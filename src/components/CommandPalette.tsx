import { memo, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore, type PresetLayout } from "../stores/layoutStore";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import { sendToSession, setActiveWorkspace as ipcSetActiveWorkspace, createWorkspace, createSession } from "../lib/ipc";
import { switchWorkspace } from "../lib/jumpToSession";

interface CommandItem {
  id: string;
  label: string;
  category: string;
  /** Extra text matched by search (label stays short in the list). */
  matchText?: string;
  action: () => void;
}

export const CommandPalette = memo(function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setNewSessionDialogOpen,
    toggleSidebar,
    setSettingsOpen,
    activeWorkspaceId,
  } = useWorkspaceStore();
  const sessions = useSessionStore((s) => s.sessions);
  const { setFocusedSession, toggleBroadcast, focusedSessionId } = useSessionStore();
  const { applyPreset, toggleMaximize, addPaneLayout } = useLayoutStore();
  const { setSkillsPanelOpen, setHubBrowserOpen, setGitManagerOpen, setMcpManagerOpen, setDependencyGraphOpen, setReviewPanelOpen, skills } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSessions = useMemo(
    () => sessions.filter((s) => s.workspace_id === activeWorkspaceId),
    [sessions, activeWorkspaceId],
  );

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const { setActiveWorkspace: setActiveWorkspaceLocal } = useWorkspaceStore();
  const { addSession } = useSessionStore();

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // --- Workspaces (highest priority) ---
    for (const ws of workspaces) {
      if (ws.id === activeWorkspaceId) continue;
      items.push({
        id: `switch-workspace-${ws.id}`,
        label: `Switch to ${ws.name}`,
        category: "Workspaces",
        action: () => {
          // Use the shared switch so the target workspace's layout is actually
          // restored (and focus reconciled) — not just the active id flipped.
          setCommandPaletteOpen(false);
          switchWorkspace(ws.id);
        },
      });
    }
    items.push({
      id: "new-workspace",
      label: "New workspace",
      category: "Workspaces",
      action: async () => {
        setCommandPaletteOpen(false);
        try {
          const ws = await createWorkspace(`Workspace ${workspaces.length + 1}`);
          setActiveWorkspaceLocal(ws.id);
          await ipcSetActiveWorkspace(ws.id);
          useWorkspaceStore.getState().addWorkspace(ws);
        } catch (e) { addToast(`Failed to create workspace: ${e}`, "error"); }
      },
    });

    // --- Projects ---
    items.push({
      id: "open-folder",
      label: "Open folder...",
      category: "Projects",
      action: async () => {
        setCommandPaletteOpen(false);
        try {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const selected = await open({ directory: true, multiple: false, title: "Open Folder" });
          if (selected && activeWorkspaceId) {
            const session = await createSession(selected as string, activeWorkspaceId);
            addSession(session);
            addPaneLayout(session.id); // give it a canvas slot so the pane is visible
            setFocusedSession(session.id);
            // Reveal the new pane (focus alone doesn't move the canvas).
            window.dispatchEvent(new CustomEvent("codegrid:zoom-to-session", { detail: { sessionId: session.id } }));
            setTimeout(() => window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } })), 100);
          }
        } catch (e) { addToast(`Failed to open folder: ${e}`, "error"); }
      },
    });
    items.push({
      id: "new-project",
      label: "New project",
      category: "Projects",
      action: () => { setCommandPaletteOpen(false); setNewSessionDialogOpen(true); },
    });

    // --- Sessions ---
    items.push({
      id: "new-session",
      label: "New session",
      category: "Sessions",
      action: () => { setCommandPaletteOpen(false); setNewSessionDialogOpen(true); },
    });
    items.push({
      id: "new-browser-pane",
      label: "New localhost preview pane",
      category: "Sessions",
      action: () => {
        setCommandPaletteOpen(false);
        window.dispatchEvent(
          new CustomEvent("codegrid:new-browser-pane", {
            detail: { url: "", focusUrl: true },
          }),
        );
      },
    });
    items.push({
      id: "new-note-pane",
      label: "New note pane",
      category: "Sessions",
      action: () => {
        setCommandPaletteOpen(false);
        window.dispatchEvent(new CustomEvent("codegrid:new-note-pane", { detail: {} }));
      },
    });
    // --- View ---
    items.push(
      {
        id: "toggle-sidebar",
        label: "Sidebar",
        category: "View",
        action: () => { setCommandPaletteOpen(false); toggleSidebar(); },
      },
      {
        id: "toggle-broadcast",
        label: "Broadcast",
        category: "View",
        action: () => { setCommandPaletteOpen(false); toggleBroadcast(); },
      },
      {
        id: "fit-all-panes",
        label: "Fit all panes to view",
        category: "View",
        action: () => { setCommandPaletteOpen(false); window.dispatchEvent(new CustomEvent("codegrid:fit-all")); },
      },
      {
        id: "new-scratch-pane",
        label: "New scratch terminal (detached)",
        category: "Sessions",
        action: () => { setCommandPaletteOpen(false); window.dispatchEvent(new CustomEvent("codegrid:new-scratch-pane")); },
      },
      {
        id: "show-onboarding",
        label: "Getting Started",
        category: "App",
        action: () => { setCommandPaletteOpen(false); window.dispatchEvent(new CustomEvent("codegrid:show-onboarding")); },
      },
    );

    // Resolve the repo dir for AI git actions: focused session → active
    // workspace repo → first session in the workspace.
    const aiGitDir = () => {
      const focused = activeSessions.find((s) => s.id === focusedSessionId);
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      return focused?.working_dir ?? ws?.repo_path ?? activeSessions[0]?.working_dir;
    };

    // --- Tools ---
    items.push(
      {
        id: "ai-code-review",
        label: "AI Code Review (uncommitted changes)",
        category: "Tools",
        action: () => {
          const dir = aiGitDir();
          setCommandPaletteOpen(false);
          if (dir) setReviewPanelOpen(true, dir);
          else addToast("Open a project to review.", "warning");
        },
      },
      {
        id: "ai-commit-message",
        label: "Generate AI commit message",
        category: "Tools",
        action: () => {
          const dir = aiGitDir();
          setCommandPaletteOpen(false);
          if (!dir) { addToast("Open a project first.", "warning"); return; }
          // The commit form lives in the Git panel; ask it to open + generate.
          window.dispatchEvent(new CustomEvent("codegrid:ai-commit-message", { detail: { dir } }));
        },
      },
      {
        id: "open-hub",
        label: "Hub",
        category: "Tools",
        action: () => { setCommandPaletteOpen(false); setHubBrowserOpen(true); },
      },
      {
        id: "open-skills",
        label: "Skills",
        category: "Tools",
        action: () => { setCommandPaletteOpen(false); setSkillsPanelOpen(true); },
      },
      {
        id: "settings",
        label: "Settings",
        category: "App",
        action: () => { setCommandPaletteOpen(false); setSettingsOpen(true); },
      },
      {
        id: "open-git",
        label: "Git",
        category: "Tools",
        action: () => {
          const focused = activeSessions.find((s) => s.id === focusedSessionId);
          setCommandPaletteOpen(false);
          setGitManagerOpen(true, focused?.working_dir);
        },
      },
      {
        id: "open-dep-graph",
        label: "Dependency Graph",
        category: "Tools",
        action: () => {
          const focused = activeSessions.find((s) => s.id === focusedSessionId);
          setCommandPaletteOpen(false);
          setDependencyGraphOpen(true, focused?.working_dir);
        },
      },
      {
        id: "open-mcp",
        label: "MCP",
        category: "Tools",
        action: () => {
          const focused = activeSessions.find((s) => s.id === focusedSessionId);
          setCommandPaletteOpen(false);
          setMcpManagerOpen(true, focused?.working_dir);
        },
      },
      {
        id: "open-claude-md",
        label: "CLAUDE.md",
        category: "Tools",
        action: () => {
          const focused = activeSessions.find((s) => s.id === focusedSessionId);
          setCommandPaletteOpen(false);
          if (focused?.working_dir) {
            useAppStore.getState().setClaudeMdEditorOpen(true, focused.working_dir);
          }
        },
      },
    );

    // Layout modes
    const layoutModes: { label: string; value: PresetLayout }[] = [
      { label: "Auto", value: "auto" },
      { label: "Focus", value: "focus" },
      { label: "Columns", value: "columns" },
      { label: "Rows", value: "rows" },
      { label: "Grid", value: "grid" },
    ];

    for (const p of layoutModes) {
      items.push({
        id: `layout-${p.value}`,
        label: `Layout: ${p.label}`,
        category: "Layouts",
        action: () => {
          applyPreset(p.value, activeSessions.map((s) => s.id), window.innerWidth - 60, window.innerHeight - 52);
          setCommandPaletteOpen(false);
        },
      });
    }

    // Send skills to focused session
    if (focusedSessionId) {
      for (const skill of skills.slice(0, 10)) {
        items.push({
          id: `skill-${skill.name}`,
          label: skill.name,
          matchText: `${skill.name} ${skill.description}`,
          category: "Skills",
          action: async () => {
            try {
              await sendToSession(focusedSessionId, skill.name);
            } catch (e) { addToast(`Failed to send skill: ${e}`, "error"); }
            setCommandPaletteOpen(false);
          },
        });
      }
    }

    // Session commands
    for (const session of activeSessions) {
      items.push({
        id: `focus-${session.id}`,
        label: `Focus [${session.pane_number}] ${session.working_dir.split("/").pop() ?? ""}`,
        category: "Sessions",
        action: () => {
          setFocusedSession(session.id);
          window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } }));
          setCommandPaletteOpen(false);
        },
      });
      items.push({
        id: `maximize-${session.id}`,
        label: `Max [${session.pane_number}]`,
        category: "Sessions",
        action: () => { toggleMaximize(session.id); setCommandPaletteOpen(false); },
      });
    }

    // Kill idle
    const idleSessions = activeSessions.filter((s) => s.status === "idle" || s.status === "dead");
    if (idleSessions.length > 0) {
      items.push({
        id: "kill-idle",
        label: `Close idle (${idleSessions.length})`,
        category: "Sessions",
        action: () => {
          // Bulk action → bypass the single-slot per-pane confirm (which would
          // otherwise collapse N closes down to one). These are idle/dead anyway.
          for (const s of idleSessions) {
            window.dispatchEvent(new CustomEvent("codegrid:force-close-session", { detail: { sessionId: s.id } }));
          }
          setCommandPaletteOpen(false);
        },
      });
    }

    return items;
  }, [activeSessions, focusedSessionId, skills, setCommandPaletteOpen, setNewSessionDialogOpen, toggleSidebar, toggleBroadcast, setHubBrowserOpen, setSkillsPanelOpen, setSettingsOpen, setGitManagerOpen, setMcpManagerOpen, setDependencyGraphOpen, setReviewPanelOpen, setFocusedSession, applyPreset, toggleMaximize, addToast, workspaces, activeWorkspaceId, setActiveWorkspaceLocal, addSession, addPaneLayout]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((c) => {
      const hay = (c.matchText ?? c.label).toLowerCase();
      return hay.includes(lower) || c.category.toLowerCase().includes(lower);
    });
  }, [commands, query]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [commandPaletteOpen]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setCommandPaletteOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); filtered[selectedIndex]?.action(); return; }
    },
    [filtered, selectedIndex, setCommandPaletteOpen],
  );

  if (!commandPaletteOpen) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "80px" }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0, 0, 0, 0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        style={{
          position: "relative", width: "560px", maxHeight: "400px", background: "#141414",
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
            placeholder="Command…"
            style={{
              width: "100%", background: "transparent", border: "none", color: "var(--text-primary)",
              fontSize: "13px", fontFamily: "var(--font-ui)", padding: "12px 16px", outline: "none",
            }}
          />
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-muted)", textAlign: "center", fontSize: "12px" }}>
              No commands found
            </div>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                onClick={() => item.action()}
                onMouseEnter={() => setSelectedIndex(index)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                  padding: "8px 16px", cursor: "pointer",
                  background: index === selectedIndex ? "#1e1e1e" : "transparent",
                  borderLeft: index === selectedIndex ? "2px solid #ff8c00" : "2px solid transparent",
                }}
              >
                <span style={{
                  color: index === selectedIndex ? "#e0e0e0" : "#888888", fontSize: "12px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                }}>
                  {item.label}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0 }}>
                  {item.category}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
