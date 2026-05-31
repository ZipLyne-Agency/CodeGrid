import { useEffect, useCallback } from "react";
import { matchKeybinding } from "../lib/keybindings";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAppStore } from "../stores/appStore";
import { setSetting } from "../lib/ipc";
import { jumpToSession, switchWorkspace } from "../lib/jumpToSession";

export function useKeyboardNav() {
  const {
    sessions,
    focusedSessionId,
    toggleBroadcast,
  } = useSessionStore();
  const { layouts, toggleMaximize, swapPanes } = useLayoutStore();
  const {
    workspaces,
    activeWorkspaceId,
    setCommandPaletteOpen,
    setNewSessionDialogOpen,
    toggleSidebar,
    setSettingsOpen,
    setActivePanel,
    setSidebarOpen,
    setPaneSwitcherOpen,
  } = useWorkspaceStore();
  const setGitManagerOpen = useAppStore((s) => s.setGitManagerOpen);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);

  const findAdjacentPane = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!focusedSessionId) return null;
      const current = layouts.find((l) => l.i === focusedSessionId);
      if (!current) return null;

      const candidates = layouts.filter((l) => l.i !== focusedSessionId);
      let best: (typeof layouts)[0] | null = null;
      let bestDist = Infinity;

      for (const c of candidates) {
        let isInDirection = false;
        let dist = Infinity;

        switch (direction) {
          case "up":
            isInDirection = c.y < current.y;
            dist = current.y - c.y + Math.abs(c.x - current.x) * 0.1;
            break;
          case "down":
            isInDirection = c.y > current.y;
            dist = c.y - current.y + Math.abs(c.x - current.x) * 0.1;
            break;
          case "left":
            isInDirection = c.x < current.x;
            dist = current.x - c.x + Math.abs(c.y - current.y) * 0.1;
            break;
          case "right":
            isInDirection = c.x > current.x;
            dist = c.x - current.x + Math.abs(c.y - current.y) * 0.1;
            break;
        }

        if (isInDirection && dist < bestDist) {
          best = c;
          bestDist = dist;
        }
      }

      return best?.i ?? null;
    },
    [focusedSessionId, layouts],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = matchKeybinding(e);
      if (!action) return;

      // Don't intercept when typing in an input/dialog — except for a few global
      // shortcuts that must work even while a terminal (a hidden textarea) or
      // input is focused.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        const allowedWhileTyping =
          action === "command-palette" ||
          action === "project-search" ||
          action === "pane-switcher" ||
          action === "fit-all" ||
          action === "new-scratch-pane" ||
          action.startsWith("terminal-font");
        if (!allowedWhileTyping) return;
      }

      e.preventDefault();
      e.stopPropagation();

      switch (action) {
        case "new-session":
          setNewSessionDialogOpen(true);
          break;
        case "close-session":
          // Handled by the pane component
          if (focusedSessionId) {
            window.dispatchEvent(
              new CustomEvent("codegrid:close-session", {
                detail: { sessionId: focusedSessionId },
              }),
            );
          }
          break;
        case "focus-up":
        case "focus-down":
        case "focus-left":
        case "focus-right": {
          const dir = action.replace("focus-", "") as "up" | "down" | "left" | "right";
          const targetId = findAdjacentPane(dir);
          // jumpToSession focuses AND pans the canvas to the pane, so directional
          // nav can never strand focus on an off-screen (invisible) terminal.
          if (targetId) jumpToSession(targetId);
          break;
        }
        case "swap-up":
        case "swap-down":
        case "swap-left":
        case "swap-right": {
          const dir = action.replace("swap-", "") as "up" | "down" | "left" | "right";
          const targetId = findAdjacentPane(dir);
          if (targetId && focusedSessionId) {
            swapPanes(focusedSessionId, targetId);
          }
          break;
        }
        case "maximize-pane":
          if (focusedSessionId) {
            toggleMaximize(focusedSessionId);
          }
          break;
        case "command-palette":
          setCommandPaletteOpen(true);
          break;
        case "pane-switcher":
          setPaneSwitcherOpen(true);
          break;
        case "fit-all":
          // Canvas owns the live viewport dims, so it performs the actual fit.
          window.dispatchEvent(new CustomEvent("codegrid:fit-all"));
          break;
        case "new-scratch-pane":
          window.dispatchEvent(new CustomEvent("codegrid:new-scratch-pane"));
          break;
        case "terminal-font-increase":
        case "terminal-font-decrease":
        case "terminal-font-reset": {
          const next =
            action === "terminal-font-reset"
              ? 13
              : useAppStore.getState().terminalFontSize + (action === "terminal-font-increase" ? 1 : -1);
          setTerminalFontSize(next);
          setSetting("terminal_font_size", String(useAppStore.getState().terminalFontSize)).catch(() => {});
          break;
        }
        case "toggle-broadcast":
          toggleBroadcast();
          break;
        case "toggle-sidebar":
          toggleSidebar();
          break;
        case "git-manager": {
          const focused = sessions.find((s) => s.id === focusedSessionId);
          setGitManagerOpen(true, focused?.working_dir);
          break;
        }
        case "settings":
          setSettingsOpen(true);
          break;
        case "project-search":
          setSidebarOpen(true);
          setActivePanel("search");
          break;
        case "new-workspace":
          window.dispatchEvent(new CustomEvent("codegrid:new-workspace"));
          break;
        case "next-workspace":
        case "prev-workspace": {
          const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
          if (idx >= 0 && workspaces.length > 1) {
            const next =
              action === "next-workspace"
                ? (idx + 1) % workspaces.length
                : (idx - 1 + workspaces.length) % workspaces.length;
            // Single shared switch impl: restores the full view + reconciles focus.
            switchWorkspace(workspaces[next].id);
          }
          break;
        }
        default:
          // Handle focus-pane-N (only search sessions in the active workspace)
          if (action.startsWith("focus-pane-")) {
            const num = parseInt(action.replace("focus-pane-", ""), 10);
            const session = sessions.find(
              (s) => s.pane_number === num && s.workspace_id === activeWorkspaceId,
            );
            // jumpToSession focuses AND reveals, so Cmd+N never targets an
            // off-screen pane.
            if (session) jumpToSession(session.id);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedSessionId,
    sessions,
    workspaces,
    activeWorkspaceId,
    findAdjacentPane,
    setNewSessionDialogOpen,
    setCommandPaletteOpen,
    toggleSidebar,
    setSettingsOpen,
    setActivePanel,
    setSidebarOpen,
    setGitManagerOpen,
    toggleBroadcast,
    swapPanes,
    toggleMaximize,
    setPaneSwitcherOpen,
    setTerminalFontSize,
  ]);
}
