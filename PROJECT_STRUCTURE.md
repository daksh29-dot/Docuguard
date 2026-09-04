# DocuGuard — Project Structure Reference

Quick-reference map of every file in the repo and what it does. Use this to
regain context fast or to hand off to someone (or an AI) unfamiliar with the
codebase.

---

## Top-level files

```
DocuGuard (root)
├── README.md                  Overview, architecture diagram, design rationale, quickstart, demo script
├── run.md                     Step-by-step local run guide: deploy contracts, start backend + frontend
├── DocuGuard_PRD.md           Product Requirements Document — vision, user stories, success metrics
├── DocuGuard_TRD.md           Technical Requirements Document — architecture, components, security checklist
├── foundryup-install.ps1      PowerShell script to install Foundry (used for the Solidity toolchain)
├── PROJECT_STRUCTURE.md       This file
├── .gitignore                 Ignores node_modules/, .env, contracts/{out,cache,broadcast}/, frontend/dist/
└── .gitmodules                Declares git submodules: openzeppelin-contracts + forge-std (under contracts/lib/)
```

## assets/

```
assets/
├── Screenshot 2026-08-22 213752.png   Dashboard screenshot — requirements & verdict UI
└── Screenshot 2026-08-22 214151.png   Dashboard screenshot — vendor submission UI
```

Visual proof used in README. The dashboard theme is pitch-black + neon green.

---

## contracts/ — Foundry / Solidity project

The on-chain half: a cheap signature-verifying contract that releases
payment tranches. Uses OpenZeppelin (ECDSA, EIP712, ERC20, ReentrancyGuard)
and forge-std.

```
contracts/
├── foundry.toml              Foundry config: solc 0.8.24, optimizer, gas reports,
│                             RPC endpoints (base_sepolia / sepolia / anvil) + Etherscan
│                             verification keys, all read from env vars
├── foundry.lock              Foundry dependency lockfile
├── src/
│   ├── DocuGuardMilestone.sol  Main contract. Constructor wires oracle signer, vendor,
│   │                            procuring entity + payment token.
│   │                            • initMilestone()  — procuring entity commits rulesHash + tranche
│   │                            • verifyAndAdvance() — anyone can call; EIP-712 recovers oracle
│   │                              signature, checks rulesHash match, attestation age (<1 hour),
│   │                              then flips state PENDING → PAID (releases tranche) or → REJECTED.
│   │                            • resubmit() — vendor moves REJECTED → PENDING with corrected docs
│   │                            • markUnderReview()/cancelUnderReview() — procuring entity
│   │                              escape hatch; can NOT force-approve funds
│   └── mocks/
│       └── MockUSDG.sol      Mock ERC20 "USDG" stablecoin (6 decimals) for testnet payouts
├── script/
│   └── Deploy.s.sol          Forge script: deploys MockUSDG + DocuGuardMilestone, mints
│                             USDG into the contract, initializes the demo Milestone 2
│                             (rebar). Reads all addresses/keys from env vars.
└── test/
    └── DocuGuardMilestone.t.sol  Forge tests for the state machine using real EIP-712
                                 signatures via Foundry's vm.sign — no shortcuts in ECDSA.
```

### Milestone state machine (from the contract)

`PENDING → (UNDER_REVIEW) → APPROVED/PAID` or `→ REJECTED → PENDING (resubmit)`

---

## backend/ — Node.js / Express

One Express service playing three architecturally-separable roles for
hackathon speed: **Ingestion API + AI Verification Agent + Attestation
Signer / Relayer**. Pipeline per submission:
`upload → ai/extract.js → verify/rulesEngine.js → signer/attestation.js → chain/submit.js → db/store.js`

```
backend/
├── package.json            Express + multer (upload), cors, dotenv, ethers v6. start/dev scripts
├── .env.example            Template for .env — GEMINI_API_KEY, CHAIN_ID, RPC_URL,
│                           CONTRACT_ADDRESS, ORACLE_PRIVATE_KEY, RELAYER_PRIVATE_KEY, etc.
├── data/
│   ├── submissions.json    Off-chain verdict log, keyed by submissionHash (flat JSON store)
│   └── tender-example.json  Machine-readable tender rules for TENDER-2026-0143 (rebar delivery).
│                           Milestone 2's fields feed rulesHash — must match Deploy.s.sol exactly
└── src/
    ├── server.js           Entry point. Defines the Express routes and orchestrates the
    │                       pipeline (forward-declared stage modules via tryRequire so the
    │                       server can boot before all stages exist).
    ├── ai/
    │   └── extract.js      Gemini vision stage. THE only LLM use in the pipeline: turns an
    │                       uploaded doc (invoice/photo/PDF) into structured JSON. No judgments.
    ├── verify/
    │   └── rulesEngine.js  Deterministic rules engine. Runs ALL numeric/tolerance checks
    │                       (qty, price, delivery date) in plain code, computes the canonical
    │                       rulesHash, and produces the verdict JSON with fail-safe-fail-closed
    │                       defaults (never silently approves).
    ├── signer/
    │   └── attestation.js  EIP-712 signer. Signs the verdict with the oracle private key;
    │                       domain + types must mirror DocuGuardMilestone.sol byte-for-byte.
    ├── chain/
    │   └── submit.js       Relayer. Submits the signed verdict on-chain via verifyAndAdvance().
    └── db/
        └── store.js        Minimal JSON-file-backed store for submissions (hackathon
                            simplification vs Postgres/IPFS — documented in code).
```

### Backend .env keys at a glance

`PORT`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `CHAIN_ID`, `RPC_URL`,
`CONTRACT_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`, `ORACLE_PRIVATE_KEY`,
`RELAYER_PRIVATE_KEY`, `ORACLE_SIGNER_ADDRESS`, `VENDOR_ADDRESS`,
`PROCURING_ENTITY_ADDRESS`.

---

## frontend/ — React + Vite + viem/wagmi

The vendor-facing dashboard with the pitch-black/neon-green theme.

```
frontend/
├── index.html               Vite HTML entry (loads /src/main.jsx)
├── package.json             React 18, viem, wagmi, @tanstack/react-query, lucide-react;
│                             dev: vite, tailwindcss, autoprefixer, postcss
├── vite.config.js           Vite config — React plugin, dev server on port 5173
├── tailwind.config.js       Tailwind theme — "monster" palette: neon green #00FF41,
│                             neon shadows, scanline/pulse/flicker animations
├── postcss.config.js        PostCSS wiring → tailwindcss + autoprefixer
└── src/
    ├── main.jsx             React entry. Creates wagmi config (Base Sepolia) +
    │                        QueryClient providers, mounts <App />
    ├── App.jsx              Root component. Floating particle canvas background, hardcodes
    │                        BACKEND_URL (localhost:4000), demo milestone id 2, contract
    │                        address + Basescan link; composes the three component panels
    ├── index.css            Global styles / Tailwind directives
    └── components/
        ├── UploadForm.jsx         Vendor submission UI — document upload with ripple effect
        ├── SubmissionHistory.jsx  Past submissions with animated ML anomaly score badge
        │                          (score hardcoded to 96.4 for the UI demo) + verdicts
        └── MilestoneStatus.jsx    On-chain milestone dashboard — animated state badges
                                   (PAID/APPROVED/REJECTED/PENDING/UNDER_REVIEW), counters,
                                   explorer links
```

### Frontend hardcoded demo values

`BACKEND_URL = http://localhost:4000`, `DEMO_MILESTONE_ID = 2`, demo contract
address with Basescan URL.

---

## End-to-end data flow (how files connect)

```
UploadForm.jsx ──▶ POST /api/milestones/2/submissions ──▶ server.js (multer)
                                                              │
                                                              ▼
                                          ai/extract.js (Gemini) → structured JSON
                                                              │
                                                              ▼
                                          verify/rulesEngine.js (deterministic checks + rulesHash)
                                                              │  verdict {pass, itemized, reasons}
                                                              ▼
                                          signer/attestation.js (EIP-712 oracle signature)
                                                              │
                                                              ▼
                                          chain/submit.js ──▶ verifyAndAdvance() on-chain
                                                              ▲
                                          DocuGuardMilestone.sol verifies sig + rulesHash
                                          → PAID (tranche via MockUSDG) or REJECTED
                                                              │
        MilestoneStatus.jsx ◀── events/logs ─────────────────┘
        SubmissionHistory.jsx ◀── db/store.js verdict log
```

---

## Handy commands

| Where      | Command                                        | What it does                          |
|------------|------------------------------------------------|---------------------------------------|
| contracts/ | `forge test`                                   | Run Solidity tests                    |
| contracts/ | `forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast` | Deploy to Base Sepolia |
| backend/   | `npm install && npm run dev`                   | Start backend on :4000               |
| frontend/  | `npm install && npm run dev`                   | Start dashboard on :5173             |