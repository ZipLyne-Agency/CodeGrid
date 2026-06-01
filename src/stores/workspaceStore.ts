import { create } from "zustand";
import { type WorkspaceInfo } from "../lib/ipc";
import { useSessionStore } from "./sessionStore";
import { useLayoutStore } from "./layoutStore";

export type ActivityPanel = "files" | "git" | "search" | "settings" | "agentbus" | "analytics" | null;

/** Where the list of open terminals lives: the horizontal top-bar strip, or a
 * pop-out drawer docked to the right edge of the canvas. User preference. */
export type TerminalListPlacement = "topbar" | "sidebar";

interface WorkspaceState {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  sidebarOpen: boolean;
  activePanel: ActivityPanel;
  terminalListPlacement: TerminalListPlacement;
  terminalDrawerOpen: boolean;
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  paneSwitcherOpen: boolean;
  newSessionDialogOpen: boolean;
  deleteConfirmId: string | null;

  setWorkspaces: (workspaces: WorkspaceInfo[]) => void;
  addWorkspace: (workspace: WorkspaceInfo) => void;
  removeWorkspace: (workspaceId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  updateWorkspace: (workspaceId: string, updates: Partial<WorkspaceInfo>) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTerminalListPlacement: (placement: TerminalListPlacement) => void;
  toggleTerminalDrawer: () => void;
  setTerminalDrawerOpen: (open: boolean) => void;
  setActivePanel: (panel: ActivityPanel) => void;
  togglePanel: (panel: ActivityPanel) => void;
  setSettingsOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setPaneSwitcherOpen: (open: boolean) => void;
  setNewSessionDialogOpen: (open: boolean) => void;
  setDeleteConfirmId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  sidebarOpen: true,
  activePanel: "files" as ActivityPanel,
  terminalListPlacement: "sidebar",
  terminalDrawerOpen: true,
  settingsOpen: false,
  commandPaletteOpen: false,
  paneSwitcherOpen: false,
  newSessionDialogOpen: false,
  deleteConfirmId: null,

  setWorkspaces: (workspaces) => set({ workspaces }),

  addWorkspace: (workspace) =>
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: workspace.id,
    })),

  removeWorkspace: (workspaceId) => {
    // No "last workspace" guard — the app handles activeWorkspaceId === null
    // and renders an empty-state asking the user to create a new workspace.
    const sessionState = useSessionStore.getState();

    // Clean up sessions and layouts belonging to this workspace
    const removedSessionIds = sessionState.removeWorkspaceSessions(workspaceId);
    const { removePaneLayout } = useLayoutStore.getState();
    for (const sid of removedSessionIds) {
      removePaneLayout(sid);
    }
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== workspaceId),
      activeWorkspaceId:
        state.activeWorkspaceId === workspaceId
          ? state.workspaces.find((w) => w.id !== workspaceId)?.id ?? null
          : state.activeWorkspaceId,
      deleteConfirmId: null,
    }));
  },

  setActiveWorkspace: (workspaceId) => set({ activeWorkspaceId: workspaceId }),

  updateWorkspace: (workspaceId, updates) =>
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, ...updates } : w,
      ),
    })),

  toggleSidebar: () => set((state) => {
    if (state.sidebarOpen) {
      return { sidebarOpen: false };
    }
    return { sidebarOpen: true, activePanel: state.activePanel ?? "files" };
  }),
  setSidebarOpen: (open) => set((state) => ({
    sidebarOpen: open,
    activePanel: open ? (state.activePanel ?? "files") : state.activePanel,
  })),
  // Switching TO the side-panel placement pops the drawer open so the user
  // immediately sees where their terminals went.
  setTerminalListPlacement: (placement) => set((state) => ({
    terminalListPlacement: placement,
    terminalDrawerOpen: placement === "sidebar" ? true : state.terminalDrawerOpen,
  })),
  toggleTerminalDrawer: () => set((state) => ({ terminalDrawerOpen: !state.terminalDrawerOpen })),
  setTerminalDrawerOpen: (open) => set({ terminalDrawerOpen: open }),
  setActivePanel: (panel) => set({
    activePanel: panel,
    sidebarOpen: panel !== null,
  }),
  togglePanel: (panel) => set((state) => {
    if (state.activePanel === panel && state.sidebarOpen) {
      return { sidebarOpen: false };
    }
    return { activePanel: panel, sidebarOpen: true };
  }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setPaneSwitcherOpen: (open) => set({ paneSwitcherOpen: open }),
  setNewSessionDialogOpen: (open) => set({ newSessionDialogOpen: open }),
  setDeleteConfirmId: (id) => set({ deleteConfirmId: id }),
}));
