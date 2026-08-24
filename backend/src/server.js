/**
 * server.js — DocuGuard backend entry point.
 *
 * This process IS the Ingestion API + AI Verification Agent + Attestation
 * Signer, combined into one Node/Express service (explicit hackathon-speed
 * scoping decision — see README). It stays *organizationally* separable:
 * each pipeline stage below is one call into its own module, not inlined
 * logic, so any stage could be pulled into its own service later without
 * restructuring the pipeline itself.
 *
 * Pipeline for a submission (see POST /api/milestones/:milestoneId/submissions):
 *
 *   upload → ai/extract.js (Gemini vision)
 *          → verify/rulesEngine.js (deterministic checks first, verdict JSON)
 *          → signer/attestation.js (EIP-712 sign the verdict)
 *          → chain/submit.js (relayer calls verifyAndAdvance on-chain)
 *          → db/store.js (persist itemized verdict, keyed by submissionHash)
 *
 * Fail-safe, not fail-open, at every stage: if extraction fails, or is
 * ambiguous, or the chain submission itself errors, the recorded verdict
 * never silently becomes a pass. See tender-example.json's
 * `failSafeDefault` for the exact fallback shapes.
 *
 * NOTE ON BUILD ORDER: ai/extract.js, verify/rulesEngine.js,
 * signer/attestation.js, and chain/submit.js are the next files in the
 * build plan and do not exist yet as of this file being written. This file
 * imports them by the exact paths/export names documented in the handover
 * (§5) and in the JSDoc typedefs below — when those modules are built,
 * their exports MUST match these signatures, or wire them up here again.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const tender = require("../data/tender-example.json");
const store = require("./db/store");

// --- Pipeline stage modules -------------------------------------------
// Forward-declared imports: see NOTE ON BUILD ORDER above. Each is wrapped
// in a try/require so this file can be loaded (and its routes registered)
// even before the later files exist, rather than crashing the whole
// process — routes that need a not-yet-built stage return 501 until then.
const extractStage = tryRequire("./ai/extract");
const rulesStage = tryRequire("./verify/rulesEngine");
const signerStage = tryRequire("./signer/attestation");
const chainStage = tryRequire("./chain/submit");

function tryRequire(modulePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") return null;
    throw err; // a real bug in an existing module should still crash loudly
  }
}

/**
 * Expected shape of ai/extract.js:
 *   async function extractFromDocument({ fileBuffer, mimeType, expectedItem, requiredDocType })
 *     -> { fields: {...extracted...}, confidence: number (0-1), notes: string, raw: any }
 *   Must never throw for "the document doesn't match" — that's a low-
 *   confidence/mismatched extraction, not an exception. Only throws for
 *   actual infra failure (Gemini API unreachable, malformed response after
 *   the documented retry-once).
 *
 * Expected shape of verify/rulesEngine.js:
 *   function computeRulesHash(milestoneConfig) -> "0x..." (bytes32 hex)
 *     — must build the string via tender.rulesHashScheme.template and
 *     keccak256(toUtf8Bytes(...)), matching Deploy.s.sol byte-for-byte.
 *   function runRulesEngine({ tender, milestone, extraction, submissionMeta })
 *     -> { pass, confidence, checks: [{ id, description, pass, detail }],
 *          timestamp, rulesHash, submissionHash, reason? }
 *
 * Expected shape of signer/attestation.js:
 *   async function signVerdict({ milestoneId, rulesHash, pass, timestamp, submissionHash })
 *     -> { signature: "0x...", signerAddress: "0x..." }
 *   EIP-712 domain/types MUST match DocuGuardMilestone.sol's VERDICT_TYPEHASH
 *   exactly (see handover §4 item 2 and §6).
 *
 * Expected shape of chain/submit.js:
 *   async function submitVerdict({ milestoneId, rulesHash, pass, timestamp, submissionHash, signature })
 *     -> { txHash, blockNumber, status: "confirmed" | "failed", error? }
 *   async function getMilestoneState(milestoneId)
 *     -> { state: "PENDING"|"UNDER_REVIEW"|"APPROVED"|"REJECTED"|"PAID", rulesHash, tranche }
 */

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Uploaded documents (invoices, photos) are small and short-lived — kept in
// memory and handed straight to the extraction stage, never written to
// disk. Nothing for a vendor to accidentally leave lying around server-side.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — generous for a photo/invoice scan
});

// -------------------------------------------------------------------------
// Health / info
// -------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "docuguard-backend",
    pipelineReady: {
      extract: !!extractStage,
      rulesEngine: !!rulesStage,
      signer: !!signerStage,
      chain: !!chainStage,
    },
  });
});

app.get("/api/tender", (req, res) => {
  // Strip internal documentation fields before exposing to the frontend —
  // the dashboard needs the rules, not the hashing-scheme essay.
  const { _comment, rulesHashScheme, ...publicTender } = tender;
  res.json(publicTender);
});

// -------------------------------------------------------------------------
// Milestones
// -------------------------------------------------------------------------

function findMilestone(milestoneId) {
  return tender.milestones.find((m) => String(m.milestoneId) === String(milestoneId));
}

app.get("/api/milestones/:milestoneId", async (req, res) => {
  const milestone = findMilestone(req.params.milestoneId);
  if (!milestone) return res.status(404).json({ error: "unknown_milestone" });

  const submissions = await store.listSubmissionsForMilestone(req.params.milestoneId);

  let onChain = null;
  if (chainStage) {
    try {
      onChain = await chainStage.getMilestoneState(req.params.milestoneId);
    } catch (err) {
      // On-chain read failures shouldn't take down the whole response — the
      // dashboard can still show off-chain history with a "state unknown"
      // badge. Logged, not swallowed.
      console.error(`[milestones] on-chain read failed for ${req.params.milestoneId}:`, err.message);
    }
  }

  res.json({
    milestone,
    onChain,
    submissionCount: submissions.length,
    latestSubmission: submissions[0] || null,
  });
});

app.get("/api/milestones/:milestoneId/submissions", async (req, res) => {
  const milestone = findMilestone(req.params.milestoneId);
  if (!milestone) return res.status(404).json({ error: "unknown_milestone" });
  const submissions = await store.listSubmissionsForMilestone(req.params.milestoneId);
  res.json({ submissions });
});

app.get("/api/submissions/:submissionHash", async (req, res) => {
  const submission = await store.getSubmission(req.params.submissionHash);
  if (!submission) return res.status(404).json({ error: "unknown_submission" });
  res.json({ submission });
});

// -------------------------------------------------------------------------
// The core pipeline: vendor document upload → verdict → attestation → chain
// -------------------------------------------------------------------------

app.post(
  "/api/milestones/:milestoneId/submissions",
  upload.single("document"),
  async (req, res) => {
    const milestone = findMilestone(req.params.milestoneId);
    if (!milestone) return res.status(404).json({ error: "unknown_milestone" });
    if (!req.file) return res.status(400).json({ error: "missing_document", detail: "expected multipart field 'document'" });

    if (!extractStage || !rulesStage || !signerStage) {
      // Pipeline stages not built yet — see NOTE ON BUILD ORDER at top of file.
      return res.status(501).json({
        error: "pipeline_not_implemented",
        detail: "ai/extract.js, verify/rulesEngine.js, and signer/attestation.js must exist before submissions can be processed.",
      });
    }

    try {
      const receivedAt = new Date().toISOString();

      // 1. AI extraction (Gemini vision) — never throws on a bad/mismatched
      //    document, only on genuine infra failure.
      const extraction = await extractStage.extractFromDocument({
        fileBuffer: req.file.buffer,
        mimeType: req.file.mimetype,
        expectedItem: milestone.expectedItem,
        requiredDocType: milestone.requiredDocType,
      });

      // 2. Deterministic rules first, LLM judgment only where genuinely
      //    qualitative — see rulesEngine.js's own doc comment for the
      //    control-flow guarantee that backs this up structurally.
      const verdict = rulesStage.runRulesEngine({
        tender,
        milestone,
        extraction,
        submissionMeta: { receivedAt, originalFilename: req.file.originalname },
      });

      // 3. EIP-712 attestation over the verdict.
      const attestation = await signerStage.signVerdict({
        milestoneId: milestone.milestoneId,
        rulesHash: verdict.rulesHash,
        pass: verdict.pass,
        timestamp: verdict.timestamp,
        submissionHash: verdict.submissionHash,
      });

      // Persist before attempting the chain call — an itemized verdict must
      // exist even if the relayer tx fails, so nothing about a rejection or
      // approval is only visible on a blockchain explorer.
      await store.createSubmission({
        submissionHash: verdict.submissionHash,
        milestoneId: milestone.milestoneId,
        contractId: tender.contractId,
        receivedAt,
        requiredDocType: milestone.requiredDocType,
        extraction,
        verdict,
        attestation,
        chain: { status: "pending" },
      });

      // 4. Relayer submits verifyAndAdvance() on-chain. Best-effort from the
      //    HTTP response's point of view: the client gets the verdict
      //    immediately either way, and chain status updates the stored
      //    record asynchronously-but-awaited-here for demo simplicity.
      let chainResult = null;
      if (chainStage) {
        try {
          chainResult = await chainStage.submitVerdict({
            milestoneId: milestone.milestoneId,
            rulesHash: verdict.rulesHash,
            pass: verdict.pass,
            timestamp: verdict.timestamp,
            submissionHash: verdict.submissionHash,
            signature: attestation.signature,
          });
          await store.updateSubmissionChainStatus(verdict.submissionHash, chainResult);
        } catch (chainErr) {
          console.error(`[submissions] chain submit failed for ${verdict.submissionHash}:`, chainErr.message);
          await store.updateSubmissionChainStatus(verdict.submissionHash, {
            status: "failed",
            error: chainErr.message,
          });
        }
      }

      res.status(201).json({
        submissionHash: verdict.submissionHash,
        verdict,
        attestation: { signerAddress: attestation.signerAddress }, // never echo the signature payload unnecessarily
        chain: chainResult,
      });
    } catch (err) {
      // Anything unexpected here is an infra failure, not a document
      // judgment — surface it as a 500, don't fabricate a verdict.
      console.error("[submissions] pipeline error:", err);
      res.status(500).json({ error: "pipeline_error", detail: err.message });
    }
  }
);

// -------------------------------------------------------------------------
// Error handling
// -------------------------------------------------------------------------

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "upload_error", detail: err.message });
  }
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

// -------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`DocuGuard backend listening on :${PORT}`);
    console.log(
      `Pipeline stages ready: extract=${!!extractStage} rulesEngine=${!!rulesStage} signer=${!!signerStage} chain=${!!chainStage}`
    );
  });
}

module.exports = app; // exported for tests / future supertest coverage
