import { memo, useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useResourceStore, SHELL_COST_MB, AGENT_COST_MB } from "../stores/resourceStore";
import { clampMenuPosition } from "../lib/menuPosition";

const MONO = "var(--font-ui)";

const WARNING_COLORS: Record<string, string> = {
  none: "#00c853",
  soft: "#ffab00",
  hard: "#ff3d00",
};

function formatGb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${Math.round(mb)}M`;
}

export const ResourceIndicator = memo(function ResourceIndicator() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const {
    totalMemoryMb,
    availableMemoryMb,
    usedMemoryMb,
    usagePercent,
    warningLevel,
    shellCount,
    agentCount,
    estimatedTerminalUsageMb,
    recommendedMaxMore,
  } = useResourceStore();

  const color = WARNING_COLORS[warningLevel] ?? "#00c853";

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const totalCount = shellCount + agentCount;
  const shellEstMb = shellCount * SHELL_COST_MB;
  const agentEstMb = agentCount * AGENT_COST_MB;

  // Position the popover so it stays on-screen. The button lives in the bottom
  // dock, so a naive "open below" runs off the bottom — clamp/flip instead.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) { setPos(null); return; }
    const a = btnRef.current.getBoundingClientRect();
    const m = popRef.current.getBoundingClientRect();
    setPos(clampMenuPosition(a, { width: m.width, height: m.height }, { align: "right" }));
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="System Resources"
        style={{
          background: open ? "#1e1e1e" : "transparent",
          border: `1px solid ${open ? "#2a2a2a" : "transparent"}`,
          color,
          fontSize: 12,
          fontFamily: MONO,
          cursor: "pointer",
          padding: "2px 8px",
          whiteSpace: "nowrap",
          lineHeight: "18px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#1e1e1e";
          e.currentTarget.style.borderColor = "#2a2a2a";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }
        }}
      >
        [{totalCount} {"\u25AA"} {formatGb(estimatedTerminalUsageMb)} / {formatGb(availableMemoryMb)}]
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
            zIndex: 9999,
            width: "280px",
            background: "#141414",
            border: "1px solid #2a2a2a",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            fontFamily: MONO,
            padding: "12px",
          }}
        >
          {/* Header */}
          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "1px", marginBottom: "10px", fontWeight: "bold" }}>
            SYSTEM RESOURCES
          </div>

          {/* Memory bar */}
          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginBottom: "3px" }}>
              <span>MEMORY</span>
              <span style={{ color }}>{usagePercent.toFixed(0)}%</span>
            </div>
            <div style={{ height: "6px", background: "#1e1e1e", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(usagePercent, 100)}%`,
                background: color,
                borderRadius: "3px",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>

          {/* Breakdown */}
          <div style={{ fontSize: 12, color: "#aaa", lineHeight: "1.8" }}>
            <div>
              <span style={{ color: "#888" }}>{shellCount} shells</span>
              <span style={{ color: "#555" }}> (~{formatGb(shellEstMb)})</span>
              <span style={{ color: "#555" }}> + </span>
              <span style={{ color: "#888" }}>{agentCount} agents</span>
              <span style={{ color: "#555" }}> (~{formatGb(agentEstMb)})</span>
            </div>
            <div>
              <span style={{ color: "#888" }}>Available: </span>
              <span style={{ color }}>{formatGb(availableMemoryMb)}</span>
              <span style={{ color: "#555" }}> of {formatGb(totalMemoryMb)}</span>
            </div>
            <div>
              <span style={{ color: "#888" }}>Recommended: </span>
              <span style={{ color: "#ff8c00" }}>~{recommendedMaxMore} more</span>
              <span style={{ color: "#555" }}> terminals</span>
            </div>
            <div>
              <span style={{ color: "#888" }}>Est. terminal usage: </span>
              <span style={{ color: "var(--text-primary)" }}>{formatGb(estimatedTerminalUsageMb)}</span>
            </div>
          </div>

          {/* Warning badge */}
          {warningLevel !== "none" && (
            <div style={{
              marginTop: "10px",
              padding: "6px 8px",
              background: warningLevel === "hard" ? "#ff3d0015" : "#ffab0015",
              border: `1px solid ${color}30`,
              fontSize: 11,
              color,
              letterSpacing: "0.5px",
            }}>
              {warningLevel === "hard"
                ? "MEMORY CRITICALLY LOW -- new terminals may cause instability"
                : "MEMORY USAGE ELEVATED -- consider closing unused terminals"}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
});
