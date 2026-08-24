# DocuGuard — Technical Requirements Document (TRD)
**AI-Audited Self-Executing Public Procurement & Vendor Contracts**

---

## 1. System Architecture Overview

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐     ┌──────────────────┐
│   Vendor UI   │────▶│  Ingestion API    │────▶│  AI Verification    │────▶│  Attestation       │
│ (upload doc)  │     │ (Node/FastAPI)    │     │  Agent (multimodal  │     │  Signer Service    │
└──────────────┘     └──────────────────┘     │  LLM + rules engine)│     │  (EIP-712 signing) │
                                                └────────────────────┘     └────────┬──────────┘
                                                                                     │ signed verdict
                                                                                     ▼
┌──────────────┐     ┌──────────────────────────────────────────────────────────────────────┐
│  Block        │◀────│              DocuGuardMilestone.sol (on testnet, e.g. Sepolia)         │
│  Explorer /   │     │  verifyAndAdvance(verdict, signature) → checks signer, updates state,   │
│  Dashboard    │     │  emits MilestoneApproved/Rejected, unlocks escrow tranche               │
└──────────────┘     └──────────────────────────────────────────────────────────────────────┘
```

**Design pattern:** off-chain compute, on-chain verification. The AI never runs on-chain (infeasible/expensive). Instead, an off-chain **Attestation Signer Service** acts as your oracle: it runs the AI verdict, signs a structured result with a private key, and the smart contract's only job is to cheaply verify that signature and the verdict's constraints on-chain. This is the same trust pattern as Chainlink Functions / any oracle — say this explicitly to judges, it signals architectural maturity.

---

## 2. Components

### 2.1 Tender Rule Store
- A structured JSON document per contract, defining milestones as machine-readable rules:
```json
{
  "contractId": "TENDER-2026-0143",
  "vendor": "0xVendorAddress...",
  "milestones": [
    {
      "id": 2,
      "description": "Rebar delivery — Phase 2",
      "expectedItem": "Rebar 12mm",
      "expectedQty": 500,
      "unit": "units",
      "unitPriceUSD": 12.00,
      "toleranceQtyPct": 2,
      "toleranceDeliveryWindowDays": 5,
      "requiredDocType": ["invoice", "delivery_receipt"]
    }
  ]
}
```
- Stored off-chain (Postgres/IPFS for hackathon), hash committed on-chain per milestone at contract creation so rules can't be silently altered later (`bytes32 rulesHash`).

### 2.2 Ingestion API
- Accepts file upload (PDF/image), stores in temp storage, returns a `submissionId`.
- Kicks off async AI verification job.

### 2.3 AI Verification Agent
Two-stage pipeline:

**Stage A — Extraction (multimodal):**
- Input: uploaded image/PDF + expected schema.
- Use a vision-capable LLM (e.g., Claude or GPT-4V-class model) with a structured-output prompt to extract: item description, quantity, unit price, dates, vendor name, any stamps/signatures visible.
- Output: strict JSON matching a defined schema (reject/retry if malformed).

**Stage B — Cross-Verification (rules + reasoning):**
- Deterministic rule checks first (cheap, auditable): quantity within tolerance? price within tolerance? date within window? document type correct?
- LLM reasoning pass only for ambiguous/qualitative checks (e.g., "does this progress photo plausibly show 60% foundation completion per the milestone description?").
- Combine into a single verdict object:
```json
{
  "submissionId": "sub_9f21",
  "contractId": "TENDER-2026-0143",
  "milestoneId": 2,
  "pass": false,
  "confidence": 0.94,
  "checks": [
    {"rule": "quantity", "expected": 500, "found": 420, "status": "FAIL", "detail": "16% shortfall exceeds 2% tolerance"},
    {"rule": "unitPrice", "expected": 12.00, "found": 12.00, "status": "PASS"},
    {"rule": "docType", "status": "PASS"}
  ],
  "timestamp": 1755000000
}
```
- **Why deterministic checks run first:** keeps the system auditable and reduces reliance on LLM judgment for anything with a clear numeric answer — reserve the LLM for genuinely qualitative assessment (e.g. photo plausibility). This is also a strong point to make to judges about responsible AI-in-the-loop design.

### 2.4 Attestation Signer Service
- Takes the verdict JSON, hashes it, signs it using **EIP-712 typed data** with a dedicated "oracle" private key (hackathon: a hot wallet held by your backend; production: a decentralized oracle network or MPC/TEE-backed signer).
- Returns `(verdict, signature)` to the frontend/backend, which submits the transaction.

### 2.5 Smart Contract — `DocuGuardMilestone.sol`

Core responsibilities: verify the signature came from the trusted oracle address, verify the verdict references the correct contract/milestone/rulesHash, and if `pass == true`, advance state and unlock funds.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract DocuGuardMilestone is EIP712 {
    using ECDSA for bytes32;

    enum State { PENDING, UNDER_REVIEW, APPROVED, REJECTED, PAID }

    struct Milestone {
        bytes32 rulesHash;      // hash of off-chain tender rules for this milestone
        uint256 tranche;        // payment amount in wei (or stablecoin units)
        State state;
    }

    address public immutable oracleSigner;   // Attestation Signer Service address
    address public immutable vendor;
    address public immutable procuringEntity;
    mapping(uint256 => Milestone) public milestones; // milestoneId => Milestone

    bytes32 private constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 milestoneId,bytes32 rulesHash,bool pass,uint256 timestamp,bytes32 submissionHash)"
    );

    event MilestoneApproved(uint256 indexed milestoneId, bytes32 submissionHash);
    event MilestoneRejected(uint256 indexed milestoneId, bytes32 submissionHash);
    event TranchePaid(uint256 indexed milestoneId, uint256 amount);

    error InvalidSigner();
    error MilestoneNotPending();
    error RulesHashMismatch();

    constructor(address _oracleSigner, address _vendor, address _procuringEntity)
        EIP712("DocuGuardMilestone", "1")
    {
        oracleSigner = _oracleSigner;
        vendor = _vendor;
        procuringEntity = _procuringEntity;
    }

    function initMilestone(uint256 milestoneId, bytes32 rulesHash, uint256 tranche) external {
        require(msg.sender == procuringEntity, "only procuring entity");
        milestones[milestoneId] = Milestone(rulesHash, tranche, State.PENDING);
    }

    function verifyAndAdvance(
        uint256 milestoneId,
        bytes32 rulesHash,
        bool pass,
        uint256 timestamp,
        bytes32 submissionHash,
        bytes calldata signature
    ) external {
        Milestone storage m = milestones[milestoneId];
        if (m.state != State.PENDING) revert MilestoneNotPending();
        if (m.rulesHash != rulesHash) revert RulesHashMismatch();

        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, milestoneId, rulesHash, pass, timestamp, submissionHash)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        if (recovered != oracleSigner) revert InvalidSigner();

        if (pass) {
            m.state = State.APPROVED;
            emit MilestoneApproved(milestoneId, submissionHash);
            _releaseTranche(milestoneId);
        } else {
            m.state = State.REJECTED;
            emit MilestoneRejected(milestoneId, submissionHash);
        }
    }

    function _releaseTranche(uint256 milestoneId) internal {
        Milestone storage m = milestones[milestoneId];
        m.state = State.PAID;
        // NOTE: hackathon — mock transfer or testnet ERC20; production — escrow-held funds
        (bool ok, ) = vendor.call{value: m.tranche}("");
        require(ok, "transfer failed");
        emit TranchePaid(milestoneId, m.tranche);
    }

    function resubmit(uint256 milestoneId) external {
        require(msg.sender == vendor, "only vendor");
        require(milestones[milestoneId].state == State.REJECTED, "not rejected");
        milestones[milestoneId].state = State.PENDING;
    }
}
```

Notes for judges/README:
- Uses **EIP-712** (not a raw hash sign) so the signed data is human-readable in wallets — a real security best practice, worth highlighting.
- `rulesHash` binding prevents the oracle from attesting against stale/tampered rules.
- State machine is intentionally simple and auditable — every transition is an event.

### 2.6 Frontend Dashboard
- Milestone state list, submission history with verdict detail (itemized checks), block explorer links per transaction. React + wagmi/viem + ethers is the standard stack; keep it minimal for hackathon time budget.

---

## 3. Data Flow (Sequence)

1. Procuring entity calls `initMilestone()` with the hash of the agreed rules.
2. Vendor uploads document via frontend → Ingestion API.
3. Ingestion API → AI Verification Agent (extraction → cross-check) → Verdict JSON.
4. Verdict JSON → Attestation Signer Service → EIP-712 signature.
5. Frontend/backend submits `verifyAndAdvance()` to the contract with verdict + signature.
6. Contract verifies signer + rulesHash → updates state → emits event → (if pass) releases tranche.
7. Dashboard listens for events, updates UI, shows itemized reasoning (pulled from off-chain verdict store, keyed by `submissionHash`).

---

## 4. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Smart contracts | Solidity 0.8.24, OpenZeppelin (ECDSA, EIP712) | Battle-tested primitives, fast to build on |
| Contract dev/test | Foundry (forge) | Fast local testing, gas reporting built in |
| Testnet | Sepolia (or Base Sepolia for lower gas) | Wide faucet availability, standard for demos |
| AI extraction | Claude (vision-capable) or GPT-4V-class API | Multimodal document + image understanding |
| Backend | Node.js (Express/Fastify) or Python (FastAPI) | Fast to wire AI SDK + ethers/web3 signing |
| Signing | ethers.js `_signTypedData` (EIP-712) | Matches on-chain verifier exactly |
| Frontend | React + viem/wagmi | Standard wallet-connect + contract-read stack |
| Off-chain rule/verdict store | Postgres or simple JSON + IPFS pinning for verdict hash | Keeps full reasoning auditable off-chain, hash on-chain |

---

## 5. Security Considerations & Audit Checklist

| # | Item | Status/Notes |
|---|---|---|
| 1 | Signature verification uses EIP-712 typed data, not raw `ecrecover` on ambiguous bytes | ✅ Implemented |
| 2 | Oracle signer key is a single point of trust — documented as known limitation | ⚠️ Disclosed; roadmap: multi-oracle threshold signing |
| 3 | `rulesHash` binds verdict to specific agreed rules, preventing rule-tampering replay | ✅ Implemented |
| 4 | Reentrancy on `_releaseTranche` external call | ⚠️ Use checks-effects-interactions (state set to PAID before transfer) — already ordered correctly above; add `ReentrancyGuard` for defense-in-depth |
| 5 | Replay protection (can the same signature be reused?) | ✅ State check (`MilestoneNotPending`) prevents re-use once processed |
| 6 | Integer/units handling for price & tolerance | Use fixed-point (e.g., cents) not floats; validate off-chain before signing |
| 7 | Access control on `initMilestone` / `resubmit` | ✅ Restricted to procuring entity / vendor respectively |
| 8 | Oracle downtime / liveness | Document as risk; fallback manual-override role for procuring entity (stretch goal) |
| 9 | AI hallucination / adversarial document (e.g. doctored image) | Confidence threshold + human-in-the-loop for low-confidence verdicts (S1 in PRD) |
| 10 | Front-running of `verifyAndAdvance` | Low risk — no economic incentive to front-run someone else's milestone approval, but note it |
| 11 | Denial-of-service via repeated invalid submissions | Rate-limit at Ingestion API layer |
| 12 | Upgradability | Hackathon: immutable contract per project. Roadmap: proxy pattern + timelock for rule updates |

---

## 6. Performance Benchmarks (to capture during hackathon and report)

| Metric | How to measure | Target |
|---|---|---|
| AI extraction latency | Time from upload to Verdict JSON | Report actual (~5–15s typical for vision LLM calls) |
| End-to-end latency | Upload → on-chain event confirmed | < 60s on testnet |
| Gas cost: `initMilestone` | `forge test --gas-report` | Report actual |
| Gas cost: `verifyAndAdvance` (pass path) | `forge test --gas-report` | Report actual, compare to a naive "store full document hash + manual multisig approval" baseline to show efficiency gain |
| False-positive/negative rate | Run 10 crafted test documents (5 valid, 5 with deliberate errors) through pipeline | 0 misclassifications on your test set — report honestly if not |

---

## 7. Deployment Plan

1. `forge build` + `forge test` locally with mocked oracle signatures.
2. Deploy `DocuGuardMilestone` to Sepolia via `forge script` with verified source (Etherscan verification — judges love seeing a verified contract).
3. Fund contract with testnet ETH (or deploy a mock ERC20 "USDG" token for tranche payments — cleaner demo than raw ETH transfers).
4. Deploy backend (Ingestion API + AI Agent + Signer Service) to a small cloud instance or run locally via ngrok for live demo.
5. Record a backup video of the full happy-path + failure-path flow in case live demo networking fails.

---

## 8. AI Integration Documentation (required deliverable)

- **Model(s) used:** vision-capable LLM for document/image extraction; same or lighter model for qualitative milestone-plausibility reasoning.
- **Prompting strategy:** structured-output (JSON schema) prompting for extraction; separate, narrower prompt for qualitative checks with explicit rubric tied to milestone description.
- **Determinism boundary:** all numeric/tolerance checks are deterministic code, not LLM judgment — LLM only used for extraction and qualitative assessment. This is the key design decision to call out — it directly addresses the "can we trust the AI" question judges will ask.
- **Fallback behavior:** malformed extraction → automatic retry once → if still malformed, verdict = `pass: false, reason: "extraction_failed"` (fail-safe, never fail-open).

---

## 9. Open Questions / Roadmap (show judges you know what's next)

- Decentralize the oracle (Chainlink Functions, or a committee of independent AI agents with threshold signing) to remove single-signer trust.
- Real escrow integration with actual procurement payment rails.
- Formal audit before any mainnet/production use — this is a hackathon prototype, not production-ready financial infrastructure.
