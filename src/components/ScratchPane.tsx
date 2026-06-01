import { memo, useCallback, useEffect, useRef, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { TerminalView } from "./Terminal";
import { useSessionStore, type SessionWithModel } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";
import { agentTheme, type AgentKind } from "../lib/paneTheme";
import { UI_ICON } from "../lib/icons";
import {
  createSession,
  spawnShellSession,
  killSession,
  clearPersistedSessions,
  type AgentType,
} from "../lib/ipc";

const UI_FONT = "var(--font-ui)";

/**
 * ScratchPane — a canvas pane that hosts a *regular* terminal you can flip
 * between every agent provider (and a plain shell) via a tab bar, all in the
 * same working directory. It lives on the project's canvas like any other pane.
 *
 * The pane's own session is synthetic (no PTY). Each provider tab is backed by
 * a real PTY that is deliberately kept OUT of the session store/layout (so it
 * never spawns its own canvas pane or tab) and has its DB row cleared so it is
 * never restored on relaunch. Child PTYs are killed when the pane unmounts.
 */

const PROVIDERS: AgentKind[] = ["claude", "codex", "gemini", "grok", "cursor", "shell"];

/**
 * Scratch child PTYs are spawned under this sentinel workspace id instead of the
 * project's. The Rust backend treats any workspace id starting with this prefix as
 * ephemeral: hidden from the agent-bus (agent_list) and never written to the DB, so
 * scratch terminals stay private to this pane and never restore on relaunch.
 * Keep in sync with `is_ephemeral_workspace` in src-tauri/src/commands.rs.
 */
const SCRATCH_WORKSPACE_ID = "__scratch__";

type TabState = { sessionId: string | null; status: "creating" | "ready" | "error" };

interface ScratchPaneProps {
  session: SessionWithModel;
  onClose: (sessionId: string) => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

export const ScratchPane = memo(function ScratchPane({ session, onClose, onDragStart }: ScratchPaneProps) {
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession);
  const isFocused = focusedSessionId === session.id;
  const addToast = useToastStore((s) => s.addToast);

  const [tabs, setTabs] = useState<Partial<Record<AgentKind, TabState>>>({});
  const [active, setActive] = useState<AgentKind>("claude");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Detached from the project: scratch PTYs run in $HOME under an isolated,
  // non-project workspace so they behave like a plain terminal on your machine
  // (no project cwd, hidden from the project agent-bus, never persisted).
  const workspaceId = SCRATCH_WORKSPACE_ID;

  const ensureTab = useCallback(
    async (kind: AgentKind) => {
      const existing = tabsRef.current[kind];
      if (existing && (existing.sessionId || existing.status === "creating")) return;
      setTabs((t) => ({ ...t, [kind]: { sessionId: null, status: "creating" } }));
      try {
        const dir = (await homeDir()).replace(/\/+$/, "");
        const created =
          kind === "shell"
            ? await spawnShellSession(dir, workspaceId)
            : await createSession(dir, workspaceId, false, false, kind as AgentType);
        // Belt-and-suspenders: backend already skips persistence for the scratch
        // workspace, but drop any row defensively too.
        clearPersistedSessions(workspaceId, [created.id]).catch(() => {});
        setTabs((t) => ({ ...t, [kind]: { sessionId: created.id, status: "ready" } }));
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: created.id } }),
          );
        }, 120);
      } catch (e) {
        setTabs((t) => ({ ...t, [kind]: { sessionId: null, status: "error" } }));
        addToast(`Failed to start ${agentTheme(kind).label}: ${e}`, "error");
      }
    },
    [workspaceId, addToast],
  );

  // Spin up the default tab once on mount.
  useEffect(() => {
    void ensureTab("claude");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kill all child PTYs when the pane is closed/unmounted.
  useEffect(
    () => () => {
      for (const t of Object.values(tabsRef.current)) {
        if (t?.sessionId) killSession(t.sessionId).catch(() => {});
      }
    },
    [],
  );

  const selectTab = useCallback(
    (kind: AgentKind) => {
      setActive(kind);
      void ensureTab(kind);
      const sid = tabsRef.current[kind]?.sessionId;
      if (sid) {
        window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: sid } }));
      }
    },
    [ensureTab],
  );

  const activeTheme = agentTheme(active);
  const activeTab = tabs[active];
  const borderColor = isFocused ? activeTheme.color : "rgba(150, 150, 150, 0.25)";

  return (
    <div
      onClick={() => setFocusedSession(session.id)}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        border: isFocused ? `2px solid ${borderColor}` : `1px solid ${borderColor}`,
        background: "#0a0a0a",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Title bar — drag handle */}
      <div
        className="drag-handle"
        onMouseDown={onDragStart}
        style={{
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          gap: 10,
          background: isFocused ? "#141414" : "#121212",
          borderBottom: "1px solid var(--border-default)",
          borderLeft: `3px solid ${activeTheme.color}`,
          cursor: "move",
          userSelect: "none",
          flexShrink: 0,
          fontFamily: UI_FONT,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <UI_ICON.scratch size={14} weight={isFocused ? "fill" : "regular"} color="#ff8c00" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
            {session.manualName ?? "Scratch"}
          </span>
          <span
            title="Detached terminal — runs in your home directory, not the project"
            style={{ fontSize: 11, color: "var(--text-faint)" }}
          >
            ~ · detached
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Close scratch pane"
          aria-label="Close scratch pane"
          style={{
            background: "transparent", border: "none", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 16, width: 26, height: 26,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--status-error)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <UI_ICON.close size={14} />
        </button>
      </div>

      {/* Provider tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 2,
          padding: "4px 6px 0 6px",
          background: "#0e0e0e",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {PROVIDERS.map((kind) => {
          const theme = agentTheme(kind);
          const isActive = kind === active;
          const t = tabs[kind];
          return (
            <button
              key={kind}
              onClick={(e) => { e.stopPropagation(); selectTab(kind); }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                background: isActive ? "#0a0a0a" : "transparent",
                border: "1px solid",
                borderColor: isActive ? theme.color : "transparent",
                color: isActive ? theme.color : "var(--text-muted)",
                fontFamily: UI_FONT,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                borderTopLeftRadius: 7,
                borderTopRightRadius: 7,
                position: "relative",
                top: 1,
                whiteSpace: "nowrap",
              }}
            >
              {(() => { const Glyph = theme.icon; return <Glyph size={14} weight={isActive ? "fill" : "regular"} color={theme.color} style={{ flexShrink: 0 }} />; })()}
              {theme.label}
              {t?.status === "creating" && <span style={{ color: "var(--text-faint)", fontSize: 10 }}>…</span>}
            </button>
          );
        })}
      </div>

      {/* Body — all created tabs stay mounted (visibility-hidden) so PTYs and
          scrollback survive tab switches without losing xterm sizing. */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#0a0a0a" }}>
        {PROVIDERS.map((kind) => {
          const t = tabs[kind];
          if (!t?.sessionId) return null;
          const isActive = kind === active;
          return (
            <div
              key={t.sessionId}
              style={{
                position: "absolute",
                inset: 0,
                visibility: isActive ? "visible" : "hidden",
                zIndex: isActive ? 2 : 1,
              }}
            >
              <TerminalView sessionId={t.sessionId} agentColor={agentTheme(kind).color} />
            </div>
          );
        })}

        {activeTab?.status === "creating" && (
          <div style={overlayStyle}>Starting {activeTheme.label}…</div>
        )}
        {activeTab?.status === "error" && (
          <div style={{ ...overlayStyle, flexDirection: "column", gap: 12 }}>
            <span>Couldn't start {activeTheme.label}.</span>
            <button
              onClick={() => {
                setTabs((t) => { const next = { ...t }; delete next[active]; return next; });
                void ensureTab(active);
              }}
              style={{
                background: activeTheme.color, border: "none", color: "#0a0a0a",
                fontFamily: UI_FONT, fontSize: 12, fontWeight: 600,
                padding: "6px 14px", cursor: "pointer", borderRadius: 6,
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10,10,10,0.85)",
  color: "var(--text-secondary)",
  fontFamily: UI_FONT,
  fontSize: 13,
  zIndex: 5,
};
