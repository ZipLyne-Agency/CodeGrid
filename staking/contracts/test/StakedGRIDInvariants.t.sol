// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakedGRID} from "../src/StakedGRID.sol";
import {MockGRID} from "./MockGRID.sol";

/// @dev Drives random stake/unstake/cancel/withdraw/warp sequences across a few
///      actors, respecting the contract's preconditions so calls actually land.
contract Handler is Test {
    StakedGRID public ve;
    MockGRID public grid;
    address[] public actors;
    uint64[2] internal cds = [uint64(7 days), uint64(30 days)];

    constructor(StakedGRID _ve, MockGRID _grid, address[] memory _actors) {
        ve = _ve;
        grid = _grid;
        actors = _actors;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function stake(uint256 actorSeed, uint256 amount, uint256 cdSeed) public {
        address a = _actor(actorSeed);
        amount = bound(amount, 1, 100_000e18);
        uint64 cd = cds[cdSeed % 2];
        (uint128 staked, uint128 unbonding, uint64 curCd,) = ve.positions(a);
        // Respect "can't lower cooldown while you hold a position".
        if ((staked > 0 || unbonding > 0) && cd < curCd) cd = curCd;
        if (grid.balanceOf(a) < amount) return;
        vm.prank(a);
        ve.stake(amount, cd);
    }

    function requestUnstake(uint256 actorSeed, uint256 amount) public {
        address a = _actor(actorSeed);
        (uint128 staked,,, uint64 end) = ve.positions(a);
        if (end != 0 || staked == 0) return;
        amount = bound(amount, 1, staked);
        vm.prank(a);
        ve.requestUnstake(amount);
    }

    function cancelUnstake(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        (, uint128 unbonding,,) = ve.positions(a);
        if (unbonding == 0) return;
        vm.prank(a);
        ve.cancelUnstake();
    }

    function withdraw(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        (, uint128 unbonding,, uint64 end) = ve.positions(a);
        if (unbonding == 0 || block.timestamp < end) return;
        vm.prank(a);
        ve.withdraw();
    }

    function warp(uint256 dt) public {
        dt = bound(dt, 1 hours, 40 days);
        vm.warp(block.timestamp + dt);
    }

    function sumPositions() external view returns (uint256 total) {
        for (uint256 i; i < actors.length; ++i) {
            (uint128 s, uint128 u,,) = ve.positions(actors[i]);
            total += uint256(s) + uint256(u);
        }
    }
}

contract StakedGRIDInvariants is Test {
    StakedGRID internal ve;
    MockGRID internal grid;
    Handler internal handler;
    address[] internal actors;

    function setUp() public {
        grid = new MockGRID();
        uint256[] memory th = new uint256[](3);
        th[0] = 10_000e18;
        th[1] = 50_000e18;
        th[2] = 250_000e18;
        ve = new StakedGRID(address(grid), address(this), th);

        actors.push(address(0xA1));
        actors.push(address(0xA2));
        actors.push(address(0xA3));
        for (uint256 i; i < actors.length; ++i) {
            grid.mint(actors[i], 1_000_000e18);
            vm.prank(actors[i]);
            grid.approve(address(ve), type(uint256).max);
        }

        handler = new Handler(ve, grid, actors);
        targetContract(address(handler));
    }

    /// Solvency: the contract always holds exactly the staked + unbonding GRID,
    /// so every user's principal is fully backed and withdrawable.
    function invariant_solvency() public view {
        assertEq(grid.balanceOf(address(ve)), ve.totalStaked(), "balance must equal totalStaked");
    }

    /// Conservation: totalStaked never drifts from the sum of all positions.
    function invariant_conservation() public view {
        assertEq(handler.sumPositions(), ve.totalStaked(), "sum(positions) must equal totalStaked");
    }
}
