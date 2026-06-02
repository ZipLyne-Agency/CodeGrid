import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { UI_ICON, type Icon } from "../lib/icons";
import { clampMenuPosition } from "../lib/menuPosition";

const UI_FONT = "var(--font-ui)";

/**
 * Top-bar action cluster (top-right): the "+ New" creation menu and the command
 * palette. (Bulk terminal management now lives in the Panes drawer, so the old
 * "manage terminals" button was removed.) Rendered inline in the top bar — the
 * canvas itself stays clean (view controls + status live in the bottom bar).
 */
export const CanvasControls = memo(function CanvasControls() {
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen);
  const setNewSessionDialogOpen = useWorkspaceStore((s) => s.setNewSessionDialogOpen);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newPos, setNewPos] = useState<{ top: number; left: number } | null>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const newPopRef = useRef<HTMLDivElement>(null);

  // Keep the "+ New" menu fully on-screen (clamps/flips near a viewport edge).
  useLayoutEffect(() => {
    if (!newMenuOpen || !newBtnRef.current || !newPopRef.current) { setNewPos(null); return; }
    const a = newBtnRef.current.getBoundingClientRect();
    const m = newPopRef.current.getBoundingClientRect();
    setNewPos(clampMenuPosition(a, { width: m.width, height: m.height }, { align: "right", gap: 6 }));
  }, [newMenuOpen]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setNewMenuOpen(false); return; }
      const t = e.target as HTMLElement;
      if (t.closest("[data-new-menu]") || t.closest("[data-new-btn]")) return;
      setNewMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [newMenuOpen]);

  const handleSameAgent = useCallback(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    const active = sessions
      .filter((s) => s.workspace_id === activeWorkspaceId)
      .sort((a, b) => (a.pane_number ?? 0) - (b.pane_number ?? 0));
    const focusedSession = active.find((s) => s.id === focusedSessionId);
    const dir = focusedSession?.working_dir ?? ws?.repo_path ?? active[0]?.working_dir ?? "";
    if (!dir) { setNewSessionDialogOpen(true); return; }
    const cmd = focusedSession?.command ?? "";
    let type = "claude";
    if (/\bcodex\b/i.test(cmd)) type = "codex";
    else if (/\bgemini\b/i.test(cmd)) type = "gemini";
    else if (/\bcursor\b/i.test(cmd)) type = "cursor";
    else if (/\bgrok\b/i.test(cmd)) type = "grok";
    else if (/\b(zsh|bash|fish|sh|powershell|pwsh|cmd)\b/i.test(cmd)) type = "shell";
    window.dispatchEvent(new CustomEvent("codegrid:quick-session", { detail: { path: dir, type } }));
  }, [workspaces, activeWorkspaceId, sessions, focusedSessionId, setNewSessionDialogOpen]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          fontFamily: UI_FONT,
        }}
      >
        <button
          ref={newBtnRef}
          data-new-btn
          onClick={() => setNewMenuOpen((o) => !o)}
          title="New… (Cmd+N)"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
            height: "var(--ctl-h)", boxSizing: "border-box",
            background: "var(--accent)", border: "1px solid var(--accent)", color: "#0a0a0a",
            fontSize: 12, fontFamily: UI_FONT, cursor: "pointer",
            padding: "0 12px", fontWeight: 700, borderRadius: 6,
          }}
        >
          + New <UI_ICON.caretDown size={11} weight="regular" style={{ flexShrink: 0 }} />
        </button>
        <IconBtn icon={UI_ICON.command} title="Command Palette (Cmd+K)" onClick={() => setCommandPaletteOpen(true)} />
      </div>

      {newMenuOpen && createPortal(
        <div
          data-new-menu
          ref={newPopRef}
          style={{
            position: "fixed", top: newPos?.top ?? -9999, left: newPos?.left ?? -9999,
            visibility: newPos ? "visible" : "hidden", width: 360, maxWidth: "92vw",
            background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
            borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.6)", zIndex: 100000, padding: 6,
          }}
        >
          {(() => {
            const renderItem = (item: { icon: Icon; color: string; label: string; hint?: string; desc: string; run: () => void }) => (
              <button
                key={item.label}
                onClick={() => { setNewMenuOpen(false); item.run(); }}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 11, width: "100%",
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: "9px 10px", borderRadius: 6, textAlign: "left",
                  color: "var(--text-primary)", fontFamily: UI_FONT,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span aria-hidden style={{ color: item.color, width: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}><item.icon size={15} weight="regular" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                    {item.hint && <span style={{ color: "var(--text-faint)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>{item.hint}</span>}
                  </span>
                  <span style={{ display: "block", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{item.desc}</span>
                </span>
              </button>
            );
            const sectionLabel = (text: string) => (
              <div style={{ padding: "4px 10px 6px", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-faint)", fontFamily: UI_FONT }}>{text}</div>
            );
            return (
              <>
                {sectionLabel("Current agent")}
                {renderItem({ icon: UI_ICON.sameAgent, color: "var(--accent)", label: "Same agent here", hint: "duplicate", desc: "Open a second pane of the focused agent on the same project folder.", run: handleSameAgent })}
                <div style={{ height: 1, background: "var(--border-default)", margin: "6px 8px" }} />
                {sectionLabel("Add to canvas")}
                {[
                  { icon: UI_ICON.newAgent, color: "var(--accent)", label: "New agent session", hint: "pick agent", desc: "Start a coding agent — Claude, Codex, Gemini, Cursor or Grok — in a project folder.", run: () => setNewSessionDialogOpen(true) },
                  { icon: UI_ICON.scratch, color: "var(--agent-shell)", label: "Scratch terminal", hint: "⇧⌘J", desc: "A throwaway shell for quick commands — not tied to any project or agent.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-scratch-pane", { detail: {} })) },
                  { icon: UI_ICON.preview, color: "var(--agent-browser)", label: "Preview pane", hint: "localhost", desc: "A live in-app browser for your dev server — preview your app beside the code.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-browser-pane", { detail: { url: "", focusUrl: true } })) },
                  { icon: UI_ICON.note, color: "var(--agent-note)", label: "Note", hint: "markdown", desc: "A markdown scratchpad pinned to the canvas — plans, to-dos, snippets.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-note-pane", { detail: {} })) },
                ].map(renderItem)}
              </>
            );
          })()}
        </div>,
        document.body,
      )}
    </>
  );
});

/** Compact icon-only control button. */
function IconBtn({ icon: Glyph, title, onClick }: { icon: Icon; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="cg-focus-ring"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "var(--ctl-h)", height: "var(--ctl-h)", minWidth: "var(--ctl-h)", boxSizing: "border-box",
        background: "transparent", border: "1px solid var(--border-default)", borderRadius: 6,
        color: "var(--text-muted)", fontSize: 14, cursor: "pointer", fontFamily: UI_FONT,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
    >
      <Glyph size={15} weight="regular" style={{ flexShrink: 0 }} />
    </button>
  );
}
