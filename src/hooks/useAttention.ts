import { useEffect, useRef } from "react";
import { useSessionStore, type SessionWithModel } from "../stores/sessionStore";
import { useAttentionStore, type AttentionKind } from "../stores/attentionStore";
import { notify, setDockBadge, setTrayStatus, ensureNotificationPermission } from "../lib/notify";
import { jumpToSession } from "../lib/jumpToSession";

function displayName(s: SessionWithModel): string {
  return (
    s.manualName ??
    s.activityName ??
    (s.working_dir ? s.working_dir.split("/").pop() || s.working_dir : "Session")
  );
}

/** Agent-like sessions are the ones worth a "finished" notification (not bare shells). */
function isAgentSession(s: SessionWithModel): boolean {
  const cmd = (s.command ?? "").toLowerCase();
  if (/\b(claude|codex|gemini|cursor|grok|venice)\b/.test(cmd)) return true;
  const act = (s.activityName ?? "").toLowerCase();
  return /claude|codex|gemini|cursor|grok|venice|openclaw/.test(act);
}

/** Whether the app window is currently focused by the user. */
function windowFocused(): boolean {
  try {
    return document.hasFocus();
  } catch {
    return true;
  }
}

/**
 * The control-room brain: converts existing session signals into attention
 * flags, OS notifications, and a dock badge.
 *
 *  - `codegrid:session-attention` (prompt detected) → "needs you"
 *  - running → idle transition (agent went quiet) → "finished"
 *  - → error / dead transition → "error"
 *
 * Flags clear when you focus the session. Mount once (in App).
 */
export function useAttention() {
  const prevStatus = useRef<Map<string, string>>(new Map());

  // Ask macOS for notification permission once, up front, so notifications work
  // the moment an agent needs you (rather than only after the first one fires).
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // ---- Status transitions across ALL sessions (done / error) ----
  useEffect(() => {
    const unsub = useSessionStore.subscribe((state) => {
      const attn = useAttentionStore.getState();
      const focusedId = state.focusedSessionId;
      const focused = windowFocused();

      for (const s of state.sessions) {
        const prev = prevStatus.current.get(s.id);
        const curr = s.status ?? "idle";
        if (prev === undefined) {
          prevStatus.current.set(s.id, curr);
          continue;
        }
        if (prev === curr) continue;
        prevStatus.current.set(s.id, curr);

        const isCurrentlyVisible = s.id === focusedId && focused;

        // Agent finished a run: running → idle.
        if (prev === "running" && curr === "idle" && isAgentSession(s) && !isCurrentlyVisible) {
          const had = useAttentionStore.getState().flags[s.id];
          attn.setAttention(s.id, "done");
          if (had !== "done" && had !== "needs") {
            void notify("Agent finished", `${displayName(s)} finished its run.`);
          }
        }

        // Error / unexpected end.
        if ((curr === "error" || curr === "dead") && prev !== "dead" && !isCurrentlyVisible) {
          const had = useAttentionStore.getState().flags[s.id];
          attn.setAttention(s.id, "error");
          if (had !== "error") {
            const verb = curr === "dead" ? "ended" : "hit an error";
            void notify("Agent needs attention", `${displayName(s)} ${verb}.`);
          }
        }
      }

      // Drop flags for sessions that no longer exist.
      const ids = new Set(state.sessions.map((s) => s.id));
      for (const id of Object.keys(useAttentionStore.getState().flags)) {
        if (!ids.has(id)) attn.clearAttention(id);
      }
    });
    return unsub;
  }, []);

  // ---- Prompt-based "needs you" (Terminal dispatches this) ----
  useEffect(() => {
    const onAttention = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail ?? {};
      if (!sessionId) return;
      const state = useSessionStore.getState();
      const s = state.sessions.find((x) => x.id === sessionId);
      if (!s) return;
      const isCurrentlyVisible = sessionId === state.focusedSessionId && windowFocused();
      if (isCurrentlyVisible) return; // you're already looking at it

      const had = useAttentionStore.getState().flags[sessionId];
      useAttentionStore.getState().setAttention(sessionId, "needs");
      if (had !== "needs") {
        void notify("Agent needs your input", `${displayName(s)} is waiting for you.`);
      }
    };
    window.addEventListener("codegrid:session-attention", onAttention);
    return () => window.removeEventListener("codegrid:session-attention", onAttention);
  }, []);

  // ---- Clear a session's flag when it becomes focused ----
  useEffect(() => {
    const unsub = useSessionStore.subscribe((state, prev) => {
      if (state.focusedSessionId && state.focusedSessionId !== prev.focusedSessionId) {
        useAttentionStore.getState().clearAttention(state.focusedSessionId);
      }
    });
    return unsub;
  }, []);

  // ---- Clear focused session's flag when the window regains focus ----
  useEffect(() => {
    const onFocus = () => {
      const fid = useSessionStore.getState().focusedSessionId;
      if (fid) useAttentionStore.getState().clearAttention(fid);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ---- Dock badge + tray status track the fleet ----
  useEffect(() => {
    const update = () => {
      const needs = useAttentionStore.getState().countOf("needs");
      const running = useSessionStore.getState().sessions.filter((s) => s.status === "running").length;
      void setDockBadge(needs);
      void setTrayStatus(running, needs);
    };
    update();
    const unsubA = useAttentionStore.subscribe(update);
    const unsubS = useSessionStore.subscribe(update);
    return () => {
      unsubA();
      unsubS();
    };
  }, []);

  // ---- "Go to next agent needing attention" ----
  useEffect(() => {
    const onNext = () => {
      const list = useAttentionStore.getState().needsList();
      const target = list[0] ?? useAttentionStore.getState().needsList()[0];
      // Prefer "needs"; fall back to any flagged (done/error) if none need input.
      const fallback = () => {
        const flags = useAttentionStore.getState().flags;
        return Object.keys(flags)[0];
      };
      const id = target ?? fallback();
      if (id) jumpToSession(id);
    };
    window.addEventListener("codegrid:next-attention", onNext);
    return () => window.removeEventListener("codegrid:next-attention", onNext);
  }, []);
}
