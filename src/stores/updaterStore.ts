import { create } from "zustand";

/**
 * In-app auto-update state.
 *
 * Flow: idle → checking → (uptodate | available → downloading → ready) | error
 * The store is the single source of truth; `lib/updater.ts` drives it and the
 * UI (UpdateBanner, Settings) reacts to it.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "uptodate"
  | "error";

interface UpdaterState {
  status: UpdateStatus;
  /** Version offered by the server (when available/ready). */
  version: string | null;
  /** Release notes / changelog body for the offered version. */
  notes: string | null;
  /** Download progress 0..1 (only meaningful while downloading). */
  progress: number;
  /** Last error message, if status === "error". */
  error: string | null;
  /** Epoch ms of the last completed check. */
  lastChecked: number | null;
  /** Installs the downloaded update and relaunches. Set when status === "ready". */
  install: (() => Promise<void>) | null;
  /** User dismissed the "ready" banner this session ("Later"). */
  dismissed: boolean;

  setStatus: (status: UpdateStatus) => void;
  setProgress: (progress: number) => void;
  setReady: (version: string, notes: string | null, install: () => Promise<void>) => void;
  setAvailable: (version: string, notes: string | null) => void;
  setUpToDate: () => void;
  setError: (message: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: 0,
  error: null,
  lastChecked: null,
  install: null,
  dismissed: false,

  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),

  setAvailable: (version, notes) =>
    set({ status: "available", version, notes, error: null, dismissed: false }),

  setReady: (version, notes, install) =>
    set({ status: "ready", version, notes, install, progress: 1, error: null }),

  setUpToDate: () =>
    set({ status: "uptodate", version: null, notes: null, install: null, error: null, lastChecked: Date.now() }),

  setError: (message) => set({ status: "error", error: message, lastChecked: Date.now() }),

  dismiss: () => set({ dismissed: true }),

  reset: () =>
    set({ status: "idle", version: null, notes: null, progress: 0, error: null, install: null, dismissed: false }),
}));
