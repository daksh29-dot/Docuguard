/**
 * signer/attestation.js
 * 
 * Generates EIP-712 signatures for milestone verdicts.
 * The domain and types here MUST strictly mirror DocuGuardMilestone.sol.
 */
const { Wallet } = require("ethers");

const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
// Defaults to Base Sepolia (84532) as specified in the architecture
const CHAIN_ID = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 84532; 
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

async function signVerdict({ milestoneId, rulesHash, pass, timestamp, submissionHash }) {
  if (!ORACLE_PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing ORACLE_PRIVATE_KEY or CONTRACT_ADDRESS in environment.");
  }

  const wallet = new Wallet(ORACLE_PRIVATE_KEY);

  // Must match constructor EIP712("DocuGuardMilestone", "1")
  const domain = {
    name: "DocuGuardMilestone",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: CONTRACT_ADDRESS,
  };

  // Must match VERDICT_TYPEHASH exact schema
  const types = {
    Verdict: [
      { name: "milestoneId", type: "uint256" },
      { name: "rulesHash", type: "bytes32" },
      { name: "pass", type: "bool" },
      { name: "timestamp", type: "uint256" },
      { name: "submissionHash", type: "bytes32" },
    ],
  };

  const value = {
    milestoneId,
    rulesHash,
    pass,
    timestamp,
    submissionHash,
  };

  // signTypedData computes the EIP-712 compliant digest and signs it
  const signature = await wallet.signTypedData(domain, types, value);

  return {
    signature,
    signerAddress: wallet.address,
  };
}

module.exports = { signVerdict };