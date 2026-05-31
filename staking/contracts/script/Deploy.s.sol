// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {StakedGRID} from "../src/StakedGRID.sol";

/**
 * @notice Deploys StakedGRID (cooldown access staking) for $GRID on Base.
 *
 * Required env (never commit — pull from Infisical):
 *   PRIVATE_KEY        deployer key (use a hardware/throwaway, transfer owner after)
 *   GRID_TOKEN_ADDRESS 0x6B456E66524aEC1792013eF9DFE87e3F84311ba3 (Base mainnet)
 *   VEGRID_OWNER       admin address (multisig recommended)
 *
 * Tier thresholds (power units, 18 decimals) are set here; tune before deploy.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
 */
contract Deploy is Script {
    function run() external returns (StakedGRID staking) {
        address grid = vm.envAddress("GRID_TOKEN_ADDRESS");
        address owner = vm.envAddress("VEGRID_OWNER");
        uint256 pk = vm.envUint("PRIVATE_KEY");

        // Thresholds are in POWER units (staked * cooldown multiplier). 30-day
        // stakers (1.25x) reach each tier with ~20% less $GRID than 7-day (1.0x).
        uint256[] memory thresholds = new uint256[](3);
        thresholds[0] = 50_000_000e18; // Tier 1 — "Pro"
        thresholds[1] = 250_000_000e18; // Tier 2 — "Team"
        thresholds[2] = 1_000_000_000e18; // Tier 3 — "Founder"

        vm.startBroadcast(pk);
        staking = new StakedGRID(grid, owner, thresholds);
        vm.stopBroadcast();

        console2.log("StakedGRID deployed at:", address(staking));
        console2.log("  grid :", grid);
        console2.log("  owner:", owner);
    }
}
