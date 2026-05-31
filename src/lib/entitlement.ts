/**
 * Premium entitlement — client helpers.
 *
 * The entitlement is a short-lived EdDSA-signed JWT minted by the grid-verifier
 * Worker after the user proves wallet ownership (SIWE). We:
 *   - persist it in the OS keychain (via Rust commands),
 *   - VERIFY its signature + expiry offline against the bundled Ed25519 public
 *     key before trusting any tier claim,
 *   - expose the decoded { tier, power, address, exp } to the app.
 *
 * Verifying offline (not just decoding) is what makes the gate meaningful: a
 * user can't hand-craft a token granting themselves a tier.
 */
import { invoke } from "@tauri-apps/api/core";
import { jwtVerify, importJWK, type JWK } from "jose";

/** Hosted login round-trip — opens the browser to sign in with a wallet. */
export const LINK_URL = "https://codegrid.app/link";

/** Where to stake — opened from the gate's "Get $GRID" action. */
export const STAKE_URL = "https://codegrid.app/token/stake";

/**
 * Power needed to reach Pro (tier 1), mirroring the contract's first tier
 * threshold. Used only for the upsell's "stake ~N more $GRID" guidance — the
 * real gate is the on-chain `tier` carried in the entitlement.
 */
export const PRO_POWER_THRESHOLD = 50_000_000;

export const JWT_ISSUER = "https://codegrid.app";
export const JWT_AUDIENCE = "codegrid-desktop";

/**
 * Ed25519 PUBLIC key (JWK) that the verifier signs entitlements with. This is
 * the public half — safe to bundle. Replace with the value printed by
 * `staking/services/verifier/scripts/gen-keys.mjs` after key generation.
 */
export const ENTITLEMENT_PUBLIC_JWK: JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: "nI2-PrApCZn-BNEqhlXPoMXUI5Bw5ht81gi70ypBakU",
  kid: "9193d787-f37a-4839-9411-e209a8c5e478",
  alg: "EdDSA",
};

export interface Entitlement {
  address: string;
  tier: number;
  /** veGRID power in wei (string). */
  power: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export interface TierInfo {
  tier: number;
  name: string;
}

export const TIER_NAMES: Record<number, string> = {
  0: "Free",
  1: "Pro",
  2: "Team",
  3: "Founder",
};

/** Verify a raw JWT offline; returns the entitlement or null if invalid/expired. */
export async function verifyEntitlementToken(token: string): Promise<Entitlement | null> {
  try {
    const key = await importJWK(ENTITLEMENT_PUBLIC_JWK, "EdDSA");
    const { payload } = await jwtVerify(token, key, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (!payload.sub || typeof payload.exp !== "number") return null;
    return {
      address: payload.sub,
      tier: Number((payload as Record<string, unknown>).tier ?? 0),
      power: String((payload as Record<string, unknown>).power ?? "0"),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

// --- Tauri keychain commands ---

export async function storeEntitlement(token: string): Promise<void> {
  await invoke("store_entitlement", { token });
}

/**
 * Poll the relay (via Rust, bypassing the locked-down webview CSP) for the
 * entitlement that the browser sign-in produced for this `state`. Returns the
 * JWT once ready, or null while still pending.
 */
export async function pollEntitlement(state: string): Promise<string | null> {
  return (await invoke("poll_entitlement", { state })) as string | null;
}

export async function getStoredEntitlement(): Promise<string | null> {
  return (await invoke("get_entitlement")) as string | null;
}

export async function clearStoredEntitlement(): Promise<void> {
  await invoke("clear_entitlement");
}

/** Pull a `codegrid://link?token=…` deep-link URL apart. */
export function parseLinkUrl(url: string): { token: string; tier?: number } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "codegrid:" || u.host !== "link") return null;
    const token = u.searchParams.get("token");
    if (!token) return null;
    const tierStr = u.searchParams.get("tier");
    return { token, tier: tierStr ? Number(tierStr) : undefined };
  } catch {
    return null;
  }
}
