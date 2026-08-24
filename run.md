
Here is the step-by-step guide to running the full DocuGuard pipeline locally. This connects your local off-chain architecture (backend + frontend) to the live Base Sepolia testnet.

### 1. Deploy the Smart Contracts

First, we need to deploy the EIP-712 verifying contract and mock tokens to Base Sepolia.

1. Open your terminal and navigate to the `contracts/` directory.
2. Install the required Foundry dependencies:

```bash
forge install openzeppelin/openzeppelin-contracts foundry-rs/forge-std --no-commit

```

3. Export your deployment variables (the deployer will also act as the procuring entity for the demo):

```bash
export DEPLOYER_PRIVATE_KEY="your_wallet_private_key"
export ORACLE_SIGNER_ADDRESS="your_oracle_public_address"
export VENDOR_ADDRESS="your_vendor_public_address"

```

4. Run the deployment script, which will also call `initMilestone()` to stage our test data:

```bash
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast

```

*Keep the terminal output handy—you will need the deployed `MockUSDG` and `DocuGuardMilestone` contract addresses.*

### 2. Start the Backend Relayer

The backend combines the AI extraction, rules engine, and the EIP-712 relayer into one Express service.

5. Navigate to the `backend/` directory and run `npm install`.
6. Copy the `.env.example` to a new file named `.env`.
7. Fill in your `.env` file with your `GEMINI_API_KEY`, your private keys (Oracle and Relayer), and the contract addresses you just generated.
8. Start the backend server:

```bash
npm start

```

*The server will run on port 4000 and queue up the local JSON-file-backed database*.

### 3. Launch the Frontend

Finally, get the React dashboard running.

9. Navigate to the `frontend/` directory and run `npm install`.
10. Generate the Tailwind CSS configuration by running `npx tailwindcss init -p`.
11. Start the Vite development server:

```bash
npm run dev

```

### 4. Run the Demo Flow

With all three pieces running, open the localhost URL provided by Vite (usually `http://localhost:5173`).

12. **The Happy Path:** Upload a dummy invoice or photo (JPEG, PNG, or PDF) that clearly states "Rebar 12mm", a quantity around "500", and a unit price of "$12.00". The backend will extract this via Gemini, verify the signature, and the relayer will submit `verifyAndAdvance()`. The dashboard will update to `PAID`.
13. **The Rejection Path:** Upload an irrelevant photo or an invoice for the wrong item. The deterministic rules engine will catch the discrepancy, issue a `pass: false` verdict, and the milestone state will update to `REJECTED`.

Do you have a sample invoice ready to test the Gemini extraction, or would you like me to generate a mock text invoice you can save as a PDF for the demo?
