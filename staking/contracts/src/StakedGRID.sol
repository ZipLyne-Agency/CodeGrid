// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  StakedGRID — cooldown access staking for $GRID (no rewards)
 * @notice Stake $GRID on Base to unlock CodeGrid premium tiers. There is NO lock
 *         term: a stake grants access for as long as it stays above a tier
 *         threshold. To exit, you start a cooldown — a notice period of your
 *         choice (e.g. 7 or 30 days) — after which you withdraw your full
 *         principal. Committing to a longer cooldown earns a power multiplier, so
 *         a 30-day staker reaches a tier with less $GRID than a 7-day staker.
 *
 * @dev    DESIGN CONSTRAINTS (intentional — utility access, not a security):
 *         - NO yield, NO emissions, NO revenue share, NO governance. Principal is
 *           always returned in full; the only "cost" of access is the opportunity
 *           cost of staked capital. This is the "subscription you don't pay for".
 *         - The owner can NEVER touch staked principal (`rescueToken` rejects
 *           GRID). Owner powers are limited to (a) tier thresholds, (b) cooldown
 *           options/multipliers, and (c) pausing *entry* (staking) — never *exit*.
 *         - `withdraw`, `requestUnstake` and `cancelUnstake` work even when
 *           paused: exit is always open.
 *         - Power(account) = staked * multiplier(cooldown) / BPS. Stake that is
 *           mid-cooldown (unbonding) carries NO power, so you cannot begin
 *           unstaking and keep your tier. The multiplier is SNAPSHOTTED into the
 *           account at stake time, so a later cooldown-option change never
 *           retroactively reprices or demotes a live staker.
 *         - $GRID is assumed a standard, non-fee, non-rebasing ERC-20 (it is,
 *           and `grid` is immutable). Amounts are credited as sent; do NOT
 *           deploy against a fee-on-transfer or rebasing token.
 *
 *         `tierOf(address)` and `votingPower(address)` keep the exact signatures
 *         the off-chain entitlement verifier reads — no Worker change needed.
 */
contract StakedGRID is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants & immutables
    // ---------------------------------------------------------------------

    /// @notice The $GRID token being staked (immutable — cannot be changed).
    IERC20 public immutable grid;

    /// @notice Basis-points denominator for cooldown multipliers.
    uint256 public constant BPS = 10_000;

    /// @notice Upper bound on any cooldown option (safety).
    uint64 public constant MAX_COOLDOWN = 90 days;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Position {
        uint128 staked; // actively staked — counts toward power
        uint128 unbonding; // mid-cooldown — no power, withdrawable at `unbondingEnd`
        uint64 cooldownPeriod; // chosen notice period (seconds)
        uint64 unbondingEnd; // timestamp the cooldown elapses (0 = not unbonding)
    }

    mapping(address account => Position) public positions;

    /// @notice Total $GRID held (active + unbonding) across all accounts.
    uint256 public totalStaked;

    /// @notice cooldown period (seconds) => power multiplier in bps. 0 = disabled.
    mapping(uint64 period => uint256 multiplierBps) public cooldownMultiplierBps;

    /// @notice Multiplier (bps) snapshotted into each account's position at stake
    ///         time. `votingPower` reads THIS, so a later `setCooldownOption`
    ///         never retroactively changes a live staker's power or tier.
    mapping(address account => uint64 multiplierBps) public stakeMultiplierBps;

    /// @notice Ascending power thresholds (18 decimals). power >= [i] ⇒ tier i+1.
    uint256[] public tierThresholds;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Staked(address indexed account, uint256 amount, uint64 cooldownPeriod, uint256 newStaked);
    event UnstakeRequested(address indexed account, uint256 amount, uint64 unbondingEnd);
    event UnstakeCancelled(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event CooldownOptionSet(uint64 period, uint256 multiplierBps);
    event TierThresholdsUpdated(uint256[] thresholds);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAmount();
    error ZeroAddress();
    error InvalidCooldown();
    error CannotLowerCooldown();
    error InsufficientStake();
    error AlreadyUnbonding();
    error NotUnbonding();
    error CooldownNotElapsed();
    error ThresholdsNotAscending();
    error TooManyTiers();
    error CannotRescueGrid();
    error AmountOverflow();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @param _grid       The $GRID ERC-20 on Base.
     * @param _owner      Admin (thresholds + cooldown options + pause). Multisig in prod.
     * @param _thresholds Initial ascending power thresholds (may be empty).
     */
    constructor(address _grid, address _owner, uint256[] memory _thresholds) Ownable(_owner) {
        if (_grid == address(0) || _owner == address(0)) revert ZeroAddress();
        grid = IERC20(_grid);
        _setTierThresholds(_thresholds);
        // Defaults: 7-day notice = 1.00x, 30-day notice = 1.25x.
        _setCooldownOption(7 days, 10_000);
        _setCooldownOption(30 days, 12_500);
    }

    // ---------------------------------------------------------------------
    // Stake lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Stake `amount` $GRID with a `cooldownPeriod` notice. Adds to any
     *         existing position; the cooldown may be raised but not lowered while
     *         staked (lowering requires fully exiting first, so the longer-notice
     *         multiplier can't be enjoyed and then dropped at exit).
     */
    function stake(uint256 amount, uint64 cooldownPeriod) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Position storage p = positions[msg.sender];

        if (p.staked == 0) {
            // No active stake (fresh, or mid-cooldown with nothing active): pick
            // any currently-enabled cooldown and snapshot its multiplier. Note
            // `p.staked == 0` (not `&& unbonding == 0`) lets a fully-unbonding
            // user open a new, possibly-shorter position with fresh capital; the
            // existing unbonding bucket keeps its own fixed unlock time.
            uint256 mult = cooldownMultiplierBps[cooldownPeriod];
            if (mult == 0) revert InvalidCooldown();
            p.cooldownPeriod = cooldownPeriod;
            stakeMultiplierBps[msg.sender] = uint64(mult);
        } else if (cooldownPeriod == p.cooldownPeriod) {
            // Top-up on the same period — always allowed, even if that option was
            // later disabled; keeps the snapshotted multiplier.
        } else {
            // Changing period while staked: can only raise (not lower), and the
            // new option must be enabled. Re-snapshot to the new multiplier.
            if (cooldownPeriod < p.cooldownPeriod) revert CannotLowerCooldown();
            uint256 mult = cooldownMultiplierBps[cooldownPeriod];
            if (mult == 0) revert InvalidCooldown();
            p.cooldownPeriod = cooldownPeriod;
            stakeMultiplierBps[msg.sender] = uint64(mult);
        }

        p.staked += _u128(amount);
        totalStaked += amount;

        // CEI: state updated above, external transfer in last; nonReentrant guards.
        grid.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, p.cooldownPeriod, p.staked);
    }

    /**
     * @notice Begin unstaking `amount`: it stops counting toward power immediately
     *         and becomes withdrawable after the cooldown. One cooldown at a time
     *         (withdraw or cancel the current one first).
     */
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage p = positions[msg.sender];
        if (p.unbondingEnd != 0) revert AlreadyUnbonding();
        if (amount > p.staked) revert InsufficientStake();

        p.staked -= _u128(amount);
        p.unbonding = _u128(amount);
        // forge-lint: disable-next-line(unsafe-typecast)
        p.unbondingEnd = uint64(block.timestamp) + p.cooldownPeriod;

        emit UnstakeRequested(msg.sender, amount, p.unbondingEnd);
    }

    /**
     * @notice Cancel an in-progress cooldown, returning the unbonding stake to
     *         active (restoring its power). Works even when paused.
     */
    function cancelUnstake() external nonReentrant {
        Position storage p = positions[msg.sender];
        uint256 amount = p.unbonding;
        if (amount == 0) revert NotUnbonding();

        p.staked += uint128(amount); // safe: `amount` was a uint128
        p.unbonding = 0;
        p.unbondingEnd = 0;

        emit UnstakeCancelled(msg.sender, amount);
    }

    /**
     * @notice Withdraw fully-cooled-down stake and return the principal.
     * @dev    Intentionally NOT `whenNotPaused`: exit must always be possible.
     */
    function withdraw() external nonReentrant {
        Position storage p = positions[msg.sender];
        uint256 amount = p.unbonding;
        if (amount == 0) revert NotUnbonding();
        if (block.timestamp < p.unbondingEnd) revert CooldownNotElapsed();

        p.unbonding = 0;
        p.unbondingEnd = 0;
        totalStaked -= amount;

        grid.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views — power & tier (read by the off-chain entitlement verifier)
    // ---------------------------------------------------------------------

    /// @notice Access power of an account = active stake * snapshotted multiplier.
    /// @dev    Reads `stakeMultiplierBps` (snapshotted at stake time), so a later
    ///         `setCooldownOption` never retroactively reprices a live staker.
    function votingPower(address account) public view returns (uint256) {
        uint256 staked = positions[account].staked;
        if (staked == 0) return 0;
        return (staked * stakeMultiplierBps[account]) / BPS;
    }

    /// @notice Tier from power. 0 = none; otherwise the count of thresholds met.
    function tierOf(address account) external view returns (uint8 tier) {
        uint256 power = votingPower(account);
        uint256 len = tierThresholds.length;
        for (uint256 i; i < len; ++i) {
            if (power >= tierThresholds[i]) tier = uint8(i + 1);
            else break; // ascending ⇒ first miss ends it
        }
    }

    /// @notice Active (power-bearing) stake of an account.
    function stakedOf(address account) external view returns (uint256) {
        return positions[account].staked;
    }

    /// @notice In-progress cooldown: amount being unbonded and when it unlocks.
    function unbondingOf(address account) external view returns (uint256 amount, uint64 end) {
        Position memory p = positions[account];
        return (p.unbonding, p.unbondingEnd);
    }

    /// @notice Power a hypothetical `amount` at `cooldownPeriod` would grant.
    function previewPower(uint256 amount, uint64 cooldownPeriod) external view returns (uint256) {
        uint256 mult = cooldownMultiplierBps[cooldownPeriod];
        if (mult == 0) return 0;
        return (amount * mult) / BPS;
    }

    /// @notice Full thresholds array (Solidity can't auto-return dynamic arrays).
    function getTierThresholds() external view returns (uint256[] memory) {
        return tierThresholds;
    }

    // ---------------------------------------------------------------------
    // Owner — minimal admin (never touches principal)
    // ---------------------------------------------------------------------

    /// @notice Replace tier thresholds (must be strictly ascending).
    function setTierThresholds(uint256[] calldata thresholds) external onlyOwner {
        _setTierThresholds(thresholds);
    }

    /**
     * @notice Add/update/disable a cooldown option for NEW stakes. Existing
     *         positions are UNAFFECTED — each snapshots its multiplier at stake
     *         time (`stakeMultiplierBps`), so a config change never reprices or
     *         demotes a live staker. `multiplierBps = 0` disables the option for
     *         new stakes; current holders keep their snapshot and can still top
     *         up on that period.
     */
    function setCooldownOption(uint64 period, uint256 multiplierBps) external onlyOwner {
        _setCooldownOption(period, multiplierBps);
    }

    /// @notice Pause *entry* (stake). Exit (request/cancel/withdraw) stays open.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Rescue non-GRID tokens sent here by mistake.
     * @dev    GRID can NEVER be rescued — that would let the owner reach staked
     *         principal. Only non-GRID tokens are sweepable.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(grid)) revert CannotRescueGrid();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _setTierThresholds(uint256[] memory thresholds) internal {
        // Bounded so tierOf's uint8 return can never wrap (tier = uint8(i + 1)).
        if (thresholds.length > 255) revert TooManyTiers();
        for (uint256 i = 1; i < thresholds.length; ++i) {
            if (thresholds[i] <= thresholds[i - 1]) revert ThresholdsNotAscending();
        }
        tierThresholds = thresholds;
        emit TierThresholdsUpdated(thresholds);
    }

    function _setCooldownOption(uint64 period, uint256 multiplierBps) internal {
        if (period == 0 || period > MAX_COOLDOWN) revert InvalidCooldown();
        cooldownMultiplierBps[period] = multiplierBps;
        emit CooldownOptionSet(period, multiplierBps);
    }

    function _u128(uint256 x) internal pure returns (uint128) {
        if (x > type(uint128).max) revert AmountOverflow();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(x);
    }
}
