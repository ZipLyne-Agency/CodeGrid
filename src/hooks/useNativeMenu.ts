import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { cycleWorkspace } from "../lib/jumpToSession";
import { checkForUpdates } from "../lib/updater";

const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid";
const DOCS = "https://www.codegrid.app/docs";
const ISSUES = `${GITHUB}/issues/new`;

/** Run a menu/tray action id. Mirrors the keyboard shortcuts' behaviour. */
function performAction(id: string) {
  const ws = useWorkspaceStore.getState();
  switch (id) {
    case "new_session":
      ws.setNewSessionDialogOpen(true);
      break;
    case "new_workspace":
      window.dispatchEvent(new CustomEvent("codegrid:new-workspace"));
      break;
    case "close_session": {
      const fid = useSessionStore.getState().focusedSessionId;
      if (fid) {
        window.dispatchEvent(new CustomEvent("codegrid:close-session", { detail: { sessionId: fid } }));
      }
      break;
    }
    case "settings":
      ws.setSettingsOpen(true);
      break;
    case "check_updates":
      void checkForUpdates({ silent: false });
      ws.setSettingsOpen(true);
      break;
    case "command_palette":
      ws.setCommandPaletteOpen(true);
      break;
    case "toggle_sidebar":
      ws.toggleSidebar();
      break;
    case "find_in_files":
      ws.setSidebarOpen(true);
      ws.setActivePanel("search");
      break;
    case "maximize_pane": {
      const fid = useSessionStore.getState().focusedSessionId;
      if (fid) useLayoutStore.getState().toggleMaximize(fid);
      break;
    }
    case "toggle_broadcast":
      useSessionStore.getState().toggleBroadcast();
      break;
    case "next_attention":
      window.dispatchEvent(new CustomEvent("codegrid:next-attention"));
      break;
    case "getting_started":
      window.dispatchEvent(new CustomEvent("codegrid:show-onboarding"));
      break;
    case "next_workspace":
      cycleWorkspace("next");
      break;
    case "prev_workspace":
      cycleWorkspace("prev");
      break;
    case "docs":
      void openExternal(DOCS).catch(() => {});
      break;
    case "github":
      void openExternal(GITHUB).catch(() => {});
      break;
    case "report_issue":
      void openExternal(ISSUES).catch(() => {});
      break;
    default:
      console.debug("Unhandled menu action:", id);
  }
}

/** Handle a codegrid:// deep link, e.g. codegrid://open?path=/abs/path&type=claude */
function handleDeepLink(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const host = url.host || url.pathname.replace(/^\/+/, "").split("/")[0];
    if (host === "new" || host === "new-session") {
      useWorkspaceStore.getState().setNewSessionDialogOpen(true);
      return;
    }
    if (host === "open") {
      const path = url.searchParams.get("path");
      const type = url.searchParams.get("type") ?? "claude";
      if (path) {
        window.dispatchEvent(
          new CustomEvent("codegrid:quick-session", { detail: { path, type } }),
        );
      }
    }
  } catch (err) {
    console.warn("Bad deep link:", rawUrl, err);
  }
}

/**
 * Bridges the native menu bar, tray, and deep links to in-app actions.
 * Mount once (in App).
 */
export function useNativeMenu() {
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      try {
        const u1 = await listen<string>("codegrid://menu", (e) => performAction(e.payload));
        if (cancelled) u1();
        else unlistens.push(u1);

        const u2 = await listen<string[]>("codegrid://deep-link", (e) => {
          for (const url of e.payload ?? []) handleDeepLink(url);
        });
        if (cancelled) u2();
        else unlistens.push(u2);
      } catch (err) {
        // Not running under Tauri (e.g. plain `vite dev` in a browser) — ignore.
        console.debug("Native menu bridge unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
  }, []);
}
