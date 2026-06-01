import { memo, useState, useMemo, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useSessionStore } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";
import { sendToSession, type SkillInfo } from "../lib/ipc";
import { agentTheme, type AgentKind } from "../lib/paneTheme";

const CATEGORY_COLORS: Record<string, string> = {
  General: "#4a9eff",
  Coding: "#00c853",
  Project: "#ff8c00",
  Models: "#d500f9",
  Custom: "#00e5ff",
  Plugin: "#ffab00",
  Bundled: "#9aa0ff",
};

// Display order for the per-agent sections.
const AGENT_ORDER: AgentKind[] = ["claude", "codex", "cursor", "gemini", "grok"];

function agentKindOf(agent: string): AgentKind {
  return (AGENT_ORDER as string[]).includes(agent) ? (agent as AgentKind) : "shell";
}

export const SkillsPanel = memo(function SkillsPanel() {
  const { skillsPanelOpen, setSkillsPanelOpen, skills } = useAppStore();
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const addToast = useToastStore((s) => s.addToast);
  const [filter, setFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState<"all" | AgentKind>("all");
  const [sentSkill, setSentSkill] = useState<string | null>(null);

  // Counts per agent (pre text-filter) for the segmented control.
  const agentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of skills) counts[s.agent] = (counts[s.agent] ?? 0) + 1;
    return counts;
  }, [skills]);

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return skills.filter((s) => {
      if (agentFilter !== "all" && s.agent !== agentFilter) return false;
      if (!lower) return true;
      return (
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower) ||
        s.agent.toLowerCase().includes(lower)
      );
    });
  }, [skills, filter, agentFilter]);

  // Group by agent (ordered), then by category within each agent.
  const groupedByAgent = useMemo(() => {
    const byAgent: Record<string, Record<string, SkillInfo[]>> = {};
    for (const skill of filtered) {
      const a = skill.agent;
      if (!byAgent[a]) byAgent[a] = {};
      if (!byAgent[a][skill.category]) byAgent[a][skill.category] = [];
      byAgent[a][skill.category].push(skill);
    }
    const orderedAgents = [
      ...AGENT_ORDER.filter((a) => byAgent[a]),
      ...Object.keys(byAgent).filter((a) => !(AGENT_ORDER as string[]).includes(a)),
    ];
    return { byAgent, orderedAgents };
  }, [filtered]);

  const handleSendSkill = useCallback(
    async (skillName: string, agent: string) => {
      if (!focusedSessionId) return;
      try {
        await sendToSession(focusedSessionId, skillName);
        setSentSkill(`${agent}::${skillName}`);
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
        aria-label="Agent Skills"
        style={{
          position: "relative",
          width: "560px",
          maxHeight: "560px",
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
              SKILLS
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              {skills.length} across all agents — click any skill to send it to the focused pane
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

        {/* Agent filter — segmented control */}
        <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a", overflowX: "auto" }}>
          {(["all", ...AGENT_ORDER] as const).map((a) => {
            const isAll = a === "all";
            const theme = isAll ? null : agentTheme(a);
            const count = isAll ? skills.length : (agentCounts[a] ?? 0);
            const active = agentFilter === a;
            const color = isAll ? "#ff8c00" : (theme as { color: string }).color;
            return (
              <button
                key={a}
                onClick={() => setAgentFilter(a as "all" | AgentKind)}
                style={{
                  flex: "1 0 auto",
                  padding: "7px 10px",
                  background: active ? "#1e1e1e" : "transparent",
                  border: "none",
                  borderBottom: active ? `2px solid ${color}` : "2px solid transparent",
                  color: active ? color : "#777777",
                  fontSize: "10px",
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                  letterSpacing: "0.5px",
                  fontWeight: "bold",
                  whiteSpace: "nowrap",
                }}
              >
                {isAll ? (
                  `ALL (${count})`
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {(() => { const Glyph = theme!.icon; return <Glyph size={14} weight={active ? "fill" : "regular"} color={color} style={{ flexShrink: 0 }} />; })()}
                    {theme!.tag} ({count})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Skills list — grouped by agent, then category */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {groupedByAgent.orderedAgents.map((agent) => {
            const theme = agentTheme(agentKindOf(agent));
            const cats = groupedByAgent.byAgent[agent];
            const agentTotal = Object.values(cats).reduce((n, arr) => n + arr.length, 0);
            return (
              <div key={agent}>
                {/* Agent header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 16px 4px",
                    marginTop: "2px",
                    borderTop: "1px solid #1c1c1c",
                  }}
                >
                  {(() => { const Glyph = theme.icon; return <Glyph size={14} weight="fill" color={theme.color} style={{ flexShrink: 0 }} />; })()}
                  <span style={{ color: theme.color, fontSize: "11px", fontWeight: "bold", letterSpacing: "1px" }}>
                    {theme.tag}
                  </span>
                  <span style={{ color: "#555555", fontSize: "10px" }}>
                    {agentTotal} skill{agentTotal !== 1 ? "s" : ""}
                  </span>
                </div>

                {Object.entries(cats).map(([category, catSkills]) => (
                  <div key={`${agent}-${category}`}>
                    <div
                      style={{
                        padding: "3px 16px 3px 24px",
                        fontSize: "9px",
                        color: CATEGORY_COLORS[category] ?? "#888888",
                        letterSpacing: "1px",
                        fontWeight: "bold",
                        textTransform: "uppercase",
                      }}
                    >
                      {category}
                    </div>
                    {catSkills.map((skill) => {
                      const sentKey = `${skill.agent}::${skill.name}`;
                      return (
                        <div
                          key={`${agent}-${category}-${skill.name}`}
                          onClick={() => handleSendSkill(skill.name, skill.agent)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "6px 16px 6px 24px",
                            cursor: focusedSessionId ? "pointer" : "default",
                            opacity: focusedSessionId ? 1 : 0.5,
                          }}
                          onMouseEnter={(e) => {
                            if (focusedSessionId) e.currentTarget.style.background = "#1e1e1e";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <span
                              style={{
                                color: theme.color,
                                fontSize: "12px",
                                fontWeight: "bold",
                                minWidth: "120px",
                                flexShrink: 0,
                              }}
                            >
                              {skill.name}
                            </span>
                            <span
                              style={{
                                color: "#888888",
                                fontSize: "11px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {skill.description}
                            </span>
                          </div>
                          {sentSkill === sentKey && (
                            <span style={{ color: "#00c853", fontSize: "10px", flexShrink: 0 }}>Sent!</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}

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
