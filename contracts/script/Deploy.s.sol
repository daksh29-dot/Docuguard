// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/DocuGuardMilestone.sol";
import "../src/mocks/MockUSDG.sol";

/// @notice Deploys the full DocuGuard on-chain stack for the demo:
///           1. MockUSDG (mock stablecoin used for tranche payouts)
///           2. DocuGuardMilestone (wired to the oracle/vendor/procuring-entity addresses)
///           3. Mints test USDG and transfers enough into the milestone contract so it can
///              actually pay out tranches live during the demo.
///           4. Initializes the exact Milestone 2 example from the PRD/TRD (rebar delivery)
///              so the demo has a milestone ready to submit against immediately.
///
/// @dev Reads all addresses/keys from environment variables so the same script works for a
///      local Anvil dry run and a real Base Sepolia deployment. Required env vars:
///
///        DEPLOYER_PRIVATE_KEY    - deployer / procuring-entity key (broadcasts every tx)
///        ORACLE_SIGNER_ADDRESS   - address of the Attestation Signer Service (backend relayer)
///        VENDOR_ADDRESS          - vendor's payout address
///
///      Run:
///        forge script script/Deploy.s.sol:Deploy \
///          --rpc-url base_sepolia \
///          --broadcast \
///          --verify
contract Deploy is Script {
    // Mirrors the PRD's Milestone 2 example (Rebar delivery — Phase 2):
    // expectedQty 500 @ $12.00/unit = $6,000.00, 6-decimal USDG.
    uint256 constant DEMO_MILESTONE_ID = 2;
    uint256 constant DEMO_TRANCHE = 6_000_000000; // 6,000.00 USDG
    uint256 constant DEMO_FUND_MULTIPLIER = 5; // fund contract with headroom for multiple demo runs

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleSigner = vm.envAddress("ORACLE_SIGNER_ADDRESS");
        address vendor = vm.envAddress("VENDOR_ADDRESS");
        address deployer = vm.addr(deployerPk);

        // For the demo, the deployer wallet also acts as the procuring entity.
        address procuringEntity = deployer;

        // Same rulesHash the backend must compute from tender-example.json — keep these in
        // sync (see backend/data/tender-example.json). Computed here as
        // keccak256(canonical JSON bytes) placeholder; backend logs the exact bytes it hashes
        // so this can be verified to match at demo time.
        bytes32 rulesHash = keccak256(
            abi.encodePacked(
                "TENDER-2026-0143|milestone:2|item:Rebar 12mm|qty:500|unit:units|",
                "unitPriceUSD:12.00|tolQtyPct:2|tolDeliveryDays:5"
            )
        );

        vm.startBroadcast(deployerPk);

        MockUSDG token = new MockUSDG(deployer);
        console.log("MockUSDG deployed at:", address(token));

        DocuGuardMilestone milestoneContract = new DocuGuardMilestone(
            oracleSigner,
            vendor,
            procuringEntity,
            address(token)
        );
        console.log("DocuGuardMilestone deployed at:", address(milestoneContract));

        // Fund the milestone contract so it can actually pay tranches during the demo.
        uint256 fundAmount = DEMO_TRANCHE * DEMO_FUND_MULTIPLIER;
        token.mint(address(milestoneContract), fundAmount);
        console.log("Funded DocuGuardMilestone with USDG:", fundAmount);

        milestoneContract.initMilestone(DEMO_MILESTONE_ID, rulesHash, DEMO_TRANCHE);
        console.log("Initialized demo milestone id:", DEMO_MILESTONE_ID);
        console.log("Milestone rulesHash:");
        console.logBytes32(rulesHash);

        vm.stopBroadcast();

        console.log("---------------------------------------------------------");
        console.log("Copy these into backend/.env:");
        console.log("CONTRACT_ADDRESS=", address(milestoneContract));
        console.log("PAYMENT_TOKEN_ADDRESS=", address(token));
        console.log("PROCURING_ENTITY_ADDRESS=", procuringEntity);
        console.log("VENDOR_ADDRESS=", vendor);
        console.log("---------------------------------------------------------");
    }
}
