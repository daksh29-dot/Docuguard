/**
 * chain/submit.js
 * 
 * Relayer module. Submits the AI oracle's signed verdicts on-chain.
 */
const { JsonRpcProvider, Wallet, Contract } = require("ethers");

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Minimal ABI required for the relayer and dashboard read operations
const ABI = [
  "function verifyAndAdvance(uint256 milestoneId, bytes32 rulesHash, bool pass, uint256 timestamp, bytes32 submissionHash, bytes calldata signature) external",
  "function getMilestone(uint256 milestoneId) external view returns (tuple(bytes32 rulesHash, uint256 tranche, uint8 state))"
];

const STATE_MAP = ["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"];

function getContract(withSigner = false) {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not configured.");
  const provider = new JsonRpcProvider(RPC_URL);
  
  if (withSigner) {
    if (!RELAYER_PRIVATE_KEY) throw new Error("RELAYER_PRIVATE_KEY not configured.");
    const wallet = new Wallet(RELAYER_PRIVATE_KEY, provider);
    return new Contract(CONTRACT_ADDRESS, ABI, wallet);
  }
  
  return new Contract(CONTRACT_ADDRESS, ABI, provider);
}

async function submitVerdict({ milestoneId, rulesHash, pass, timestamp, submissionHash, signature }) {
  try {
    const contract = getContract(true);
    
    const tx = await contract.verifyAndAdvance(
      milestoneId,
      rulesHash,
      pass,
      timestamp,
      submissionHash,
      signature
    );

    // Wait for 1 confirmation
    const receipt = await tx.wait(1);

    return {
      status: receipt.status === 1 ? "confirmed" : "failed",
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
  } catch (err) {
    // Surface the revert reason gracefully for the off-chain store
    const reason = err.reason || err.shortMessage || err.message;
    return {
      status: "failed",
      error: reason,
    };
  }
}

async function getMilestoneState(milestoneId) {
  const contract = getContract(false);
  const result = await contract.getMilestone(milestoneId);

  // ethers.js returns a Result object — access by property name (struct fields)
  // or by index. Using index is safest for ABI tuple returns.
  const rulesHash = result[0] ?? result.rulesHash;
  const tranche = result[1] ?? result.tranche;
  const stateIndex = Number(result[2] ?? result.state ?? 0);

  return {
    state: STATE_MAP[stateIndex] || "UNKNOWN",
    rulesHash,
    tranche: tranche.toString(), // Convert BigInt to string for JSON
  };
}

module.exports = { submitVerdict, getMilestoneState };