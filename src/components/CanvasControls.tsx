import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalManager } from "./TerminalManager";

const UI_FONT = "var(--font-ui)";

/**
 * Top-bar action cluster (top-right): "manage terminals", command palette, and
 * the single "+ New" creation menu. Rendered inline in the top bar — the canvas
 * itself stays clean (view controls + status live in the bottom bar).
 */
export const CanvasControls = memo(function CanvasControls() {
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen);
  const setNewSessionDialogOpen = useWorkspaceStore((s) => s.setNewSessionDialogOpen);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);

  const [tmOpen, setTmOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newAnchor, setNewAnchor] = useState<{ top: number; right: number } | null>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);

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
        <IconBtn glyph="▤" title="Manage all terminals" onClick={() => setTmOpen(true)} />
        <IconBtn glyph="⌘" title="Command Palette (Cmd+K)" onClick={() => setCommandPaletteOpen(true)} />
        <button
          ref={newBtnRef}
          data-new-btn
          onClick={() => {
            const r = newBtnRef.current?.getBoundingClientRect();
            if (r) setNewAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
            setNewMenuOpen((o) => !o);
          }}
          title="New… (Cmd+N)"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: "#ff8c00", border: "1px solid #ff8c00", color: "#0a0a0a",
            fontSize: 12, fontFamily: UI_FONT, cursor: "pointer",
            padding: "5px 12px", fontWeight: "bold", borderRadius: 6,
          }}
        >
          + New <span style={{ fontSize: 9 }}>▾</span>
        </button>
      </div>

      {newMenuOpen && newAnchor && createPortal(
        <div
          data-new-menu
          style={{
            position: "fixed", top: newAnchor.top, right: newAnchor.right, width: 360, maxWidth: "92vw",
            background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
            borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.6)", zIndex: 100000, padding: 6,
          }}
        >
          <div style={{ padding: "4px 10px 6px", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-faint)", fontFamily: UI_FONT }}>
            Add to canvas
          </div>
          {[
            { glyph: "◆", color: "#ff8c00", label: "New agent session", hint: "pick agent", desc: "Start a coding agent — Claude, Codex, Gemini, Cursor or Grok — in a project folder.", run: () => setNewSessionDialogOpen(true) },
            { glyph: "⧉", color: "#ff8c00", label: "Same agent here", hint: "duplicate", desc: "Open a second pane of the focused agent on the same project folder.", run: handleSameAgent },
            { glyph: "⌁", color: "#ff8c00", label: "Scratch terminal", hint: "⇧⌘J", desc: "A throwaway shell for quick commands — not tied to any project or agent.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-scratch-pane", { detail: {} })) },
            { glyph: "◧", color: "#4a9eff", label: "Preview pane", hint: "localhost", desc: "A live in-app browser for your dev server — preview your app beside the code.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-browser-pane", { detail: { url: "", focusUrl: true } })) },
            { glyph: "✎", color: "#ffab00", label: "Note", hint: "markdown", desc: "A markdown scratchpad pinned to the canvas — plans, to-dos, snippets.", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-note-pane", { detail: {} })) },
          ].map((item) => (
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
              <span aria-hidden style={{ color: item.color, width: 16, textAlign: "center", flexShrink: 0, fontSize: 13, lineHeight: "16px", marginTop: 1 }}>{item.glyph}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                  {item.hint && <span style={{ color: "var(--text-faint)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>{item.hint}</span>}
                </span>
                <span style={{ display: "block", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{item.desc}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      <TerminalManager open={tmOpen} onClose={() => setTmOpen(false)} />
    </>
  );
});

/** Compact icon-only control button. */
function IconBtn({ glyph, title, onClick }: { glyph: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="cg-focus-ring"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, minWidth: 28,
        background: "transparent", border: "1px solid #2a2a2a", borderRadius: 6,
        color: "#888", fontSize: 14, cursor: "pointer", fontFamily: UI_FONT,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#ff8c00"; e.currentTarget.style.borderColor = "#ff8c00"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#2a2a2a"; }}
    >
      {glyph}
    </button>
  );
}
