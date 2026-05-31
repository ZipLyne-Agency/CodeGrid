import { memo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useResourceStore, SHELL_COST_MB, AGENT_COST_MB } from "../stores/resourceStore";

const MONO = "var(--font-ui)";
const RED = "#ff3d00";

function formatGb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onForceCreate: () => void;
}

export const ResourceWarningDialog = memo(function ResourceWarningDialog({
  open,
  onClose,
  onForceCreate,
}: Props) {
  const {
    totalMemoryMb,
    availableMemoryMb,
    usedMemoryMb,
    usagePercent,
    shellCount,
    agentCount,
    estimatedTerminalUsageMb,
  } = useResourceStore();

  const handleForce = useCallback(() => {
    onForceCreate();
    onClose();
  }, [onForceCreate, onClose]);

  if (!open) return null;

  const shellEstMb = shellCount * SHELL_COST_MB;
  const agentEstMb = agentCount * AGENT_COST_MB;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(2px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141414",
          border: `1px solid ${RED}`,
          boxShadow: `0 0 40px ${RED}20, 0 12px 32px rgba(0,0,0,0.6)`,
          fontFamily: MONO,
          width: "400px",
          maxWidth: "90vw",
          padding: "24px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <span style={{ fontSize: "16px", color: RED }}>&#9888;</span>
          <span style={{ fontSize: "12px", fontWeight: "bold", color: RED, letterSpacing: "1px" }}>
            SYSTEM MEMORY LOW
          </span>
        </div>

        {/* Memory bar */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#888", marginBottom: "4px" }}>
            <span>MEMORY USAGE</span>
            <span style={{ color: RED }}>{usagePercent.toFixed(0)}%</span>
          </div>
          <div style={{ height: "8px", background: "#1e1e1e", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(usagePercent, 100)}%`,
              background: `linear-gradient(90deg, #ffab00, ${RED})`,
              borderRadius: "4px",
            }} />
          </div>
        </div>

        {/* Stats grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 16px",
          fontSize: "10px",
          marginBottom: "16px",
          lineHeight: "1.8",
        }}>
          <div>
            <span style={{ color: "#555" }}>Total: </span>
            <span style={{ color: "#aaa" }}>{formatGb(totalMemoryMb)}</span>
          </div>
          <div>
            <span style={{ color: "#555" }}>Used: </span>
            <span style={{ color: RED }}>{formatGb(usedMemoryMb)}</span>
          </div>
          <div>
            <span style={{ color: "#555" }}>Available: </span>
            <span style={{ color: "#aaa" }}>{formatGb(availableMemoryMb)}</span>
          </div>
          <div>
            <span style={{ color: "#555" }}>Terminal est: </span>
            <span style={{ color: "#aaa" }}>{formatGb(estimatedTerminalUsageMb)}</span>
          </div>
        </div>

        {/* Warning message */}
        <div style={{
          fontSize: "10px",
          color: "#999",
          lineHeight: "1.7",
          marginBottom: "16px",
          padding: "10px",
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
        }}>
          Your system is running low on memory. Creating more terminals may cause instability.
        </div>

        {/* Breakdown */}
        <div style={{ fontSize: "10px", color: "#888", marginBottom: "20px", lineHeight: "1.8" }}>
          <div style={{ color: "#555", fontSize: "10px", letterSpacing: "1px", marginBottom: "4px" }}>CURRENT TERMINALS</div>
          <div>
            <span style={{ color: "#aaa" }}>{shellCount} shells</span>
            <span style={{ color: "#555" }}> x ~{SHELL_COST_MB} MB = ~{formatGb(shellEstMb)}</span>
          </div>
          <div>
            <span style={{ color: "#aaa" }}>{agentCount} agents</span>
            <span style={{ color: "#555" }}> x ~{AGENT_COST_MB} MB = ~{formatGb(agentEstMb)}</span>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid #333",
              color: "#888",
              fontSize: "11px",
              fontWeight: "bold",
              fontFamily: MONO,
              padding: "10px",
              cursor: "pointer",
              letterSpacing: "0.5px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#555"; e.currentTarget.style.color = "#ccc"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#888"; }}
          >
            CLOSE
          </button>
          <button
            onClick={handleForce}
            style={{
              flex: 1,
              background: RED,
              border: `1px solid ${RED}`,
              color: "#fff",
              fontSize: "11px",
              fontWeight: "bold",
              fontFamily: MONO,
              padding: "10px",
              cursor: "pointer",
              letterSpacing: "0.5px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            CREATE ANYWAY
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
});
