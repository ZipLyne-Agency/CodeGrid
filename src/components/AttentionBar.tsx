import { memo } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useAttentionStore } from "../stores/attentionStore";

const MONO = "var(--font-ui)";

/**
 * Always-visible fleet status: how many agents are running, how many need you,
 * and how many just finished — across every workspace. Clicking jumps to the
 * next agent needing attention.
 */
export const AttentionBar = memo(function AttentionBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const flags = useAttentionStore((s) => s.flags);

  const running = sessions.filter((s) => s.status === "running").length;
  const flagVals = Object.values(flags);
  const needs = flagVals.filter((k) => k === "needs").length;
  const done = flagVals.filter((k) => k === "done").length;
  const errors = flagVals.filter((k) => k === "error").length;

  const hasActionable = needs > 0 || errors > 0;
  const jumpNext = () => window.dispatchEvent(new CustomEvent("codegrid:next-attention"));

  // Nothing interesting → keep the bar quiet but present (so the layout is stable).
  const nothing = running === 0 && needs === 0 && done === 0 && errors === 0;

  const Segment = ({
    color,
    label,
    title,
  }: {
    color: string;
    label: string;
    title: string;
  }) => (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: "4px", color }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );

  return (
    <button
      onClick={hasActionable ? jumpNext : undefined}
      title={hasActionable ? "Go to next agent needing attention (⌘⇧A)" : "Agent fleet status"}
      disabled={!hasActionable}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        background: hasActionable ? "rgba(255,140,0,0.10)" : "transparent",
        border: `1px solid ${hasActionable ? "#ff8c0066" : "#2a2a2a"}`,
        padding: "3px 10px",
        cursor: hasActionable ? "pointer" : "default",
        fontFamily: MONO,
        fontSize: 12,
        fontWeight: "bold",
        letterSpacing: "0.3px",
        whiteSpace: "nowrap",
      }}
    >
      {nothing ? (
        <span style={{ color: "#555" }}>NO AGENTS</span>
      ) : (
        <>
          {running > 0 && <Segment color="#00c853" label={`${running} running`} title={`${running} agent(s) running`} />}
          {needs > 0 && <Segment color="#ff8c00" label={`${needs} needs you`} title={`${needs} agent(s) waiting for input — click to jump`} />}
          {errors > 0 && <Segment color="#ff3d00" label={`${errors} error`} title={`${errors} agent(s) errored — click to jump`} />}
          {done > 0 && <Segment color="#888" label={`${done} done`} title={`${done} agent(s) finished`} />}
        </>
      )}
    </button>
  );
});
