import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEntitlementStore } from "../stores/entitlementStore";
import { parseLinkUrl } from "../lib/entitlement";
import { useToastStore } from "../stores/toastStore";

/**
 * Wires premium entitlement into the app:
 *   - hydrates the stored token from the keychain on launch,
 *   - listens for the `codegrid://link?token=…` deep-link — a MANUAL fallback
 *     for the hands-free relay (the "Return to CodeGrid" button on /link),
 *   - re-hydrates periodically so an expired token drops the user back to free.
 *
 * The primary link path is hands-free: `startLink()` opens the browser and polls
 * the relay (see entitlementStore), so the deep-link is rarely needed.
 *
 * Mount once near the app root.
 */
export function useEntitlement() {
  const hydrate = useEntitlementStore((s) => s.hydrate);
  const applyToken = useEntitlementStore((s) => s.applyToken);

  useEffect(() => {
    hydrate();

    const unlistenPromise = listen<string[]>("codegrid://deep-link", async (event) => {
      const urls = event.payload ?? [];
      for (const url of urls) {
        const parsed = parseLinkUrl(url);
        if (!parsed) continue;
        const ok = await applyToken(parsed.token);
        // Clear any in-progress hands-free poll now that we have a result.
        useEntitlementStore.getState().cancelLink();
        const { addToast } = useToastStore.getState();
        if (ok) addToast("Wallet linked.", "success");
        else addToast("Could not verify entitlement. Try again.", "error");
      }
    });

    // Re-check periodically (tokens are ~24h); also catches wake-from-sleep.
    const interval = window.setInterval(() => hydrate(), 6 * 60 * 60 * 1000);

    return () => {
      unlistenPromise.then((un) => un());
      window.clearInterval(interval);
    };
  }, [hydrate, applyToken]);
}

/** Open the hosted wallet sign-in. Hands-free: opens the browser + auto-detects. */
export async function startPremiumLink() {
  await useEntitlementStore.getState().startLink();
}
