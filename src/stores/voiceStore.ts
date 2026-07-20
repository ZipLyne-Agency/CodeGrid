import { create } from "zustand";
import {
  voiceStart,
  voiceStop,
  voiceSetMicPaused,
  getSetting,
} from "../lib/ipc";
import { useWorkspaceStore } from "./workspaceStore";
import { useToastStore } from "./toastStore";

/**
 * CodeGrid Voice — UI-side state for the Rust-owned Realtime session.
 * All audio lives in Rust; this store only mirrors status events and issues
 * start/stop/mute commands. See docs/voice-control.md.
 */

export type VoiceStatus =
  | "off"
  | "connecting"
  | "listening"
  | "speaking"
  | "tool"
  /** Wake-word mode: session live, ignoring everything until "Max" is heard. */
  | "sleeping"
  | "error";

export interface VoiceTranscriptLine {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface VoiceStateStore {
  status: VoiceStatus;
  /** Last status detail (tool name, error message, end reason). */
  detail: string | null;
  micPaused: boolean;
  startedAt: number | null;
  userLine: VoiceTranscriptLine | null;
  assistantLine: VoiceTranscriptLine | null;
  /** Last tool action, for the "⚡ spawned codex → pane 3" toast strip. */
  lastTool: string | null;
  /** Listening mode of the live session ("focused" | "always" | "ptt"). */
  mode: string;
  /** Hotkey label for the PTT hint ("F9"). */
  pttShortcut: string;

  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleMic: () => Promise<void>;

  // Event ingestion (wired in App.tsx).
  applyStatus: (status: VoiceStatus | "warning", detail: string | null) => void;
  applyTranscript: (line: VoiceTranscriptLine) => void;
  applyToolCall: (payload: { name: string; phase: string; ok?: boolean; result?: any; error?: string }) => void;
  applyMic: (paused: boolean) => void;
}

export const useVoiceStore = create<VoiceStateStore>((set, get) => ({
  status: "off",
  detail: null,
  micPaused: false,
  startedAt: null,
  userLine: null,
  assistantLine: null,
  lastTool: null,
  mode: "focused",
  pttShortcut: "F9",

  start: async () => {
    const wsId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!wsId) {
      useToastStore.getState().addToast("Open a workspace first.", "warning");
      return;
    }
    // Snapshot mode + hotkey so the UI can hint "hold F9 to talk".
    try {
      const [mode, ptt] = await Promise.all([
        getSetting("voice_mode"),
        getSetting("voice_ptt_shortcut"),
      ]);
      set({ mode: mode || "focused", pttShortcut: ptt || "F9" });
    } catch {
      /* defaults stand */
    }
    set({ status: "connecting", detail: null, userLine: null, assistantLine: null, lastTool: null });
    try {
      await voiceStart(wsId);
      set({ startedAt: Date.now() });
    } catch (e) {
      set({ status: "off", startedAt: null });
      useToastStore.getState().addToast(String(e), "error", 6000);
    }
  },

  stop: async () => {
    try {
      await voiceStop();
    } catch {
      /* session already gone */
    }
    set({ status: "off", startedAt: null, micPaused: false });
  },

  toggleMic: async () => {
    const next = !get().micPaused;
    set({ micPaused: next });
    voiceSetMicPaused(next).catch(() => {});
  },

  applyStatus: (status, detail) => {
    // "warning" = non-fatal realtime error: surface as toast, keep running.
    if (status === "warning") {
      if (detail) useToastStore.getState().addToast(`Voice: ${detail}`, "warning", 5000);
      return;
    }
    if (status === "error" && detail) {
      useToastStore.getState().addToast(`Voice: ${detail}`, "error", 8000);
    }
    set((s) => ({
      status,
      detail: detail ?? null,
      startedAt:
        status === "off" || status === "error"
          ? null
          : s.startedAt ?? (status === "connecting" ? Date.now() : s.startedAt),
      ...(status === "off" || status === "error"
        ? { micPaused: false, userLine: null, assistantLine: null }
        : {}),
    }));
  },

  applyTranscript: (line) =>
    set(line.role === "user" ? { userLine: line } : { assistantLine: line }),

  applyToolCall: ({ name, phase, ok, result, error }) => {
    if (phase !== "done") return;
    let summary: string;
    if (!ok) {
      summary = `✗ ${name}: ${error ?? "failed"}`;
    } else if (name === "spawn_agent" && result?.pane != null) {
      summary = `⚡ spawned ${result.agent ?? "agent"} → pane ${result.pane}`;
    } else if (result?.pane != null) {
      summary = `⚡ ${name.replace("_", " ")} → pane ${result.pane}`;
    } else {
      summary = `⚡ ${name.replace("_", " ")}`;
    }
    set({ lastTool: summary });
  },

  applyMic: (paused) => set({ micPaused: paused }),
}));

/**
 * Voice is strictly per-workspace: switching workspaces ends the session
 * instead of dragging it along — start the mic again in the new workspace.
 */
export function bindVoiceToWorkspaceSwitches() {
  const handler = (e: Event) => {
    const wsId = (e as CustomEvent).detail?.workspaceId;
    if (!wsId) return;
    const voice = useVoiceStore.getState();
    if (voice.status !== "off" && voice.status !== "error") {
      void voice.stop();
      useToastStore
        .getState()
        .addToast("Voice session ended — it's per-workspace. Tap the mic to start it here.", "info", 4000);
    }
  };
  window.addEventListener("codegrid:workspace-changed", handler);
  return () => window.removeEventListener("codegrid:workspace-changed", handler);
}
