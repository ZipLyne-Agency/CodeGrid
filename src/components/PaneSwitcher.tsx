import { memo, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { detectAgent, statusTheme } from "../lib/paneTheme";
import { jumpToSession } from "../lib/jumpToSession";

/**
 * Cmd+P quick-switcher — a focused list of the current workspace's panes.
 * Type to fuzzy-filter by name / folder / agent / pane number, ↑↓ to move,
 * Enter to jump. Distinct from the command palette (Cmd+K), which is actions.
 */
export const PaneSwitcher = memo(function PaneSwitcher() {
  const paneSwitcherOpen = useWorkspaceStore((s) => s.paneSwitcherOpen);
  const setPaneSwitcherOpen = useWorkspaceStore((s) => s.setPaneSwitcherOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const sessions = useSessionStore((s) => s.sessions);
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const panes = useMemo(
    () =>
      sessions
        .filter((s) => s.workspace_id === activeWorkspaceId)
        .sort((a, b) => a.pane_number - b.pane_number),
    [sessions, activeWorkspaceId],
  );

  const filtered = useMemo(() => {
    if (!query) return panes;
    const lower = query.toLowerCase();
    return panes.filter((s) => {
      const name = (s.manualName ?? s.activityName ?? "").toLowerCase();
      const folder = (s.working_dir.split("/").pop() ?? "").toLowerCase();
      const agent = detectAgent(s.command).label.toLowerCase();
      const branch = (s.git_branch ?? "").toLowerCase();
      return (
        name.includes(lower) ||
        folder.includes(lower) ||
        agent.includes(lower) ||
        branch.includes(lower) ||
        String(s.pane_number) === lower
      );
    });
  }, [panes, query]);

  useEffect(() => {
    if (paneSwitcherOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paneSwitcherOpen]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const choose = useCallback(
    (sessionId: string) => {
      // jumpToSession focuses AND pans the canvas to the pane — selecting a pane
      // in the switcher must always bring it on-screen, not just focus a hidden one.
      jumpToSession(sessionId);
      setPaneSwitcherOpen(false);
    },
    [setPaneSwitcherOpen],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setPaneSwitcherOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); const s = filtered[selectedIndex]; if (s) choose(s.id); return; }
    },
    [filtered, selectedIndex, choose, setPaneSwitcherOpen],
  );

  if (!paneSwitcherOpen) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "80px" }}
      onClick={() => setPaneSwitcherOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0, 0, 0, 0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Switch Pane"
        style={{
          position: "relative", width: "520px", maxHeight: "400px", background: "#141414",
          border: "1px solid #ff8c00", display: "flex", flexDirection: "column",
          fontFamily: "var(--font-ui)", zIndex: 1,
        }}
      >
        <div style={{ borderBottom: "1px solid #2a2a2a" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Switch to pane…"
            style={{
              width: "100%", background: "transparent", border: "none", color: "var(--text-primary)",
              fontSize: "13px", fontFamily: "var(--font-ui)", padding: "12px 16px", outline: "none",
            }}
          />
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center", fontSize: "12px" }}>
              No panes in this workspace
            </div>
          ) : (
            filtered.map((s, index) => {
              const agent = detectAgent(s.command);
              const status = statusTheme(s.status);
              const name = s.manualName ?? s.activityName ?? agent.label;
              const folder = s.working_dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
              const active = index === selectedIndex;
              return (
                <div
                  key={s.id}
                  onClick={() => choose(s.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 16px", cursor: "pointer",
                    background: active ? "#1e1e1e" : "transparent",
                    borderLeft: active ? "2px solid #ff8c00" : "2px solid transparent",
                  }}
                >
                  <span style={{
                    fontSize: 12, fontWeight: 800, color: agent.color, minWidth: 16, textAlign: "center",
                  }}>{s.pane_number}</span>
                  <span aria-hidden style={{ color: agent.color, fontSize: 13, flexShrink: 0 }}>{agent.glyph}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      color: active ? "#e0e0e0" : "#aaaaaa", fontSize: 12, fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {name}
                      {s.git_branch ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{`  ⎇ ${s.git_branch}`}</span> : null}
                    </div>
                    <div style={{
                      color: "var(--text-muted)", fontSize: 10,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{folder}</div>
                  </div>
                  <span aria-hidden title={status.label} style={{ color: status.color, fontSize: 11, flexShrink: 0 }}>
                    {status.glyph}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
