import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdaterStore } from "../stores/updaterStore";

/** How often to re-check for updates while the app stays open (6 hours). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Delay before the first check after launch, so startup isn't contended. */
const INITIAL_CHECK_DELAY_MS = 5_000;

/** Guard against overlapping checks (e.g. interval fires while a manual check runs). */
let inFlight: Promise<void> | null = null;

/**
 * Check for an update and, if one exists, download it (streaming progress into
 * the store) and arm the install action. Safe to call repeatedly.
 *
 * @param silent  When true (background checks), don't surface "up to date" /
 *                error states as prominently. When false (user clicked
 *                "Check for Updates"), the UI shows the full result.
 */
export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;

  const store = useUpdaterStore.getState();

  // If an update is already downloaded and waiting, don't re-download.
  if (store.status === "ready" || store.status === "downloading") return;

  inFlight = (async () => {
    const s = useUpdaterStore.getState();
    s.setStatus("checking");
    try {
      const update: Update | null = await check();

      if (!update) {
        useUpdaterStore.getState().setUpToDate();
        return;
      }

      const notes = update.body?.trim() ? update.body.trim() : null;
      useUpdaterStore.getState().setAvailable(update.version, notes);

      // Download with progress. contentLength may be undefined on some servers.
      let total = 0;
      let received = 0;
      useUpdaterStore.getState().setStatus("downloading");
      useUpdaterStore.getState().setProgress(0);

      await update.download((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            received = 0;
            break;
          case "Progress":
            received += event.data.chunkLength;
            if (total > 0) {
              useUpdaterStore.getState().setProgress(Math.min(1, received / total));
            }
            break;
          case "Finished":
            useUpdaterStore.getState().setProgress(1);
            break;
        }
      });

      useUpdaterStore.getState().setReady(update.version, notes, async () => {
        await update.install();
        await relaunch();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Update check failed:", message);
      if (!opts.silent) {
        useUpdaterStore.getState().setError(message);
      } else {
        // Background failure: stay quiet, just go back to idle so the banner hides.
        const cur = useUpdaterStore.getState();
        if (cur.status !== "ready") cur.setStatus("idle");
      }
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Start background update checks: one shortly after launch, then on an interval.
 * Returns a cleanup function to stop the interval.
 */
export function startAutoUpdateChecks(): () => void {
  const initial = setTimeout(() => void checkForUpdates({ silent: true }), INITIAL_CHECK_DELAY_MS);
  const interval = setInterval(() => void checkForUpdates({ silent: true }), CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
