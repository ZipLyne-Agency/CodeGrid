import { memo, useState, useMemo, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useSessionStore } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";
import { sendToSession } from "../lib/ipc";

const CATEGORY_COLORS: Record<string, string> = {
  General: "#4a9eff",
  Coding: "#00c853",
  Project: "#ff8c00",
  Models: "#d500f9",
  Custom: "#00e5ff",
};

export const SkillsPanel = memo(function SkillsPanel() {
  const { skillsPanelOpen, setSkillsPanelOpen, skills } = useAppStore();
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const addToast = useToastStore((s) => s.addToast);
  const [filter, setFilter] = useState("");
  const [sentSkill, setSentSkill] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return skills;
    const lower = filter.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower),
    );
  }, [skills, filter]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof skills> = {};
    for (const skill of filtered) {
      if (!groups[skill.category]) groups[skill.category] = [];
      groups[skill.category].push(skill);
    }
    return groups;
  }, [filtered]);

  const handleSendSkill = useCallback(
    async (skillName: string) => {
      if (!focusedSessionId) return;
      try {
        await sendToSession(focusedSessionId, skillName);
        setSentSkill(skillName);
        setTimeout(() => setSentSkill(null), 1500);
      } catch (e) {
        addToast(`Failed to send skill: ${e}`, "error");
      }
    },
    [focusedSessionId, addToast],
  );

  if (!skillsPanelOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        paddingTop: "60px",
      }}
      onClick={() => setSkillsPanelOpen(false)}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Claude Code Skills"
        style={{
          position: "relative",
          width: "520px",
          maxHeight: "520px",
          background: "#141414",
          border: "1px solid #ff8c00",
          fontFamily: "var(--font-ui)",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ color: "#ff8c00", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px" }}>
              CLAUDE CODE SKILLS
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              Click any skill to send it to the focused pane
            </div>
          </div>
          <button
            onClick={() => setSkillsPanelOpen(false)}
            style={{
              background: "none",
              border: "none",
              color: "#555555",
              fontSize: "14px",
              cursor: "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            x
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #2a2a2a" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search skills..."
            autoFocus
            style={{
              width: "100%",
              background: "#0a0a0a",
              border: "1px solid #2a2a2a",
              color: "#e0e0e0",
              fontSize: "12px",
              fontFamily: "var(--font-ui)",
              padding: "6px 8px",
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
          />
        </div>

        {/* Skills list */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {Object.entries(grouped).map(([category, catSkills]) => (
            <div key={category}>
              <div
                style={{
                  padding: "4px 16px",
                  fontSize: "10px",
                  color: CATEGORY_COLORS[category] ?? "#888888",
                  letterSpacing: "1px",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  marginTop: "4px",
                }}
              >
                {category}
              </div>
              {catSkills.map((skill) => (
                <div
                  key={skill.name}
                  onClick={() => handleSendSkill(skill.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 16px",
                    cursor: focusedSessionId ? "pointer" : "default",
                    opacity: focusedSessionId ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (focusedSessionId)
                      e.currentTarget.style.background = "#1e1e1e";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        color: "#ff8c00",
                        fontSize: "12px",
                        fontWeight: "bold",
                        minWidth: "120px",
                      }}
                    >
                      {skill.name}
                    </span>
                    <span style={{ color: "#888888", fontSize: "11px" }}>
                      {skill.description}
                    </span>
                  </div>
                  {sentSkill === skill.name && (
                    <span style={{ color: "#00c853", fontSize: "10px" }}>
                      Sent!
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "#555555", fontSize: "11px" }}>
              No skills match your search
            </div>
          )}
        </div>

        {/* Footer */}
        {!focusedSessionId && (
          <div
            style={{
              padding: "8px 16px",
              borderTop: "1px solid #2a2a2a",
              color: "#ffab00",
              fontSize: "10px",
              textAlign: "center",
            }}
          >
            Focus a Claude Code pane first to send skills
          </div>
        )}
      </div>
    </div>
  );
});
