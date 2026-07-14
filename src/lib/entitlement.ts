/**
 * Legacy entitlement helpers — $GRID staking / wallet link is disconnected.
 * Types and constants remain only so residual imports compile; nothing here
 * talks to a verifier or stores a JWT.
 */

export const LINK_URL = "https://codegrid.app";
export const STAKE_URL = "https://codegrid.app";
export const PRO_POWER_THRESHOLD = 0;

export interface Entitlement {
  address: string;
  tier: number;
  power: string;
  exp: number;
}

export interface TierInfo {
  tier: number;
  name: string;
}

export const TIER_NAMES: Record<number, string> = {
  0: "Free",
  1: "Free",
};

export async function verifyEntitlementToken(_token: string): Promise<Entitlement | null> {
  return null;
}

export async function storeEntitlement(_token: string): Promise<void> {}

export async function pollEntitlement(_state: string): Promise<string | null> {
  return null;
}

export async function getStoredEntitlement(): Promise<string | null> {
  return null;
}

export async function clearStoredEntitlement(): Promise<void> {}

export function parseLinkUrl(_url: string): { token: string; tier?: number } | null {
  return null;
}
