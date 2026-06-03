import { memo, useCallback, useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { clampMenuPosition } from "../lib/menuPosition";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useToastStore } from "../stores/toastStore";
import { createWorkspace, renameWorkspace as renameWorkspaceIpc, setActiveWorkspace as setActiveWorkspaceIpc, renameSession as renameSessionIpc, deleteWorkspace as deleteWorkspaceIpc } from "../lib/ipc";
import { jumpToSession, switchWorkspace } from "../lib/jumpToSession";
import { detectAgent } from "../lib/paneTheme";
import { UI_ICON } from "../lib/icons";
import { CanvasControls } from "./CanvasControls";

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

/** Agent-backed terminals (claude/codex/…) — the only ones worth a "done" flash. */
function isAgentSession(s: { command?: string | null; activityName?: string | null }): boolean {
  const cmd = (s.command ?? "").toLowerCase();
  if (/\b(claude|codex|gemini|cursor|grok|venice)\b/.test(cmd)) return true;
  return /claude|codex|gemini|cursor|grok|venice|openclaw/.test((s.activityName ?? "").toLowerCase());
}

type SortMode = "pane" | "type" | "recent";
const SORT_LABEL: Record<SortMode, string> = { pane: "Order", type: "Type", recent: "Recent" };

interface TopBarProps {
  onFocusSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

export const TopBar = memo(function TopBar({ onFocusSession, onCloseSession }: TopBarProps) {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    addWorkspace,
    removeWorkspace,
    setNewSessionDialogOpen,
    toggleSidebar,
    sidebarOpen,
    terminalListPlacement,
    terminalDrawerOpen,
    toggleTerminalDrawer,
  } = useWorkspaceStore();
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const broadcastMode = useSessionStore((s) => s.broadcastMode);
  const toggleBroadcast = useSessionStore((s) => s.toggleBroadcast);
  const setSessionManualName = useSessionStore((s) => s.setSessionManualName);
  const autoLayout = useLayoutStore((s) => s.autoLayout);
  const canvasState = useLayoutStore((s) => s.canvas);
  const toggleLocked = useLayoutStore((s) => s.toggleLocked);
  const zoomToFit = useLayoutStore((s) => s.zoomToFit);
  const setCanvas = useLayoutStore((s) => s.setCanvas);
  const addToast = useToastStore((s) => s.addToast);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionName, setEditSessionName] = useState("");
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("pane");
  const [auxMenuOpen, setAuxMenuOpen] = useState(false);
  const auxMenuRef = useRef<HTMLDivElement>(null);

  // Track running→idle transitions for "done" flash animations
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const [pulsingTabs, setPulsingTabs] = useState<Set<string>>(new Set());

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number;
    type: "workspace" | "session";
    id: string; currentName: string;
  } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setCtxMenu(null); return; }
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [ctxMenu]);

  const openCtxMenu = useCallback((e: React.MouseEvent, type: "workspace" | "session", id: string, currentName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, type, id, currentName });
  }, []);

  const startRenameFromCtx = useCallback(() => {
    if (!ctxMenu) return;
    if (ctxMenu.type === "workspace") {
      setEditingId(ctxMenu.id);
      setEditName(ctxMenu.currentName);
    } else {
      setEditingSessionId(ctxMenu.id);
      setEditSessionName(ctxMenu.currentName);
    }
    setCtxMenu(null);
  }, [ctxMenu]);

  // All panes in the active workspace, in stable pane-number order. Used for
  // dir lookups, layout, and as the source for the split lists below.
  const activeSessions = useMemo(
    () => sessions
      .filter((s) => s.workspace_id === activeWorkspaceId)
      .sort((a, b) => (a.pane_number ?? 0) - (b.pane_number ?? 0)),
    [sessions, activeWorkspaceId],
  );

  // The top bar shows REAL TERMINALS only. Notes and browser/preview panes live
  // in the aux dropdown so the tab strip stays a clean list of terminals.
  const terminalTabs = useMemo(() => {
    const list = activeSessions.filter(isTerminalSession);
    if (sortMode === "type") {
      return [...list].sort((a, b) => {
        const ta = detectAgent(a.command).label;
        const tb = detectAgent(b.command).label;
        return ta.localeCompare(tb) || (a.pane_number ?? 0) - (b.pane_number ?? 0);
      });
    }
    if (sortMode === "recent") {
      // Most-recently opened first.
      return [...list].sort((a, b) => {
        const da = new Date(a.created_at).getTime() || 0;
        const db = new Date(b.created_at).getTime() || 0;
        return db - da || (b.pane_number ?? 0) - (a.pane_number ?? 0);
      });
    }
    return list; // "pane" — already in pane-number order
  }, [activeSessions, sortMode]);

  // Notes + browser/preview panes for the aux dropdown.
  const auxPanes = useMemo(
    () => activeSessions.filter((s) => !isTerminalSession(s)),
    [activeSessions],
  );

  const handleNewWorkspace = useCallback(async () => {
    const name = `Workspace ${workspaces.length + 1}`;
    try {
      const ws = await createWorkspace(name);
      addWorkspace(ws);
      await setActiveWorkspaceIpc(ws.id);
    } catch (e) {
      addToast(`Failed to create workspace: ${e}`, "error");
    }
  }, [workspaces.length, addWorkspace, addToast]);

  // "+" workspace menu: a normal (project) workspace, or a project-less
  // scratchpad sandbox that holds only throwaway scratch terminals.
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [wsMenuPos, setWsMenuPos] = useState<{ top: number; left: number } | null>(null);
  const wsBtnRef = useRef<HTMLButtonElement>(null);
  const wsPopRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!wsMenuOpen || !wsBtnRef.current || !wsPopRef.current) { setWsMenuPos(null); return; }
    const a = wsBtnRef.current.getBoundingClientRect();
    const m = wsPopRef.current.getBoundingClientRect();
    setWsMenuPos(clampMenuPosition(a, { width: m.width, height: m.height }, { gap: 6 }));
  }, [wsMenuOpen]);

  useEffect(() => {
    if (!wsMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setWsMenuOpen(false); return; }
      const t = e.target as HTMLElement;
      if (t.closest("[data-ws-menu]") || t.closest("[data-ws-btn]")) return;
      setWsMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [wsMenuOpen]);

  // Single shared switch impl (restores the full view + reconciles focus). Keep
  // all switch entry points on switchWorkspace so they can't drift apart.
  const handleSwitchWorkspace = useCallback((wsId: string) => {
    switchWorkspace(wsId);
  }, []);

  // "Done" flash on running→idle — ONLY for agent terminals (claude/codex/…).
  // Bare shells, notes, browsers and repaint-driven blips must never flash, or
  // the tab strip strobes for no reason.
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

  // Close the aux (notes/previews) dropdown on outside click or Escape.
  useEffect(() => {
    if (!auxMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setAuxMenuOpen(false); return; }
      if (auxMenuRef.current && !auxMenuRef.current.contains(e.target as Node)) setAuxMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [auxMenuOpen]);

  const handleAutoLayout = useCallback(() => {
    const ids = activeSessions.map((s) => s.id);
    const vw = window.innerWidth - 60;
    const vh = window.innerHeight - 52;
    autoLayout(ids, vw, vh);
    // Reset zoom/pan so panes are visible
    setCanvas({ zoom: 1, panX: 0, panY: 0 });
  }, [activeSessions, autoLayout, setCanvas]);

  const handleRenameEnd = useCallback(
    async (id: string) => {
      if (editName.trim()) {
        try {
          await renameWorkspaceIpc(id, editName.trim());
          useWorkspaceStore.getState().updateWorkspace(id, { name: editName.trim() });
        } catch (e) {
          addToast(`Failed to rename workspace: ${e}`, "error");
        }
      }
      setEditingId(null);
    },
    [editName, addToast],
  );

  const handleSessionRenameEnd = useCallback(
    (sessionId: string) => {
      const trimmed = editSessionName.trim();
      if (trimmed) {
        setSessionManualName(sessionId, trimmed);
        // Persist to DB so the name survives app restarts
        renameSessionIpc(sessionId, trimmed).catch((e) =>
          console.warn("Failed to persist session name:", e)
        );
      }
      setEditingSessionId(null);
    },
    [editSessionName, setSessionManualName],
  );

  const handleDeleteWorkspace = useCallback(async (wsId: string) => {
    if (confirmDeleteId !== wsId) {
      setConfirmDeleteId(wsId);
      setCtxMenu(null);
      return;
    }
    setConfirmDeleteId(null);
    try {
      // Allow deleting the last workspace. The empty-state will surface a
      // "Create workspace" CTA once activeWorkspaceId is null.
      await deleteWorkspaceIpc(wsId);
      removeWorkspace(wsId);
    } catch (e) {
      addToast(`Failed to delete workspace: ${e}`, "error");
    }
  }, [confirmDeleteId, removeWorkspace, addToast]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "rgba(18, 18, 18, 0.9)",
        border: "1px solid #2a2a2a",
        borderRadius: "12px",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(6px)",
        userSelect: "none",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Main bar */}
      <div
        style={{
          height: "32px",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: "4px",
        }}
      >
        {/* Toggle sidebar */}
        <button
          onClick={() => toggleSidebar()}
          title="Toggle Sidebar (Cmd+S)"
          style={{
            background: "none", border: "none",
            color: sidebarOpen ? "#ff8c00" : "#555555",
            fontSize: "14px", cursor: "pointer", padding: "4px 6px",
            fontFamily: "var(--font-ui)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8c00")}
          onMouseLeave={(e) => (e.currentTarget.style.color = sidebarOpen ? "#ff8c00" : "#555555")}
        >
          <UI_ICON.sidebar size={15} weight={sidebarOpen ? "fill" : "regular"} style={{ flexShrink: 0 }} />
        </button>


        {/* Workspace switcher — pills with a pane count, the active one accented */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, overflow: "hidden" }}>
          {workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            const paneCount = sessions.filter((s) => s.workspace_id === ws.id).length;
            return (
              <div
                key={ws.id}
                onClick={() => handleSwitchWorkspace(ws.id)}
                onDoubleClick={() => { setEditingId(ws.id); setEditName(ws.name); }}
                onContextMenu={(e) => openCtxMenu(e, "workspace", ws.id, ws.name)}
                title={ws.repo_path ? ws.repo_path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~") : ws.name}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontFamily: "var(--font-ui)",
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? "#ff8c00" : "#999",
                  background: isActive ? "rgba(255,140,0,0.12)" : "transparent",
                  border: `1px solid ${isActive ? "rgba(255,140,0,0.5)" : "transparent"}`,
                  borderRadius: 7,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                  maxWidth: 200,
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-secondary)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {/* repo/folder dot — project-backed workspaces get an accent dot */}
                <span
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: ws.repo_path ? (isActive ? "#ff8c00" : "#666") : "transparent",
                    border: ws.repo_path ? "none" : `1px solid ${isActive ? "#ff8c00" : "#555"}`,
                  }}
                />
                {editingId === ws.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRenameEnd(ws.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameEnd(ws.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    style={{
                      background: "transparent", border: "none", color: "#ff8c00",
                      fontFamily: "var(--font-ui)", fontSize: "11px", outline: "none",
                      width: "90px", padding: 0,
                    }}
                  />
                ) : (
                  <>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ws.name}</span>
                    {paneCount > 0 && (
                      <span
                        style={{
                          fontSize: 9, fontWeight: 700, lineHeight: 1,
                          color: isActive ? "#ff8c00" : "#777",
                          background: isActive ? "rgba(255,140,0,0.18)" : "rgba(255,255,255,0.06)",
                          borderRadius: 5, padding: "2px 5px", flexShrink: 0,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {paneCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <button
            ref={wsBtnRef}
            data-ws-btn
            onClick={() => setWsMenuOpen((o) => !o)}
            title="New workspace…"
            aria-haspopup="menu"
            aria-expanded={wsMenuOpen}
            style={{
              background: "none", border: "none", color: wsMenuOpen ? "#ff8c00" : "#555555", fontSize: "16px",
              cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-ui)", flexShrink: 0, lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8c00")}
            onMouseLeave={(e) => { if (!wsMenuOpen) e.currentTarget.style.color = "#555555"; }}
          >
            <UI_ICON.plus size={15} weight="regular" style={{ flexShrink: 0 }} />
          </button>
        </div>

        {wsMenuOpen && createPortal(
          <div
            data-ws-menu
            ref={wsPopRef}
            style={{
              position: "fixed", top: wsMenuPos?.top ?? -9999, left: wsMenuPos?.left ?? -9999,
              visibility: wsMenuPos ? "visible" : "hidden", width: 320, maxWidth: "92vw",
              background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
              borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.6)", zIndex: 100000, padding: 6,
              fontFamily: "var(--font-ui)",
            }}
          >
            {([
              { icon: UI_ICON.files, color: "var(--accent)", label: "New workspace", desc: "An empty workspace for a project — open a folder to start coding.", run: () => { void handleNewWorkspace(); } },
              { icon: UI_ICON.scratch, color: "var(--agent-shell)", label: "New scratchpad", desc: "A project-less sandbox of throwaway scratch terminals. Right-click to add more.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-scratch-workspace")) },
            ] as const).map((item) => (
              <button
                key={item.label}
                onClick={() => { setWsMenuOpen(false); item.run(); }}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 11, width: "100%",
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: "9px 10px", borderRadius: 6, textAlign: "left",
                  color: "var(--text-primary)", fontFamily: "var(--font-ui)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span aria-hidden style={{ color: item.color, width: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  <item.icon size={15} weight="regular" />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ display: "block", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{item.desc}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}

        {/* Top-right actions: + New · command palette */}
        <CanvasControls />

        {/* Far-right: toggle the Panes drawer (terminals, previews, notes).
            In side-panel mode the tab strip is gone, so this is the way to
            reach the list. */}
        {terminalListPlacement === "sidebar" && (
          <button
            onClick={() => toggleTerminalDrawer()}
            title="Toggle panes drawer"
            className="cg-focus-ring"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              height: "var(--ctl-h)", boxSizing: "border-box",
              background: terminalDrawerOpen ? "var(--accent-soft)" : "transparent",
              border: `1px solid ${terminalDrawerOpen ? "var(--accent-border)" : "var(--border-default)"}`,
              color: terminalDrawerOpen ? "var(--text-accent)" : "var(--text-muted)",
              fontSize: 11, fontFamily: "var(--font-ui)", cursor: "pointer",
              padding: "0 9px", borderRadius: 6, whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = terminalDrawerOpen ? "var(--text-accent)" : "var(--text-muted)"; e.currentTarget.style.borderColor = terminalDrawerOpen ? "var(--accent-border)" : "var(--border-default)"; }}
          >
            <UI_ICON.terminals size={14} weight={terminalDrawerOpen ? "fill" : "regular"} style={{ flexShrink: 0 }} /> Panes
            {activeSessions.filter(isTerminalSession).length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {activeSessions.filter(isTerminalSession).length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Session tab bar — real terminals only (notes/previews live in the aux menu).
          Hidden when the user has moved the terminal list to the pop-out drawer. */}
      {activeSessions.length > 0 && terminalListPlacement === "topbar" && (
        <div
          style={{
            height: "32px",
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            gap: 6,
            borderTop: "1px solid var(--border-default)",
            background: "#0f0f0f",
            overflow: "hidden",
          }}
        >
          {/* Sort / organize terminals — cycles Order → Type → Recent */}
          {terminalTabs.length > 1 && (
            <button
              onClick={() => setSortMode((m) => (m === "pane" ? "type" : m === "type" ? "recent" : "pane"))}
              title="Sort terminals: Order / Type / Recent"
              className="cg-focus-ring"
              style={{
                display: "inline-flex", alignItems: "center", height: "var(--ctl-h)", boxSizing: "border-box",
                background: "transparent", border: "1px solid var(--border-default)", borderRadius: 6,
                color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)",
                cursor: "pointer", padding: "0 8px", flexShrink: 0, whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <UI_ICON.sort size={13} weight="regular" style={{ flexShrink: 0 }} /> {SORT_LABEL[sortMode]}
              </span>
            </button>
          )}

          {/* Scrollable strip of equal-width terminal tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 1, overflowX: "auto", overflowY: "hidden", flex: 1, minWidth: 0 }}>
          {terminalTabs.map((session) => {
            const isFocused = session.id === focusedSessionId;
            const isHovered = session.id === hoveredTab;
            const isPulsing = pulsingTabs.has(session.id);
            const statusColor = STATUS_COLORS[session.status] ?? "#555555";

            // Display name: manual name > activity name > fallback to working dir
            const displayName = session.manualName
              ?? session.activityName
              ?? (session.working_dir.split("/").pop() || session.working_dir);

            return (
              <div
                key={session.id}
                className={isPulsing ? "tab-done-highlight" : undefined}
                onClick={() => {
                  onFocusSession(session.id);
                  // Full jump: switches workspace, un-minimizes, and centers the
                  // canvas on the pane wherever it lives.
                  jumpToSession(session.id);
                }}
                onDoubleClick={() => { setEditingSessionId(session.id); setEditSessionName(displayName); }}
                onContextMenu={(e) => openCtxMenu(e, "session", session.id, displayName)}
                onMouseEnter={() => setHoveredTab(session.id)}
                onMouseLeave={() => setHoveredTab(null)}
                title={`Right-click or double-click to rename. Dir: ${session.working_dir}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  minHeight: 24,
                  cursor: "pointer",
                  background: isFocused ? "var(--bg-tertiary)" : isHovered ? "var(--bg-secondary)" : "transparent",
                  borderBottom: isFocused ? "2px solid var(--text-accent)" : "2px solid transparent",
                  borderTop: "2px solid transparent",
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  // Equal-width tabs regardless of name length.
                  width: 170,
                  flex: "0 0 170px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {/* Status dot — pulses bright on running→idle */}
                <div
                  key={isPulsing ? `${session.id}-pulsing` : session.id}
                  className={isPulsing ? "tab-done-dot" : undefined}
                  style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: statusColor, flexShrink: 0,
                  }}
                  aria-label={`Status: ${session.status}`}
                />

                {/* Pane number */}
                <span
                  className="cg-num"
                  style={{
                    color: "var(--text-accent)",
                    fontWeight: 700,
                    fontSize: 12,
                    minWidth: 14,
                    textAlign: "center",
                  }}
                >
                  {session.pane_number}
                </span>

                {/* Display name -- editable on double-click */}
                {editingSessionId === session.id ? (
                  <input
                    value={editSessionName}
                    onChange={(e) => setEditSessionName(e.target.value)}
                    onBlur={() => handleSessionRenameEnd(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSessionRenameEnd(session.id);
                      if (e.key === "Escape") setEditingSessionId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    style={{
                      background: "transparent", border: "none", color: "var(--text-primary)",
                      fontFamily: "var(--font-ui)",
                      fontSize: 12, outline: "none", width: 110, padding: 0,
                    }}
                  />
                ) : (
                  <span style={{
                    color: isFocused ? "var(--text-primary)" : "var(--text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontSize: 12,
                    fontWeight: isFocused ? 600 : 500,
                    flex: 1, minWidth: 0,
                  }}>
                    {displayName}
                  </span>
                )}

                {/* Close button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseSession(session.id); }}
                  aria-label={`Close session ${session.pane_number}`}
                  style={{
                    background: "none", border: "none",
                    color: "var(--text-faint)", cursor: "pointer",
                    fontSize: 14, padding: "0 4px",
                    fontFamily: "var(--font-ui)",
                    lineHeight: 1,
                    visibility: isHovered || isFocused ? "visible" : "hidden",
                    flexShrink: 0,
                    minWidth: 18,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--status-error)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-faint)")}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Quick add terminal button */}
          <button
            onClick={() => {
              const ws = workspaces.find((w) => w.id === activeWorkspaceId);
              const dir = ws?.repo_path ?? activeSessions[0]?.working_dir ?? "";
              if (dir) {
                window.dispatchEvent(new CustomEvent("codegrid:quick-session", { detail: { path: dir, type: "shell" } }));
              } else {
                setNewSessionDialogOpen(true);
              }
            }}
            title="Quick add terminal in workspace directory"
            style={{
              background: "none", border: "none", color: "#333333",
              fontSize: "12px", fontFamily: "var(--font-ui)",
              cursor: "pointer", padding: "2px 6px", flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8c00")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#333333")}
          >
            +
          </button>
          </div>{/* /scrollable terminal tabs */}

          {/* Notes & preview panes — deliberately kept out of the terminal strip */}
          {auxPanes.length > 0 && (
            <div ref={auxMenuRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => setAuxMenuOpen((o) => !o)}
                title="Notes & preview panes"
                className="cg-focus-ring"
                style={{
                  display: "inline-flex", alignItems: "center", height: "var(--ctl-h)", boxSizing: "border-box",
                  background: "transparent", border: "1px solid var(--border-default)", borderRadius: 6,
                  color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)",
                  cursor: "pointer", padding: "0 8px", whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <UI_ICON.preview size={14} weight="regular" style={{ flexShrink: 0 }} /> Notes & Previews ({auxPanes.length})
                </span>
              </button>
              {auxMenuOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 240,
                  background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.6)", zIndex: 9999, padding: 4,
                }}>
                  {auxPanes.map((p) => {
                    const isNote = p.kind === "note";
                    const label = p.manualName
                      ?? (isNote
                        ? (p.noteText?.split("\n")[0]?.slice(0, 30) || "Note")
                        : (p.browserTitle || p.browserUrl || "Preview"));
                    return (
                      <div
                        key={p.id}
                        onClick={() => { setAuxMenuOpen(false); onFocusSession(p.id); jumpToSession(p.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: "pointer", color: "var(--text-secondary)", fontSize: 12 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {(() => { const Glyph = isNote ? UI_ICON.note : UI_ICON.preview; return <Glyph size={14} weight="regular" color={isNote ? "var(--agent-note)" : "var(--agent-browser)"} style={{ flexShrink: 0 }} />; })()}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* Context menu — portaled to body to escape overflow:hidden */}
      {ctxMenu && createPortal(
        <div
          ref={ctxRef}
          style={{
            position: "fixed",
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 9999,
            background: "#1e1e1e",
            border: "1px solid #2a2a2a",
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            fontFamily: "var(--font-ui)",
            minWidth: "160px",
            padding: "4px 0",
          }}
        >
          <div style={{ padding: "4px 12px", fontSize: "10px", color: "#555555", letterSpacing: "1px", borderBottom: "1px solid #2a2a2a", marginBottom: "2px" }}>
            {ctxMenu.type === "workspace" ? "WORKSPACE" : "TERMINAL"}
          </div>
          <button
            onClick={startRenameFromCtx}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#e0e0e0", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 14px", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#ff8c0020"; e.currentTarget.style.color = "#ff8c00"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#e0e0e0"; }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <UI_ICON.rename size={13} weight="regular" style={{ flexShrink: 0 }} /> Rename
            </span>
          </button>
          {ctxMenu.type === "workspace" && (
            <>
              <div style={{ height: "1px", background: "#2a2a2a", margin: "2px 0" }} />
              <button
                onClick={() => handleDeleteWorkspace(ctxMenu.id)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#ff3d00", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 14px", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#ff3d0020"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <UI_ICON.trash size={13} weight="regular" style={{ flexShrink: 0 }} /> Delete Workspace
                </span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Delete confirmation overlay — portaled to body */}
      {confirmDeleteId && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#1a1a1a", border: "1px solid #ff3d00", padding: "24px 28px", fontFamily: "var(--font-ui)", minWidth: "320px" }}
          >
            <div style={{ color: "#ff3d00", fontWeight: "bold", fontSize: "12px", letterSpacing: "1px", marginBottom: "8px" }}>DELETE WORKSPACE</div>
            <div style={{ color: "#888888", fontSize: "11px", marginBottom: "20px", lineHeight: "1.6" }}>
              This will close all terminals in "{workspaces.find((w) => w.id === confirmDeleteId)?.name ?? "this workspace"}" and remove it permanently.
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => handleDeleteWorkspace(confirmDeleteId)}
                style={{ flex: 1, background: "#ff3d00", border: "none", color: "#fff", fontSize: "11px", fontWeight: "bold", fontFamily: "var(--font-ui)", padding: "8px", cursor: "pointer" }}
              >
                DELETE
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid #333333", color: "#888888", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "8px", cursor: "pointer" }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});
