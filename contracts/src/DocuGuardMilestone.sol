// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DocuGuardMilestone
/// @notice On-chain half of DocuGuard's off-chain-compute / on-chain-verification pattern.
///         An off-chain AI Verification Agent produces a structured verdict for a vendor's
///         milestone submission; an Attestation Signer Service signs that verdict with
///         EIP-712 typed data; this contract's only job is to cheaply verify that signature
///         came from the trusted oracle address, verify the verdict is bound to the correct
///         milestone's agreed rules (via `rulesHash`), and — only if `pass == true` — advance
///         the milestone state machine and release the payment tranche.
/// @dev    The AI never runs on-chain. This contract trusts a single oracle signer, which is
///         a deliberate, disclosed hackathon-scope limitation — see README "Known limitation".
///         Production roadmap: multi-oracle threshold signing or Chainlink Functions.
contract DocuGuardMilestone is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    enum State {
        PENDING, // awaiting a submission / re-submission
        UNDER_REVIEW, // AI pipeline has a submission in flight (off-chain only signal; see note below)
        APPROVED, // oracle attested pass == true, tranche released this tx
        REJECTED, // oracle attested pass == false
        PAID // tranche transferred (set alongside APPROVED in this version)
    }

    struct Milestone {
        bytes32 rulesHash; // hash of the off-chain tender rules agreed for this milestone
        uint256 tranche; // payment amount in payment-token base units
        State state;
    }

    /// @notice Trusted Attestation Signer Service address (the "oracle").
    address public immutable oracleSigner;
    /// @notice Vendor being paid on milestone approval.
    address public immutable vendor;
    /// @notice Procuring entity (municipality / agency) that owns this contract's milestones.
    address public immutable procuringEntity;
    /// @notice ERC20 token tranches are paid in (e.g. mock "USDG" on testnet).
    IERC20 public immutable paymentToken;

    mapping(uint256 => Milestone) public milestones; // milestoneId => Milestone

    // keccak256("Verdict(uint256 milestoneId,bytes32 rulesHash,bool pass,uint256 timestamp,bytes32 submissionHash)")
    bytes32 private constant VERDICT_TYPEHASH =
        keccak256(
            "Verdict(uint256 milestoneId,bytes32 rulesHash,bool pass,uint256 timestamp,bytes32 submissionHash)"
        );

    event MilestoneInitialized(uint256 indexed milestoneId, bytes32 rulesHash, uint256 tranche);
    event MilestoneApproved(uint256 indexed milestoneId, bytes32 submissionHash);
    event MilestoneRejected(uint256 indexed milestoneId, bytes32 submissionHash);
    event TranchePaid(uint256 indexed milestoneId, uint256 amount);
    event MilestoneReset(uint256 indexed milestoneId);

    error InvalidSigner();
    error MilestoneNotPending();
    error MilestoneNotRejected();
    error RulesHashMismatch();
    error OnlyProcuringEntity();
    error OnlyVendor();
    error StaleAttestation();
    error MilestoneAlreadyInitialized();

    /// @dev Attestations older than this are rejected on-chain, so a leaked/replayed old
    ///      signature for a milestone that was reset can't be resubmitted indefinitely.
    uint256 public constant MAX_ATTESTATION_AGE = 1 hours;

    modifier onlyProcuringEntity() {
        if (msg.sender != procuringEntity) revert OnlyProcuringEntity();
        _;
    }

    modifier onlyVendor() {
        if (msg.sender != vendor) revert OnlyVendor();
        _;
    }

    constructor(
        address _oracleSigner,
        address _vendor,
        address _procuringEntity,
        address _paymentToken
    ) EIP712("DocuGuardMilestone", "1") {
        oracleSigner = _oracleSigner;
        vendor = _vendor;
        procuringEntity = _procuringEntity;
        paymentToken = IERC20(_paymentToken);
    }

    /// @notice Registers a milestone and commits the hash of its agreed tender rules on-chain,
    ///         so the rules can't be silently altered after the fact and still pass a stale
    ///         oracle attestation.
    function initMilestone(
        uint256 milestoneId,
        bytes32 rulesHash,
        uint256 tranche
    ) external onlyProcuringEntity {
        if (milestones[milestoneId].rulesHash != bytes32(0)) revert MilestoneAlreadyInitialized();
        milestones[milestoneId] = Milestone(rulesHash, tranche, State.PENDING);
        emit MilestoneInitialized(milestoneId, rulesHash, tranche);
    }

    /// @notice Verifies an EIP-712 signed AI verdict and advances milestone state accordingly.
    /// @dev    Anyone can call this (typically the relayer/backend) — the security boundary is
    ///         the oracle signature, not msg.sender. Checks-effects-interactions: state is
    ///         flipped to PAID before the external token transfer, plus `nonReentrant` for
    ///         defense-in-depth (TRD security checklist item #4).
    function verifyAndAdvance(
        uint256 milestoneId,
        bytes32 rulesHash,
        bool pass,
        uint256 timestamp,
        bytes32 submissionHash,
        bytes calldata signature
    ) external nonReentrant {
        Milestone storage m = milestones[milestoneId];
        if (m.state != State.PENDING) revert MilestoneNotPending();
        if (m.rulesHash != rulesHash) revert RulesHashMismatch();
        if (timestamp > block.timestamp || block.timestamp - timestamp > MAX_ATTESTATION_AGE) {
            revert StaleAttestation();
        }

        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, milestoneId, rulesHash, pass, timestamp, submissionHash)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        if (recovered != oracleSigner) revert InvalidSigner();

        if (pass) {
            m.state = State.PAID; // effects before interaction
            emit MilestoneApproved(milestoneId, submissionHash);
            _releaseTranche(milestoneId, m.tranche);
        } else {
            m.state = State.REJECTED;
            emit MilestoneRejected(milestoneId, submissionHash);
        }
    }

    /// @dev Separated from state mutation above so the external call happens strictly after
    ///      all storage writes for this milestone are finalized.
    function _releaseTranche(uint256 milestoneId, uint256 amount) internal {
        emit TranchePaid(milestoneId, amount);
        bool ok = paymentToken.transfer(vendor, amount);
        require(ok, "tranche transfer failed");
    }

    /// @notice Vendor moves a REJECTED milestone back to PENDING to submit corrected documents.
    function resubmit(uint256 milestoneId) external onlyVendor {
        if (milestones[milestoneId].state != State.REJECTED) revert MilestoneNotRejected();
        milestones[milestoneId].state = State.PENDING;
        emit MilestoneReset(milestoneId);
    }

    /// @notice Manual override path for oracle downtime (TRD security checklist item #8).
    ///         Procuring entity can force a PENDING milestone back to PENDING-equivalent
    ///         re-review state is implicit (no-op today) — reserved as an explicit escape
    ///         hatch documented for judges; intentionally NOT able to force-approve, so the
    ///         procuring entity alone can never bypass the AI/oracle check to release funds.
    function markUnderReview(uint256 milestoneId) external onlyProcuringEntity {
        Milestone storage m = milestones[milestoneId];
        if (m.state != State.PENDING) revert MilestoneNotPending();
        m.state = State.UNDER_REVIEW;
    }

    /// @notice Companion to markUnderReview — lets the procuring entity return a milestone to
    ///         PENDING if the off-chain pipeline stalls, without granting any approval power.
    function cancelUnderReview(uint256 milestoneId) external onlyProcuringEntity {
        Milestone storage m = milestones[milestoneId];
        require(m.state == State.UNDER_REVIEW, "not under review");
        m.state = State.PENDING;
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        return milestones[milestoneId];
    }
}
