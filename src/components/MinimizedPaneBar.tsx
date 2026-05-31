import { memo, useCallback } from "react";
import type { SessionWithModel } from "../stores/sessionStore";
import { jumpToSession } from "../lib/jumpToSession";

interface MinimizedPaneBarProps {
  sessions: SessionWithModel[];
  onCloseSession: (sessionId: string) => void;
}

export const MinimizedPaneBar = memo(function MinimizedPaneBar({
  sessions,
  onCloseSession,
}: MinimizedPaneBarProps) {
  // jumpToSession un-minimizes, focuses, AND pans the canvas to the pane, so a
  // restored pane can never reappear off-screen.
  const handleRestore = useCallback((sessionId: string) => {
    jumpToSession(sessionId);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "2px 6px",
        height: "34px",
        margin: "0 8px 8px",
        background: "rgba(17, 17, 17, 0.92)",
        border: "1px solid #2a2a2a",
        borderRadius: "8px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          fontFamily:
            "var(--font-ui)",
          letterSpacing: "0.5px",
          marginRight: "4px",
          flexShrink: 0,
        }}
      >
        MIN
      </span>
      {sessions.map((session) => {
        const isClaude = session.command?.includes("claude");
        const displayName =
          session.working_dir.split("/").pop() || session.working_dir;
        const statusColorMap: Record<string, string> = {
          idle: "#4a9eff", running: "#00c853", waiting: "#ffab00",
          error: "#ff3d00", dead: "#555555",
        };
        const statusColor = statusColorMap[session.status ?? "idle"] ?? "#4a9eff";
        return (
          <div
            key={session.id}
            onClick={() => handleRestore(session.id)}
            title={`Restore: ${displayName} (click to restore)`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderLeft: `2px solid ${statusColor}`,
              cursor: "pointer",
              maxWidth: "160px",
              fontFamily:
                "var(--font-ui)",
              fontSize: 12,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#ff8c00";
              e.currentTarget.style.background = "#1e1e1e";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#2a2a2a";
              e.currentTarget.style.background = "#1a1a1a";
            }}
          >
            {/* Status dot */}
            <span
              style={{
                width: "5px", height: "5px", borderRadius: "50%",
                background: statusColor, flexShrink: 0,
              }}
            />
            {/* Pane number badge */}
            <span
              style={{
                color: "#ff8c00",
                fontWeight: "bold",
                fontSize: 11,
              }}
            >
              [{session.pane_number}]
            </span>
            {/* Type */}
            <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
              {isClaude ? "claude" : "sh"}
            </span>
            {/* Name */}
            <span
              style={{
                color: "#aaaaaa",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: 11,
              }}
            >
              {displayName}
            </span>
            {/* Restore button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRestore(session.id);
              }}
              title="Restore pane"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: "0 1px",
                fontFamily:
                  "var(--font-ui)",
                lineHeight: 1,
                flexShrink: 0,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "#00c853")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "#555555")
              }
            >
              ^
            </button>
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(session.id);
              }}
              title="Close pane"
              style={{
                background: "none",
                border: "none",
                color: "#333333",
                cursor: "pointer",
                fontSize: 12,
                padding: "0 1px",
                fontFamily:
                  "var(--font-ui)",
                lineHeight: 1,
                flexShrink: 0,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "#ff3d00")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "#333333")
              }
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
});
