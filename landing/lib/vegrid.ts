/**
 * StakedGRID — cooldown access staking config + helpers.
 *
 * Single source of truth for the staking contract address, the ABI subset the UI
 * calls, tier metadata, the cooldown options, and the client-side power-preview
 * math (staked × cooldown multiplier — a mirror of the chain, which is
 * authoritative). No lock term: stake grants access; exit via a cooldown.
 */
import {base, baseSepolia} from "viem/chains";
import type {Chain} from "viem";
import {GRID_TOKEN_ADDRESS, GRID_CHAIN} from "./token";

/**
 * Active chain. Defaults to Base mainnet (8453); set
 * NEXT_PUBLIC_GRID_CHAIN_ID=84532 to point the UI at Base Sepolia for testing.
 */
export const GRID_CHAIN_ID = Number(process.env.NEXT_PUBLIC_GRID_CHAIN_ID ?? "8453");
export const GRID_VIEM_CHAIN: Chain = GRID_CHAIN_ID === 84532 ? baseSepolia : base;

/**
 * StakedGRID contract address. On testnet this is the Sepolia deploy; on mainnet,
 * the audited production contract. Set via NEXT_PUBLIC_VEGRID_ADDRESS.
 */
export const VEGRID_ADDRESS = (process.env.NEXT_PUBLIC_VEGRID_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/**
 * GRID token to stake. On mainnet this is the real $GRID; on testnet, set
 * NEXT_PUBLIC_GRID_TOKEN_ADDRESS to the MockGRID deploy.
 */
export const GRID_ADDRESS = (process.env.NEXT_PUBLIC_GRID_TOKEN_ADDRESS ??
  GRID_TOKEN_ADDRESS) as `0x${string}`;
export {GRID_CHAIN};

/** Entitlement verifier Worker base URL. */
export const VERIFIER_URL =
  process.env.NEXT_PUBLIC_VERIFIER_URL ?? "https://grid-verifier.codegrid.workers.dev";

/** Points Worker base URL. */
export const POINTS_URL =
  process.env.NEXT_PUBLIC_POINTS_URL ?? "https://grid-points.codegrid.workers.dev";

export const BPS = 10_000;

export interface CooldownOption {
  /** Notice period in seconds (the contract key). */
  seconds: number;
  days: number;
  label: string;
  /** Power multiplier in basis points (10000 = 1.0x). Must match the contract. */
  multiplierBps: number;
}

/** Must match the contract's default `cooldownMultiplierBps` options. */
export const COOLDOWN_OPTIONS: CooldownOption[] = [
  {seconds: 7 * 86_400, days: 7, label: "7-day notice", multiplierBps: 10_000},
  {seconds: 30 * 86_400, days: 30, label: "30-day notice", multiplierBps: 12_500},
];

export interface TierMeta {
  /** On-chain tier index (1-based). 0 = no tier. */
  tier: number;
  name: string;
  /** Power threshold in whole GRID (18-decimals applied elsewhere). */
  threshold: number;
  blurb: string;
}

/** Must match the thresholds passed to the deploy script. */
export const TIERS: TierMeta[] = [
  {tier: 1, name: "Pro", threshold: 50_000_000, blurb: "AI code review · coding analytics"},
  {tier: 2, name: "Team", threshold: 250_000_000, blurb: "Everything in Pro · shared workspaces"},
  {tier: 3, name: "Founder", threshold: 1_000_000_000, blurb: "Everything · early features · founder badge"},
];

/** The StakedGRID ABI subset the UI reads/writes. */
export const VEGRID_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      {name: "amount", type: "uint256"},
      {name: "cooldownPeriod", type: "uint64"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestUnstake",
    stateMutability: "nonpayable",
    inputs: [{name: "amount", type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelUnstake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [
      {name: "staked", type: "uint128"},
      {name: "unbonding", type: "uint128"},
      {name: "cooldownPeriod", type: "uint64"},
      {name: "unbondingEnd", type: "uint64"},
    ],
  },
  {
    type: "function",
    name: "votingPower",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint256"}],
  },
  {
    type: "function",
    name: "tierOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint8"}],
  },
  {
    type: "function",
    name: "stakedOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint256"}],
  },
  {
    type: "function",
    name: "unbondingOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [
      {name: "amount", type: "uint256"},
      {name: "end", type: "uint64"},
    ],
  },
  {
    type: "function",
    name: "cooldownMultiplierBps",
    stateMutability: "view",
    inputs: [{name: "period", type: "uint64"}],
    outputs: [{name: "", type: "uint256"}],
  },
] as const;

/** Minimal ERC-20 ABI for approve/allowance/balance. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [{name: "", type: "bool"}],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "spender", type: "address"},
    ],
    outputs: [{name: "", type: "uint256"}],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "", type: "uint256"}],
  },
] as const;

/** Client-side mirror of on-chain power: amount × multiplier. */
export function previewPower(amountTokens: number, multiplierBps: number): number {
  return (amountTokens * multiplierBps) / BPS;
}

/** Tier reached for a given power (whole GRID). */
export function tierForPower(power: number): TierMeta | null {
  let reached: TierMeta | null = null;
  for (const t of TIERS) {
    if (power >= t.threshold) reached = t;
    else break;
  }
  return reached;
}

/** The next tier above `power`, or null if already at the top. */
export function nextTier(power: number): TierMeta | null {
  for (const t of TIERS) {
    if (power < t.threshold) return t;
  }
  return null;
}

/** Rough USD reference for display estimates only — price drifts, always show as "≈". */
export const GRID_USD = 0.00000286;
export function usd(gridAmount: number): string {
  const v = gridAmount * GRID_USD;
  if (v <= 0) return "$0";
  if (v < 0.01) return "<$0.01";
  if (v < 1000) return `$${v.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
  return `$${Math.round(v).toLocaleString()}`;
}
