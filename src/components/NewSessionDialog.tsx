import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import type { GitHubRepo, RepoQuickStatus } from "../lib/ipc";

interface NewSessionDialogProps {
  onCreateSession: (workingDir: string, useWorktree: boolean, resume: boolean, isShell: boolean, sessionType?: string) => void;
}

function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function folderName(path: string): string {
  return path.split("/").pop() || path;
}

const AGENTS = [
  { id: "claude", label: "Claude", desc: "Anthropic", color: "#ff8c00", icon: "C" },
  { id: "codex", label: "Codex", desc: "OpenAI", color: "#10a37f", icon: "X" },
  { id: "gemini", label: "Gemini", desc: "Google", color: "#4285f4", icon: "G" },
  { id: "cursor", label: "Cursor", desc: "Cursor", color: "#a855f7", icon: "A" },
  { id: "grok", label: "Grok", desc: "xAI", color: "#e6e6e6", icon: "K" },
  { id: "shell", label: "Shell", desc: "Terminal", color: "#4a9eff", icon: ">" },
] as const;

const FONT = "var(--font-ui)";
const MONO_FONT = "var(--font-code)";

export const NewSessionDialog = memo(function NewSessionDialog({
  onCreateSession,
}: NewSessionDialogProps) {
  const { newSessionDialogOpen, setNewSessionDialogOpen, activeWorkspaceId, workspaces } = useWorkspaceStore();
  const allSessions = useSessionStore((s) => s.sessions);
  const recentDirs = useAppStore((s) => s.recentDirs);
  const addToast = useToastStore((s) => s.addToast);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const workspaceSessions = useMemo(
    () => allSessions.filter((s) => s.workspace_id === activeWorkspaceId),
    [allSessions, activeWorkspaceId],
  );
  const currentProjectDir = activeWorkspace?.repo_path ?? workspaceSessions[0]?.working_dir ?? null;

  const [showDifferentProject, setShowDifferentProject] = useState(false);
  const [tab, setTab] = useState<"recent" | "browse" | "clone" | "github">("recent");
  const [path, setPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneTargetDir, setCloneTargetDir] = useState("");
  const [resume, setResume] = useState(false);
  const [sessionType, setSessionType] = useState<"claude" | "shell" | "codex" | "gemini" | "cursor" | "grok">("claude");
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Repo quick status for recent dirs
  const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoQuickStatus>>({});

  // GitHub tab state
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [ghSearch, setGhSearch] = useState("");
  const [ghLoading, setGhLoading] = useState(false);
  const [ghCloning, setGhCloning] = useState<string | null>(null);
  const ghSearchRef = useRef<HTMLInputElement>(null);
  const ghSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (newSessionDialogOpen) {
      setPath("");
      setCloneUrl("");
      setCloneTargetDir("");
      setResume(false);
      setSessionType("claude");
      setFilter("");
      setGhSearch("");
      setGhRepos([]);
      setGhCloning(null);
      setShowDifferentProject(false);
      setTab(recentDirs.length > 0 ? "recent" : "browse");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [newSessionDialogOpen, recentDirs.length]);

  // Default clone destination
  useEffect(() => {
    if (!newSessionDialogOpen) return;
    (async () => {
      try {
        const { getHomeDir } = await import("../lib/ipc");
        const home = await getHomeDir();
        setCloneTargetDir(`${home}/Projects`);
      } catch { /* fallback */ }
    })();
  }, [newSessionDialogOpen]);

  // Fetch repo statuses
  useEffect(() => {
    if (!newSessionDialogOpen || recentDirs.length === 0) return;
    let cancelled = false;
    (async () => {
      const { checkRepoStatus } = await import("../lib/ipc");
      const results: Record<string, RepoQuickStatus> = {};
      for (let i = 0; i < recentDirs.length; i += 10) {
        if (cancelled) break;
        const batch = recentDirs.slice(i, i + 10);
        const statuses = await Promise.all(
          batch.map(async (dir) => {
            try {
              const status = await checkRepoStatus(dir);
              return [dir, status] as const;
            } catch {
              return [dir, { is_git: false, has_remote: false, branch: null }] as const;
            }
          }),
        );
        for (const [dir, status] of statuses) {
          results[dir] = status;
        }
        if (!cancelled) setRepoStatuses({ ...results });
      }
    })();
    return () => { cancelled = true; };
  }, [newSessionDialogOpen, recentDirs]);

  // GitHub identity
  const [ghIdentity, setGhIdentity] = useState<{ username: string; orgs: string[] } | null>(null);

  // Load GitHub repos
  useEffect(() => {
    if (tab !== "github") return;
    setGhLoading(true);
    (async () => {
      try {
        const { listGithubRepos, getGithubIdentity } = await import("../lib/ipc");
        const identity = await getGithubIdentity().catch(() => null);
        if (identity) setGhIdentity(identity);
        const personalRepos = await listGithubRepos(undefined, 100);
        const orgNames = identity?.orgs ?? [];
        const orgResults = await Promise.allSettled(
          orgNames.map((org) => listGithubRepos(org, 100))
        );
        const allRepos = [...personalRepos];
        const seen = new Set(allRepos.map((r) => r.full_name));
        for (const result of orgResults) {
          if (result.status === "fulfilled") {
            for (const repo of result.value) {
              if (!seen.has(repo.full_name)) {
                seen.add(repo.full_name);
                allRepos.push(repo);
              }
            }
          }
        }
        setGhRepos(allRepos);
      } catch (e) {
        addToast(`Failed to load GitHub repos: ${e}`, "error", 5000);
      } finally {
        setGhLoading(false);
      }
    })();
    setTimeout(() => ghSearchRef.current?.focus(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // GitHub search with debounce
  const handleGhSearch = useCallback((query: string) => {
    setGhSearch(query);
    if (ghSearchTimer.current) clearTimeout(ghSearchTimer.current);
    if (!query.trim()) {
      setGhLoading(true);
      (async () => {
        try {
          const { listGithubRepos } = await import("../lib/ipc");
          const repos = await listGithubRepos(undefined, 30);
          setGhRepos(repos);
        } catch (e) { console.warn("Failed to load GitHub repos:", e); } finally {
          setGhLoading(false);
        }
      })();
      return;
    }
    ghSearchTimer.current = setTimeout(async () => {
      setGhLoading(true);
      try {
        const { searchGithubRepos } = await import("../lib/ipc");
        const repos = await searchGithubRepos(query.trim(), 20);
        setGhRepos(repos);
      } catch (e) {
        addToast(`GitHub search failed: ${e}`, "error", 4000);
      } finally {
        setGhLoading(false);
      }
    }, 400);
  }, [addToast]);

  const handleSubmit = useCallback(
    (dir?: string) => {
      const finalDir = dir ?? (path.trim() || "~");
      onCreateSession(finalDir, false, resume, sessionType === "shell", sessionType);
      setNewSessionDialogOpen(false);
    },
    [path, resume, sessionType, onCreateSession, setNewSessionDialogOpen],
  );

  const handleClone = useCallback(async () => {
    if (!cloneUrl.trim()) return;
    try {
      const { cloneRepo } = await import("../lib/ipc");
      const targetDir = cloneTargetDir.trim() || undefined;
      const clonedPath = await cloneRepo(cloneUrl.trim(), targetDir);
      onCreateSession(clonedPath, false, false, false);
      setNewSessionDialogOpen(false);
    } catch (e) {
      addToast(`Clone failed: ${e}`, "error", 5000);
    }
  }, [cloneUrl, cloneTargetDir, onCreateSession, setNewSessionDialogOpen, addToast]);

  const handleGhCloneAndOpen = useCallback(async (repo: GitHubRepo) => {
    setGhCloning(repo.full_name);
    try {
      const { cloneRepo } = await import("../lib/ipc");
      const targetDir = cloneTargetDir.trim() || undefined;
      const clonedPath = await cloneRepo(repo.clone_url, targetDir);
      onCreateSession(clonedPath, false, false, sessionType === "shell", sessionType);
      setNewSessionDialogOpen(false);
    } catch (e) {
      console.error("Clone failed:", e);
      addToast(`Clone failed: ${e}`, "error", 5000);
    } finally {
      setGhCloning(null);
    }
  }, [cloneTargetDir, onCreateSession, setNewSessionDialogOpen, sessionType, addToast]);

  const handlePickCloneDestination = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose clone destination" });
      if (selected) setCloneTargetDir(selected as string);
    } catch (e) {
      addToast(`Could not open folder picker: ${e}`, "error");
    }
  }, [addToast]);

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Pick a folder" });
      if (selected) {
        setPath(selected as string);
        setTab("browse");
      }
    } catch (e) {
      addToast(`Could not open folder picker: ${e}`, "error");
    }
  }, [addToast]);

  const filteredDirs = useMemo(() => {
    if (!filter) return recentDirs;
    const lowerFilter = filter.toLowerCase();
    return recentDirs.filter((d) =>
      d.toLowerCase().includes(lowerFilter) ||
      folderName(d).toLowerCase().includes(lowerFilter),
    );
  }, [recentDirs, filter]);

  // Close on click outside
  useEffect(() => {
    if (!newSessionDialogOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setNewSessionDialogOpen(false);
      }
    };
    // Delay to avoid immediate close from the click that opened it
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handler); };
  }, [newSessionDialogOpen, setNewSessionDialogOpen]);

  // Close on Escape
  useEffect(() => {
    if (!newSessionDialogOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewSessionDialogOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [newSessionDialogOpen, setNewSessionDialogOpen]);

  if (!newSessionDialogOpen) return null;

  const selectedAgent = AGENTS.find((a) => a.id === sessionType) ?? AGENTS[0];

  const tabs = [
    { id: "recent" as const, label: "RECENT", count: filteredDirs.length },
    { id: "github" as const, label: "GITHUB" },
    { id: "browse" as const, label: "BROWSE" },
    { id: "clone" as const, label: "CLONE" },
  ];

  const langColors: Record<string, string> = {
    TypeScript: "#3178c6", JavaScript: "#f7df1e", Python: "#3572a5", Rust: "#dea584",
    Go: "#00add8", Java: "#b07219", Ruby: "#701516", C: "#555555", "C++": "#f34b7d",
    "C#": "#178600", Swift: "#f05138", Kotlin: "#a97bff", Dart: "#00b4ab",
    HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051", Lua: "#000080",
  };

  return (
    <>
      {/* Subtle backdrop - just dims, click closes */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
          background: "rgba(0, 0, 0, 0.3)",
        }}
      />

      {/* Dropdown panel anchored top-right near the + NEW button */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="New Session"
        style={{
          position: "fixed",
          top: "36px",
          right: "8px",
          zIndex: 1000,
          width: showDifferentProject ? "560px" : "380px",
          maxHeight: showDifferentProject ? "calc(100vh - 60px)" : "auto",
          background: "#141414",
          border: "1px solid #333",
          borderTop: `2px solid ${selectedAgent.color}`,
          fontFamily: FONT,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
          transition: "width 0.15s ease",
          overflow: "hidden",
        }}
      >
        {/* ============================================ */}
        {/* SECTION 1: Same Project                      */}
        {/* ============================================ */}
        {currentProjectDir && (
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #222" }}>
            {/* Section label */}
            <div style={{
              fontSize: 11,
              color: "#666",
              letterSpacing: "1.5px",
              fontWeight: "bold",
              marginBottom: "10px",
              textTransform: "uppercase",
            }}>
              Same Project
            </div>

            {/* Current project name */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
            }}>
              <div style={{
                width: "28px",
                height: "28px",
                background: "#1e1e1e",
                border: "1px solid #333",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                color: "#ff8c00",
                fontWeight: "bold",
                flexShrink: 0,
              }}>
                {folderName(currentProjectDir)[0]?.toUpperCase() ?? "?"}
              </div>
              <div style={{ overflow: "hidden" }}>
                <div style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: "bold" }}>
                  {folderName(currentProjectDir)}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortenPath(currentProjectDir)}
                </div>
              </div>
            </div>

            {/* Agent type selector - pill style */}
            <div style={{
              display: "flex",
              gap: "4px",
              marginBottom: "10px",
            }}>
              {AGENTS.map((agent) => {
                const selected = sessionType === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSessionType(agent.id)}
                    title={`${agent.label} (${agent.desc})`}
                    style={{
                      flex: 1,
                      padding: "7px 2px 5px",
                      background: selected ? `${agent.color}20` : "#1a1a1a",
                      border: `1.5px solid ${selected ? agent.color : "#2a2a2a"}`,
                      color: selected ? agent.color : "#666",
                      fontSize: 12,
                      fontFamily: FONT,
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 0.1s ease",
                      position: "relative",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) {
                        e.currentTarget.style.borderColor = agent.color;
                        e.currentTarget.style.color = agent.color;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) {
                        e.currentTarget.style.borderColor = "#2a2a2a";
                        e.currentTarget.style.color = "#666";
                      }
                    }}
                  >
                    <div style={{ fontWeight: "bold", fontSize: 12, marginBottom: "1px" }}>{agent.icon}</div>
                    <div style={{ fontSize: "10px", opacity: 0.8 }}>{agent.label}</div>
                  </button>
                );
              })}
            </div>

            {/* Resume toggle - only for Claude */}
            {sessionType === "claude" && (
              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                color: "#777",
                fontSize: 12,
                cursor: "pointer",
                marginBottom: "10px",
                padding: "0 2px",
              }}>
                <input
                  type="checkbox"
                  checked={resume}
                  onChange={(e) => setResume(e.target.checked)}
                  style={{ accentColor: "#ff8c00", margin: 0 }}
                />
                Resume previous session
              </label>
            )}

            {/* Launch button */}
            <button
              onClick={() => handleSubmit(currentProjectDir)}
              style={{
                width: "100%",
                padding: "10px",
                background: selectedAgent.color,
                border: "none",
                color: "#0a0a0a",
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: "bold",
                letterSpacing: "0.8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              START {selectedAgent.label.toUpperCase()} SESSION
            </button>
          </div>
        )}

        {/* ============================================ */}
        {/* SECTION 2: Different Project                 */}
        {/* ============================================ */}
        <div>
          {/* Toggle header */}
          <button
            onClick={() => setShowDifferentProject(!showDifferentProject)}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: showDifferentProject ? "#1a1a1a" : "transparent",
              border: "none",
              borderBottom: showDifferentProject ? "1px solid #222" : "none",
              color: showDifferentProject ? "#ccc" : "#777",
              fontSize: 11,
              fontFamily: FONT,
              fontWeight: "bold",
              letterSpacing: "1.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              textTransform: "uppercase",
            }}
            onMouseEnter={(e) => {
              if (!showDifferentProject) e.currentTarget.style.color = "#aaa";
              e.currentTarget.style.background = "#1a1a1a";
            }}
            onMouseLeave={(e) => {
              if (!showDifferentProject) {
                e.currentTarget.style.color = "#777";
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            <span>Different Project</span>
            <span style={{ fontSize: "12px", opacity: 0.6 }}>
              {showDifferentProject ? "\u25B4" : "\u25BE"}
            </span>
          </button>

          {/* Expanded: project picker */}
          {showDifferentProject && (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 280px)" }}>
              {/* Agent selector (compact, for different project) */}
              <div style={{ display: "flex", gap: "2px", padding: "8px 12px", borderBottom: "1px solid #222" }}>
                {AGENTS.map((agent) => {
                  const selected = sessionType === agent.id;
                  return (
                    <button
                      key={agent.id}
                      onClick={() => setSessionType(agent.id)}
                      style={{
                        flex: 1,
                        padding: "4px 2px",
                        background: selected ? `${agent.color}18` : "transparent",
                        border: `1px solid ${selected ? agent.color : "transparent"}`,
                        color: selected ? agent.color : "#555",
                        fontSize: 11,
                        fontFamily: FONT,
                        fontWeight: "bold",
                        cursor: "pointer",
                        textAlign: "center",
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.color = agent.color; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.color = "#555"; }}
                    >
                      {agent.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab navigation */}
              <div style={{ display: "flex", borderBottom: "1px solid #222" }}>
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      flex: 1,
                      padding: "7px",
                      background: tab === t.id ? "#1e1e1e" : "transparent",
                      border: "none",
                      borderBottom: tab === t.id ? `2px solid ${selectedAgent.color}` : "2px solid transparent",
                      color: tab === t.id ? selectedAgent.color : "#555",
                      fontSize: 11,
                      fontFamily: FONT,
                      cursor: "pointer",
                      letterSpacing: "0.5px",
                      fontWeight: tab === t.id ? "bold" : "normal",
                    }}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span style={{ marginLeft: "3px", opacity: 0.5, fontSize: "10px" }}>({t.count})</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflow: "auto", maxHeight: "340px" }}>
                {/* Recent Projects */}
                {tab === "recent" && (
                  <div>
                    <div style={{ padding: "8px 12px" }}>
                      <input
                        ref={inputRef}
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter projects..."
                        style={{
                          width: "100%",
                          background: "#0a0a0a",
                          border: "1px solid #2a2a2a",
                          color: "var(--text-primary)",
                          fontSize: 12,
                          fontFamily: FONT,
                          padding: "7px 8px",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = selectedAgent.color)}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                      />
                    </div>
                    {filteredDirs.length === 0 ? (
                      <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                        {recentDirs.length === 0
                          ? "No projects found. Try Browse or Clone."
                          : "No projects match your filter"}
                      </div>
                    ) : (
                      filteredDirs.map((dir) => {
                        const status = repoStatuses[dir];
                        return (
                          <div
                            key={dir}
                            onClick={() => handleSubmit(dir)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "8px 12px",
                              cursor: "pointer",
                              gap: "10px",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#1e1e1e")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <div style={{
                              width: "26px", height: "26px",
                              background: "#1e1e1e", border: "1px solid #2a2a2a",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "12px", color: selectedAgent.color, fontWeight: "bold", flexShrink: 0,
                            }}>
                              {folderName(dir)[0]?.toUpperCase() ?? "?"}
                            </div>
                            <div style={{ flex: 1, overflow: "hidden" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: "bold" }}>
                                  {folderName(dir)}
                                </span>
                                {status?.is_git && (
                                  <span style={{ fontSize: "10px", fontWeight: "bold", padding: "1px 3px", border: "1px solid #555", color: "var(--text-secondary)", letterSpacing: "0.5px" }}>git</span>
                                )}
                                {status?.has_remote && (
                                  <span style={{ fontSize: "10px", fontWeight: "bold", color: "#00c853" }}>&#x21D4;</span>
                                )}
                                {status?.branch && (
                                  <span style={{ fontSize: "10px", color: "#d500f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70px" }}>{status.branch}</span>
                                )}
                              </div>
                              <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {shortenPath(dir)}
                              </div>
                            </div>
                            <div style={{
                              color: selectedAgent.color, fontSize: 11, fontWeight: "bold",
                              padding: "3px 6px", border: `1px solid ${selectedAgent.color}`, flexShrink: 0,
                            }}>
                              OPEN
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* GitHub tab */}
                {tab === "github" && (
                  <div>
                    <div style={{ padding: "8px 12px" }}>
                      <input
                        ref={ghSearchRef}
                        value={ghSearch}
                        onChange={(e) => handleGhSearch(e.target.value)}
                        placeholder="Search GitHub repos..."
                        style={{
                          width: "100%",
                          background: "#0a0a0a",
                          border: "1px solid #2a2a2a",
                          color: "var(--text-primary)",
                          fontSize: 12,
                          fontFamily: FONT,
                          padding: "7px 8px",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "#00c853")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                      />
                    </div>
                    <div style={{ padding: "0 12px 6px 12px" }}>
                      <div style={{ color: "#666", fontSize: "10px", marginBottom: "3px", letterSpacing: "0.4px" }}>CLONE DESTINATION</div>
                      <div style={{ display: "flex", gap: "3px" }}>
                        <input
                          value={cloneTargetDir}
                          onChange={(e) => setCloneTargetDir(e.target.value)}
                          placeholder="~/Projects"
                          style={{
                            flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a",
                            color: "var(--text-primary)", fontSize: 12, fontFamily: FONT,
                            padding: "5px 6px", outline: "none",
                          }}
                          onFocus={(e) => (e.currentTarget.style.borderColor = "#00c853")}
                          onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                        />
                        <button
                          onClick={handlePickCloneDestination}
                          style={{
                            background: "#1e1e1e", border: "1px solid #2a2a2a", color: "var(--text-secondary)",
                            fontSize: 11, fontFamily: FONT, cursor: "pointer", padding: "5px 8px", fontWeight: "bold",
                          }}
                        >PICK</button>
                      </div>
                    </div>
                    {ghLoading && (
                      <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading...</div>
                    )}
                    {ghIdentity && !ghSearch && (
                      <div style={{ padding: "5px 12px", borderBottom: "1px solid #1e1e1e", display: "flex", gap: "3px", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)", marginRight: "3px" }}>SHOWING:</span>
                        <button onClick={() => handleGhSearch("")} style={{
                          background: "#1e1e1e", border: "1px solid #00c853", color: "#00c853",
                          fontSize: "10px", padding: "1px 5px", cursor: "pointer", fontFamily: FONT,
                        }}>{ghIdentity.username}</button>
                        {ghIdentity.orgs.map((org) => (
                          <button key={org} style={{
                            background: "#1e1e1e", border: "1px solid #4a9eff", color: "#4a9eff",
                            fontSize: "10px", padding: "1px 5px", cursor: "default", fontFamily: FONT,
                          }}>{org}</button>
                        ))}
                        <span style={{ fontSize: "10px", color: "#444", marginLeft: "auto" }}>{ghRepos.length} repos</span>
                      </div>
                    )}
                    {!ghLoading && ghRepos.length === 0 && (
                      <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                        {ghSearch ? "No repos found." : "No repos found. Ensure GitHub CLI is authenticated."}
                      </div>
                    )}
                    {!ghLoading && ghRepos.map((repo) => (
                      <div
                        key={repo.full_name}
                        style={{
                          display: "flex", alignItems: "center", padding: "8px 12px",
                          gap: "10px", borderBottom: "1px solid #1a1a1a",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1e1e1e")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                            <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: "bold" }}>{repo.name}</span>
                            {repo.is_private && (
                              <span style={{ fontSize: "10px", padding: "1px 3px", border: "1px solid #ff8c00", color: "#ff8c00", fontWeight: "bold" }}>PRIVATE</span>
                            )}
                            {repo.is_fork && (
                              <span style={{ fontSize: "10px", padding: "1px 3px", border: "1px solid #555", color: "#555" }}>FORK</span>
                            )}
                            {repo.language && (
                              <span style={{ fontSize: "10px", color: langColors[repo.language] ?? "#888", fontWeight: "bold" }}>{repo.language}</span>
                            )}
                          </div>
                          {repo.description && (
                            <div style={{ color: "#666", fontSize: 11, marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {repo.description}
                            </div>
                          )}
                          <div style={{ color: "#444", fontSize: "10px", marginTop: "1px" }}>
                            {repo.full_name}
                            {repo.stars > 0 && <span style={{ marginLeft: "6px" }}>* {repo.stars}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleGhCloneAndOpen(repo)}
                          disabled={ghCloning !== null}
                          style={{
                            background: ghCloning === repo.full_name ? "#2a2a2a" : "#00c853",
                            border: "none",
                            color: ghCloning === repo.full_name ? "#555" : "#0a0a0a",
                            fontSize: "10px", fontFamily: FONT,
                            cursor: ghCloning !== null ? "default" : "pointer",
                            padding: "5px 8px", fontWeight: "bold", letterSpacing: "0.5px",
                            flexShrink: 0, whiteSpace: "nowrap",
                          }}
                        >
                          {ghCloning === repo.full_name ? "CLONING..." : "CLONE & OPEN"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Browse folder */}
                {tab === "browse" && (
                  <div style={{ padding: "12px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: 11, marginBottom: "5px", letterSpacing: "0.5px" }}>FOLDER PATH</div>
                    <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
                      <input
                        ref={tab === "browse" ? inputRef : undefined}
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder="~/projects/my-app"
                        style={{
                          flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a",
                          color: "var(--text-primary)", fontSize: "12px", fontFamily: FONT, padding: "8px", outline: "none",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = selectedAgent.color)}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                      />
                      <button
                        onClick={handleBrowse}
                        style={{
                          background: "#1e1e1e", border: "1px solid #2a2a2a", color: "var(--text-secondary)",
                          fontSize: 12, fontFamily: FONT, cursor: "pointer", padding: "8px 12px", fontWeight: "bold",
                        }}
                      >BROWSE</button>
                    </div>

                    {sessionType === "claude" && (
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", color: "#777", fontSize: 12, cursor: "pointer", marginBottom: "12px" }}>
                        <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} style={{ accentColor: "#ff8c00", margin: 0 }} />
                        Resume previous session
                      </label>
                    )}

                    <button
                      onClick={() => handleSubmit()}
                      style={{
                        width: "100%", background: selectedAgent.color, border: "none",
                        color: "#0a0a0a", fontSize: 12, fontFamily: FONT, cursor: "pointer",
                        padding: "10px", fontWeight: "bold", letterSpacing: "0.8px",
                      }}
                    >
                      START {selectedAgent.label.toUpperCase()} SESSION
                    </button>
                  </div>
                )}

                {/* Clone repo */}
                {tab === "clone" && (
                  <div style={{ padding: "12px" }}>
                    <div style={{ color: "var(--text-secondary)", fontSize: 11, marginBottom: "5px", letterSpacing: "0.5px" }}>GIT REPOSITORY URL</div>
                    <input
                      ref={tab === "clone" ? inputRef : undefined}
                      value={cloneUrl}
                      onChange={(e) => setCloneUrl(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      style={{
                        width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a",
                        color: "var(--text-primary)", fontSize: "12px", fontFamily: FONT, padding: "8px",
                        outline: "none", boxSizing: "border-box", marginBottom: "10px",
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = selectedAgent.color)}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                      onKeyDown={(e) => { if (e.key === "Enter") handleClone(); }}
                    />
                    <div style={{ color: "var(--text-secondary)", fontSize: 11, marginBottom: "5px", letterSpacing: "0.5px" }}>DESTINATION FOLDER</div>
                    <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                      <input
                        value={cloneTargetDir}
                        onChange={(e) => setCloneTargetDir(e.target.value)}
                        placeholder="~/Projects"
                        style={{
                          flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a",
                          color: "var(--text-primary)", fontSize: "12px", fontFamily: FONT, padding: "8px", outline: "none",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = selectedAgent.color)}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                      />
                      <button
                        onClick={handlePickCloneDestination}
                        style={{
                          background: "#1e1e1e", border: "1px solid #2a2a2a", color: "var(--text-secondary)",
                          fontSize: 12, fontFamily: FONT, cursor: "pointer", padding: "8px 10px", fontWeight: "bold",
                        }}
                      >BROWSE</button>
                    </div>
                    <button
                      onClick={handleClone}
                      disabled={!cloneUrl.trim()}
                      style={{
                        width: "100%",
                        background: cloneUrl.trim() ? selectedAgent.color : "#2a2a2a",
                        border: "none",
                        color: cloneUrl.trim() ? "#0a0a0a" : "#555",
                        fontSize: 12, fontFamily: FONT,
                        cursor: cloneUrl.trim() ? "pointer" : "default",
                        padding: "10px", fontWeight: "bold", letterSpacing: "0.8px", marginBottom: "6px",
                      }}
                    >
                      CLONE & START
                    </button>
                    <button
                      onClick={() => {
                        setNewSessionDialogOpen(false);
                        useAppStore.getState().setHubBrowserOpen(true);
                      }}
                      style={{
                        width: "100%", background: "transparent", border: "1px solid #2a2a2a",
                        color: "var(--text-secondary)", fontSize: 12, fontFamily: FONT, cursor: "pointer", padding: "8px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = selectedAgent.color; e.currentTarget.style.color = selectedAgent.color; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#888"; }}
                    >
                      Browse Featured Repos in Hub
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
});
