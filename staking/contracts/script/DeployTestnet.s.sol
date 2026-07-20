// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {StakedGRID} from "../src/StakedGRID.sol";
import {MockGRID} from "../test/MockGRID.sol";

/**
 * @notice Testnet-only deploy: a MockGRID token (real $GRID is mainnet-only) +
 *         StakedGRID pointed at it, with test tokens minted to the deployer.
 *
 *   forge script script/DeployTestnet.s.sol --rpc-url base_sepolia --broadcast
 *
 * Env: PRIVATE_KEY (deployer, also the test user + owner).
 */
contract DeployTestnet is Script {
    function run() external returns (MockGRID grid, StakedGRID staking) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256[] memory thresholds = new uint256[](3);
        thresholds[0] = 50_000_000e18; // Pro
        thresholds[1] = 250_000_000e18; // Team
        thresholds[2] = 1_000_000_000e18; // Founder

        vm.startBroadcast(pk);
        grid = new MockGRID();
        grid.mint(deployer, 1_000_000e18); // 1M test GRID for the deployer
        staking = new StakedGRID(address(grid), deployer, thresholds);
        vm.stopBroadcast();

        console2.log("MockGRID  :", address(grid));
        console2.log("StakedGRID:", address(staking));
        console2.log("deployer  :", deployer);
    }
}
