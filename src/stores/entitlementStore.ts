import { create } from "zustand";

/**
 * Legacy entitlement store — wallet / $GRID staking is disconnected.
 * Every feature is free: hasTier always succeeds, tier is effectively unlimited.
 * Hydrate / link / clear are no-ops so residual call sites stay safe.
 */

export type LinkStatus = "idle" | "waiting" | "success" | "timeout" | "error";

interface EntitlementState {
  entitlement: null;
  loading: boolean;
  tier: number;
  linkStatus: LinkStatus;
  hydrate: () => Promise<void>;
  applyToken: (token: string) => Promise<boolean>;
  startLink: () => Promise<void>;
  cancelLink: () => void;
  clear: () => Promise<void>;
  hasTier: (min: number) => boolean;
}

export const useEntitlementStore = create<EntitlementState>(() => ({
  entitlement: null,
  loading: false,
  tier: 99,
  linkStatus: "idle",

  hydrate: async () => {},
  applyToken: async () => false,
  startLink: async () => {},
  cancelLink: () => {},
  clear: async () => {},
  hasTier: () => true,
}));
