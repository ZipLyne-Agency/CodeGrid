import { memo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/sessionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useToastStore } from "../stores/toastStore";
import { setupAgentBus } from "../lib/ipc";
import { detectAgent, statusTheme } from "../lib/paneTheme";
import { UI_ICON } from "../lib/icons";
import { jumpToSession } from "../lib/jumpToSession";

const MONO = "var(--font-code)";

/** A ready-to-paste prompt that teaches an agent how to drive the bus. */
const STARTER_PROMPT =
  "Use the codegrid-agent-bus MCP to coordinate with the other agents running in this workspace. " +
  "First call list_agents to see who's available and get their session_id. " +
  "Before messaging one, call read_pane on it to see its recent state, then message_agent to send a clear, self-contained request. " +
  "Wait a few seconds, then read_pane again to get its reply. " +
  "Follow the protocol: read → message once → wait → read. " +
  "For example, ask another agent to review the file I'm working on and report back what it would change.";

/**
 * Agent Bus panel — explains the multi-agent bus, lets the user install/configure
 * it for their agents in one click, and lists the live agents you can talk to.
 */
export const AgentBusPanel = memo(function AgentBusPanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addToast = useToastStore((s) => s.addToast);
  const [installing, setInstalling] = useState(false);

  // Real agent terminals (not shells/notes/browsers) are the bus participants.
  // The bus is scoped per-workspace, so the panel mirrors that: only agents in
  // the active workspace are shown — matching what those agents see on the bus.
  const agents = sessions.filter((s) => {
    if (s.kind === "note" || s.kind === "browser") return false;
    if (activeWorkspaceId && s.workspace_id !== activeWorkspaceId) return false;
    return /\b(claude|codex|gemini|cursor|grok|venice)\b/.test((s.command ?? "").toLowerCase());
  });

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const result = await setupAgentBus();
      addToast(result || "Agent Bus configured for your agents.", "success", 6000);
    } catch (e) {
      addToast(`Agent Bus setup failed: ${e}`, "error", 8000);
    }
    setInstalling(false);
  }, [addToast]);

  const copyStarter = useCallback(() => {
    invoke("clipboard_write", { text: STARTER_PROMPT })
      .then(() => addToast("Starter prompt copied — paste it into any agent.", "success"))
      .catch(() => addToast("Could not copy the prompt.", "error"));
  }, [addToast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", fontFamily: "var(--font-ui)" }}>
      {/* Intro */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, color: "var(--text-accent)" }}>
          <UI_ICON.bus size={16} weight="fill" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>AGENT BUS</span>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5 }}>
          The <strong style={{ color: "var(--text-primary)" }}>Agent Bus</strong> lets the agents
          running in your panes talk to each other — natively, over CodeGrid's local socket, with no tmux.
          One agent can read another's pane and send it a message.
        </div>
      </div>

      {/* Install / configure */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="cg-focus-ring"
          style={{
            width: "100%", background: installing ? "var(--bg-elevated)" : "var(--text-accent)",
            border: "none", color: installing ? "var(--text-muted)" : "#0a0a0a",
            fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)",
            padding: "8px 12px", cursor: installing ? "default" : "pointer",
          }}
        >
          {installing ? "Configuring…" : "Install Agent Bus for my agents"}
        </button>
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
          Adds the <code style={{ fontFamily: MONO, color: "var(--text-secondary)" }}>codegrid-agent-bus</code> MCP
          server to Claude / Codex / Gemini configs. Restart an agent after installing.
        </div>
      </div>

      {/* The three tools */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <div className="cg-caps" style={{ color: "var(--text-faint)", fontSize: 10, marginBottom: 8 }}>How to use it</div>
        {[
          { t: "list_agents()", d: "discover who's running + their session_id" },
          { t: "read_pane(id)", d: "read another agent's recent output" },
          { t: "message_agent(id, text)", d: "type a request into its pane" },
        ].map((row) => (
          <div key={row.t} style={{ marginBottom: 8 }}>
            <div style={{ color: "var(--text-accent)", fontFamily: MONO, fontSize: 11 }}>{row.t}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{row.d}</div>
          </div>
        ))}
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>
          Protocol: <span style={{ color: "var(--text-secondary)" }}>read → message once → wait → read the reply.</span> Ask an agent to "use the agent bus to…" and it will follow the skill.
        </div>
        <div style={{ color: "var(--text-faint)", fontSize: 10, marginTop: 8, fontFamily: MONO }}>
          docs: codegrid.app/agent-bus
        </div>
      </div>

      {/* Starter prompt — copy and paste into any agent to kick off the bus. */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div className="cg-caps" style={{ color: "var(--text-faint)", fontSize: 10 }}>Starter prompt</div>
          <button
            onClick={copyStarter}
            className="cg-focus-ring"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--accent-soft)", border: "1px solid var(--accent-border)",
              color: "var(--text-accent)", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-ui)",
              padding: "3px 9px", borderRadius: 6, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; }}
          ><UI_ICON.sameAgent size={12} weight="regular" /> Copy</button>
        </div>
        <div
          onClick={copyStarter}
          title="Click to copy"
          style={{
            color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.5, fontFamily: MONO,
            background: "var(--bg-primary)", border: "1px solid var(--border-default)",
            borderRadius: 6, padding: "8px 10px", cursor: "pointer",
            maxHeight: 110, overflow: "hidden", position: "relative",
          }}
        >
          {STARTER_PROMPT}
        </div>
      </div>

      {/* Live agents */}
      <div style={{ padding: "12px 14px" }}>
        <div className="cg-caps" style={{ color: "var(--text-faint)", fontSize: 10, marginBottom: 8 }}>
          Agents on the bus ({agents.length})
        </div>
        {agents.length === 0 ? (
          <div style={{ color: "var(--text-faint)", fontSize: 11 }}>No agents running yet. Open a Claude/Codex/Gemini pane.</div>
        ) : (
          agents.map((a) => {
            const agent = detectAgent(a.command);
            const status = statusTheme(a.status);
            const name = a.manualName ?? a.activityName ?? agent.label;
            return (
              <div
                key={a.id}
                onClick={() => jumpToSession(a.id)}
                title="Jump to this agent"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", cursor: "pointer", fontSize: 12, color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {(() => { const Glyph = agent.icon; return <Glyph size={14} weight="fill" color={agent.color} style={{ flexShrink: 0 }} />; })()}
                <span style={{ color: "var(--text-accent)", fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{a.pane_number}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: status.color, fontSize: 11, flexShrink: 0 }}>
                  <span aria-hidden>{status.glyph}</span>{status.label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
