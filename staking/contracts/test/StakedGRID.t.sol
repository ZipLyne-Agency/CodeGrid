// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakedGRID} from "../src/StakedGRID.sol";
import {MockGRID} from "./MockGRID.sol";

contract StakedGRIDTest is Test {
    StakedGRID internal ve;
    MockGRID internal grid;

    address internal owner = address(0xA11CE);
    address internal alice = address(0xBEEF);
    address internal bob = address(0xCAFE);

    uint64 internal constant W7 = 7 days;
    uint64 internal constant W30 = 30 days;

    function setUp() public {
        grid = new MockGRID();
        uint256[] memory thresholds = new uint256[](3);
        thresholds[0] = 10_000e18; // Pro
        thresholds[1] = 50_000e18; // Team
        thresholds[2] = 250_000e18; // Founder
        ve = new StakedGRID(address(grid), owner, thresholds);

        grid.mint(alice, 1_000_000e18);
        grid.mint(bob, 1_000_000e18);
        vm.prank(alice);
        grid.approve(address(ve), type(uint256).max);
        vm.prank(bob);
        grid.approve(address(ve), type(uint256).max);
    }

    // --- helpers ---
    function _stake(address who, uint256 amt, uint64 cd) internal {
        vm.prank(who);
        ve.stake(amt, cd);
    }

    // ---------------------------------------------------------------------
    // Staking + power + tiers
    // ---------------------------------------------------------------------

    function test_stake_grantsPowerAndTier() public {
        _stake(alice, 10_000e18, W7);
        assertEq(ve.votingPower(alice), 10_000e18, "7d power = amount");
        assertEq(ve.tierOf(alice), 1, "Pro");
        assertEq(ve.stakedOf(alice), 10_000e18);
        assertEq(grid.balanceOf(address(ve)), 10_000e18);
        assertEq(ve.totalStaked(), 10_000e18);
    }

    function test_longerCooldown_givesMultiplier() public {
        // 8,000 GRID at 30-day notice → 8,000 * 1.25 = 10,000 power → Pro.
        _stake(alice, 8_000e18, W30);
        assertEq(ve.votingPower(alice), 10_000e18, "30d = 1.25x");
        assertEq(ve.tierOf(alice), 1, "Pro with less GRID");

        // Same 8,000 at 7-day → only 8,000 power → no tier.
        _stake(bob, 8_000e18, W7);
        assertEq(ve.votingPower(bob), 8_000e18);
        assertEq(ve.tierOf(bob), 0, "below Pro at 7d");
    }

    function test_tiers_climbWithStake() public {
        _stake(alice, 10_000e18, W7);
        assertEq(ve.tierOf(alice), 1);
        _stake(alice, 40_000e18, W7); // 50k → Team
        assertEq(ve.tierOf(alice), 2);
        _stake(alice, 200_000e18, W7); // 250k → Founder
        assertEq(ve.tierOf(alice), 3);
    }

    function test_addStake_canRaiseCooldownNotLower() public {
        _stake(alice, 10_000e18, W7);
        // raise to 30d → ok, whole stake now 1.25x
        _stake(alice, 0 + 1e18, W30);
        (,, uint64 cd,) = ve.positions(alice);
        assertEq(cd, W30);
        // lowering back to 7d while staked must revert
        vm.prank(alice);
        vm.expectRevert(StakedGRID.CannotLowerCooldown.selector);
        ve.stake(1e18, W7);
    }

    function test_invalidCooldown_reverts() public {
        vm.prank(alice);
        vm.expectRevert(StakedGRID.InvalidCooldown.selector);
        ve.stake(1e18, 3 days); // not a configured option
    }

    function test_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(StakedGRID.ZeroAmount.selector);
        ve.stake(0, W7);
    }

    // ---------------------------------------------------------------------
    // Cooldown / unstake lifecycle
    // ---------------------------------------------------------------------

    function test_requestUnstake_dropsPowerImmediately() public {
        _stake(alice, 10_000e18, W7);
        assertEq(ve.tierOf(alice), 1);

        vm.prank(alice);
        ve.requestUnstake(10_000e18);

        assertEq(ve.votingPower(alice), 0, "unbonding carries no power");
        assertEq(ve.tierOf(alice), 0, "access drops at request, not at withdraw");
        (uint256 amt, uint64 end) = ve.unbondingOf(alice);
        assertEq(amt, 10_000e18);
        assertEq(end, uint64(block.timestamp) + W7);
        // funds still held by the contract until withdraw
        assertEq(grid.balanceOf(address(ve)), 10_000e18);
    }

    function test_withdraw_revertsBeforeCooldown() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(alice);
        ve.requestUnstake(10_000e18);

        vm.warp(block.timestamp + W7 - 1);
        vm.prank(alice);
        vm.expectRevert(StakedGRID.CooldownNotElapsed.selector);
        ve.withdraw();
    }

    function test_withdraw_returnsPrincipalAfterCooldown() public {
        _stake(alice, 10_000e18, W7);
        uint256 balBefore = grid.balanceOf(alice);
        vm.prank(alice);
        ve.requestUnstake(10_000e18);

        vm.warp(block.timestamp + W7);
        vm.prank(alice);
        ve.withdraw();

        assertEq(grid.balanceOf(alice), balBefore + 10_000e18, "full principal back");
        assertEq(ve.totalStaked(), 0);
        (uint256 amt,) = ve.unbondingOf(alice);
        assertEq(amt, 0);
    }

    function test_partialUnstake_keepsRemainderActive() public {
        _stake(alice, 50_000e18, W7); // Team
        vm.prank(alice);
        ve.requestUnstake(40_000e18); // leave 10k active
        assertEq(ve.stakedOf(alice), 10_000e18);
        assertEq(ve.tierOf(alice), 1, "remainder still Pro");

        vm.warp(block.timestamp + W7);
        vm.prank(alice);
        ve.withdraw();
        assertEq(ve.stakedOf(alice), 10_000e18, "active untouched by withdraw");
        assertEq(ve.tierOf(alice), 1);
    }

    function test_cannotDoubleRequest() public {
        _stake(alice, 50_000e18, W7);
        vm.prank(alice);
        ve.requestUnstake(10_000e18);
        vm.prank(alice);
        vm.expectRevert(StakedGRID.AlreadyUnbonding.selector);
        ve.requestUnstake(10_000e18);
    }

    function test_requestUnstake_moreThanStaked_reverts() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(alice);
        vm.expectRevert(StakedGRID.InsufficientStake.selector);
        ve.requestUnstake(10_001e18);
    }

    function test_cancelUnstake_restoresPower() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(alice);
        ve.requestUnstake(10_000e18);
        assertEq(ve.tierOf(alice), 0);

        vm.prank(alice);
        ve.cancelUnstake();
        assertEq(ve.votingPower(alice), 10_000e18, "power restored");
        assertEq(ve.tierOf(alice), 1);
        (uint256 amt, uint64 end) = ve.unbondingOf(alice);
        assertEq(amt, 0);
        assertEq(end, 0);
    }

    function test_cancel_withNothingUnbonding_reverts() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(alice);
        vm.expectRevert(StakedGRID.NotUnbonding.selector);
        ve.cancelUnstake();
    }

    function test_fullExitThenRestake_resetsCooldown() public {
        _stake(alice, 10_000e18, W30);
        vm.prank(alice);
        ve.requestUnstake(10_000e18);
        vm.warp(block.timestamp + W30);
        vm.prank(alice);
        ve.withdraw();
        // fully exited → can choose a fresh (lower) cooldown
        _stake(alice, 10_000e18, W7);
        (,, uint64 cd,) = ve.positions(alice);
        assertEq(cd, W7);
    }

    // ---------------------------------------------------------------------
    // Pause — entry blocked, exit always open
    // ---------------------------------------------------------------------

    function test_pause_blocksStakeNotExit() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(owner);
        ve.pause();

        vm.prank(alice);
        vm.expectRevert(); // Pausable: EnforcedPause
        ve.stake(1e18, W7);

        // exit path all works while paused
        vm.prank(alice);
        ve.requestUnstake(10_000e18);
        vm.prank(alice);
        ve.cancelUnstake();
        vm.prank(alice);
        ve.requestUnstake(10_000e18);
        vm.warp(block.timestamp + W7);
        vm.prank(alice);
        ve.withdraw();
        assertEq(ve.totalStaked(), 0);
    }

    // ---------------------------------------------------------------------
    // Owner / admin
    // ---------------------------------------------------------------------

    function test_owner_cannotRescueGrid() public {
        _stake(alice, 10_000e18, W7);
        vm.prank(owner);
        vm.expectRevert(StakedGRID.CannotRescueGrid.selector);
        ve.rescueToken(address(grid), owner, 1e18);
    }

    function test_owner_canRescueOtherToken() public {
        MockGRID other = new MockGRID();
        other.mint(address(ve), 5e18);
        vm.prank(owner);
        ve.rescueToken(address(other), owner, 5e18);
        assertEq(other.balanceOf(owner), 5e18);
    }

    function test_setTierThresholds_mustAscend() public {
        uint256[] memory bad = new uint256[](2);
        bad[0] = 100e18;
        bad[1] = 50e18;
        vm.prank(owner);
        vm.expectRevert(StakedGRID.ThresholdsNotAscending.selector);
        ve.setTierThresholds(bad);
    }

    function test_onlyOwner_admin() public {
        vm.prank(alice);
        vm.expectRevert();
        ve.pause();
        vm.prank(alice);
        vm.expectRevert();
        ve.setCooldownOption(14 days, 11_000);
    }

    function test_setCooldownOption_addsNewTier() public {
        vm.prank(owner);
        ve.setCooldownOption(14 days, 11_000);
        _stake(alice, 10_000e18, 14 days);
        assertEq(ve.votingPower(alice), 11_000e18, "14d = 1.1x");
    }

    function test_ownership_twoStep() public {
        vm.prank(owner);
        ve.transferOwnership(bob);
        assertEq(ve.owner(), owner, "not transferred until accepted");
        vm.prank(bob);
        ve.acceptOwnership();
        assertEq(ve.owner(), bob);
    }

    // ---------------------------------------------------------------------
    // Config changes never demote/strand existing stakers (review fixes)
    // ---------------------------------------------------------------------

    function test_disablingOption_doesNotDemoteExistingStaker() public {
        _stake(alice, 8_000e18, W30); // 1.25x → 10k power → Pro
        assertEq(ve.tierOf(alice), 1);
        vm.prank(owner);
        ve.setCooldownOption(W30, 0); // disable 30-day
        assertEq(ve.votingPower(alice), 10_000e18, "snapshot holds");
        assertEq(ve.tierOf(alice), 1, "config change does not demote");
    }

    function test_disabledOption_stillAllowsTopUpOnOwnPeriod() public {
        _stake(alice, 8_000e18, W30);
        vm.prank(owner);
        ve.setCooldownOption(W30, 0);
        _stake(alice, 2_000e18, W30); // top-up on the now-disabled own period
        assertEq(ve.stakedOf(alice), 10_000e18);
        assertEq(ve.votingPower(alice), 12_500e18, "10k * 1.25 snapshot");
    }

    function test_reRatingOption_doesNotAffectExistingStaker() public {
        _stake(alice, 8_000e18, W30); // 1.25x → 10k
        vm.prank(owner);
        ve.setCooldownOption(W30, 11_000); // down-rate to 1.1x
        assertEq(ve.votingPower(alice), 10_000e18, "existing snapshot unchanged");
        _stake(bob, 8_000e18, W30); // new staker gets the new rate
        assertEq(ve.votingPower(bob), 8_800e18, "new staker repriced to 1.1x");
    }

    function test_fullyUnbonding_canStartFreshShorterCooldown() public {
        _stake(alice, 10_000e18, W30);
        vm.prank(alice);
        ve.requestUnstake(10_000e18); // staked=0, unbonding>0
        vm.prank(alice);
        ve.stake(5_000e18, W7); // fresh shorter cooldown must be allowed
        (,, uint64 cd,) = ve.positions(alice);
        assertEq(cd, W7);
        assertEq(ve.votingPower(alice), 5_000e18, "1.0x on the new stake");
    }

    function test_tooManyTiers_reverts() public {
        uint256[] memory many = new uint256[](256);
        for (uint256 i; i < 256; ++i) {
            many[i] = (i + 1) * 1e18;
        }
        vm.prank(owner);
        vm.expectRevert(StakedGRID.TooManyTiers.selector);
        ve.setTierThresholds(many);
    }

    // ---------------------------------------------------------------------
    // Fuzz / invariant-ish
    // ---------------------------------------------------------------------

    function testFuzz_stakeUnstakeWithdraw_returnsExactPrincipal(uint128 amount) public {
        amount = uint128(bound(uint256(amount), 1, 1_000_000e18));
        uint256 before = grid.balanceOf(alice);
        _stake(alice, amount, W7);
        assertEq(grid.balanceOf(alice), before - amount);
        vm.prank(alice);
        ve.requestUnstake(amount);
        vm.warp(block.timestamp + W7);
        vm.prank(alice);
        ve.withdraw();
        assertEq(grid.balanceOf(alice), before, "principal fully returned, no more no less");
        assertEq(ve.totalStaked(), 0);
    }

    function testFuzz_powerMonotonicInStake(uint128 a, uint128 b) public {
        a = uint128(bound(uint256(a), 1, 500_000e18));
        b = uint128(bound(uint256(b), 1, 500_000e18));
        _stake(alice, a, W7);
        uint256 p1 = ve.votingPower(alice);
        _stake(alice, b, W7);
        uint256 p2 = ve.votingPower(alice);
        assertGe(p2, p1, "more stake never reduces power");
    }
}
