import { memo, useCallback, useState, useRef, useEffect, useLayoutEffect } from "react";
import { TerminalView } from "./Terminal";
import { clampMenuPosition } from "../lib/menuPosition";
import { StatusBar } from "./StatusBar";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import type { SessionWithModel } from "../stores/sessionStore";
import { detectAgent, statusTheme, hexToRgb } from "../lib/paneTheme";
import { UI_ICON } from "../lib/icons";

const UI_FONT = "var(--font-ui)";

interface PaneProps {
  session: SessionWithModel;
  onClose: (sessionId: string) => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

export const Pane = memo(function Pane({ session, onClose, onDragStart }: PaneProps) {
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const broadcastMode = useSessionStore((s) => s.broadcastMode);
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession);
  const setSessionManualName = useSessionStore((s) => s.setSessionManualName);
  const toggleMaximize = useLayoutStore((s) => s.toggleMaximize);
  const minimizePane = useLayoutStore((s) => s.minimizePane);
  const maximizedPane = useLayoutStore((s) => s.maximizedPane);

  const isFocused = focusedSessionId === session.id;
  const isMaximized = maximizedPane === session.id;

  // Flash pane border when agent transitions running→idle ("done generating")
  const prevStatusRef = useRef<string | undefined>(undefined);
  const [doneGlow, setDoneGlow] = useState(false);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = session.status ?? "idle";
    prevStatusRef.current = curr;
    // Only agent terminals get the "done generating" glow — shells, browsers and
    // notes must never flash.
    const isAgent = /\b(claude|codex|gemini|cursor|grok|venice)\b/.test((session.command ?? "").toLowerCase());
    if (prev === "running" && curr === "idle" && isAgent) {
      setDoneGlow(true);
      const t = setTimeout(() => setDoneGlow(false), 1500);
      return () => clearTimeout(t);
    }
  }, [session.status, session.command]);

  // Detect agent type from command string — shared theme for color/glyph/label.
  const agent = detectAgent(session.command);
  const agentColor = agent.color;
  const status = statusTheme(session.status);

  // Display name: manual name > activity name > fallback
  const displayName = session.manualName
    // Venice (OpenClaw) panes keep their agent identity — their activity name
    // echoes the underlying model ("Claude") or tooling ("Node"), not the agent.
    ?? (agent.kind === "venice" ? agent.label : session.activityName)
    ?? agent.label;

  const handleFocus = useCallback(() => {
    setFocusedSession(session.id);
  }, [session.id, setFocusedSession]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(session.id);
    },
    [session.id, onClose],
  );

  const handleDoubleClick = useCallback(() => {
    toggleMaximize(session.id);
  }, [session.id, toggleMaximize]);

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxPos, setCtxPos] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setCtxMenu(null); return; }
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [ctxMenu]);

  // Keep the context menu on-screen when right-clicking near an edge/corner.
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) { setCtxPos(null); return; }
    const m = ctxMenuRef.current.getBoundingClientRect();
    const point = { top: ctxMenu.y, bottom: ctxMenu.y, left: ctxMenu.x, right: ctxMenu.x };
    setCtxPos(clampMenuPosition(point, { width: m.width, height: m.height }, { gap: 0 }));
  }, [ctxMenu]);

  const startRename = useCallback(() => {
    setCtxMenu(null);
    setRenameValue(displayName);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 20);
  }, [displayName]);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      setSessionManualName(session.id, trimmed);
      import("../lib/ipc").then(({ renameSession }) => renameSession(session.id, trimmed).catch(() => {}));
    }
    setRenaming(false);
  }, [renameValue, session.id, setSessionManualName]);

  const [restarting, setRestarting] = useState(false);
  const [naming, setNaming] = useState(false);

  // Name this terminal with AI from its recent on-screen output (BYOK OpenAI).
  const handleAiName = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (naming) return;
      const { getTerminalSnapshot } = await import("../lib/terminalSnapshots");
      const text = getTerminalSnapshot(session.id);
      const { useToastStore } = await import("../stores/toastStore");
      if (!text.trim()) {
        useToastStore.getState().addToast("Nothing in this terminal to name yet.", "error");
        return;
      }
      setNaming(true);
      try {
        const { summarizeTerminal, renameSession } = await import("../lib/ipc");
        const name = await summarizeTerminal(text);
        setSessionManualName(session.id, name);
        renameSession(session.id, name).catch(() => {});
      } catch (err) {
        useToastStore.getState().addToast(typeof err === "string" ? err : "Couldn't name the terminal.", "error");
      } finally {
        setNaming(false);
      }
    },
    [naming, session.id, setSessionManualName],
  );

  const handleRestart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRestarting(true);
      const sessionType = agent.kind === "browser" || agent.kind === "note" ? "shell" : agent.kind;

      // Signal App.tsx to re-create this session with the same working_dir
      window.dispatchEvent(
        new CustomEvent("codegrid:restart-session", {
          detail: {
            sessionId: session.id,
            workingDir: session.working_dir,
            workspaceId: session.workspace_id,
            isShell: sessionType === "shell",
            resume: false,
            sessionType,
          },
        }),
      );
    },
    [session, agent.kind],
  );

  // Border color: focused → agent color, otherwise a muted version of it.
  const borderColor = broadcastMode
    ? "#ff8c00"
    : isFocused
      ? agentColor
      : "rgba(150, 150, 150, 0.25)";
  const glowRgb = hexToRgb(broadcastMode ? "#ff8c00" : agentColor);

  // Header chrome colors. Focused panes keep the solid agent-color bar (clear
  // "where am I"); unfocused panes get a dark bar with a thin colored accent
  // strip + agent-color glyph/label — identity stays legible without a wall of
  // saturated bars across the whole grid.
  const hc = isFocused
    ? {
        bg: agentColor,
        borderBottom: `1px solid ${agentColor}`,
        borderLeft: `3px solid ${agentColor}`,
        label: "#0a0a0a",
        glyph: "rgba(0,0,0,0.85)",
        statusText: "rgba(0,0,0,0.65)",
        nameText: "rgba(0,0,0,0.7)",
        numBg: "rgba(0,0,0,0.7)",
        numColor: agentColor,
      }
    : {
        bg: "#161616",
        borderBottom: "1px solid var(--border-default)",
        borderLeft: `3px solid ${agentColor}`,
        label: agentColor,
        glyph: agentColor,
        statusText: "var(--text-muted)",
        nameText: "var(--text-muted)",
        numBg: "rgba(255,255,255,0.06)",
        numColor: agentColor,
      };

  return (
    <div
      className={doneGlow ? "pane-done-glow" : undefined}
      onClick={handleFocus}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        border: isFocused
          ? `2px solid ${borderColor}`
          : `1px solid ${borderColor}`,
        // Calmer focus glow: a tight color ring + soft depth shadow instead of a
        // wide 14px colored halo. Identity stays clear without halation over long sessions.
        boxShadow: isFocused
          ? `0 0 0 1px rgba(${glowRgb}, 0.5), 0 0 8px rgba(${glowRgb}, 0.22), 0 2px 12px rgba(0, 0, 0, 0.5)`
          : "none",
        background: isFocused ? "#0c0c0c" : "#0a0a0a",
        overflow: "hidden",
        position: "relative",
        zIndex: isFocused ? 2 : 1,
        transition: "border 0.15s ease, box-shadow 0.2s ease, z-index 0s",
      }}
    >
      {/* Title bar — agent color as solid block, never a wash. */}
      <div
        className="drag-handle"
        onMouseDown={onDragStart}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        style={{
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          gap: 10,
          background: hc.bg,
          borderBottom: hc.borderBottom,
          borderLeft: hc.borderLeft,
          cursor: "move",
          userSelect: "none",
          flexShrink: 0,
          color: hc.label,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: UI_FONT, minWidth: 0, flex: 1 }}>
          {/* Pane number badge — large enough to read at a glance */}
          <span
            aria-label={`Pane ${session.pane_number}`}
            style={{
              color: hc.numColor, fontWeight: 800, fontSize: 13,
              minWidth: 22, height: 22, padding: "0 6px",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: hc.numBg,
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {session.pane_number}
          </span>
          {/* Terminal name — the single title on the bar. Defaults to the agent
              name (e.g. "Claude") until the user or AI renames it. Status, branch
              and other metadata live in the bottom status bar, not up here. */}
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,0,0,0.8)", color: "#fff",
                fontSize: 13, fontFamily: UI_FONT, padding: "2px 6px", outline: "none", width: 180,
              }}
              autoFocus
            />
          ) : (
            <span
              style={{
                color: hc.label,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              title={displayName}
            >
              {displayName}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <HeaderBtn label={naming ? "Naming this terminal with AI…" : "Name this terminal with AI (uses your OpenAI key)"} onClick={handleAiName} onDark={!isFocused}>
            {naming ? (
              <span className="cg-spinner" aria-label="Naming…" style={{ width: 12, height: 12 }} />
            ) : (
              <UI_ICON.ai size={13} weight="fill" />
            )}
          </HeaderBtn>
          <HeaderBtn label={isMaximized ? "Restore pane" : "Maximize pane"} onClick={(e) => { e.stopPropagation(); toggleMaximize(session.id); }} onDark={!isFocused}>
            {isMaximized ? <UI_ICON.restore size={13} /> : <UI_ICON.maximize size={13} />}
          </HeaderBtn>
          <HeaderBtn label={`Close pane ${session.pane_number} (Cmd+W)`} onClick={handleClose} danger onDark={!isFocused}>
            <UI_ICON.close size={14} />
          </HeaderBtn>
        </div>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          style={{
            position: "fixed",
            top: ctxPos?.top ?? ctxMenu.y,
            left: ctxPos?.left ?? ctxMenu.x,
            visibility: ctxPos ? "visible" : "hidden",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-strong)",
            zIndex: 9999,
            minWidth: 180,
            fontFamily: UI_FONT,
            fontSize: 13,
            boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
          }}
        >
          {[
            { label: "Rename", action: () => startRename() },
            { label: isMaximized ? "Restore size" : "Maximize", action: () => { setCtxMenu(null); toggleMaximize(session.id); } },
            { label: "Minimize", action: () => { setCtxMenu(null); minimizePane(session.id); } },
            null, // divider
            { label: "Close", action: () => { setCtxMenu(null); onClose(session.id); }, danger: true },
          ].map((item, i) =>
            item === null ? (
              <div key={i} style={{ height: "1px", background: "#2a2a2a", margin: "2px 0" }} />
            ) : (
              <div
                key={item.label}
                onClick={item.action}
                style={{
                  padding: "8px 14px", cursor: "pointer",
                  color: item.danger ? "var(--status-error)" : "var(--text-primary)",
                  minHeight: 30, display: "flex", alignItems: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {item.label}
              </div>
            )
          )}
        </div>
      )}

      {/* Terminal */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <TerminalView sessionId={session.id} agentColor={agentColor} />

        {/* Dead-session overlay: shown for sessions restored from DB on startup */}
        {session.status === "dead" && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              background: "rgba(10, 10, 10, 0.92)",
              gap: 14,
              fontFamily: UI_FONT,
              zIndex: 10,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 13 }}>
              <span aria-hidden>◌</span>
              <span>Session stopped</span>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12, maxWidth: 320, textAlign: "center", lineHeight: 1.5, fontFamily: "var(--font-code)" }}>
              {session.working_dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              style={{
                background: restarting ? "var(--bg-elevated)" : agentColor,
                border: "none",
                color: restarting ? "var(--text-muted)" : "#0a0a0a",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: UI_FONT,
                padding: "8px 18px",
                cursor: restarting ? "default" : "pointer",
                minHeight: 32,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
              onMouseEnter={(e) => { if (!restarting) e.currentTarget.style.filter = "brightness(1.1)"; }}
              onMouseLeave={(e) => { if (!restarting) e.currentTarget.style.filter = "none"; }}
            >
              <span aria-hidden>▶</span>
              {restarting ? "Starting…" : "Restart session"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
              style={{
                background: "transparent", border: "1px solid var(--border-default)",
                color: "var(--text-muted)", fontSize: 11,
                fontFamily: UI_FONT,
                padding: "5px 14px", cursor: "pointer", minHeight: 26,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--status-error)"; e.currentTarget.style.color = "var(--status-error)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar session={session} />

      {/* Broadcast indicator */}
      {broadcastMode && (
        <div
          style={{
            position: "absolute", top: 38, right: 10,
            fontSize: 10, fontFamily: UI_FONT, fontWeight: 700,
            color: "#0a0a0a", background: "#ff8c00",
            padding: "2px 7px", letterSpacing: 0.7, textTransform: "uppercase",
          }}
        >
          Broadcast
        </div>
      )}
    </div>
  );
});

/** Title-bar button used by the terminal Pane chrome. Bigger hit area than the
 *  visual glyph; readable; respects keyboard focus. */
function HeaderBtn({
  label,
  onClick,
  children,
  danger,
  onDark,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
  /** True when sitting on the dark (unfocused) header bar — flips to light glyphs. */
  onDark?: boolean;
}) {
  // Rest/hover colors depend on whether the header is the bright agent-color bar
  // (focused → dark glyphs) or the dark bar (unfocused → light glyphs).
  const restColor = onDark ? "var(--text-muted)" : "rgba(0,0,0,0.55)";
  const hoverColor = onDark ? (danger ? "var(--status-error)" : "var(--text-primary)") : "#0a0a0a";
  const hoverBg = onDark ? "var(--bg-hover)" : danger ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.18)";
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="cg-focus-ring"
      style={{
        background: "transparent",
        border: "none",
        color: restColor,
        cursor: "pointer",
        fontSize: 16,
        lineHeight: 1,
        width: 26,
        height: 26,
        minWidth: 26,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: UI_FONT,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = restColor;
      }}
    >
      {children}
    </button>
  );
}
