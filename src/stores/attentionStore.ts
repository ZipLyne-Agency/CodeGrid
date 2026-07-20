import { create } from "zustand";

/**
 * Per-session "attention" state for the control-room view.
 *  - "needs":  the agent is waiting on you (permission prompt, y/n, question).
 *  - "done":   the agent finished a run while you weren't looking at it.
 *  - "error":  the agent hit an error / its session ended unexpectedly.
 * Cleared when you focus/visit that session.
 */
export type AttentionKind = "needs" | "done" | "error";

interface AttentionState {
  /** sessionId -> attention kind */
  flags: Record<string, AttentionKind>;
  /** When each flag was set (ms) — used to surface the most recent first. */
  since: Record<string, number>;

  setAttention: (sessionId: string, kind: AttentionKind) => void;
  clearAttention: (sessionId: string) => void;
  clearAll: () => void;

  /** Count of sessions in a given state. */
  countOf: (kind: AttentionKind) => number;
  /** sessionIds needing the user, oldest first (so "next" feels fair). */
  needsList: () => string[];
}

export const useAttentionStore = create<AttentionState>((set, get) => ({
  flags: {},
  since: {},

  setAttention: (sessionId, kind) =>
    set((state) => {
      // "needs" outranks "done": don't downgrade a waiting agent to merely "done".
      const existing = state.flags[sessionId];
      if (existing === "needs" && kind === "done") return state;
      if (existing === kind) return state;
      return {
        flags: { ...state.flags, [sessionId]: kind },
        since: { ...state.since, [sessionId]: Date.now() },
      };
    }),

  clearAttention: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.flags)) return state;
      const flags = { ...state.flags };
      const since = { ...state.since };
      delete flags[sessionId];
      delete since[sessionId];
      return { flags, since };
    }),

  clearAll: () => set({ flags: {}, since: {} }),

  countOf: (kind) => Object.values(get().flags).filter((k) => k === kind).length,

  needsList: () => {
    const { flags, since } = get();
    return Object.keys(flags)
      .filter((id) => flags[id] === "needs")
      .sort((a, b) => (since[a] ?? 0) - (since[b] ?? 0));
  },
}));
