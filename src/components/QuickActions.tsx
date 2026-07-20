import { memo, useCallback } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { sendToSession } from "../lib/ipc";

interface QuickAction {
  label: string;
  command: string;
  color: string;
  tooltip: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Review",   command: "/review",                                                    color: "#00c853", tooltip: "Review code changes in current project" },
  { label: "Fix Bug",  command: "Find and fix the most critical bug in this codebase",        color: "#ff3d00", tooltip: "Ask Claude to find and fix bugs" },
  { label: "Explain",  command: "Explain the architecture of this codebase at a high level", color: "#4a9eff", tooltip: "Get an overview of the project" },
  { label: "Test",     command: "Write tests for the untested code in this project",          color: "#ffab00", tooltip: "Generate tests for untested code" },
  { label: "Refactor", command: "Identify the messiest code and refactor it cleanly",        color: "#d500f9", tooltip: "Clean up messy code" },
  { label: "Docs",     command: "Add documentation to the public API of this project",       color: "#00e5ff", tooltip: "Generate documentation" },
];

const MONO = "var(--font-ui)";

interface QuickActionsProps {
  sessionId?: string;
}

export const QuickActions = memo(function QuickActions({ sessionId }: QuickActionsProps) {
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const targetId = sessionId ?? focusedSessionId;

  const handleAction = useCallback(
    async (command: string) => {
      if (!targetId) return;
      try {
        await sendToSession(targetId, command);
      } catch (e) {
        console.warn("Failed to send quick action:", e);
      }
    },
    [targetId],
  );

  return (
    <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
      <span
        style={{
          fontSize: "10px", color: "#e0e0e0",
          fontFamily: MONO, marginRight: "2px", letterSpacing: "0.5px", fontWeight: "bold",
        }}
      >
        QUICK
      </span>
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => handleAction(action.command)}
          title={action.tooltip}
          style={{
            background: "#1e1e1e",
            border: `1px solid ${targetId ? "#444444" : "#2a2a2a"}`,
            color: targetId ? action.color : "#333333",
            fontSize: "10px", fontWeight: "bold", fontFamily: MONO,
            cursor: targetId ? "pointer" : "default",
            padding: "2px 6px", letterSpacing: "0.3px",
            opacity: targetId ? 1 : 0.4,
          }}
          onMouseEnter={(e) => {
            if (targetId) {
              e.currentTarget.style.background = `${action.color}15`;
              e.currentTarget.style.borderColor = action.color;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#1e1e1e";
            e.currentTarget.style.borderColor = targetId ? "#444444" : "#2a2a2a";
            e.currentTarget.style.color = targetId ? action.color : "#333333";
            e.currentTarget.style.opacity = targetId ? "1" : "0.4";
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
});
