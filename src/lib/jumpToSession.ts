import { useSessionStore } from "../stores/sessionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { sanitizeWorkspaceView, useLayoutStore } from "../stores/layoutStore";
import { setActiveWorkspace as setActiveWorkspaceIpc } from "./ipc";

/**
 * After a workspace switch, make sure the focused session belongs to the now-active
 * workspace. Otherwise keyboard nav / shortcuts keep acting on an off-screen pane in
 * the workspace we just left. Picks the most-recently-used visible session, else null.
 */
function reconcileFocusForWorkspace(workspaceId: string) {
  const sessionStore = useSessionStore.getState();
  const { minimizedPanes } = useLayoutStore.getState();
  const focused = sessionStore.sessions.find((s) => s.id === sessionStore.focusedSessionId);
  if (focused && focused.workspace_id === workspaceId) return;

  const candidates = sessionStore.sessions
    .filter((s) => s.workspace_id === workspaceId && !minimizedPanes[s.id])
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  sessionStore.setFocusedSession(candidates[0]?.id ?? null);
}

/**
 * Switch the active workspace and restore its full saved canvas view (layouts,
 * pan/zoom, and minimized/maximized state). This is the single switch implementation
 * used by the top bar, Cmd+Tab, the native menu, and jumpToSession — keep them on it.
 */
export function switchWorkspace(workspaceId: string) {
  const wsStore = useWorkspaceStore.getState();
  if (wsStore.activeWorkspaceId === workspaceId) return;
  const ws = wsStore.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return;
  wsStore.setActiveWorkspace(workspaceId);

  useLayoutStore.getState().applyWorkspaceView(sanitizeWorkspaceView(ws.layout_json));
  reconcileFocusForWorkspace(workspaceId);

  setActiveWorkspaceIpc(workspaceId).catch(() => {});
  window.dispatchEvent(new CustomEvent("codegrid:workspace-changed", { detail: { workspaceId } }));
}

/**
 * Bring a session into view: switch to its workspace if needed, focus it, and
 * zoom the canvas to it. Used by the attention bar and "next attention" action.
 */
export function jumpToSession(sessionId: string) {
  const sessionStore = useSessionStore.getState();
  const session = sessionStore.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  const activeWs = useWorkspaceStore.getState().activeWorkspaceId;
  const needsSwitch = !!session.workspace_id && session.workspace_id !== activeWs;
  if (needsSwitch) switchWorkspace(session.workspace_id);

  sessionStore.setFocusedSession(sessionId);

  const layout = useLayoutStore.getState();
  // A maximized *other* pane would hide the target — drop out of maximize.
  if (layout.maximizedPane && layout.maximizedPane !== sessionId) {
    layout.toggleMaximize(layout.maximizedPane);
  }
  // If the target is minimized it isn't on the canvas — restore it so the
  // zoom-to-session handler can actually find and center it.
  const wasMinimized = !!layout.minimizedPanes[sessionId];
  if (wasMinimized) layout.restorePane(sessionId);

  const fire = () => {
    window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId } }));
    window.dispatchEvent(new CustomEvent("codegrid:zoom-to-session", { detail: { sessionId } }));
  };
  // Let the workspace/layout settle before zooming when we changed workspaces
  // or just restored a minimized pane.
  if (needsSwitch || wasMinimized) setTimeout(fire, 140);
  else fire();
}

/** Cycle to the next/previous workspace (used by the native menu). */
export function cycleWorkspace(direction: "next" | "prev") {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState();
  if (workspaces.length < 2) return;
  const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
  if (idx < 0) return;
  const nextIdx =
    direction === "next"
      ? (idx + 1) % workspaces.length
      : (idx - 1 + workspaces.length) % workspaces.length;
  switchWorkspace(workspaces[nextIdx].id);
}
