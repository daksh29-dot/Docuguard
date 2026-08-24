# DocuGuard — Product Requirements Document (PRD)
**AI-Audited Self-Executing Public Procurement & Vendor Contracts**
Track 3: Smart Contracts Powered by AI

---

## 1. Executive Summary

Public procurement and municipal vendor payments are gated by manual document review: an official reads an invoice, cross-checks it against a tender agreement, inspects photos of delivered goods or construction progress, and — days or weeks later — approves a milestone payment. This is slow, inconsistent between reviewers, and a common site of both honest error and corruption.

**DocuGuard replaces the human compliance-checking bottleneck with a multimodal AI agent that cross-verifies vendor submissions (invoices, OCR'd receipts, progress photos) against machine-readable tender rules, then issues a signed cryptographic attestation that a smart contract verifies on-chain before releasing the next tranche of funds.**

The result: milestone approval time drops from days to minutes, every rejection comes with an itemized, auditable reason, and the approval logic is transparent and tamper-evident because it lives partly on-chain.

---

## 2. Problem Statement

| Pain Point | Current State | Impact |
|---|---|---|
| Slow compliance review | Manual invoice/receipt checking by procurement officers | Payment delays of days–weeks, project stalls |
| Inconsistent judgment | Different reviewers apply tender rules differently | Vendor disputes, appeals, rework |
| Opaque rejections | Vendors get vague "non-compliant" notices | Repeated back-and-forth, wasted cycles |
| Corruption surface | Human discretion in high-value approvals | Bribery risk, favoritism, audit difficulty |
| Poor auditability | Paper trails / siloed PDFs | Hard to reconstruct decisions after the fact |

**Who feels this:** municipal procurement officers, government contractors/vendors (especially SMEs who can't afford compliance staff), auditors, and ultimately taxpayers.

---

## 3. Goals & Non-Goals

### Goals (Hackathon Scope)
- G1: Vendor can submit a document (invoice/receipt/progress photo) through a simple UI.
- G2: An AI agent parses the document and cross-verifies it against a machine-readable tender rule set (quantities, unit prices, milestone deliverable descriptions).
- G3: The agent produces a structured, itemized compliance verdict (pass/fail + reasons).
- G4: A cryptographic attestation of that verdict is submitted to a smart contract on a public testnet.
- G5: The smart contract verifies the attestation and — only if valid and passing — advances the project's on-chain milestone state and unlocks the next payment tranche.
- G6: A clear, live demo: one submission that fails (formatting/quantity error) with itemized rejection, one that passes and advances contract state.

### Non-Goals (out of scope for hackathon, noted as roadmap)
- Real fiat/CBDC payment rails (we use testnet ETH/stablecoin mock instead)
- Full legal-grade e-signature / KYC of vendors
- Multi-language OCR robustness at production scale
- DAO-style dispute arbitration (flagged as future work)
- Training a custom ML model — we use an existing multimodal LLM API, not a from-scratch model (this is a legitimate, common pattern; judges care about integration quality, not that you trained a foundation model in a weekend)

---

## 4. Target Users / Personas

**1. Procurement Officer ("Priya")** — oversees 20+ active municipal contracts, currently manually reviews every milestone submission. Wants faster throughput without losing control/audit trail.

**2. Vendor / Contractor ("Marco")** — small construction/supply company. Wants fast, predictable, transparent approval so cash flow doesn't stall.

**3. Auditor / Oversight Body ("Amara")** — needs to reconstruct *why* a payment was approved, months later, without relying on someone's memory.

---

## 5. Core User Story (Demo Flow)

> As a vendor, I upload a delivery receipt or invoice against Milestone 2 of my contract.
> The AI agent reads it, compares it against the tender's rule set (expected item, quantity, unit price, delivery date window).
> - **If it fails** (e.g., quantity mismatch), I immediately see an itemized rejection: *"Expected 500 units of rebar @ $12/unit; submitted invoice shows 420 units — 16% shortfall. Rejected."*
> - **If it passes**, the AI issues a signed attestation, the smart contract verifies it on-chain, the milestone state flips from `PENDING` → `APPROVED`, and the next tranche becomes claimable — all visible on a block explorer.

---

## 6. Feature List

### MVP (must demo)
| # | Feature | Priority |
|---|---|---|
| 1 | Tender rule ingestion (structured JSON: milestones, expected items, qty, unit price, tolerance) | P0 |
| 2 | Document upload UI (invoice/receipt/photo) | P0 |
| 3 | Multimodal AI parsing (OCR + vision-language extraction of line items) | P0 |
| 4 | Rule-based + LLM cross-verification engine → structured verdict JSON | P0 |
| 5 | Itemized rejection reasoning surfaced to vendor | P0 |
| 6 | Off-chain signer produces EIP-712 signed attestation of verdict | P0 |
| 7 | Smart contract verifies signature + verdict, updates milestone state | P0 |
| 8 | Milestone state machine (PENDING → UNDER_REVIEW → APPROVED/REJECTED → PAID) | P0 |
| 9 | Testnet deployment + block explorer link in demo | P0 |
| 10 | Simple dashboard: contract state, submission history, verdicts | P1 |

### Stretch Goals (impressive if time allows)
| # | Feature |
|---|---|
| S1 | Confidence score + human-in-the-loop override for low-confidence verdicts |
| S2 | Multi-oracle attestation (2-of-3 AI agents must agree) to reduce single-model risk |
| S3 | On-chain event feed → auto-notify vendor via webhook/email |
| S4 | Parametric insurance mini-module reusing the same verification engine (shows track versatility) |
| S5 | Gas benchmark comparison: on-chain verification vs. naive full-data-on-chain approach |

---

## 7. Success Metrics (for judging + your own validation)

| Metric | Target for Demo |
|---|---|
| End-to-end latency (upload → on-chain state update) | < 60 seconds |
| Rejection reasoning specificity | Itemized, references exact rule violated |
| False approval rate on test set (10 crafted documents) | 0 on obvious violations |
| On-chain gas cost per milestone verification | Reported and benchmarked |
| Security checklist completion | 100% of checklist items addressed or explicitly deferred with rationale |

---

## 8. Why This Wins the Track (Judging Alignment)

Hackathon judges for an "AI-powered smart contracts" track typically score on: **technical depth, real-world utility, novelty, demo polish, and completeness of deliverables.** Map explicitly:

- **Real-world data / decisions** → tender rules + document parsing is exactly "context-aware execution based on real-world data."
- **Oracle systems** → the AI attestation service *is* your oracle; name it as such explicitly in your pitch.
- **Automated decision engines** → the verdict engine.
- **Deliverables match the brief exactly**: deployed testnet contract ✅, AI integration doc ✅ (this + TRD), performance benchmarks ✅, security checklist ✅.
- **Public good framing** (anti-corruption, government efficiency) is a strong narrative differentiator vs. the more common "DeFi yield bot" submissions — lead with this in your pitch.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| AI misreads a document → wrongful rejection/approval | Confidence threshold + human override path (S1); log full reasoning on-chain/IPFS for appeal |
| Oracle (AI signer) is a centralization/trust bottleneck | Explicitly disclose this as a known limitation; propose multi-oracle roadmap (S2) |
| Judges ask "why not just use Chainlink Functions?" | Have an answer ready: Chainlink Functions/Automation is a great production path for the off-chain compute → on-chain callback pattern; for the hackathon you're simulating that pattern with your own signer service, and you name this explicitly as the production upgrade path |
| Demo document parsing fails live | Pre-test with your exact demo files repeatedly; have a recorded backup clip |
| Scope creep | MVP list above is the hard cutoff; stretch goals only after MVP is demo-stable |

---

## 10. Suggested Hackathon Timeline

| Phase | Time | Output |
|---|---|---|
| Setup | Hr 0–2 | Repo, tender rule JSON schema, contract skeleton, testnet wallet/faucet funds |
| Core build | Hr 2–10 | AI parsing pipeline, verdict engine, EIP-712 signer, smart contract, deploy to testnet |
| Integration | Hr 10–16 | Wire frontend upload → AI → signature → contract call; end-to-end happy path working |
| Hardening | Hr 16–20 | Failure-path demo document, security checklist pass, gas benchmarking |
| Polish | Hr 20–24 | Dashboard UI pass, pitch deck, rehearse demo twice end-to-end |

