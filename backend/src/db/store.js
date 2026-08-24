/**
 * db/store.js — minimal JSON-file-backed off-chain store.
 *
 * Why a flat JSON file and not Postgres/SQLite/IPFS: explicit hackathon-scope
 * simplification (see README "why these choices" + PRD Non-Goals). This is
 * the durable side of the "off-chain compute, on-chain verification" split —
 * the chain only ever sees a signed verdict hash; the *itemized* verdict
 * (per-check breakdown, extracted fields, raw confidence) lives here, keyed
 * by submissionHash so the dashboard can look it up after hearing a
 * MilestoneApproved/MilestoneRejected event on-chain.
 *
 * Concurrency model: hackathon-appropriate, not production-appropriate. All
 * writes go through a single in-process write queue (`writeChain`) so two
 * concurrent submissions can't interleave a read-modify-write and clobber
 * each other. This is NOT safe across multiple server processes — if this
 * were to run horizontally scaled, this file would need to become an actual
 * database. Flagged here rather than silently left as a landmine.
 */

const fs = require("fs/promises");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "..", "data", "submissions.json");

/** @type {Promise<any>} tail of the in-process write queue, see module doc */
let writeChain = Promise.resolve();

/**
 * Shape of the on-disk file:
 * {
 *   "submissions": {
 *     "<submissionHash>": {
 *       submissionHash, milestoneId, contractId,
 *       receivedAt, requiredDocType,
 *       extraction: { ...raw extractor output... },
 *       verdict: { pass, confidence, checks[], timestamp, rulesHash, submissionHash },
 *       attestation: { signature, signerAddress },
 *       chain: { status: "pending"|"confirmed"|"failed", txHash, blockNumber, error },
 *     }
 *   },
 *   "byMilestone": { "<milestoneId>": ["<submissionHash>", ...] }  // newest last
 * }
 */
async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { submissions: {}, byMilestone: {} };
    }
    throw err;
  }
}

async function writeDb(db) {
  const tmpPath = `${DB_PATH}.tmp`;
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  // Write-then-rename so a crash mid-write can never leave submissions.json
  // truncated or half-written — the store is only ever read as of a
  // complete prior write.
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmpPath, DB_PATH);
}

/** Queue `fn` (an async fn taking the current db and returning the next db)
 *  onto the write chain, so concurrent callers serialize instead of racing. */
function enqueueWrite(fn) {
  const result = writeChain.then(async () => {
    const db = await readDb();
    const nextDb = await fn(db);
    await writeDb(nextDb);
    return nextDb;
  });
  // Swallow rejection in the chain itself (so one failed write doesn't wedge
  // the queue forever) but still let this call's caller see the error.
  writeChain = result.catch(() => {});
  return result;
}

/**
 * Persist a new submission record. Called once per upload, before the
 * chain-submit step, with chain.status = "pending" — updated afterward via
 * updateSubmissionChainStatus() once the relayer tx lands (or fails).
 */
async function createSubmission(record) {
  const { submissionHash, milestoneId } = record;
  if (!submissionHash) throw new Error("createSubmission: submissionHash required");

  await enqueueWrite((db) => {
    db.submissions[submissionHash] = record;
    const key = String(milestoneId);
    db.byMilestone[key] = db.byMilestone[key] || [];
    db.byMilestone[key].push(submissionHash);
    return db;
  });

  return record;
}

/** Patch the chain-status sub-object of an existing submission (e.g. after
 *  the relayer tx confirms or reverts). No-ops silently if the hash is
 *  unknown, since this is called from a best-effort background step. */
async function updateSubmissionChainStatus(submissionHash, chainPatch) {
  await enqueueWrite((db) => {
    const existing = db.submissions[submissionHash];
    if (existing) {
      existing.chain = { ...existing.chain, ...chainPatch };
    }
    return db;
  });
}

async function getSubmission(submissionHash) {
  const db = await readDb();
  return db.submissions[submissionHash] || null;
}

/** Newest-first list of submissions for a milestone. */
async function listSubmissionsForMilestone(milestoneId) {
  const db = await readDb();
  const hashes = db.byMilestone[String(milestoneId)] || [];
  return hashes
    .slice()
    .reverse()
    .map((h) => db.submissions[h])
    .filter(Boolean);
}

module.exports = {
  createSubmission,
  updateSubmissionChainStatus,
  getSubmission,
  listSubmissionsForMilestone,
};
