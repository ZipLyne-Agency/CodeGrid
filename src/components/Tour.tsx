import { memo, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";

const ACCENT = "#ff8c00";
const PAD = 6;

/**
 * Post-onboarding spotlight tour. Dims the app and cuts a hole over each real
 * control (anchored via data-tour attributes), with a short card explaining it.
 * Ends by opening the New Session dialog so the user creates their first agent
 * the moment the training wheels come off.
 *
 * Steps whose anchor isn't currently in the DOM (e.g. the tab strip in
 * side-panel mode) are skipped automatically.
 */

interface TourStep {
  anchor: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    anchor: '[data-tour="workspaces"]',
    title: "Workspaces — one canvas per project",
    body: "Each pill is a separate canvas with its own agents. Click to switch, double-click to rename, + to add one. ⌘⇥ cycles through them.",
  },
  {
    anchor: '[data-tour="sidebar-toggle"]',
    title: "The sidebar",
    body: "Files, project search, the Git manager, the Agent Bus monitor, and analytics all live here. Toggle with ⌘S.",
  },
  {
    anchor: '[data-tour="new-button"]',
    title: "Add to the canvas",
    body: "New agent sessions, throwaway scratch terminals, live localhost previews, and markdown notes. ⌘N is the shortcut you'll use most.",
  },
  {
    anchor: '[data-tour="voice"]',
    title: "Max — your voice operator",
    body: "Click the glowing pill and just say it: \"Max, spin up a Codex agent and have it fix the failing test.\" It spawns, types, and reports back out loud. First click walks you through adding your OpenAI key.",
  },
  {
    anchor: '[data-tour="tab-strip"]',
    title: "Every pane, one strip",
    body: "All terminals in this workspace as tabs — click to jump the canvas to one. Status dots show who's running, waiting, or done.",
  },
  {
    anchor: '[data-tour="canvas"]',
    title: "The canvas",
    body: "Your agents live here. Drag panes by their title bar, resize from the edges, pan and zoom the whole board. Ready to put your first agent on it?",
  },
];

export const Tour = memo(function Tour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Resolve the current step's anchor; skip steps whose anchor is missing.
  const resolve = useCallback(
    (idx: number, dir: 1 | -1): number => {
      let i = idx;
      while (i >= 0 && i < STEPS.length && !document.querySelector(STEPS[i].anchor)) i += dir;
      return i;
    },
    [],
  );

  const measure = useCallback(() => {
    const el = document.querySelector(STEPS[step]?.anchor ?? "");
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Esc ends the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const finish = useCallback(() => {
    onClose();
    // Land them in the flow that creates their first agent.
    useWorkspaceStore.getState().setNewSessionDialogOpen(true);
  }, [onClose]);

  const go = (dir: 1 | -1) => {
    const target = resolve(step + dir, dir);
    if (target >= STEPS.length) {
      finish();
    } else if (target < 0) {
      setStep(resolve(0, 1));
    } else {
      setStep(target);
    }
  };

  const isLast = resolve(step + 1, 1) >= STEPS.length;
  const s = STEPS[step];
  if (!s) return null;

  // Card placement: below the anchor if there's room, else above; clamped.
  const cardW = 340;
  const below = rect ? rect.bottom + PAD + 12 : 100;
  const useBelow = rect ? below + 170 < window.innerHeight : true;
  const cardTop = rect ? (useBelow ? rect.bottom + PAD + 12 : Math.max(12, rect.top - PAD - 182)) : 100;
  const cardLeft = rect
    ? Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), window.innerWidth - cardW - 12)
    : window.innerWidth / 2 - cardW / 2;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2500, fontFamily: "var(--font-ui)" }}>
      {/* Spotlight: the highlight box's huge shadow is the dimmer, so the
          anchor itself stays at full brightness. */}
      {rect ? (
        <div
          style={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            border: `1.5px solid ${ACCENT}`,
            borderRadius: 9,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.66), 0 0 22px rgba(255,140,0,0.35)",
            transition: "all 0.25s ease",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.66)" }} />
      )}
      {/* Click-catcher so the app underneath doesn't react during the tour. */}
      <div style={{ position: "absolute", inset: 0 }} onClick={() => go(1)} />

      <div
        role="dialog"
        aria-label={s.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: cardTop,
          left: cardLeft,
          width: cardW,
          background: "#141414",
          border: `1px solid ${ACCENT}`,
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          padding: "14px 16px",
          transition: "all 0.25s ease",
        }}
      >
        <div style={{ fontSize: 10, color: "#666", letterSpacing: "0.1em", marginBottom: 6 }}>
          {step + 1} / {STEPS.length}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{s.title}</div>
        <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.6 }}>{s.body}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 }}
          >
            End tour
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => go(-1)}
                style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 6, color: "#888", fontSize: 11.5, padding: "6px 14px", cursor: "pointer", fontFamily: "var(--font-ui)" }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => go(1)}
              style={{ background: ACCENT, border: `1px solid ${ACCENT}`, borderRadius: 6, color: "#0a0a0a", fontSize: 11.5, fontWeight: 700, padding: "6px 14px", cursor: "pointer", fontFamily: "var(--font-ui)" }}
            >
              {isLast ? "Create your first agent →" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
