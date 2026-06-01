import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { jumpToSession } from "../lib/jumpToSession";
import { detectAgent } from "../lib/paneTheme";
import { UI_ICON, type Icon } from "../lib/icons";
import { renameSession as renameSessionIpc } from "../lib/ipc";

const STATUS_COLORS: Record<string, string> = {
  idle: "var(--status-idle)",
  running: "var(--status-running)",
  waiting: "var(--status-waiting)",
  error: "var(--status-error)",
  dead: "var(--status-dead)",
};

/** Real terminals only — notes and browser/preview panes are not terminals. */
function isTerminalSession(s: { kind?: string }): boolean {
  return s.kind !== "note" && s.kind !== "browser";
}

/** The collapsible groups the drawer splits panes into, keyed by pane kind. */
type SectionKey = "terminal" | "browser" | "scratch" | "note";

const SECTION_META: Record<SectionKey, { label: string; icon: Icon; color: string }> = {
  terminal: { label: "Terminals", icon: UI_ICON.terminals, color: "var(--text-accent)" },
  browser: { label: "Preview browsers", icon: UI_ICON.preview, color: "var(--agent-browser)" },
  scratch: { label: "Scratch", icon: UI_ICON.scratch, color: "#ff8c00" },
  note: { label: "Notes", icon: UI_ICON.note, color: "var(--agent-note)" },
};

// Section render order (terminals first).
const SECTION_ORDER: SectionKey[] = ["terminal", "browser", "scratch", "note"];

/** Map a session's pane kind to its drawer section (terminal & undefined → terminals). */
function sectionForSession(s: { kind?: string }): SectionKey {
  if (s.kind === "browser") return "browser";
  if (s.kind === "scratch") return "scratch";
  if (s.kind === "note") return "note";
  return "terminal";
}

/** Agent-backed terminals (claude/codex/…) — the only ones worth a "done" flash. */
function isAgentSession(s: { command?: string | null; activityName?: string | null }): boolean {
  const cmd = (s.command ?? "").toLowerCase();
  if (/\b(claude|codex|gemini|cursor|grok)\b/.test(cmd)) return true;
  return /claude|codex|gemini|cursor|grok/.test((s.activityName ?? "").toLowerCase());
}

type SortMode = "pane" | "type" | "recent";
const SORT_LABEL: Record<SortMode, string> = { pane: "Order", type: "Type", recent: "Recent" };

const DRAWER_WIDTH = 280;

interface TerminalSidebarProps {
  onFocusSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

/**
 * Pop-out drawer (right-docked) that holds the list of open terminals — the
 * alternative to the top-bar tab strip. Slides in/out over the right edge of
 * the canvas; a slim handle tab on the edge re-opens it when collapsed. Active
 * only when terminalListPlacement === "sidebar".
 */
export const TerminalSidebar = memo(function TerminalSidebar({
  onFocusSession,
  onCloseSession,
}: TerminalSidebarProps) {
  const placement = useWorkspaceStore((s) => s.terminalListPlacement);
  const open = useWorkspaceStore((s) => s.terminalDrawerOpen);
  const toggleDrawer = useWorkspaceStore((s) => s.toggleTerminalDrawer);
  const setDrawerOpen = useWorkspaceStore((s) => s.setTerminalDrawerOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setNewSessionDialogOpen = useWorkspaceStore((s) => s.setNewSessionDialogOpen);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const setSessionManualName = useSessionStore((s) => s.setSessionManualName);

  const [sortMode, setSortMode] = useState<SortMode>("pane");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Track running→idle transitions for "done" flash animations (parity w/ top bar).
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const [pulsingTabs, setPulsingTabs] = useState<Set<string>>(new Set());

  const activeSessions = useMemo(
    () => sessions
      .filter((s) => s.workspace_id === activeWorkspaceId)
      .sort((a, b) => (a.pane_number ?? 0) - (b.pane_number ?? 0)),
    [sessions, activeWorkspaceId],
  );

  // Apply the active sort mode to a list of panes (shared across sections).
  const applySort = useCallback(
    <T extends { command?: string | null; created_at: string; pane_number?: number }>(list: T[]): T[] => {
      if (sortMode === "type") {
        return [...list].sort((a, b) => {
          const ta = detectAgent(a.command).label;
          const tb = detectAgent(b.command).label;
          return ta.localeCompare(tb) || (a.pane_number ?? 0) - (b.pane_number ?? 0);
        });
      }
      if (sortMode === "recent") {
        return [...list].sort((a, b) => {
          const da = new Date(a.created_at).getTime() || 0;
          const db = new Date(b.created_at).getTime() || 0;
          return db - da || (b.pane_number ?? 0) - (a.pane_number ?? 0);
        });
      }
      return list;
    },
    [sortMode],
  );

  // Split every pane in the workspace into its kind-section, sorted within.
  const sectionLists = useMemo(() => {
    const groups: Record<SectionKey, typeof activeSessions> = {
      terminal: [], browser: [], scratch: [], note: [],
    };
    for (const s of activeSessions) groups[sectionForSession(s)].push(s);
    return {
      terminal: applySort(groups.terminal),
      browser: applySort(groups.browser),
      scratch: applySort(groups.scratch),
      note: applySort(groups.note),
    } as Record<SectionKey, typeof activeSessions>;
  }, [activeSessions, applySort]);

  // Real terminals back the header counts / "needs you" pip (parity w/ old behavior).
  const terminalTabs = useMemo(
    () => applySort(activeSessions.filter(isTerminalSession)),
    [activeSessions, applySort],
  );

  // Per-section collapse flags — every section starts expanded.
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>({
    terminal: false, browser: false, scratch: false, note: false,
  });
  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const session of activeSessions) {
      const prev = prevStatusRef.current.get(session.id);
      const curr = session.status ?? "idle";
      if (prev === "running" && curr === "idle" && isAgentSession(session)) {
        setPulsingTabs((s) => { const ns = new Set(s); ns.add(session.id); return ns; });
        timers.push(setTimeout(() => {
          setPulsingTabs((s) => { const ns = new Set(s); ns.delete(session.id); return ns; });
        }, 1400));
      }
      prevStatusRef.current.set(session.id, curr);
    }
    return () => timers.forEach(clearTimeout);
  }, [activeSessions]);

  const handleRenameEnd = useCallback((sessionId: string) => {
    const trimmed = editName.trim();
    if (trimmed) {
      setSessionManualName(sessionId, trimmed);
      renameSessionIpc(sessionId, trimmed).catch((e) => console.warn("Failed to persist session name:", e));
    }
    setEditingId(null);
  }, [editName, setSessionManualName]);

  const handleQuickAdd = useCallback(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    const dir = ws?.repo_path ?? activeSessions[0]?.working_dir ?? "";
    if (dir) {
      window.dispatchEvent(new CustomEvent("codegrid:quick-session", { detail: { path: dir, type: "shell" } }));
    } else {
      setNewSessionDialogOpen(true);
    }
  }, [workspaces, activeWorkspaceId, activeSessions, setNewSessionDialogOpen]);

  // One pane row — shared markup reused by every section.
  const renderRow = (session: (typeof activeSessions)[number]) => {
    const isFocused = session.id === focusedSessionId;
    const isHovered = session.id === hoveredId;
    const isPulsing = pulsingTabs.has(session.id);
    const statusColor = STATUS_COLORS[session.status] ?? "var(--status-dead)";
    const agent = detectAgent(session.command);
    const displayName = session.manualName
      ?? session.activityName
      ?? (session.working_dir.split("/").pop() || session.working_dir);

    return (
      <div
        key={session.id}
        className={isPulsing ? "tab-done-highlight" : undefined}
        onClick={() => { onFocusSession(session.id); jumpToSession(session.id); }}
        onDoubleClick={() => { setEditingId(session.id); setEditName(displayName); }}
        onMouseEnter={() => setHoveredId(session.id)}
        onMouseLeave={() => setHoveredId(null)}
        title={`Double-click to rename · ${session.working_dir}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "8px 9px 8px 10px",
          borderRadius: 8,
          cursor: "pointer",
          position: "relative",
          background: isFocused ? "rgba(255,140,0,0.10)" : isHovered ? "var(--bg-secondary)" : "transparent",
          border: `1px solid ${isFocused ? "rgba(255,140,0,0.45)" : "transparent"}`,
          // Agent-colored accent rail on the left edge.
          boxShadow: isFocused ? `inset 3px 0 0 ${agent.color}` : `inset 3px 0 0 ${isHovered ? agent.color + "88" : "transparent"}`,
          transition: "background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease",
        }}
      >
        {/* Status dot — pulses bright on running→idle */}
        <span
          key={isPulsing ? `${session.id}-pulsing` : session.id}
          className={isPulsing ? "tab-done-dot" : undefined}
          aria-label={`Status: ${session.status}`}
          style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0 }}
        />

        {/* Pane number */}
        <span className="cg-num" style={{
          color: "var(--text-accent)", fontWeight: 700, fontSize: 12,
          minWidth: 14, textAlign: "center", flexShrink: 0,
        }}>
          {session.pane_number}
        </span>

        {/* Name + agent label */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          {editingId === session.id ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleRenameEnd(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameEnd(session.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                background: "transparent", border: "none", color: "var(--text-primary)",
                fontFamily: "var(--font-ui)", fontSize: 12.5, outline: "none", width: "100%", padding: 0,
              }}
            />
          ) : (
            <span style={{
              color: isFocused ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 12.5, fontWeight: isFocused ? 600 : 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {displayName}
            </span>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-faint)" }}>
            {(() => { const Glyph = agent.icon; return <Glyph size={13} weight={isFocused ? "fill" : "regular"} color={agent.color} style={{ flexShrink: 0 }} />; })()}
            <span style={{ letterSpacing: 0.5 }}>{agent.label}</span>
          </span>
        </div>

        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); onCloseSession(session.id); }}
          aria-label={`Close terminal ${session.pane_number}`}
          style={{
            background: "none", border: "none", color: "var(--text-faint)",
            cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px",
            fontFamily: "var(--font-ui)", flexShrink: 0, minWidth: 16,
            visibility: isHovered || isFocused ? "visible" : "hidden",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--status-error)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-faint)")}
        >
          <UI_ICON.close size={14} />
        </button>
      </div>
    );
  };

  // Only live in side-panel mode.
  if (placement !== "sidebar") return null;

  const count = terminalTabs.length;
  const runningCount = terminalTabs.filter((s) => s.status === "running").length;
  const needsYouCount = terminalTabs.filter((s) => s.status === "waiting" || s.status === "error").length;

  return (
    <>
      {/* Collapsed handle — a slim vertical tab clinging to the right edge. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label={`Open terminals (${count})`}
        title={`Open terminals (${count})`}
        style={{
          position: "absolute",
          top: 14,
          right: 0,
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "12px 7px",
          background: "rgba(20,20,20,0.94)",
          border: "1px solid var(--border-default)",
          borderRight: "none",
          borderRadius: "10px 0 0 10px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          // Pull off-screen with the drawer so they cross-fade cleanly.
          transform: open ? "translateX(20px)" : "translateX(0)",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease",
          fontFamily: "var(--font-ui)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
      >
        <UI_ICON.terminals size={14} style={{ flexShrink: 0 }} />
        <span style={{
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.5,
          transform: "rotate(180deg)",
        }}>
          TERMINALS
        </span>
        {count > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 800, lineHeight: 1,
            color: "var(--text-accent)", background: "rgba(255,140,0,0.16)",
            borderRadius: 6, padding: "3px 5px", fontVariantNumeric: "tabular-nums",
          }}>
            {count}
          </span>
        )}
        {/* attention pip when any terminal needs you */}
        {needsYouCount > 0 && (
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-waiting)" }} />
        )}
      </button>

      {/* The drawer itself. */}
      <div
        role="complementary"
        aria-label="Terminals"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          maxWidth: "85%",
          zIndex: 31,
          display: "flex",
          flexDirection: "column",
          background: "rgba(16,16,16,0.97)",
          borderLeft: "1px solid var(--border-strong)",
          boxShadow: "-14px 0 40px rgba(0,0,0,0.45)",
          backdropFilter: "blur(10px)",
          transform: open ? "translateX(0)" : "translateX(101%)",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
          fontFamily: "var(--font-ui)",
          userSelect: "none",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 10px 10px 14px",
          borderBottom: "1px solid var(--border-default)",
          flexShrink: 0,
        }}>
          <span style={{ color: "var(--text-accent)", fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>
            TERMINALS
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
            background: "rgba(255,255,255,0.05)", borderRadius: 5, padding: "2px 6px",
            fontVariantNumeric: "tabular-nums",
          }}>
            {count}
          </span>
          {runningCount > 0 && (
            <span title={`${runningCount} running`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--status-running)" }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-running)" }} />
              {runningCount}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {count > 1 && (
            <button
              onClick={() => setSortMode((m) => (m === "pane" ? "type" : m === "type" ? "recent" : "pane"))}
              title="Sort terminals: Order / Type / Recent"
              className="cg-focus-ring"
              style={{
                background: "transparent", border: "1px solid var(--border-default)",
                color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-ui)",
                cursor: "pointer", padding: "3px 7px", borderRadius: 6, whiteSpace: "nowrap",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
            >
              <UI_ICON.sort size={13} style={{ flexShrink: 0 }} /> {SORT_LABEL[sortMode]}
            </button>
          )}
          <button
            onClick={toggleDrawer}
            title="Collapse terminals"
            aria-label="Collapse terminals"
            className="cg-focus-ring"
            style={{
              background: "transparent", border: "1px solid var(--border-default)",
              color: "var(--text-muted)", fontSize: 13, lineHeight: 1, fontFamily: "var(--font-ui)",
              cursor: "pointer", padding: "3px 8px", borderRadius: 6,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
          >
            {"»"}
          </button>
        </div>

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 8px 4px", display: "flex", flexDirection: "column", gap: 4 }}>
          {activeSessions.length === 0 && (
            <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--text-faint)", fontSize: 12, lineHeight: 1.6 }}>
              No terminals in this workspace yet.
            </div>
          )}

          {SECTION_ORDER.map((key) => {
            const list = sectionLists[key];
            if (list.length === 0) return null; // render a section only if non-empty
            const meta = SECTION_META[key];
            const collapsed = collapsedSections[key];
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Section header — label + count badge + collapse chevron */}
                <button
                  onClick={() => toggleSection(key)}
                  aria-expanded={!collapsed}
                  title={collapsed ? `Expand ${meta.label}` : `Collapse ${meta.label}`}
                  className="cg-focus-ring"
                  style={{
                    display: "flex", alignItems: "center", gap: 7, width: "100%",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "5px 4px 5px 6px", borderRadius: 6,
                    fontFamily: "var(--font-ui)", textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span aria-hidden style={{
                    color: "var(--text-muted)", flexShrink: 0,
                    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease", display: "inline-flex",
                  }}>
                    <UI_ICON.caretDown size={12} />
                  </span>
                  {(() => { const Glyph = meta.icon; return <Glyph size={15} color={meta.color} style={{ flexShrink: 0 }} />; })()}
                  <span style={{
                    color: "var(--text-secondary)", fontWeight: 700, fontSize: 10.5,
                    letterSpacing: 1, textTransform: "uppercase",
                  }}>
                    {meta.label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
                    background: "rgba(255,255,255,0.05)", borderRadius: 5, padding: "1px 6px",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {list.length}
                  </span>
                </button>

                {/* Section rows */}
                {!collapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {list.map((session) => renderRow(session))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — quick add terminal */}
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-default)", padding: 8 }}>
          <button
            onClick={handleQuickAdd}
            title="New terminal in this workspace"
            className="cg-focus-ring"
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: "transparent", border: "1px dashed var(--border-strong)",
              color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)",
              cursor: "pointer", padding: "8px 12px", borderRadius: 8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; e.currentTarget.style.background = "rgba(255,140,0,0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.background = "transparent"; }}
          >
            <UI_ICON.plus size={14} style={{ flexShrink: 0 }} /> New terminal
          </button>
        </div>
      </div>
    </>
  );
});
