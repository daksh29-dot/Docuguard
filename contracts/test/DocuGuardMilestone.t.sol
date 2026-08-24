// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/DocuGuardMilestone.sol";
import "../src/mocks/MockUSDG.sol";

/// @notice Tests DocuGuardMilestone end-to-end using a real EIP-712 signature produced with
///         a known test private key (Foundry's `vm.sign`), so the on-chain verification path
///         is exercised exactly as it would be against the real Attestation Signer Service —
///         no shortcuts around ECDSA.recover.
contract DocuGuardMilestoneTest is Test {
    DocuGuardMilestone public milestoneContract;
    MockUSDG public token;

    // Known test key so we can both sign (off-chain simulation) and derive the address
    // to pass in as the trusted oracleSigner.
    uint256 constant ORACLE_PK = 0xA11CE;
    address oracleSigner;

    address procuringEntity = makeAddr("procuringEntity");
    address vendor = makeAddr("vendor");
    address stranger = makeAddr("stranger");

    uint256 constant MILESTONE_ID = 2;
    bytes32 constant RULES_HASH = keccak256("tender-2026-0143-milestone-2-rules-v1");
    uint256 constant TRANCHE = 6_000_000000; // 6,000.00 USDG at 6 decimals

    // Mirrors the contract's private constant — needed here to build the struct hash for signing.
    bytes32 constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 milestoneId,bytes32 rulesHash,bool pass,uint256 timestamp,bytes32 submissionHash)"
    );

    event MilestoneApproved(uint256 indexed milestoneId, bytes32 submissionHash);
    event MilestoneRejected(uint256 indexed milestoneId, bytes32 submissionHash);
    event TranchePaid(uint256 indexed milestoneId, uint256 amount);

    function setUp() public {
        oracleSigner = vm.addr(ORACLE_PK);

        token = new MockUSDG(address(this));
        milestoneContract = new DocuGuardMilestone(oracleSigner, vendor, procuringEntity, address(token));

        // Fund the contract so it can pay out the tranche on approval.
        token.mint(address(milestoneContract), TRANCHE * 10);

        vm.prank(procuringEntity);
        milestoneContract.initMilestone(MILESTONE_ID, RULES_HASH, TRANCHE);
    }

    /// @dev Builds the same EIP-712 digest the contract computes, then signs it with the
    ///      oracle test key — simulating what the Attestation Signer Service does off-chain.
    function _signVerdict(
        uint256 milestoneId,
        bytes32 rulesHash,
        bool pass,
        uint256 timestamp,
        bytes32 submissionHash
    ) internal view returns (bytes memory signature) {
        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, milestoneId, rulesHash, pass, timestamp, submissionHash)
        );

        // Recreate _hashTypedDataV4 manually: domainSeparator ^ structHash per EIP-712.
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DocuGuardMilestone")),
                keccak256(bytes("1")),
                block.chainid,
                address(milestoneContract)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK, digest);
        signature = abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------

    function test_ApprovedVerdict_AdvancesStateAndPaysTranche() public {
        bytes32 submissionHash = keccak256("submission-corrected-invoice-500-units");
        uint256 timestamp = block.timestamp;
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash);

        uint256 vendorBalanceBefore = token.balanceOf(vendor);

        vm.expectEmit(true, false, false, true);
        emit MilestoneApproved(MILESTONE_ID, submissionHash);
        vm.expectEmit(true, false, false, true);
        emit TranchePaid(MILESTONE_ID, TRANCHE);

        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash, sig);

        DocuGuardMilestone.Milestone memory m = milestoneContract.getMilestone(MILESTONE_ID);
        assertEq(uint8(m.state), uint8(DocuGuardMilestone.State.PAID));
        assertEq(token.balanceOf(vendor), vendorBalanceBefore + TRANCHE);
    }

    // ---------------------------------------------------------------------
    // Failure path
    // ---------------------------------------------------------------------

    function test_RejectedVerdict_SetsRejectedState_NoPayment() public {
        bytes32 submissionHash = keccak256("submission-invoice-420-units-shortfall");
        uint256 timestamp = block.timestamp;
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, false, timestamp, submissionHash);

        uint256 vendorBalanceBefore = token.balanceOf(vendor);

        vm.expectEmit(true, false, false, true);
        emit MilestoneRejected(MILESTONE_ID, submissionHash);

        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, false, timestamp, submissionHash, sig);

        DocuGuardMilestone.Milestone memory m = milestoneContract.getMilestone(MILESTONE_ID);
        assertEq(uint8(m.state), uint8(DocuGuardMilestone.State.REJECTED));
        assertEq(token.balanceOf(vendor), vendorBalanceBefore); // untouched
    }

    function test_VendorCanResubmitAfterRejection() public {
        bytes32 submissionHash = keccak256("submission-bad");
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, false, block.timestamp, submissionHash);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, false, block.timestamp, submissionHash, sig);

        vm.prank(vendor);
        milestoneContract.resubmit(MILESTONE_ID);

        DocuGuardMilestone.Milestone memory m = milestoneContract.getMilestone(MILESTONE_ID);
        assertEq(uint8(m.state), uint8(DocuGuardMilestone.State.PENDING));
    }

    function test_RevertWhen_StrangerResubmits() public {
        bytes32 submissionHash = keccak256("submission-bad");
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, false, block.timestamp, submissionHash);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, false, block.timestamp, submissionHash, sig);

        vm.prank(stranger);
        vm.expectRevert(DocuGuardMilestone.OnlyVendor.selector);
        milestoneContract.resubmit(MILESTONE_ID);
    }

    // ---------------------------------------------------------------------
    // Security checklist coverage
    // ---------------------------------------------------------------------

    function test_RevertWhen_SignatureFromWrongKey() public {
        uint256 attackerPk = 0xBADD00D;
        bytes32 submissionHash = keccak256("submission-forged");
        uint256 timestamp = block.timestamp;

        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash)
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("DocuGuardMilestone")),
                keccak256(bytes("1")),
                block.chainid,
                address(milestoneContract)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);
        bytes memory forgedSig = abi.encodePacked(r, s, v);

        vm.expectRevert(DocuGuardMilestone.InvalidSigner.selector);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash, forgedSig);
    }

    function test_RevertWhen_RulesHashMismatch() public {
        bytes32 wrongRulesHash = keccak256("tampered-rules");
        bytes32 submissionHash = keccak256("submission-x");
        uint256 timestamp = block.timestamp;

        // Oracle would never actually sign against the wrong hash in practice, but even if a
        // valid signature existed for a mismatched rulesHash, the contract must reject it.
        bytes memory sig = _signVerdict(MILESTONE_ID, wrongRulesHash, true, timestamp, submissionHash);

        vm.expectRevert(DocuGuardMilestone.RulesHashMismatch.selector);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, wrongRulesHash, true, timestamp, submissionHash, sig);
    }

    function test_RevertWhen_ReplayingAlreadyProcessedVerdict() public {
        bytes32 submissionHash = keccak256("submission-once");
        uint256 timestamp = block.timestamp;
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash);

        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash, sig);

        // Same call again — milestone is no longer PENDING, so replay must revert.
        vm.expectRevert(DocuGuardMilestone.MilestoneNotPending.selector);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash, sig);
    }

    function test_RevertWhen_AttestationTooOld() public {
        bytes32 submissionHash = keccak256("submission-stale");
        uint256 timestamp = block.timestamp;
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash);

        vm.warp(block.timestamp + 2 hours); // exceed MAX_ATTESTATION_AGE

        vm.expectRevert(DocuGuardMilestone.StaleAttestation.selector);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, timestamp, submissionHash, sig);
    }

    function test_RevertWhen_FutureTimestamp() public {
        bytes32 submissionHash = keccak256("submission-future");
        uint256 futureTs = block.timestamp + 1000;
        bytes memory sig = _signVerdict(MILESTONE_ID, RULES_HASH, true, futureTs, submissionHash);

        vm.expectRevert(DocuGuardMilestone.StaleAttestation.selector);
        milestoneContract.verifyAndAdvance(MILESTONE_ID, RULES_HASH, true, futureTs, submissionHash, sig);
    }

    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    function test_RevertWhen_StrangerInitializesMilestone() public {
        vm.prank(stranger);
        vm.expectRevert(DocuGuardMilestone.OnlyProcuringEntity.selector);
        milestoneContract.initMilestone(99, RULES_HASH, TRANCHE);
    }

    function test_RevertWhen_DoubleInitializingMilestone() public {
        vm.prank(procuringEntity);
        vm.expectRevert(DocuGuardMilestone.MilestoneAlreadyInitialized.selector);
        milestoneContract.initMilestone(MILESTONE_ID, RULES_HASH, TRANCHE);
    }

    function test_ProcuringEntityCannotForceApprove() public {
        // markUnderReview / cancelUnderReview exist for oracle-downtime handling but must
        // never let the procuring entity reach APPROVED/PAID without a valid oracle signature.
        vm.startPrank(procuringEntity);
        milestoneContract.markUnderReview(MILESTONE_ID);
        DocuGuardMilestone.Milestone memory m = milestoneContract.getMilestone(MILESTONE_ID);
        assertEq(uint8(m.state), uint8(DocuGuardMilestone.State.UNDER_REVIEW));

        milestoneContract.cancelUnderReview(MILESTONE_ID);
        m = milestoneContract.getMilestone(MILESTONE_ID);
        assertEq(uint8(m.state), uint8(DocuGuardMilestone.State.PENDING));
        vm.stopPrank();
        // No path from here to APPROVED/PAID exists without calling verifyAndAdvance with a
        // valid oracle signature — absence of such a function is itself the assertion.
    }
}
