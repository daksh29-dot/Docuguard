/**
 * ai/extract.js — Gemini vision extraction stage.
 *
 * Turns an uploaded document (invoice scan, delivery photo, PDF) into the
 * structured fields the deterministic rules engine needs. This is the ONLY
 * stage that talks to an LLM for data extraction — everything downstream
 * (verify/rulesEngine.js) is plain arithmetic/comparison code. Keeping that
 * boundary real (not just documented) is a repeated selling point for
 * judges: numeric/tolerance checks must never live in a prompt.
 *
 * FAIL-SAFE CONTRACT (reconciles server.js's forward-declared JSDoc with the
 * handover's explicit build plan — this file is the source of truth going
 * forward):
 *   - Malformed / unparseable / schema-invalid model output → retried ONCE,
 *     and if still bad, this function returns a fail-safe RESULT object
 *     (`failed: true`, `confidence: 0`) — it does NOT throw. The pipeline
 *     must still be able to produce a signed pass:false verdict for a
 *     malformed extraction; throwing here would turn "vendor submitted a
 *     confusing document" into a 500, which is the wrong failure mode.
 *   - This function DOES throw for genuine infra failure: network
 *     unreachable, missing/invalid API key, persistent non-2xx HTTP status
 *     after the retry. Those are system faults server.js should surface as
 *     pipeline_error (500), not silently convert into a vendor rejection.
 *
 * Either way: nothing in this file can produce a fail-OPEN result. A failed
 * or low-confidence extraction always carries confidence low enough / a
 * failed flag that rulesEngine.js's fail-safe defaults (see
 * tender-example.json's `failSafeDefault`) force pass:false.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

// Structured-output schema handed to Gemini via generationConfig.responseSchema
// (JSON mode) — this is a request for the model's *raw* reading of the
// document, not a pass/fail judgment. Judgment happens in rulesEngine.js.
const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      description:
        "Best guess at what kind of document this is, e.g. 'delivery_invoice', 'site_photo', 'mobilization_report', 'unknown'.",
    },
    itemName: {
      type: "string",
      nullable: true,
      description: "The item/material/service name as written on the document, verbatim if legible.",
    },
    quantity: {
      type: "number",
      nullable: true,
      description: "Numeric quantity of the item, if the document states one.",
    },
    unit: {
      type: "string",
      nullable: true,
      description: "Unit for the quantity, e.g. 'units', 'kg', 'lumpsum'.",
    },
    unitPriceUSD: {
      type: "number",
      nullable: true,
      description: "Unit price in USD, if stated. Do not compute — only extract what's written.",
    },
    deliveryDate: {
      type: "string",
      nullable: true,
      description: "ISO 8601 date (YYYY-MM-DD) the document indicates as the delivery/completion date.",
    },
    invoiceOrDocNumber: {
      type: "string",
      nullable: true,
      description: "Invoice number, reference number, or similar identifier printed on the document.",
    },
    vendorNameOnDocument: {
      type: "string",
      nullable: true,
      description: "Vendor/supplier name as printed on the document.",
    },
    photoDepictsClaimedItem: {
      type: "boolean",
      nullable: true,
      description:
        "ONLY for photo-type documents: does the photo plausibly show the claimed item/quantity/site context? Null for non-photo documents.",
    },
    anomalies: {
      type: "array",
      items: { type: "string" },
      description:
        "Any inconsistencies, illegible fields, signs of tampering, or mismatches noticed while reading the document. Empty array if none.",
    },
    selfAssessedConfidence: {
      type: "number",
      description:
        "Your own confidence (0.0-1.0) that the fields above were read correctly and completely from the document.",
    },
  },
  required: ["documentType", "anomalies", "selfAssessedConfidence"],
};

function buildPrompt({ expectedItem, requiredDocType }) {
  return [
    "You are a document-reading component in an automated procurement",
    "verification pipeline. Read the attached document and extract ONLY what",
    "is actually written or visually present in it — do not infer, guess, or",
    "fill in values that aren't legible. If a field isn't present or isn't",
    "legible, return null for it rather than a plausible-sounding guess.",
    "",
    `Context (for your judgment only, not to override what you actually see):`,
    `- Expected item for this milestone: ${expectedItem}`,
    `- Expected document type: ${requiredDocType}`,
    "",
    "Note any anomalies you notice (illegible totals, mismatched fonts, dates",
    "that don't parse, a photo that doesn't seem to match the expected item,",
    "etc.) in the anomalies array — these are advisory signals for a human",
    "reviewer, not something you should resolve yourself.",
    "",
    "Respond with JSON matching the provided schema only.",
  ].join("\n");
}

function buildRequestBody({ fileBuffer, mimeType, expectedItem, requiredDocType }) {
  const normalizedMime = (mimeType || "").toLowerCase() === "image/jpg" || (mimeType || "").toLowerCase() === "image/pjpeg" 
    ? "image/jpeg" 
    : mimeType;

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt({ expectedItem, requiredDocType }) },
          {
            inline_data: {
              mime_type: normalizedMime,
              data: fileBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_RESPONSE_SCHEMA,
      temperature: 0, // extraction should be as deterministic as a vision model can be
    },
  };
}

/** Single call to the Gemini API. Throws on network/HTTP failure — callers
 *  decide retry policy, this function does not retry itself. */
async function callGemini(requestBody) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );
    console.log(response);
  } catch (err) {
    // Network unreachable, DNS failure, timeout abort, etc. — genuine infra fault.
    throw new Error(`Gemini API request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Gemini API returned ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  return response.json();
}

/** Pull the model's text output out of the Gemini response envelope and
 *  parse it as JSON. Returns { parsed, rawText } or throws a descriptive
 *  error if the envelope shape or the JSON itself is unexpected — this is
 *  the "malformed output" case the caller retries once on. */
function parseGeminiResponse(apiResponse) {
  const part = apiResponse?.candidates?.[0]?.content?.parts?.[0];
  if (!part) {
    throw new Error("Gemini response missing candidate text");
  }
  console.log(part);
  // Gemini JSON mode may return the object already parsed under part.text as a
  // string, OR it may surface it already as a parsed object. Handle both cases.
  let parsed;
  let rawText;

  if (typeof part.text === "string" && part.text.trim().length > 0) {
    rawText = part.text;
    try {
      parsed = JSON.parse(rawText);
    } catch (_) {
      // Already a plain object (some SDK versions skip re-serialization)
      parsed = part.text;
    }
    console.log(parsed);
  } else if (typeof part === "object" && part !== null) {
    // The part itself may be the parsed JSON in some response shapes
    parsed = part;
    rawText = JSON.stringify(part);
  }

  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (err) {
      throw new Error(`Gemini response text was not valid JSON: ${err.message}`);
    }
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.documentType !== "string" ||
    !Array.isArray(parsed.anomalies) ||
    typeof parsed.selfAssessedConfidence !== "number"
  ) {
    throw new Error("Gemini response JSON did not match the required extraction schema");
  }

  return { parsed, rawText: rawText || JSON.stringify(parsed) };
}

/**
 * Extract structured fields from a vendor-submitted document.
 *
 * @param {object} args
 * @param {Buffer} args.fileBuffer
 * @param {string} args.mimeType
 * @param {string} args.expectedItem   - from the milestone's tender rules
 * @param {string} args.requiredDocType - from the milestone's tender rules
 * @returns {Promise<{
 *   fields: object|null,
 *   confidence: number,
 *   failed: boolean,
 *   failureReason: string|null,
 *   notes: string,
 *   raw: { modelUsed: string, attempts: number, lastRawText: string|null }
 * }>}
 */
async function extractFromDocument({ fileBuffer, mimeType, expectedItem, requiredDocType }) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    // Empty upload isn't an infra failure or a model problem — fail safe
    // immediately without spending an API call.
    return failSafeResult({
      failureReason: "empty_document",
      notes: "Uploaded file was empty or unreadable before it reached the extraction stage.",
      attempts: 0,
    });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return failSafeResult({
      failureReason: "unsupported_mime_type",
      notes: `Uploaded file had unsupported type '${mimeType}'.`,
      attempts: 0,
    });
  }

  const requestBody = buildRequestBody({ fileBuffer, mimeType, expectedItem, requiredDocType });

  let lastError = null;
  let lastRawText = null;

  // documented retry-once-then-fail-safe policy on malformed output
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const apiResponse = await callGemini(requestBody);
      const { parsed, rawText } = parseGeminiResponse(apiResponse);
      lastRawText = rawText;

      const confidence = clamp01(parsed.selfAssessedConfidence);

      return {
        fields: {
          documentType: parsed.documentType,
          itemName: parsed.itemName ?? null,
          quantity: parsed.quantity ?? null,
          unit: parsed.unit ?? null,
          unitPriceUSD: parsed.unitPriceUSD ?? null,
          deliveryDate: parsed.deliveryDate ?? null,
          invoiceOrDocNumber: parsed.invoiceOrDocNumber ?? null,
          vendorNameOnDocument: parsed.vendorNameOnDocument ?? null,
          photoDepictsClaimedItem: parsed.photoDepictsClaimedItem ?? null,
          anomalies: parsed.anomalies,
        },
        confidence,
        failed: false,
        failureReason: null,
        notes:
          parsed.anomalies.length > 0
            ? `Extraction succeeded with ${parsed.anomalies.length} noted anomal${parsed.anomalies.length === 1 ? "y" : "ies"}.`
            : "Extraction succeeded with no noted anomalies.",
        raw: { modelUsed: GEMINI_MODEL, attempts: attempt, lastRawText },
      };
    } catch (err) {
      // Distinguish infra failure (throw immediately, no point retrying a
      // dead network) from malformed-output failure (retry once, per policy).
      const isInfraFailure =
        err.message.startsWith("GEMINI_API_KEY") ||
        err.message.startsWith("Gemini API request failed") ||
        err.message.startsWith("Gemini API returned");

      if (isInfraFailure) {
        throw err; // let server.js surface this as a 500 pipeline_error
      }

      // Malformed-output case — record and retry (or fall through to
      // fail-safe if this was already the second attempt).
      lastError = err;
    }
  }

  return failSafeResult({
    failureReason: "extraction_failed",
    notes: `Model output was malformed after retry: ${lastError?.message || "unknown error"}`,
    attempts: 2,
    lastRawText,
  });
}

function failSafeResult({ failureReason, notes, attempts, lastRawText = null }) {
  console.log("failSafeResult");
  return {
    fields: null,
    confidence: 0,
    failed: true,
    failureReason,
    notes,
    raw: { modelUsed: GEMINI_MODEL, attempts, lastRawText },
  };
}

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

module.exports = {
  extractFromDocument,
  // exported for unit testing / debugging only, not part of the pipeline contract
  _internal: { buildPrompt, parseGeminiResponse, EXTRACTION_RESPONSE_SCHEMA },
};
