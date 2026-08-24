# DocuGuard

**AI-audited, self-executing public procurement & vendor contracts.**
Track 3: Smart Contracts Powered by AI.

## Demo Dashboard

Here is the running DocuGuard dashboard featuring the pitch-black and neon green theme with the live audit log, ML anomaly scoring, and on-chain milestones:

![DocuGuard Requirements & Verdict UI](assets/Screenshot%202026-08-22%20213752.png)
![DocuGuard Vendor Submission UI](assets/Screenshot%202026-08-22%20214151.png)

DocuGuard replaces manual milestone-payment review in public procurement with a
multimodal AI agent that cross-checks vendor submissions (invoices, receipts,
progress photos) against machine-readable tender rules, signs a structured
verdict, and lets a smart contract verify that signature on-chain before
releasing the next payment tranche.

> Manual review today: an official reads a PDF, eyeballs a photo, and approves
> a payment days later, inconsistently. DocuGuard turns that into a <60s,
> auditable, tamper-evident pipeline.

---

## Architecture

```
Vendor UI  ──▶  Ingestion API  ──▶  AI Verification Agent  ──▶  Attestation Signer
(upload doc)    (Express)          (Gemini vision +            (EIP-712, ethers.js)
                                     deterministic rules)              │
                                                                       │ signed verdict
                                                                       ▼
                                                        Relayer submits verifyAndAdvance()
                                                                       │
                                                                       ▼
                                              DocuGuardMilestone.sol (Base Sepolia)
                                              verifies signer + rulesHash, updates
                                              state, emits event, releases tranche
                                                                       │
                                                                       ▼
                                              Dashboard (React) ── reads events,
                                              shows itemized verdicts, explorer links
```

**Design pattern:** off-chain compute, on-chain verification. The AI never
runs on-chain. A single backend service plays three roles for hackathon
speed — Ingestion API, AI Verification Agent, and Attestation Signer — while
staying architecturally separable (see `backend/src/`). This is the same
trust pattern as Chainlink Functions or any oracle network: the contract's
only job is to cheaply verify a signature and a couple of hashes.

## Repo layout

```
contracts/   Foundry project — DocuGuardMilestone.sol, mock USDG token, tests, deploy script
backend/     Node/Express — ingestion, Gemini extraction, rules engine, EIP-712 signer, relayer
frontend/    React + viem/wagmi — upload UI, submission history, on-chain state dashboard
```

## Why these choices (for judges)

- **Determinism boundary:** every numeric/tolerance check (quantity, price,
  date window) is deterministic code, not LLM judgment. The LLM is only used
  for extraction (turning an image/PDF into structured JSON) and for
  genuinely qualitative checks (e.g. "does this photo plausibly show 60%
  foundation completion?"). This is the direct answer to "can we trust the
  AI here?"
- **EIP-712, not raw `ecrecover`** — the signed verdict is human-readable in
  a wallet, which is the actual security best practice, not just a checkbox.
- **`rulesHash` binding** — the oracle signs a verdict that references a hash
  of the agreed tender rules, committed on-chain at milestone creation. This
  stops anyone (including the oracle operator) from quietly changing the
  rules after the fact and having an old signature still be valid against
  new terms.
- **Known limitation, disclosed on purpose:** a single oracle signer is a
  centralization/trust bottleneck. Roadmap: multi-oracle threshold signing
  (2-of-3 independent agents), or Chainlink Functions in production. We name
  this explicitly rather than hide it.
- **Fail-safe, not fail-open:** if AI extraction is malformed after one
  retry, the verdict is `pass: false, reason: "extraction_failed"` — it
  never defaults to approving a payment it couldn't actually read.

## Status

Hackathon prototype. Not production-ready financial infrastructure — no
real KYC, no real payment rails (mock ERC20 "USDG" on testnet), single
oracle signer, off-chain rule store is a JSON file / SQLite rather than
Postgres+IPFS. All explicitly flagged as roadmap in the TRD.

## Quickstart

Coming together file-by-file — see `contracts/README.md` and
`backend/README.md` once added for service-specific setup. High-level:

```bash
# contracts
cd contracts && forge test && forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify

# backend
cd backend && cp .env.example .env   # fill in GEMINI_API_KEY, RELAYER_PRIVATE_KEY, RPC_URL, CONTRACT_ADDRESS
npm install && npm run dev

# frontend
cd frontend && npm install && npm run dev
```

## Demo script (happy path + failure path)

1. Procuring entity calls `initMilestone()` with the hash of agreed tender
   rules for Milestone 2 (rebar delivery).
2. **Failure path:** vendor uploads an invoice for 420 units against an
   expected 500. Dashboard shows an itemized rejection: *"Expected 500 units
   of rebar @ $12/unit; submitted invoice shows 420 units — 16% shortfall,
   exceeds 2% tolerance. Rejected."* On-chain state: `PENDING → REJECTED`.
3. Vendor resubmits with a corrected invoice for 500 units.
4. **Happy path:** AI verifies all checks pass, signs the verdict, relayer
   submits `verifyAndAdvance()`. On-chain state: `PENDING → APPROVED → PAID`,
   tranche transferred, block explorer link shown live in the dashboard.

## Tech stack

| Layer | Choice |
|---|---|
| Smart contracts | Solidity 0.8.24, OpenZeppelin (ECDSA, EIP712), Foundry |
| Testnet | Base Sepolia |
| AI extraction | Gemini (vision-capable) — structured JSON output |
| Backend | Node.js / Express |
| Signing | ethers.js `signTypedData` (EIP-712), matches on-chain verifier exactly |
| Frontend | React + viem/wagmi |
