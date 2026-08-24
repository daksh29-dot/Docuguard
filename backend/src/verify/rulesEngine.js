const { keccak256, toUtf8Bytes } = require("ethers");

function computeRulesHash(tender, milestone) {
  // Build the canonical pipe-delimited string that exactly matches the format
  // committed on-chain by contracts/script/Deploy.s.sol — any deviation here
  // will cause verifyAndAdvance() to revert with RulesHashMismatch.
  // Format: "{contractId}|milestone:{milestoneId}|item:{expectedItem}|qty:{expectedQty}|unit:{unit}|unitPriceUSD:{unitPriceUSD}|tolQtyPct:{tolQtyPct}|tolDeliveryDays:{tolDeliveryDays}"
  const tolQtyPct = milestone.tolQtyPct ?? milestone.tolerances?.qtyPct ?? 0;
  const tolDeliveryDays = milestone.tolDeliveryDays ?? milestone.tolerances?.deliveryDays ?? 0;

  const rawString = `${tender.contractId}|milestone:${milestone.milestoneId}|item:${milestone.expectedItem}|qty:${milestone.expectedQty}|unit:${milestone.unit}|unitPriceUSD:${Number(milestone.unitPriceUSD).toFixed(2)}|tolQtyPct:${tolQtyPct}|tolDeliveryDays:${tolDeliveryDays}`;

  return keccak256(toUtf8Bytes(rawString));
}

function runRulesEngine({ tender, milestone, extraction, submissionMeta }) {
  const rulesHash = computeRulesHash(tender, milestone);
  // Unique hash per submission combining timestamp and filename
  const submissionHash = keccak256(toUtf8Bytes(submissionMeta.receivedAt + submissionMeta.originalFilename));

  // Fail-safe: extraction failed — build a complete verdict with pass:false
  // and all required keys so server.js can still sign and persist it.
  if (extraction.failed) {
    return {
      pass: false,
      confidence: 0,
      checks: [],
      timestamp: Math.floor(Date.now() / 1000),
      rulesHash,
      submissionHash,
      reason: extraction.failureReason || "extraction_failed",
    };
  }

  const { fields, confidence } = extraction;
  const checks = [];
  
  // Deterministic checks
  const isCorrectDoc = fields.documentType === milestone.requiredDocType;
  checks.push({ id: "docType", pass: isCorrectDoc, detail: `Expected ${milestone.requiredDocType}, got ${fields.documentType}` });

  const tolQtyPct = milestone.tolQtyPct ?? milestone.tolerances?.qtyPct ?? 0;
  const qtyLowerBound = milestone.expectedQty * (1 - (tolQtyPct / 100));
  const isQtyValid = typeof fields.quantity === "number" && fields.quantity >= qtyLowerBound;
  checks.push({ id: "quantity", pass: isQtyValid, detail: `Expected >= ${qtyLowerBound}, got ${fields.quantity}` });

  // Final boolean verdict
  const pass = isCorrectDoc && isQtyValid && (confidence >= 0.8) && (fields.anomalies.length === 0);

  return {
    pass,
    confidence,
    checks,
    timestamp: Math.floor(Date.now() / 1000),
    rulesHash,
    submissionHash
  };
}

module.exports = { computeRulesHash, runRulesEngine };