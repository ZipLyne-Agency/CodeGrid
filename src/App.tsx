import { useCallback, useEffect, useMemo, useState, useRef, lazy, Suspense } from "react";
import { Canvas } from "./components/Canvas";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { TerminalSidebar } from "./components/TerminalSidebar";
import { ToastContainer } from "./components/ToastContainer";

// ── Lazy-loaded dialogs / overlays ───────────────────────────────────────
// These are heavy (Monaco-style editors, graphs, full forms) and most users
// open zero of them per session, so we ship them as separate chunks that load
// on first open. Wrapped in Suspense with a `null` fallback — the open state
// is already gated by store flags, so users never see the transition.
const CommandPalette    = lazy(() => import("./components/CommandPalette").then(m => ({ default: m.CommandPalette })));
const PaneSwitcher      = lazy(() => import("./components/PaneSwitcher").then(m => ({ default: m.PaneSwitcher })));
const NewSessionDialog  = lazy(() => import("./components/NewSessionDialog").then(m => ({ default: m.NewSessionDialog })));
const Settings          = lazy(() => import("./components/Settings").then(m => ({ default: m.Settings })));
const SkillsPanel       = lazy(() => import("./components/SkillsPanel").then(m => ({ default: m.SkillsPanel })));
const HubBrowser        = lazy(() => import("./components/HubBrowser").then(m => ({ default: m.HubBrowser })));
const GitManager        = lazy(() => import("./components/GitManager").then(m => ({ default: m.GitManager })));
const McpManager        = lazy(() => import("./components/McpManager").then(m => ({ default: m.McpManager })));
const ClaudeMdEditor    = lazy(() => import("./components/ClaudeMdEditor").then(m => ({ default: m.ClaudeMdEditor })));
const GitSetupWizard    = lazy(() => import("./components/GitSetupWizard").then(m => ({ default: m.GitSetupWizard })));
const CodeViewer        = lazy(() => import("./components/CodeViewer").then(m => ({ default: m.CodeViewer })));
const DependencyGraph   = lazy(() => import("./components/DependencyGraph").then(m => ({ default: m.DependencyGraph })));
const ReviewPanel       = lazy(() => import("./components/ReviewPanel").then(m => ({ default: m.ReviewPanel })));
const ProFeaturesModal  = lazy(() => import("./components/ProFeaturesModal").then(m => ({ default: m.ProFeaturesModal })));
const Onboarding        = lazy(() => import("./components/Onboarding").then(m => ({ default: m.Onboarding })));
const Tour              = lazy(() => import("./components/Tour").then(m => ({ default: m.Tour })));
const ResourceWarningDialog = lazy(() => import("./components/ResourceWarningDialog").then(m => ({ default: m.ResourceWarningDialog })));
import { useSessionStore } from "./stores/sessionStore";
import { sanitizeWorkspaceView, useLayoutStore } from "./stores/layoutStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useAppStore } from "./stores/appStore";
import { useToastStore } from "./stores/toastStore";

import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { useAttention } from "./hooks/useAttention";
import { useNativeMenu } from "./hooks/useNativeMenu";
import { useEntitlement } from "./hooks/useEntitlement";
import {
  createSession,
  killSession,
  createWorkspace,
  createWorkspaceWithRepo,
  getWorkspaces,
  saveLayout as saveLayoutIpc,
  spawnShellSession,
  setActiveWorkspace as setActiveWorkspaceIpc,
  listRecentProjects,
  recordRecentProject,
  removeRecentProject,
  pinRecentProject,
  rescanProjectRoots,
  detectAllSkills,
  getAvailableModels,
  checkGitSetup,
  getSetting,
  setSetting,
  getPersistedSessions,
  clearPersistedSessions,
  getSystemMemory,
  voiceToolResponse,
} from "./lib/ipc";
import { useVoiceStore, bindVoiceToWorkspaceSwitches } from "./stores/voiceStore";
import { jumpToSession } from "./lib/jumpToSession";
import { useResourceStore } from "./stores/resourceStore";
import { startAutoUpdateChecks } from "./lib/updater";
import { UpdateBanner } from "./components/UpdateBanner";

/**
 * Detect the agent/session type from a stored command string (binary path).
 * Used when restoring persisted sessions or restarting dead sessions.
 */
function detectSessionType(command: string): string {
  const cmd = (command ?? "").toLowerCase();
  if (cmd.includes("codex")) return "codex";
  if (cmd.includes("gemini")) return "gemini";
  // Cursor's CLI binary is "cursor-agent" (matches "cursor" and word "agent")
  if (cmd.includes("cursor") || /\bagent\b/.test(cmd)) return "cursor";
  if (cmd.includes("grok")) return "grok";
  if (cmd.includes("venice") || cmd.includes("openclaw")) return "venice";
  if (cmd.includes("claude")) return "claude";
  return "shell";
}

/**
 * Pan/zoom the canvas to a pane so a freshly created or restarted pane is brought
 * into view — creation only *focuses* the terminal (xterm), which does not move the
 * canvas, so without this a new pane can be placed off-screen and look "missing".
 */
function revealSession(sessionId: string, delay = 0) {
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("codegrid:zoom-to-session", { detail: { sessionId } }));
  }, delay);
}

export default function App() {
  const {
    sessions: allSessions,
    addSession,
    removeSession,
    setFocusedSession,
  } = useSessionStore();
  const { layouts, canvas, minimizedPanes, maximizedPane, addPaneLayout, removePaneLayout, setLayouts, renameLayoutId } = useLayoutStore();
  const {
    workspaces,
    activeWorkspaceId,
    setWorkspaces,
    addWorkspace,
    setActiveWorkspace,
    updateWorkspace,
    sidebarOpen,
    activePanel,
    setNewSessionDialogOpen,
  } = useWorkspaceStore();
  const { setSkills, setModels, setRecentProjects, setGitSetupWizardOpen } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const attentionCooldownRef = useRef<Record<string, number>>({});
  const initRef = useRef(false);
  const prevWarningLevelRef = useRef<string>("none");
  // Session-restore bookkeeping: only workspaces that existed at launch are
  // candidates for restore, and each is restored at most once this run (so a
  // workspace's live sessions are never double-spawned when switching back).
  const startupWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const restoredWorkspacesRef = useRef<Set<string>>(new Set());
  const [resourceWarningOpen, setResourceWarningOpen] = useState(false);
  const [pendingSession, setPendingSession] = useState<{
    workingDir: string;
    useWorktree: boolean;
    resume: boolean;
    isShell: boolean;
    sessionType?: string;
  } | null>(null);

  useEffect(() => {
    // Background update checks: shortly after launch, then on an interval.
    const stop = startAutoUpdateChecks();
    return stop;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  // Sessions for the active workspace (used by broadcast routing, etc.)
  const sessions = useMemo(
    () => allSessions.filter((s) => s.workspace_id === activeWorkspaceId),
    [allSessions, activeWorkspaceId],
  );

  useKeyboardNav();
  useAttention();
  useNativeMenu();
  useEntitlement();

  // First-run onboarding (and re-openable via Help → Getting Started), plus
  // the post-onboarding spotlight tour over the real UI.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    getSetting("onboarded")
      .then((v) => { if (v !== "true") setShowOnboarding(true); })
      .catch(() => {});
    const reopen = () => setShowOnboarding(true);
    const startTour = () => setShowTour(true);
    window.addEventListener("codegrid:show-onboarding", reopen);
    window.addEventListener("codegrid:start-tour", startTour);
    return () => {
      window.removeEventListener("codegrid:show-onboarding", reopen);
      window.removeEventListener("codegrid:start-tour", startTour);
    };
  }, []);

  const finishOnboarding = useCallback((action: "none" | "project" | "tour") => {
    setShowOnboarding(false);
    setSetting("onboarded", "true").catch(() => {});
    if (action === "project") useWorkspaceStore.getState().setNewSessionDialogOpen(true);
    if (action === "tour") setShowTour(true);
  }, []);

  // Self-heal session↔layout desync: any session in the active workspace that
  // lacks a layout entry gets one, so a session can never become a "ghost tab"
  // (a tab whose pane is parked off-screen because it has no canvas slot).
  useEffect(() => {
    if (!activeWorkspaceId) return;
    const layoutIds = new Set(layouts.map((l) => l.i));
    const orphans = allSessions.filter(
      (s) =>
        s.workspace_id === activeWorkspaceId &&
        !layoutIds.has(s.id) &&
        // A minimized pane intentionally has no canvas layout — don't "heal" it
        // back onto the canvas (that would duplicate it and lose the minimized chip).
        !minimizedPanes[s.id],
    );
    for (const s of orphans) addPaneLayout(s.id);
  }, [allSessions, layouts, minimizedPanes, activeWorkspaceId, addPaneLayout]);

  // Re-spawn the terminals a workspace had at last close, in their saved dirs.
  // Agents are launched with `--continue` so Claude picks up the prior
  // conversation rather than starting cold. Guarded so each workspace restores
  // at most once and only workspaces present at launch are eligible — switching
  // between workspaces never re-spawns sessions that are already live.
  const restoreSessionsForWorkspace = useCallback(async (wsId: string) => {
    if (restoredWorkspacesRef.current.has(wsId)) return;
    if (!startupWorkspaceIdsRef.current.has(wsId)) return;
    restoredWorkspacesRef.current.add(wsId);
    try {
      const persisted = await getPersistedSessions(wsId);
      if (persisted.length === 0) return;
      console.log(`[CodeGrid] Restoring ${persisted.length} session(s) for workspace ${wsId}`);
      const idRemap = new Map<string, string>();
      for (const old of persisted) {
        try {
          if (old.command === "browser") continue; // legacy panes are not restorable
          const sessionType = detectSessionType(old.command);
          const isShell = sessionType === "shell";
          let restored;
          try {
            if (isShell) {
              restored = await spawnShellSession(old.working_dir, wsId);
            } else {
              // continueSession=true → `claude --continue` resumes the prior convo
              restored = await createSession(old.working_dir, wsId, false, false, sessionType as any, true);
            }
          } catch (sessionErr) {
            addToast(`Couldn't restore a session in ${old.working_dir} — folder may no longer exist`, "error");
            throw sessionErr;
          }
          if (old.name) {
            restored.name = old.name;
            import("./lib/ipc").then(({ renameSession }) =>
              renameSession(restored!.id, old.name!).catch(() => {})
            );
          }
          addSession(restored);
          const hasSavedLayout = useLayoutStore.getState().layouts.some((l) => l.i === old.id);
          if (hasSavedLayout) {
            idRemap.set(old.id, restored.id);
          } else {
            addPaneLayout(restored.id);
          }
        } catch (e) {
          console.warn(`[CodeGrid] Failed to restore session ${old.id}:`, e);
        }
      }
      // Remap saved layout slots from old → new session ids so each restored
      // pane keeps its position, and drop any slot whose session never came back
      // (deleted folder, skipped legacy browser) so it doesn't linger as a phantom.
      const liveIds = new Set(useSessionStore.getState().sessions.map((s) => s.id));
      setLayouts(
        useLayoutStore.getState().layouts
          .map((l) => (idRemap.has(l.i) ? { ...l, i: idRemap.get(l.i)! } : l))
          .filter((l) => liveIds.has(l.i))
      );
      clearPersistedSessions(wsId, persisted.map((s) => s.id)).catch((e) =>
        console.warn("Failed to clear old persisted sessions:", e)
      );
    } catch (e) {
      console.warn("Failed to restore persisted sessions:", e);
    }
  }, [addToast, addSession, addPaneLayout, setLayouts]);

  // Lazily restore a workspace's sessions the first time it becomes active
  // (e.g. via Cmd+Tab) after a relaunch — so every workspace comes back, not
  // just the one that was active at close.
  useEffect(() => {
    const handler = (e: Event) => {
      const wsId = (e as CustomEvent).detail?.workspaceId;
      if (wsId) void restoreSessionsForWorkspace(wsId);
    };
    window.addEventListener("codegrid:workspace-changed", handler);
    return () => window.removeEventListener("codegrid:workspace-changed", handler);
  }, [restoreSessionsForWorkspace]);

  // Initialize app: workspace, skills, models, recent dirs
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const init = async () => {
      // Load workspaces
      let isFirstLaunch = false;
      try {
        const existing = await getWorkspaces();
        isFirstLaunch = existing.length === 0;
        startupWorkspaceIdsRef.current = new Set(existing.map((w) => w.id));
        if (existing.length > 0) {
          setWorkspaces(existing);
          const active = existing.find((w) => w.is_active) ?? existing[0];
          setActiveWorkspace(active.id);
          // Restore the full saved view (layouts + pan/zoom + minimized/maximized).
          useLayoutStore.getState().applyWorkspaceView(sanitizeWorkspaceView(active.layout_json));

          // Restore the active workspace's sessions from the previous launch.
          // Other workspaces restore lazily on first switch (see the
          // workspace-changed listener above).
          await restoreSessionsForWorkspace(active.id);
        } else {
          const ws = await createWorkspace("Default");
          addWorkspace(ws);
          try { await setActiveWorkspaceIpc(ws.id); } catch {}
        }
      } catch {
        const mockWs = {
          id: "mock-workspace", name: "Default", layout_json: null,
          created_at: new Date().toISOString(), is_active: true, repo_path: null,
        };
        setWorkspaces([mockWs]);
        setActiveWorkspace(mockWs.id);
      }

      // Load skills (all agents)
      try { const skills = await detectAllSkills(); setSkills(skills); } catch (e) { console.warn("Failed to load skills:", e); }

      // Load models
      try { const models = await getAvailableModels(); setModels(models); } catch (e) { console.warn("Failed to load models:", e); }

      // Load recent dirs
      try { const projects = await listRecentProjects(); setRecentProjects(projects); } catch (e) { console.warn("Failed to load recent projects:", e); }

      // Restore persisted terminal preferences (zoom + cursor)
      try {
        const [fs, cs, cb] = await Promise.all([
          getSetting("terminal_font_size"),
          getSetting("terminal_cursor_style"),
          getSetting("terminal_cursor_blink"),
        ]);
        const n = fs ? parseInt(fs, 10) : NaN;
        if (!Number.isNaN(n)) useAppStore.getState().setTerminalFontSize(n);
        if (cs === "bar" || cs === "block" || cs === "underline") useAppStore.getState().setTerminalCursorStyle(cs);
        if (cb === "true" || cb === "false") useAppStore.getState().setTerminalCursorBlink(cb === "true");
      } catch { /* defaults */ }

      // Restore where the terminal list lives (top bar vs. pop-out drawer).
      try {
        const placement = await getSetting("terminal_list_placement");
        if (placement === "sidebar" || placement === "topbar") {
          // Set directly — setTerminalListPlacement pops the drawer open as a
          // "look where your terminals went" affordance, which we don't want
          // on a silent launch-time restore.
          useWorkspaceStore.setState({ terminalListPlacement: placement });
        }
      } catch { /* default: topbar */ }

      // Show Git Setup Wizard on first launch (no workspaces existed) OR if not fully configured
      try {
        const gitStatus = await checkGitSetup();
        if (isFirstLaunch || !gitStatus.gh_authenticated) {
          setGitSetupWizardOpen(true);
        }
      } catch (e) { console.warn("Failed to check git setup:", e); }
    };
    init();
  }, []);

  // Track container dimensions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Persist layout (including empty layouts so closing all sessions clears saved state)
  const layoutFlushRef = useRef<{ workspaceId: string; json: string } | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId) return;
    // Persist the FULL view so a workspace round-trip keeps minimized/maximized
    // panes too (not just layouts + pan/zoom).
    const layoutJson = JSON.stringify({ layouts, canvas, minimizedPanes, maximizedPane });
    // Keep workspace store in sync so workspace switching can read current layout
    updateWorkspace(activeWorkspaceId, { layout_json: layoutJson });
    layoutFlushRef.current = { workspaceId: activeWorkspaceId, json: layoutJson };
    const timer = setTimeout(() => {
      saveLayoutIpc(activeWorkspaceId, layoutJson).catch(() => {});
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [layouts, canvas, minimizedPanes, maximizedPane, activeWorkspaceId, updateWorkspace]);
  // Flush latest layout on workspace switch or unmount
  useEffect(() => {
    return () => {
      const pending = layoutFlushRef.current;
      if (pending) {
        saveLayoutIpc(pending.workspaceId, pending.json).catch(() => {});
      }
    };
  }, [activeWorkspaceId]);
  // Flush synchronously when the app is quitting. The Rust close handler emits
  // this before the quit dialog / window.destroy(), which otherwise tears down the
  // webview before the 1s debounced save (or unmount cleanup) can run — losing any
  // layout edits made in the last second.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("codegrid:flush-before-quit", () => {
        const pending = layoutFlushRef.current;
        if (pending) saveLayoutIpc(pending.workspaceId, pending.json).catch(() => {});
      }).then((un) => { unlisten = un; }).catch(() => {});
    });
    return () => { unlisten?.(); };
  }, []);

  // Broadcast input routing (only to sessions in the active workspace).
  // Reads fresh state on each event so a workspace switch can't leave the handler
  // broadcasting to the previous workspace's panes via a stale closure.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      const live = useSessionStore.getState().sessions.filter((s) => s.workspace_id === wsId);
      for (const session of live) {
        window.dispatchEvent(new CustomEvent("codegrid:broadcast-write", { detail: { sessionId: session.id, data: detail.data } }));
      }
    };
    window.addEventListener("codegrid:broadcast-input", handler);
    return () => window.removeEventListener("codegrid:broadcast-input", handler);
  }, []);

  // Cross-terminal attention toasts (approval/input requests).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; reason?: string }>).detail;
      if (!detail?.sessionId || !detail.reason) return;

      const now = Date.now();
      const last = attentionCooldownRef.current[detail.sessionId] ?? 0;
      if (now - last < 12000) return;
      attentionCooldownRef.current[detail.sessionId] = now;

      const all = useSessionStore.getState().sessions;
      const target = all.find((s) => s.id === detail.sessionId);
      const pane = target ? `[${target.pane_number}]` : `#${detail.sessionId.slice(0, 6)}`;
      addToast(`${pane} ${detail.reason}`, "warning", 7000);
    };

    window.addEventListener("codegrid:session-attention", handler);
    return () => window.removeEventListener("codegrid:session-attention", handler);
  }, [addToast]);

  // Memory polling — fetch system memory every 30s and feed into resource store
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const info = await getSystemMemory();
        if (!cancelled) useResourceStore.getState().updateMemory(info);
      } catch (e) {
        console.warn("Failed to poll system memory:", e);
      }
    };
    poll(); // immediate first poll
    const interval = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Session count tracking — count shells vs agents and update resource store
  useEffect(() => {
    const agentKeywords = ["claude", "codex", "gemini", "cursor", "agent", "grok", "venice", "openclaw"];
    let shellCount = 0;
    let agentCount = 0;
    for (const s of allSessions) {
      // Notes, browser/preview, and the scratch container are NOT PTYs — don't
      // count them. (Scratch child PTYs are managed outside the store.)
      if (s.kind === "note" || s.kind === "browser" || s.kind === "scratch") continue;
      const cmd = (s.command ?? "").toLowerCase();
      if (agentKeywords.some((kw) => cmd.includes(kw))) {
        agentCount++;
      } else {
        shellCount++;
      }
    }
    useResourceStore.getState().updateSessionCounts(shellCount, agentCount);
  }, [allSessions]);

  // Soft warning toast when warningLevel transitions to "soft"
  useEffect(() => {
    const unsub = useResourceStore.subscribe((state) => {
      const level = state.warningLevel;
      if (level === "soft" && prevWarningLevelRef.current !== "soft") {
        addToast("System memory is running low. Consider closing unused sessions.", "warning", 8000);
      }
      prevWarningLevelRef.current = level;
    });
    return unsub;
  }, [addToast]);

  // New workspace events
  useEffect(() => {
    const handler = async () => {
      try {
        const ws = await createWorkspace(`Workspace ${workspaces.length + 1}`);
        addWorkspace(ws);
        try { await setActiveWorkspaceIpc(ws.id); } catch {}
      } catch (e) { addToast(`Failed to create workspace: ${e}`, "error"); }
    };
    window.addEventListener("codegrid:new-workspace", handler);
    return () => window.removeEventListener("codegrid:new-workspace", handler);
  }, [workspaces.length, addWorkspace, addToast]);

  // New workspace with repo event
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      try {
        const ws = await createWorkspaceWithRepo(detail.name, detail.repoPath);
        addWorkspace(ws);
        try { await setActiveWorkspaceIpc(ws.id); } catch {}
        if (detail.repoPath) {
          try { await recordRecentProject(detail.repoPath); const p = await listRecentProjects(); setRecentProjects(p); } catch {}
        }
        addToast(`Workspace "${ws.name}" created`, "success");
      } catch (err) {
        addToast(`Failed to create workspace: ${err}`, "error");
      }
    };
    window.addEventListener("codegrid:new-workspace-with-repo", handler);
    return () => window.removeEventListener("codegrid:new-workspace-with-repo", handler);
  }, [addWorkspace, addToast]);

  const handleCreateSession = useCallback(
    async (workingDir: string, useWorktree: boolean, resume: boolean, isShell: boolean, sessionType?: string) => {
      if (!activeWorkspaceId) return;

      // Unlimited: never block creation. Surface a non-blocking advisory only
      // when memory is critically low.
      const resCheck = useResourceStore.getState().canCreateTerminal();
      if (resCheck.reason) {
        addToast(resCheck.reason, "warning", 4000);
      }

      try {
        let session;
        if (isShell || sessionType === "shell") {
          session = await spawnShellSession(workingDir, activeWorkspaceId);
        } else {
          session = await createSession(workingDir, activeWorkspaceId, useWorktree, resume, (sessionType ?? "claude") as any);
        }
        addSession(session);
        addPaneLayout(session.id, { nearSessionId: mostRecentTerminalId(activeWorkspaceId ?? "") });
        setFocusedSession(session.id);

        // Recents are action-driven: record every opened folder so the launch
        // screen reflects what the user actually opened (not a filesystem scan).
        if (workingDir) {
          recordRecentProject(workingDir)
            .then(() => listRecentProjects())
            .then(setRecentProjects)
            .catch(() => {});
        }

        // Auto-name workspace after the repo/folder if it has a generic name
        const ws = useWorkspaceStore.getState().workspaces.find(w => w.id === activeWorkspaceId);
        if (ws && /^(Default|Workspace \d+)$/i.test(ws.name)) {
          const folderName = workingDir.split("/").pop() ?? workingDir;
          useWorkspaceStore.getState().updateWorkspace(activeWorkspaceId, { name: folderName });
          import("./lib/ipc").then(({ renameWorkspace }) => renameWorkspace(activeWorkspaceId, folderName).catch(() => {}));
        }
        revealSession(session.id);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } }));
        }, 200);
      } catch (e) {
        addToast(`Failed to create session: ${e}`, "error");
      }
    },
    [activeWorkspaceId, addSession, addPaneLayout, setFocusedSession, addToast],
  );

  // Quick session from Hub
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const isShell = detail.type === "shell";
      const sessionType = !isShell && detail.type ? detail.type : undefined;
      handleCreateSession(detail.path, false, false, isShell, sessionType);
    };
    window.addEventListener("codegrid:quick-session", handler);
    return () => window.removeEventListener("codegrid:quick-session", handler);
  }, [handleCreateSession]);

  // ── Synthetic-session helpers (browser / note) ──
  // These don't go through Rust's create_session (no PTY, no DB row). We mint a
  // stable id, push a fake SessionInfo into the store, and let the layout
  // system handle positioning like any other pane.
  const nextSyntheticPaneNumber = useCallback(
    (workspaceId: string) => {
      const used = new Set(
        useSessionStore.getState().sessions
          .filter((s) => s.workspace_id === workspaceId)
          .map((s) => s.pane_number),
      );
      let n = 1;
      while (used.has(n)) n++;
      return n;
    },
    [],
  );

  /**
   * Find the most recently used terminal in the active workspace. New browser /
   * note panes anchor next to this so they land in the user's current context
   * instead of in a random corner of the canvas.
   */
  const mostRecentTerminalId = useCallback(
    (workspaceId: string): string | undefined => {
      const state = useSessionStore.getState();
      const candidates = state.sessions
        .filter((s) =>
          s.workspace_id === workspaceId &&
          (s.kind ?? "terminal") === "terminal" &&
          s.status !== "dead",
        )
        .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
      // Prefer the focused session if it's a terminal in this workspace.
      const focused = candidates.find((s) => s.id === state.focusedSessionId);
      return (focused ?? candidates[0])?.id;
    },
    [],
  );

  const handleCreateBrowserPane = useCallback(
    (rawUrl: string, focusUrl: boolean = false) => {
      if (!activeWorkspaceId) return;
      const url = (() => {
        const t = rawUrl.trim();
        if (!t) return ""; // empty → show the start screen
        if (/^https?:\/\//i.test(t)) return t;
        const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)(:\d+)?(\/|$)/i.test(t);
        return (local ? "http://" : "https://") + t;
      })();

      const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Browser panes need more screen real estate than a terminal — pages
      // designed for 1024+ width get cramped at 600. Bump the slot once it's
      // placed.
      setTimeout(() => {
        const layout = useLayoutStore.getState().layouts.find((l) => l.i === id);
        if (layout) {
          useLayoutStore.getState().updatePaneLayout(id, {
            w: Math.max(layout.w, 1000),
            h: Math.max(layout.h, 720),
          });
        }
      }, 0);
      if (focusUrl) {
        // Defer until after the pane mounts. The chrome bar listens for this.
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("codegrid:focus-browser-url", { detail: { sessionId: id } }),
          );
        }, 120);
      }
      const synthetic = {
        id,
        workspace_id: activeWorkspaceId,
        working_dir: url,
        command: "browser",
        git_branch: null,
        status: "idle" as const,
        created_at: new Date().toISOString(),
        pane_number: nextSyntheticPaneNumber(activeWorkspaceId),
        worktree_path: null,
        name: null,
        kind: "browser" as const,
        browserUrl: url,
      };
      addSession(synthetic);
      addPaneLayout(id, { nearSessionId: mostRecentTerminalId(activeWorkspaceId) });
      setFocusedSession(id);
      // Reveal after the slot is resized to its larger browser dimensions.
      revealSession(id, 16);
    },
    [activeWorkspaceId, addSession, addPaneLayout, setFocusedSession, nextSyntheticPaneNumber, mostRecentTerminalId],
  );

  const handleCreateNote = useCallback(
    (opts?: { pinnedTo?: string; seedText?: string; color?: string }) => {
      if (!activeWorkspaceId) return;
      const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const synthetic = {
        id,
        workspace_id: activeWorkspaceId,
        working_dir: "",
        command: "note",
        git_branch: null,
        status: "idle" as const,
        created_at: new Date().toISOString(),
        pane_number: nextSyntheticPaneNumber(activeWorkspaceId),
        worktree_path: null,
        name: null,
        kind: "note" as const,
        noteText: opts?.seedText ?? "",
        noteColor: opts?.color ?? "#ffab00",
        notePinnedTo: opts?.pinnedTo,
      };
      addSession(synthetic);
      addPaneLayout(id, { nearSessionId: opts?.pinnedTo ?? mostRecentTerminalId(activeWorkspaceId) });
      setFocusedSession(id);
      revealSession(id);
      // Persist immediately so the file exists even before the user types.
      import("./lib/ipc").then(({ notesWrite }) => {
        const layout = useLayoutStore.getState().layouts.find((l) => l.i === id);
        notesWrite(
          {
            id,
            workspace_id: activeWorkspaceId,
            title: null,
            color: synthetic.noteColor!,
            x: layout?.x ?? 0,
            y: layout?.y ?? 0,
            w: layout?.w ?? 320,
            h: layout?.h ?? 280,
            pinned_to: opts?.pinnedTo ?? null,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          synthetic.noteText!,
        ).catch(() => {});
      });
    },
    [activeWorkspaceId, addSession, addPaneLayout, setFocusedSession, nextSyntheticPaneNumber, mostRecentTerminalId],
  );

  // A scratch pane: a throwaway terminal that is deliberately DETACHED from the
  // project — it opens in $HOME, its PTYs are isolated from the project workspace
  // (hidden from the agent-bus, never persisted), like a fresh terminal on your
  // machine. The pane lives on the canvas but `working_dir` is left empty so
  // ScratchPane resolves $HOME. The pane itself is synthetic (no PTY); ScratchPane
  // spawns/kills the per-provider PTYs internally.
  const handleCreateScratchPane = useCallback((targetWorkspaceId?: string) => {
    const wsId = targetWorkspaceId ?? activeWorkspaceId;
    if (!wsId) return;
    const id = `scratch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const synthetic = {
      id,
      workspace_id: wsId,
      working_dir: "", // empty → ScratchPane runs its shells/agents in $HOME, not the project
      command: "scratch",
      git_branch: null,
      status: "idle" as const,
      created_at: new Date().toISOString(),
      pane_number: nextSyntheticPaneNumber(wsId),
      worktree_path: null,
      name: null,
      kind: "scratch" as const,
    };
    addSession(synthetic);
    addPaneLayout(id, { nearSessionId: mostRecentTerminalId(wsId) });
    setFocusedSession(id);
    revealSession(id);
  }, [activeWorkspaceId, addSession, addPaneLayout, setFocusedSession, nextSyntheticPaneNumber, mostRecentTerminalId]);

  // A scratchpad workspace: a project-less sandbox that holds only scratch
  // terminals (no repo, no file tree). We create the workspace, make it active,
  // then seed one scratch terminal so it's immediately usable. Like every scratch
  // terminal it runs detached in $HOME and is intentionally ephemeral.
  const handleCreateScratchWorkspace = useCallback(async () => {
    try {
      const existing = workspaces.filter((w) => /^Scratchpad/.test(w.name)).length;
      const name = existing > 0 ? `Scratchpad ${existing + 1}` : "Scratchpad";
      const ws = await createWorkspace(name);
      addWorkspace(ws); // sets it active in the store
      try { await setActiveWorkspaceIpc(ws.id); } catch {}
      handleCreateScratchPane(ws.id);
    } catch (e) {
      addToast(`Failed to create scratchpad: ${e}`, "error");
    }
  }, [workspaces, addWorkspace, addToast, handleCreateScratchPane]);

  // Window-level events so the command palette, top bar, and dialogs can create these.
  useEffect(() => {
    const onBrowser = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; focusUrl?: boolean }>).detail;
      handleCreateBrowserPane(detail?.url ?? "", !!detail?.focusUrl);
    };
    const onNote = (e: Event) => {
      const detail = (e as CustomEvent<{ seedText?: string; pinnedTo?: string }>).detail;
      handleCreateNote({ seedText: detail?.seedText, pinnedTo: detail?.pinnedTo });
    };
    const onScratch = () => handleCreateScratchPane();
    const onScratchWorkspace = () => { void handleCreateScratchWorkspace(); };
    window.addEventListener("codegrid:new-browser-pane", onBrowser);
    window.addEventListener("codegrid:new-note-pane", onNote);
    window.addEventListener("codegrid:new-scratch-pane", onScratch);
    window.addEventListener("codegrid:new-scratch-workspace", onScratchWorkspace);
    return () => {
      window.removeEventListener("codegrid:new-browser-pane", onBrowser);
      window.removeEventListener("codegrid:new-note-pane", onNote);
      window.removeEventListener("codegrid:new-scratch-pane", onScratch);
      window.removeEventListener("codegrid:new-scratch-workspace", onScratchWorkspace);
    };
  }, [handleCreateBrowserPane, handleCreateNote, handleCreateScratchPane, handleCreateScratchWorkspace]);

  // ⇧⌘J (new scratch pane) is registered centrally in useKeyboardNav via the
  // keybindings table → dispatches "codegrid:new-scratch-pane", handled above.

  // Restore notes from disk on first workspace activation. Browser panes are
  // ephemeral (the WKWebView dies on app close) so we don't try to restore them.
  const restoredNotesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (restoredNotesRef.current.has(activeWorkspaceId)) return;
    restoredNotesRef.current.add(activeWorkspaceId);
    (async () => {
      try {
        const { notesList } = await import("./lib/ipc");
        const notes = await notesList(activeWorkspaceId);
        if (notes.length === 0) return;
        const existing = new Set(
          useSessionStore.getState().sessions.map((s) => s.id),
        );
        const existingPanes = new Set(
          useSessionStore.getState().sessions
            .filter((s) => s.workspace_id === activeWorkspaceId)
            .map((s) => s.pane_number),
        );
        let nextPane = 1;
        const pickPane = () => {
          while (existingPanes.has(nextPane)) nextPane++;
          existingPanes.add(nextPane);
          return nextPane++;
        };
        for (const n of notes) {
          if (existing.has(n.id)) continue;
          const synthetic = {
            id: n.id,
            workspace_id: n.workspace_id,
            working_dir: "",
            command: "note",
            git_branch: null,
            status: "idle" as const,
            created_at: new Date(n.created_at).toISOString(),
            pane_number: pickPane(),
            worktree_path: null,
            name: n.title,
            kind: "note" as const,
            noteText: n.text,
            noteColor: n.color || "#ffab00",
            notePinnedTo: n.pinned_to ?? undefined,
            manualName: n.title ?? undefined,
          };
          useSessionStore.getState().addSession(synthetic);
          // Add a layout entry if the saved one didn't survive.
          const hasLayout = useLayoutStore.getState().layouts.some((l) => l.i === n.id);
          if (!hasLayout) {
            useLayoutStore.getState().addPaneLayout(n.id);
            // If meta has saved geometry, apply it.
            if (n.x || n.y || n.w || n.h) {
              useLayoutStore.getState().updatePaneLayout(n.id, {
                x: n.x, y: n.y, w: n.w || 320, h: n.h || 280,
              });
            }
          }
        }
      } catch (e) {
        console.warn("[CodeGrid] notes restore failed:", e);
      }
    })();
  }, [activeWorkspaceId]);


  // ── Localhost auto-detect ──────────────────────────────────────────
  // Watch all PTY output for URLs that look like dev servers, and surface
  // a one-shot toast offering to open them in a browser pane. Cmux ships
  // this pattern; Warp issue #2164 is "the most asked-for feature."
  useEffect(() => {
    const recentBuffers = new Map<string, string>();
    const dedupe = new Map<string, number>(); // `${sessionId}|${url}` → expiresAt
    const URL_RE =
      /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d{2,5})?(?:\/[^\s\]]*)?/gi;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { onPtyOutput } = await import("./lib/ipc");
      if (cancelled) return;
      unlisten = await onPtyOutput((data) => {
        // Decode just enough for the regex; PTY data may contain ANSI escapes.
        let chunk: string;
        try {
          chunk = new TextDecoder("utf-8", { fatal: false }).decode(
            new Uint8Array(data.data),
          );
        } catch {
          return;
        }
        // Strip ANSI escape sequences so they don't break URL matching.
        chunk = chunk.replace(/\[[0-9;?]*[A-Za-z]/g, "");

        const prev = recentBuffers.get(data.session_id) ?? "";
        const merged = (prev + chunk).slice(-4096);
        recentBuffers.set(data.session_id, merged);

        const now = Date.now();
        let m: RegExpExecArray | null;
        URL_RE.lastIndex = 0;
        while ((m = URL_RE.exec(merged)) !== null) {
          const rawUrl = m[0].replace(/[.,;:)\]"'>]+$/, "");
          // Require an actual port — bare `http://localhost/` is too noisy.
          if (!/:\d+/.test(rawUrl)) continue;
          const key = `${data.session_id}|${rawUrl}`;
          const exp = dedupe.get(key) ?? 0;
          if (exp > now) continue;
          dedupe.set(key, now + 5 * 60_000); // 5 min cool-down per session+url
          const fire = () => {
            useToastStore.getState().addToast(
              `Dev server detected → ${rawUrl}`,
              "info",
              10_000,
              {
                label: "OPEN",
                onClick: () => {
                  window.dispatchEvent(
                    new CustomEvent("codegrid:new-browser-pane", {
                      detail: { url: rawUrl },
                    }),
                  );
                },
              },
            );
          };
          // Small debounce so the regex catches the full "Local: http://..."
          // line rather than firing on the first half mid-print.
          setTimeout(fire, 400);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for JSON-RPC commands from Unix socket
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      unlisten1 = await listen<string>("rpc:open-folder", (e) => {
        handleCreateSession(e.payload, false, false, false);
      });
      unlisten2 = await listen<string>("rpc:new-session", (e) => {
        handleCreateSession(e.payload, false, false, false);
      });
    })();

    return () => {
      cancelled = true;
      unlisten1?.();
      unlisten2?.();
    };
  }, [handleCreateSession]);

  // ── CodeGrid Voice: Rust session events → store; spawn/focus round-trips ──
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      const voice = () => useVoiceStore.getState();

      unlistens.push(
        await listen<{ status: string; detail: string | null }>("voice-status", (e) => {
          voice().applyStatus(e.payload.status as any, e.payload.detail ?? null);
        }),
        await listen<{ role: "user" | "assistant"; text: string; final: boolean }>(
          "voice-transcript",
          (e) => voice().applyTranscript(e.payload),
        ),
        await listen<any>("voice-tool-call", (e) => voice().applyToolCall(e.payload)),
        await listen<{ paused: boolean }>("voice-mic", (e) => voice().applyMic(e.payload.paused)),

        // "Show me the Codex pane" — reuse the canonical reveal path.
        await listen<{ sessionId: string }>("voice-focus-pane", (e) => {
          jumpToSession(e.payload.sessionId);
        }),

        // close_agent: Rust killed the PTY; drop the pane from the canvas too
        // (mirrors what the manual close button does after killSession).
        await listen<{ sessionId: string }>("voice-close-pane", (e) => {
          removeSession(e.payload.sessionId);
          removePaneLayout(e.payload.sessionId);
        }),

        // Rust-side idle settler flipped a pane (it detects "agent done" even
        // while this webview's timers are throttled in the background) — keep
        // the store in sync so tab dots don't lag until refocus.
        await listen<{ sessionId: string; status: string }>("session-status-changed", (e) => {
          useSessionStore.getState().updateSession(e.payload.sessionId, { status: e.payload.status as any });
        }),

        // Max writing a note / opening a preview — reuse the exact paths the
        // "+ New" menu uses (notes and browser panes are React-owned synthetics).
        await listen<{ seedText: string }>("voice-create-note", (e) => {
          window.dispatchEvent(new CustomEvent("codegrid:new-note-pane", { detail: { seedText: e.payload.seedText } }));
        }),
        await listen<{ url: string }>("voice-open-browser", (e) => {
          window.dispatchEvent(new CustomEvent("codegrid:new-browser-pane", { detail: { url: e.payload.url } }));
        }),

        // spawn_agent round-trip: pane layout lives here, so Rust asks us to
        // create the session and ship the SessionInfo back via voice_tool_response.
        await listen<{
          requestId: string;
          workspaceId: string;
          agentType: string;
          workingDir?: string | null;
        }>("voice-spawn-agent", (e) => {
          const { requestId, workspaceId, agentType, workingDir } = e.payload;
          void (async () => {
            try {
              const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
              const dir =
                workingDir ||
                ws?.repo_path ||
                useSessionStore.getState().sessions.find(
                  (s) => s.workspace_id === workspaceId && s.status !== "dead",
                )?.working_dir;
              if (!dir) {
                await voiceToolResponse(requestId, {
                  error: "No working directory — open a project in this workspace first.",
                });
                return;
              }
              const session =
                agentType === "shell"
                  ? await spawnShellSession(dir, workspaceId)
                  : await createSession(dir, workspaceId, false, false, agentType as any);
              addSession(session);
              if (workspaceId === useWorkspaceStore.getState().activeWorkspaceId) {
                addPaneLayout(session.id, { nearSessionId: mostRecentTerminalId(workspaceId) });
                setFocusedSession(session.id);
                revealSession(session.id);
              }
              await voiceToolResponse(requestId, session);
            } catch (err) {
              await voiceToolResponse(requestId, { error: String(err) }).catch(() => {});
            }
          })();
        }),
      );
    })();

    const unbindWs = bindVoiceToWorkspaceSwitches();
    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
      unbindWs();
    };
  }, [addSession, addPaneLayout, setFocusedSession, mostRecentTerminalId, removeSession, removePaneLayout]);

  // Restart a dead/restored session — replaces the dead entry with a live one
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        sessionId: string; workingDir: string; workspaceId: string;
        isShell: boolean; resume: boolean; sessionType?: string;
      };
      try {
        // Capture the dead session's name and layout position before removing it
        const deadSession = useSessionStore.getState().sessions.find((s) => s.id === detail.sessionId);
        const savedName = deadSession?.manualName ?? deadSession?.name ?? undefined;
        const oldLayout = useLayoutStore.getState().layouts.find((l) => l.i === detail.sessionId);

        // Remove dead session
        try { await killSession(detail.sessionId); } catch { /* already dead */ }
        removeSession(detail.sessionId);

        // Create new live session in the same workspace
        const agentType = detail.sessionType ?? (detail.isShell ? "shell" : "claude");
        const session = agentType === "shell"
          ? await spawnShellSession(detail.workingDir, detail.workspaceId)
          : await createSession(detail.workingDir, detail.workspaceId, false, detail.resume, agentType as any);

        addSession(session);
        // Swap the layout ID in-place to avoid layout shifts from remove+add.
        // renameLayoutId (not setLayouts) so we don't wipe other panes' minimized/
        // maximized state.
        if (oldLayout) {
          renameLayoutId(detail.sessionId, session.id);
        } else {
          removePaneLayout(detail.sessionId);
          addPaneLayout(session.id, { nearSessionId: mostRecentTerminalId(activeWorkspaceId ?? "") });
        }
        setFocusedSession(session.id);

        // Restore the custom name if it had one
        if (savedName) {
          useSessionStore.getState().setSessionManualName(session.id, savedName);
          import("./lib/ipc").then(({ renameSession }) =>
            renameSession(session.id, savedName).catch(() => {})
          );
        }

        revealSession(session.id, 200);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } }));
        }, 200);
      } catch (err) {
        addToast(`Failed to restart session: ${err}`, "error");
      }
    };
    window.addEventListener("codegrid:restart-session", handler);
    return () => window.removeEventListener("codegrid:restart-session", handler);
  }, [addSession, addPaneLayout, setFocusedSession, removeSession, removePaneLayout, renameLayoutId, addToast]);

  // Listen for "open terminal in directory" events from the file tree context menu
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { workingDir: string };
      if (!activeWorkspaceId) return;
      try {
        const session = await spawnShellSession(detail.workingDir, activeWorkspaceId);
        addSession(session);
        addPaneLayout(session.id, { nearSessionId: mostRecentTerminalId(activeWorkspaceId ?? "") });
        setFocusedSession(session.id);
        revealSession(session.id);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } }));
        }, 200);
      } catch (err) {
        addToast(`Failed to open terminal: ${err}`, "error");
      }
    };
    window.addEventListener("codegrid:open-terminal", handler);
    return () => window.removeEventListener("codegrid:open-terminal", handler);
  }, [addSession, addPaneLayout, setFocusedSession, addToast, activeWorkspaceId]);

  const [closeConfirm, setCloseConfirm] = useState<{ id: string; name: string } | null>(null);
  // Escape cancels the close-terminal confirm (consistent with every other dialog).
  useEffect(() => {
    if (!closeConfirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setCloseConfirm(null); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closeConfirm]);

  const performCloseSession = useCallback(
    async (sessionId: string) => {
      // Look up the session BEFORE we remove it, so we know if we need to do
      // browser/note-specific cleanup vs a PTY kill.
      const closing = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      const kind = closing?.kind ?? "terminal";
      const workspaceId = closing?.workspace_id;

      removeSession(sessionId);
      removePaneLayout(sessionId);

      if (kind === "terminal") {
        try { await killSession(sessionId); } catch (e) { console.warn("Failed to kill session:", e); }
      } else if (kind === "browser") {
        // Browser panes are pure React iframes — nothing to clean up server-side.
      } else if (kind === "note" && workspaceId) {
        try {
          const { notesDelete } = await import("./lib/ipc");
          await notesDelete(workspaceId, sessionId);
        } catch (e) { console.warn("Failed to delete note:", e); }
      }
      // Scratch panes: ScratchPane kills its own child PTYs on unmount.
    },
    [removeSession, removePaneLayout],
  );

  // Closing a terminal/scratch pane asks for confirmation first (these hold a
  // live agent/PTY). Browser/note panes close immediately — they're disposable.
  const handleCloseSession = useCallback(
    (sessionId: string) => {
      const s = useSessionStore.getState().sessions.find((x) => x.id === sessionId);
      const kind = s?.kind ?? "terminal";
      const isLiveTerminal = (kind === "terminal" || kind === "scratch") && s?.status !== "dead";
      if (isLiveTerminal) {
        const name = s?.manualName ?? s?.activityName ?? (s?.working_dir?.split("/").pop() || "this terminal");
        setCloseConfirm({ id: sessionId, name });
        return;
      }
      void performCloseSession(sessionId);
    },
    [performCloseSession],
  );

  // Close session events (must be after handleCloseSession declaration)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      handleCloseSession(detail.sessionId);
    };
    window.addEventListener("codegrid:close-session", handler);
    return () => window.removeEventListener("codegrid:close-session", handler);
  }, [handleCloseSession]);

  // Force-close bypasses the per-pane confirm. Used by the Terminal Manager, which
  // is an explicit destructive surface and runs its own aggregate confirmation —
  // routing its kills through the single-slot confirm would collapse a bulk kill
  // down to one terminal.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId) void performCloseSession(detail.sessionId);
    };
    window.addEventListener("codegrid:force-close-session", handler);
    return () => window.removeEventListener("codegrid:force-close-session", handler);
  }, [performCloseSession]);

  const handleFocusSession = useCallback(
    (sessionId: string) => {
      setFocusedSession(sessionId);
      window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId } }));
    },
    [setFocusedSession],
  );

  const handleForceCreateSession = useCallback(async () => {
    setResourceWarningOpen(false);
    if (!pendingSession || !activeWorkspaceId) { setPendingSession(null); return; }
    const { workingDir, useWorktree, resume, isShell, sessionType } = pendingSession;
    setPendingSession(null);
    try {
      let session;
      if (isShell || sessionType === "shell") {
        session = await spawnShellSession(workingDir, activeWorkspaceId);
      } else {
        session = await createSession(workingDir, activeWorkspaceId, useWorktree, resume, (sessionType ?? "claude") as any);
      }
      addSession(session);
      addPaneLayout(session.id, { nearSessionId: mostRecentTerminalId(activeWorkspaceId ?? "") });
      setFocusedSession(session.id);
      revealSession(session.id);
      const ws = useWorkspaceStore.getState().workspaces.find(w => w.id === activeWorkspaceId);
      if (ws && /^(Default|Workspace \d+)$/i.test(ws.name)) {
        const folderName = workingDir.split("/").pop() ?? workingDir;
        useWorkspaceStore.getState().updateWorkspace(activeWorkspaceId, { name: folderName });
        import("./lib/ipc").then(({ renameWorkspace }) => renameWorkspace(activeWorkspaceId, folderName).catch(() => {}));
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: session.id } }));
      }, 200);
    } catch (e) {
      addToast(`Failed to create session: ${e}`, "error");
    }
  }, [pendingSession, activeWorkspaceId, addSession, addPaneLayout, setFocusedSession, addToast]);

  const gridWidth = dimensions.width;
  const gridHeight = dimensions.height;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: "#0a0a0a",
        backgroundImage: "radial-gradient(circle, #202020 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        padding: "10px",
        gap: "10px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: "10px", minHeight: 0 }}>
        <Sidebar />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "10px", minWidth: 0, minHeight: 0 }}>
        <TopBar onFocusSession={handleFocusSession} onCloseSession={handleCloseSession} />
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "hidden",
            position: "relative",
            minHeight: 0,
            borderRadius: "14px",
            border: "1px solid #2a2a2a",
            background: "rgba(12, 12, 12, 0.88)",
            boxShadow: "0 14px 36px rgba(0, 0, 0, 0.4)",
          }}
        >
          {!activeWorkspaceId && (
            <NoWorkspaceState
              onCreate={async () => {
                try {
                  const ws = await createWorkspace(`Workspace ${workspaces.length + 1}`);
                  addWorkspace(ws);
                  try { await setActiveWorkspaceIpc(ws.id); } catch {}
                } catch (e) {
                  addToast(`Failed to create workspace: ${e}`, "error");
                }
              }}
            />
          )}
          {activeWorkspaceId && sessions.length === 0 && (
            <EmptyState
              onNewSession={() => setNewSessionDialogOpen(true)}
              onCreateSession={handleCreateSession}
            />
          )}
          {allSessions.length > 0 && (
            <div style={{ position: "absolute", inset: 0, visibility: sessions.length > 0 ? "visible" : "hidden" }}>
              <Canvas width={gridWidth} height={gridHeight} onCloseSession={handleCloseSession} />
            </div>
          )}
          {/* Pop-out terminal drawer — overlays the right edge of the canvas.
              Renders only when terminalListPlacement === "sidebar". */}
          <TerminalSidebar onFocusSession={handleFocusSession} onCloseSession={handleCloseSession} />
        </div>
        </div>
      </div>

      {/* Overlays — lazy. Each opens via a store flag; Suspense never shows
          a flicker because the component renders nothing until that flag flips. */}
      <Suspense fallback={null}>
        <CommandPalette />
        <PaneSwitcher />
        <NewSessionDialog onCreateSession={handleCreateSession} />
        <Settings />
        <SkillsPanel />
        <HubBrowser />
        <GitManager />
        <McpManager />
        <ClaudeMdEditor />
        <ProFeaturesModal />
        <GitSetupWizard />
        <CodeViewer />
        <DependencyGraph />
        <ReviewPanel />
        <ResourceWarningDialog
          open={resourceWarningOpen}
          onClose={() => { setResourceWarningOpen(false); setPendingSession(null); }}
          onForceCreate={handleForceCreateSession}
        />
        {showOnboarding && <Onboarding onClose={finishOnboarding} />}
        {showTour && !showOnboarding && <Tour onClose={() => setShowTour(false)} />}
      </Suspense>
      <ToastContainer />
      <UpdateBanner />

      {/* Close-terminal confirmation */}
      {closeConfirm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 100001, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" }}
          onClick={() => setCloseConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#161616", border: "1px solid var(--border-strong)", borderRadius: 12, padding: "22px 24px", minWidth: 340, fontFamily: "var(--font-ui)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
          >
            <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Close terminal?</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 20 }}>
              <span style={{ color: "var(--text-accent)", fontWeight: 600 }}>{closeConfirm.name}</span> will be stopped and its session ended. This can't be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                autoFocus
                onClick={() => setCloseConfirm(null)}
                style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-ui)", padding: "8px 16px", borderRadius: 7, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={() => { const id = closeConfirm.id; setCloseConfirm(null); void performCloseSession(id); }}
                style={{ background: "var(--status-error)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)", padding: "8px 16px", borderRadius: 7, cursor: "pointer" }}
              >
                Close terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoWorkspaceState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        fontFamily: "var(--font-ui)",
        color: "var(--text-muted)",
        gap: 20,
        padding: 48,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          color: "var(--text-faint)",
          letterSpacing: 3,
        }}
      >
        CODEGRID
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 440, lineHeight: 1.6 }}>
        No workspaces open.
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 12, maxWidth: 440, lineHeight: 1.55 }}>
        Workspaces hold your terminals, browser previews, notes, and the canvas layout for one project.
        Create a fresh one to get started.
      </div>
      <button
        onClick={onCreate}
        style={{
          background: "var(--text-accent)",
          border: "none",
          color: "#0a0a0a",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "var(--font-ui)",
          padding: "10px 22px",
          cursor: "pointer",
          minHeight: 36,
          letterSpacing: 0.2,
        }}
      >
        + Create workspace
      </button>
    </div>
  );
}

interface EmptyStateProps {
  onNewSession: () => void;
  onCreateSession: (workingDir: string, useWorktree: boolean, resume: boolean, isShell: boolean) => Promise<void>;
}

function EmptyState({ onNewSession, onCreateSession }: EmptyStateProps) {
  const { setHubBrowserOpen, setSkillsPanelOpen, recentProjects, setRecentProjects } = useAppStore();
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);
  const addToast = useToastStore((s) => s.addToast);
  const [rescanning, setRescanning] = useState(false);
  const [showAllRecents, setShowAllRecents] = useState(false);
  const RECENTS_COLLAPSED = 8;

  // Jump straight to Settings (the Project Folders section lives on the
  // default General tab) so users can choose which folders are scanned.
  const handleOpenProjectFolders = () => setSettingsOpen(true);

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const projects = await rescanProjectRoots();
      setRecentProjects(projects);
      addToast(
        projects.length > 0
          ? `Found ${projects.length} project${projects.length === 1 ? "" : "s"}`
          : "No projects found in your configured folders",
        projects.length > 0 ? "success" : "warning",
      );
    } catch (e) {
      addToast(`Rescan failed: ${e}`, "error");
    } finally {
      setRescanning(false);
    }
  };

  const handleQuickOpen = (dir: string) => {
    window.dispatchEvent(new CustomEvent("codegrid:quick-session", { detail: { path: dir, type: "claude" } }));
  };

  const handleCreateWorkspaceFromRepo = (dir: string) => {
    const name = dir.split("/").pop() ?? "Workspace";
    window.dispatchEvent(new CustomEvent("codegrid:new-workspace-with-repo", { detail: { name, repoPath: dir } }));
  };

  const handleNewEmptyWorkspace = () => {
    window.dispatchEvent(new CustomEvent("codegrid:new-workspace"));
  };

  const handleTogglePin = async (path: string, pinned: boolean) => {
    try { await pinRecentProject(path, !pinned); setRecentProjects(await listRecentProjects()); } catch {}
  };

  const handleRemoveRecent = async (path: string) => {
    try { await removeRecentProject(path); setRecentProjects(await listRecentProjects()); } catch {}
  };

  const relativeTime = (iso: string): string => {
    // SQLite datetime('now') is UTC with a space separator.
    const ts = Date.parse(iso.replace(" ", "T") + "Z");
    if (Number.isNaN(ts)) return "";
    const secs = Math.max(0, (Date.now() - ts) / 1000);
    if (secs < 60) return "just now";
    const mins = secs / 60;
    if (mins < 60) return `${Math.floor(mins)}m ago`;
    const hrs = mins / 60;
    if (hrs < 24) return `${Math.floor(hrs)}h ago`;
    const days = hrs / 24;
    if (days < 30) return `${Math.floor(days)}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open a project folder" });
      if (selected) {
        window.dispatchEvent(new CustomEvent("codegrid:quick-session", { detail: { path: selected, type: "claude" } }));
      }
    } catch (e) {
      addToast(`Failed to open folder picker: ${e}`, "error");
    }
  };

  const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace";

  // === EMPTY STATE ===
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        fontFamily: MONO,
        color: "#555555",
        gap: "16px",
        padding: "40px",
      }}
    >
      {/* Logo */}
      <div style={{ fontSize: "48px", fontWeight: "bold", color: "#2a2a2a", letterSpacing: "4px" }}>
        CODEGRID
      </div>
      <div style={{ fontSize: "12px", color: "#666666", marginBottom: "8px" }}>
        Your AI-powered terminal workspace
      </div>

      {/* Big action button */}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "stretch" }}>
        <button
          onClick={onNewSession}
          style={{
            background: "#ff8c00", border: "none", color: "#0a0a0a",
            fontSize: "13px", fontFamily: MONO, cursor: "pointer",
            padding: "14px 28px", fontWeight: "bold", letterSpacing: "1px",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ffa040")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#ff8c00")}
        >
          START A NEW SESSION
        </button>
        <button
          onClick={handleOpenFolder}
          title="Pick any folder to open as a project"
          style={{
            background: "transparent", border: "1px solid #2a2a2a", color: "#aaaaaa",
            fontSize: "12px", fontFamily: MONO, cursor: "pointer",
            padding: "0 16px", fontWeight: "bold", letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff8c00"; e.currentTarget.style.color = "#ff8c00"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#aaaaaa"; }}
        >
          OPEN FOLDER…
        </button>
        <button
          onClick={handleNewEmptyWorkspace}
          title="Create an empty workspace not tied to any folder"
          style={{
            background: "transparent", border: "1px solid #2a2a2a", color: "#aaaaaa",
            fontSize: "12px", fontFamily: MONO, cursor: "pointer",
            padding: "0 16px", fontWeight: "bold", letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff8c00"; e.currentTarget.style.color = "#ff8c00"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#aaaaaa"; }}
        >
          EMPTY WORKSPACE
        </button>
      </div>

      {/* Recent projects — always rendered so the project-folders controls are
          discoverable even before any project has been opened. */}
      <div style={{ marginTop: "24px", width: "100%", maxWidth: "700px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
          <div style={{ color: "#888888", fontSize: "10px", letterSpacing: "1px", fontWeight: "bold" }}>
            RECENT PROJECTS{recentProjects.length > 0 ? " — CLICK TO START · DBL-CLICK FOR WORKSPACE" : ""}
          </div>
          <div style={{ display: "flex", gap: "14px", flexShrink: 0 }}>
            <button
              onClick={handleRescan}
              disabled={rescanning}
              title="Re-scan your configured project folders"
              style={{ background: "none", border: "none", color: rescanning ? "#555" : "#888888", cursor: rescanning ? "default" : "pointer", fontFamily: MONO, fontSize: "10px", letterSpacing: "0.5px", padding: 0 }}
              onMouseEnter={(e) => { if (!rescanning) e.currentTarget.style.color = "#ff8c00"; }}
              onMouseLeave={(e) => { if (!rescanning) e.currentTarget.style.color = "#888888"; }}
            >
              {rescanning ? "Scanning…" : "↻ Rescan"}
            </button>
            <button
              onClick={handleOpenProjectFolders}
              title="Choose which folders CodeGrid scans for projects"
              style={{ background: "none", border: "none", color: "#888888", cursor: "pointer", fontFamily: MONO, fontSize: "10px", letterSpacing: "0.5px", padding: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8c00")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
            >
              ⚙ Project folders
            </button>
          </div>
        </div>
        {recentProjects.length > 0 ? (
          <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px",
              // When expanded, cap the height and scroll so a long list doesn't
              // push the rest of the launch screen off-screen.
              maxHeight: showAllRecents ? "42vh" : undefined,
              overflowY: showAllRecents ? "auto" : undefined,
            }}
          >
            {recentProjects.slice(0, showAllRecents ? recentProjects.length : RECENTS_COLLAPSED).map((proj) => {
              const missing = !proj.exists;
              return (
                <div
                  key={proj.path}
                  onClick={() => { if (!missing) handleQuickOpen(proj.path); }}
                  onDoubleClick={(e) => { e.preventDefault(); if (!missing) handleCreateWorkspaceFromRepo(proj.path); }}
                  title={missing ? "Folder no longer exists" : proj.path}
                  style={{
                    background: "#141414", border: "1px solid #2a2a2a", color: missing ? "#666666" : "#e0e0e0",
                    fontSize: "11px", fontFamily: MONO, cursor: missing ? "default" : "pointer",
                    padding: "10px 12px", textAlign: "left", display: "flex", alignItems: "center",
                    gap: "8px", opacity: missing ? 0.55 : 1, position: "relative",
                  }}
                  onMouseEnter={(e) => { if (!missing) { e.currentTarget.style.borderColor = "#ff8c00"; e.currentTarget.style.background = "#1e1e1e"; } e.currentTarget.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => (el.style.opacity = "1")); }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#141414"; e.currentTarget.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => (el.style.opacity = "0")); }}
                >
                  <span style={{ color: proj.pinned ? "#ff8c00" : (missing ? "#555555" : "#ff8c00"), fontWeight: "bold", fontSize: "14px" }}>
                    {proj.pinned ? "★" : (proj.name[0] || "?").toUpperCase()}
                  </span>
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    <div style={{ fontWeight: "bold", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {proj.name}
                    </div>
                    <div style={{ color: "#555555", fontSize: "9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {missing ? "missing — " : ""}
                      {proj.path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
                      {!missing && proj.last_opened ? `  ·  ${relativeTime(proj.last_opened)}` : ""}
                    </div>
                  </div>
                  {/* Hover actions: pin + remove */}
                  <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                    {!missing && (
                      <span
                        data-action
                        role="button"
                        title={proj.pinned ? "Unpin" : "Pin to top"}
                        onClick={(e) => { e.stopPropagation(); void handleTogglePin(proj.path, proj.pinned); }}
                        style={{ opacity: proj.pinned ? 1 : 0, color: proj.pinned ? "#ff8c00" : "#888888", fontSize: "12px", cursor: "pointer", padding: "0 4px", transition: "opacity 0.12s" }}
                      >
                        {proj.pinned ? "★" : "☆"}
                      </span>
                    )}
                    <span
                      data-action
                      role="button"
                      title="Remove from recents"
                      onClick={(e) => { e.stopPropagation(); void handleRemoveRecent(proj.path); }}
                      style={{ opacity: 0, color: "#888888", fontSize: "12px", cursor: "pointer", padding: "0 4px", transition: "opacity 0.12s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#e06c75")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#888888")}
                    >
                      ✕
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {recentProjects.length > RECENTS_COLLAPSED && (
            <button
              onClick={() => setShowAllRecents((v) => !v)}
              style={{
                marginTop: "8px", width: "100%", background: "transparent",
                border: "1px solid #2a2a2a", color: "#888888", cursor: "pointer",
                fontFamily: MONO, fontSize: "10px", letterSpacing: "0.5px",
                fontWeight: "bold", padding: "7px 0",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff8c00"; e.currentTarget.style.color = "#ff8c00"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#888888"; }}
            >
              {showAllRecents
                ? "▲ SHOW FEWER"
                : `▼ VIEW ALL ${recentProjects.length} PROJECTS`}
            </button>
          )}
          </>
        ) : (
          <div style={{ border: "1px dashed #2a2a2a", padding: "18px 16px", textAlign: "center", color: "#666666", fontSize: "11px", lineHeight: 1.6 }}>
            No recent projects yet — they appear here as you open folders.
            <br />
            Tell CodeGrid where your projects live, then scan for them.
            <div style={{ marginTop: "10px", display: "flex", gap: "16px", justifyContent: "center" }}>
              <button
                onClick={handleOpenProjectFolders}
                style={{ color: "#ff8c00", background: "none", border: "none", cursor: "pointer", fontFamily: MONO, fontSize: "11px", fontWeight: "bold" }}
              >
                Choose project folders →
              </button>
              <button
                onClick={handleRescan}
                disabled={rescanning}
                style={{ color: rescanning ? "#555" : "#aaaaaa", background: "none", border: "none", cursor: rescanning ? "default" : "pointer", fontFamily: MONO, fontSize: "11px", fontWeight: "bold" }}
              >
                {rescanning ? "Scanning…" : "↻ Rescan now"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <div
        style={{
          marginTop: "20px", fontSize: "10px", color: "#333333",
          display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "4px 16px",
        }}
      >
        <span style={{ color: "#555555" }}>Cmd+N</span><span>New Session</span>
        <span style={{ color: "#555555" }}>Cmd+K</span><span>Command Palette</span>
        <span style={{ color: "#555555" }}>Cmd+B</span><span>Broadcast to All</span>
        <span style={{ color: "#555555" }}>Cmd+Enter</span><span>Maximize Pane</span>
        <span style={{ color: "#555555" }}>Cmd+S</span><span>Toggle Sidebar</span>
        <span style={{ color: "#555555" }}>Cmd+Tab</span><span>Switch Workspace</span>
      </div>
    </div>
  );
}
