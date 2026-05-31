import { create } from "zustand";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  type Entitlement,
  verifyEntitlementToken,
  storeEntitlement,
  getStoredEntitlement,
  clearStoredEntitlement,
  pollEntitlement,
  LINK_URL,
} from "../lib/entitlement";
import { useToastStore } from "./toastStore";

export type LinkStatus = "idle" | "waiting" | "success" | "timeout" | "error";

interface EntitlementState {
  /** Verified entitlement, or null if free / none / expired. */
  entitlement: Entitlement | null;
  /** True until the first hydrate from the keychain completes. */
  loading: boolean;
  /** Current effective tier (0 = free). */
  tier: number;
  /** Hands-free desktop-link flow status (open browser → auto-detect). */
  linkStatus: LinkStatus;

  /** Load + verify a stored token on launch. Drops it if expired/invalid. */
  hydrate: () => Promise<void>;
  /** Verify + persist a token (from the relay poll or the deep-link). */
  applyToken: (token: string) => Promise<boolean>;
  /** Open the hosted sign-in and auto-detect completion via the relay. */
  startLink: () => Promise<void>;
  /** Cancel an in-progress link. */
  cancelLink: () => void;
  /** Sign out / forget the wallet. */
  clear: () => Promise<void>;
  /** Convenience gate check. */
  hasTier: (min: number) => boolean;
}

// Module-level poll control so a new/cancelled link supersedes any prior one.
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activeState: string | null = null;
const LINK_TIMEOUT_MS = 4 * 60 * 1000;

function stopPolling() {
  activeState = null;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  entitlement: null,
  loading: true,
  tier: 0,
  linkStatus: "idle",

  hydrate: async () => {
    try {
      const token = await getStoredEntitlement();
      if (!token) {
        set({ entitlement: null, tier: 0, loading: false });
        return;
      }
      const ent = await verifyEntitlementToken(token);
      if (!ent || ent.exp * 1000 <= Date.now()) {
        await clearStoredEntitlement().catch(() => {});
        set({ entitlement: null, tier: 0, loading: false });
        return;
      }
      set({ entitlement: ent, tier: ent.tier, loading: false });
    } catch {
      set({ entitlement: null, tier: 0, loading: false });
    }
  },

  applyToken: async (token: string) => {
    const ent = await verifyEntitlementToken(token);
    if (!ent || ent.exp * 1000 <= Date.now()) return false;
    await storeEntitlement(token);
    set({ entitlement: ent, tier: ent.tier });
    return true;
  },

  startLink: async () => {
    stopPolling();
    const state = crypto.randomUUID();
    activeState = state;
    set({ linkStatus: "waiting" });

    try {
      await openExternal(`${LINK_URL}?state=${encodeURIComponent(state)}`);
    } catch {
      // If we can't open the browser, surface it but keep polling in case the
      // user opens the link manually.
    }

    const started = Date.now();
    const tick = async () => {
      if (activeState !== state) return; // superseded / cancelled
      if (Date.now() - started > LINK_TIMEOUT_MS) {
        stopPolling();
        set({ linkStatus: "timeout" });
        return;
      }
      let token: string | null = null;
      try {
        token = await pollEntitlement(state);
      } catch {
        token = null;
      }
      if (activeState !== state) return;
      if (token) {
        stopPolling();
        const ok = await get().applyToken(token);
        set({ linkStatus: ok ? "success" : "error" });
        const { addToast } = useToastStore.getState();
        if (ok) addToast("Wallet linked.", "success");
        else addToast("Couldn't verify the link. Try again.", "error");
        return;
      }
      pollTimer = setTimeout(tick, 2000);
    };
    pollTimer = setTimeout(tick, 1500);
  },

  cancelLink: () => {
    stopPolling();
    set({ linkStatus: "idle" });
  },

  clear: async () => {
    stopPolling();
    await clearStoredEntitlement().catch(() => {});
    set({ entitlement: null, tier: 0, linkStatus: "idle" });
  },

  hasTier: (min: number) => get().tier >= min,
}));
