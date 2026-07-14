import { memo, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { clampMenuPosition } from "../lib/menuPosition";

import { useWorkspaceStore, type ActivityPanel } from "../stores/workspaceStore";
import { useSessionStore } from "../stores/sessionStore";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import { useReviewStore } from "../stores/reviewStore";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import {
  gitStatus, gitPush, gitPull, gitStageFile, gitUnstageFile, gitCommit,
  gitDiffStat, quickPublish, quickSave, generateCommitMessage,
  gitListBranches, gitLog, gitCreateBranch, gitSwitchBranch, gitShowCommit,
  gitFetch, gitStash, gitStageAll, gitDiscardFile,
  type GitStatusInfo, type GitBranchInfo, type GitLogEntry,
} from "../lib/ipc";

import { FileTree } from "./FileTree";
import { ProjectSearch } from "./ProjectSearch";
import { AgentBusPanel } from "./AgentBusPanel";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { VersionBadge } from "./VersionBadge";
import { getFileIconUrl } from "../lib/fileIcons";
import { UI_ICON, type Icon } from "../lib/icons";

// ---------------------------------------------------------------------------
// Activity Bar (far-left icon rail)
// ---------------------------------------------------------------------------

const ACTIVITY_ITEMS: { id: ActivityPanel; label: string; icon: Icon }[] = [
  { id: "files",     label: "Files",    icon: UI_ICON.files },
  { id: "search",    label: "Search",   icon: UI_ICON.search },
  { id: "git",       label: "Git",      icon: UI_ICON.git },
  { id: "agentbus",  label: "Bus",      icon: UI_ICON.bus },
  { id: "analytics", label: "Pro",      icon: UI_ICON.pro },
  { id: "settings",  label: "Settings", icon: UI_ICON.settings },
];

// ---------------------------------------------------------------------------
// Panel: Files
// ---------------------------------------------------------------------------
const FilesPanel = memo(function FilesPanel({
  fileTreeDir,
  gitChangesMap,
}: {
  fileTreeDir: string | null;
  gitChangesMap: Map<string, string>;
}) {
  if (!fileTreeDir) {
    return (
      <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: 12 }}>
        Open a session to browse files.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <FileTree rootPath={fileTreeDir} gitChanges={gitChangesMap} />
      </div>
    </div>
  );
});


// ---------------------------------------------------------------------------
// Panel: Git (inline, not the overlay GitManager)
// ---------------------------------------------------------------------------
/** Shared style for the compact secondary git action buttons. */
function gitMiniBtn(borderColor: string, textColor: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "4px 8px",
    background: "transparent",
    border: `1px solid ${borderColor}`,
    color: textColor,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "var(--font-ui)",
    cursor: "pointer",
    borderRadius: 6,
    whiteSpace: "nowrap",
  };
}

/** Best-effort web URL for a commit from a git remote (GitHub/GitLab/Bitbucket). */
function commitUrl(remoteUrl: string | undefined, hash: string): string | null {
  if (!remoteUrl) return null;
  let host = "", path = "";
  const raw = remoteUrl.trim().replace(/^git\+/, "");
  const scp = raw.match(/^[a-zA-Z0-9_.-]+@([^:]+):(.+)$/); // git@host:owner/repo.git
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    try {
      const u = new URL(raw);
      host = u.host;
      path = u.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  path = path.replace(/\.git$/, "");
  if (!host || !path) return null;
  if (/gitlab\./i.test(host)) return `https://${host}/${path}/-/commit/${hash}`;
  if (/bitbucket\./i.test(host)) return `https://${host}/${path}/commits/${hash}`;
  return `https://${host}/${path}/commit/${hash}`; // github + generic
}

function PopBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent", border: "1px solid var(--border-default)",
        color: "var(--text-secondary)", fontSize: 11, fontFamily: "var(--font-ui)",
        padding: "3px 8px", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-accent)"; e.currentTarget.style.color = "var(--text-accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
    >{children}</button>
  );
}

/**
 * A commit row in HISTORY. The diff/details are no longer shown inline on click —
 * instead, hovering the row reveals a pop-out with the message, author, a link
 * to the commit on the remote, copy actions, and an on-demand diff.
 */
const CommitRow = memo(function CommitRow({
  entry, dir, remoteUrl, hasRemote, addToast,
}: {
  entry: GitLogEntry;
  dir: string | null;
  remoteUrl: string | undefined;
  hasRemote: boolean;
  addToast: (m: string, t?: "success" | "error" | "info" | "warning", d?: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghUrl = hasRemote ? commitUrl(remoteUrl, entry.hash) : null;

  const openPop = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const r = rowRef.current?.getBoundingClientRect();
    if (r) setPos(clampMenuPosition({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }, { width: 320, height: 260 }, { align: "left" }));
    setOpen(true);
  }, []);
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setOpen(false); setShowDiff(false); }, 150);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const loadDiff = useCallback(async () => {
    setShowDiff(true);
    if (detail != null || !dir) return;
    try {
      setDetail(await gitShowCommit(dir, entry.hash));
    } catch (e) {
      setDetail(`Error loading commit: ${e}`);
    }
  }, [detail, dir, entry.hash]);

  const copy = useCallback((text: string, what: string) => {
    invoke("clipboard_write", { text }).then(() => addToast(`${what} copied`, "success", 2500)).catch(() => {});
  }, [addToast]);

  return (
    <>
      <div
        ref={rowRef}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; openPop(); }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; scheduleClose(); }}
        style={{ padding: "4px 12px", display: "flex", alignItems: "center", gap: "6px", borderBottom: "1px solid #1a1a1a", cursor: "default" }}
      >
        <span style={{ color: "var(--text-accent)", fontSize: 11, fontWeight: "bold", flexShrink: 0, fontFamily: "var(--font-ui)" }}>
          {entry.short_hash}
        </span>
        <span style={{ color: "#cccccc", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.message}
        </span>
        <span style={{ color: "var(--border-strong)", fontSize: 11, flexShrink: 0 }}>{entry.date}</span>
      </div>
      {open && pos && createPortal(
        <div
          onMouseEnter={openPop}
          onMouseLeave={scheduleClose}
          style={{
            position: "fixed", top: pos.top, left: pos.left, zIndex: 100000,
            width: 320, maxWidth: "92vw", background: "var(--bg-secondary)",
            border: "1px solid var(--border-strong)", borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)", padding: 10, fontFamily: "var(--font-ui)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ color: "var(--text-accent)", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-ui)" }}>{entry.short_hash}</span>
            <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{entry.date}</span>
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 12, marginBottom: 5, lineHeight: 1.45 }}>{entry.message}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 9 }}>by {entry.author}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: showDiff ? 9 : 0 }}>
            {ghUrl && <PopBtn onClick={() => openExternal(ghUrl)}>View on remote ↗</PopBtn>}
            <PopBtn onClick={() => copy(entry.hash, "Commit hash")}>Copy hash</PopBtn>
            <PopBtn onClick={() => copy(entry.message, "Message")}>Copy message</PopBtn>
            {!showDiff && <PopBtn onClick={loadDiff}>Show diff</PopBtn>}
          </div>
          {showDiff && (
            <pre style={{
              margin: 0, maxHeight: 260, overflow: "auto", padding: 6,
              background: "#0d0d0d", border: "1px solid var(--border-default)",
              color: "#9a9a9a", fontSize: 11, lineHeight: 1.45,
              whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-ui)",
            }}>
              {detail ?? "Loading commit details…"}
            </pre>
          )}
        </div>,
        document.body,
      )}
    </>
  );
});

const GitPanel = memo(function GitPanel({
  workspaceGitStatus,
  activeWorkspace,
  activeSessions,
  onRefreshGit,
}: {
  workspaceGitStatus: GitStatusInfo | null;
  activeWorkspace: { repo_path: string | null; name: string } | undefined;
  activeSessions: { working_dir: string }[];
  onRefreshGit: () => void;
}) {
  const { setGitSetupWizardOpen, setCodeViewerOpen, setReviewPanelOpen } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const reviews = useReviewStore((s) => s.reviews);
  const [pushLoading, setPushLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [commitFormOpen, setCommitFormOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const morePopRef = useRef<HTMLDivElement>(null);
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const dir = activeWorkspace?.repo_path ?? activeSessions[0]?.working_dir ?? null;

  const resolvePath = useCallback((relativePath: string) => {
    if (!dir) return relativePath;
    return relativePath.startsWith("/") ? relativePath : `${dir.replace(/\/$/, "")}/${relativePath}`;
  }, [dir]);

  const openDiffReview = useCallback((relativePath: string) => {
    if (!dir) return;
    setCodeViewerOpen(true, resolvePath(relativePath), { diffMode: true, workingDir: dir });
  }, [dir, resolvePath, setCodeViewerOpen]);

  const refreshBranchesAndLog = useCallback(async () => {
    if (!dir) return;
    gitListBranches(dir).then(setBranches).catch(() => {});
    gitLog(dir, 20).then(setLogEntries).catch(() => {});
  }, [dir]);

  useEffect(() => { refreshBranchesAndLog(); }, [refreshBranchesAndLog]);

  // Close branch dropdown on outside click
  useEffect(() => {
    if (!branchDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchDropdownOpen]);

  // Close the "more actions" menu on outside click. The menu is portaled to
  // <body> (so it can't be clipped by the sidebar), so treat both the trigger
  // and the portaled menu as "inside".
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || morePopRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  // Keep the portaled "more actions" menu on-screen.
  useLayoutEffect(() => {
    if (!moreOpen || !moreBtnRef.current || !morePopRef.current) { setMorePos(null); return; }
    const a = moreBtnRef.current.getBoundingClientRect();
    const m = morePopRef.current.getBoundingClientRect();
    setMorePos(clampMenuPosition(a, { width: m.width, height: m.height }, { align: "left" }));
  }, [moreOpen]);

  const handleSwitchBranch = useCallback(async (name: string) => {
    if (!dir) return;
    setBranchSwitching(true);
    setBranchDropdownOpen(false);
    try {
      await gitSwitchBranch(dir, name.replace(/^origin\//, ""));
      addToast(`Switched to ${name}`, "success", 3000);
      onRefreshGit();
      refreshBranchesAndLog();
    } catch (e) { addToast(`Switch failed: ${e}`, "error", 5000); }
    setBranchSwitching(false);
  }, [dir, addToast, onRefreshGit, refreshBranchesAndLog]);

  const handleCreateBranch = useCallback(async () => {
    if (!dir || !newBranchName.trim()) return;
    setBranchSwitching(true);
    try {
      await gitCreateBranch(dir, newBranchName.trim(), true);
      addToast(`Created & switched to ${newBranchName.trim()}`, "success", 3000);
      setNewBranchName("");
      setBranchDropdownOpen(false);
      onRefreshGit();
      refreshBranchesAndLog();
    } catch (e) { addToast(`Create branch failed: ${e}`, "error", 5000); }
    setBranchSwitching(false);
  }, [dir, newBranchName, addToast, onRefreshGit, refreshBranchesAndLog]);

  const handleQuickPush = useCallback(async () => {
    if (!dir || pushLoading) return;
    if (!workspaceGitStatus?.has_remote) {
      addToast("No remote. Add: git remote add origin <url>", "warning", 5000);
      return;
    }
    setPushLoading(true);
    try {
      const aheadCount = workspaceGitStatus?.ahead ?? 0;
      const branch = workspaceGitStatus?.branch ?? "unknown";
      const result = await gitPush(dir, false);
      const detail = aheadCount > 0
        ? `Pushed ${aheadCount} commit${aheadCount > 1 ? "s" : ""} to origin/${branch}`
        : `Pushed to origin/${branch}`;
      addToast(result || detail, "success", 4000);
      onRefreshGit();
      refreshBranchesAndLog();
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "");
      const needsPull = /rejected|fetch first|cannot fast-forward|non-fast-forward/i.test(msg);
      if (needsPull) {
        addToast(
          "Push rejected — remote has changes you don't have locally. Pull first, then push.",
          "warning", 10000
        );
      } else {
        addToast(`Push failed: ${msg}`, "error", 6000);
      }
    } finally {
      setPushLoading(false);
    }
  }, [dir, workspaceGitStatus, addToast, pushLoading, onRefreshGit, refreshBranchesAndLog]);

  const handleQuickPull = useCallback(async () => {
    if (!dir || pullLoading) return;
    setPullLoading(true);
    try {
      const result = await gitPull(dir);
      const detail = result?.includes("Already up to date")
        ? "Already up to date"
        : result || "Pulled latest changes";
      addToast(detail, "success", 4000);
      onRefreshGit();
    } catch (e) {
      addToast(`Pull failed: ${String(e).replace(/^Error:\s*/, "")}`, "error", 6000);
    } finally {
      setPullLoading(false);
    }
  }, [dir, addToast, pullLoading, onRefreshGit]);

  const handleStageToggle = useCallback(async (filePath: string, isStaged: boolean) => {
    if (!dir) return;
    try {
      if (isStaged) {
        await gitUnstageFile(dir, filePath);
      } else {
        await gitStageFile(dir, filePath);
      }
      onRefreshGit();
    } catch (e) { addToast(`Stage/unstage failed: ${e}`, "error"); }
  }, [dir, onRefreshGit, addToast]);

  const handleCommit = useCallback(async () => {
    if (!dir || !commitMessage.trim()) return;
    try {
      await gitCommit(dir, commitMessage.trim());
      addToast("Committed successfully", "success");
      setCommitMessage("");
      setCommitFormOpen(false);
      onRefreshGit();
    } catch (e) { addToast(`Commit failed: ${e}`, "error"); }
  }, [dir, commitMessage, onRefreshGit, addToast]);

  // Free, offline fallback: a conventional-commit message inferred from filenames.
  const buildHeuristicMessage = useCallback((): string => {
    if (!workspaceGitStatus) return `Changes ${new Date().toLocaleDateString()}`;
    const allChanges = [
      ...workspaceGitStatus.staged.map((f) => ({ path: f.path, status: f.status })),
      ...workspaceGitStatus.unstaged.map((f) => ({ path: f.path, status: f.status })),
      ...workspaceGitStatus.untracked.map((p) => ({ path: p, status: "added" })),
    ];
    if (allChanges.length === 0) return `Changes ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    const paths = allChanges.map((c) => c.path.toLowerCase());
    const hasTests = paths.some((p) => p.includes("test") || p.includes("spec"));
    const hasFix = paths.some((p) => p.includes("fix") || allChanges.some((c) => c.status === "deleted"));
    const hasConfig = paths.some((p) => p.includes("config") || p.includes(".json") || p.includes(".toml") || p.includes(".yml"));
    const prefix = hasTests ? "test:" : hasFix ? "fix:" : hasConfig ? "chore:" : "feat:";
    if (allChanges.length === 1) {
      const fileName = allChanges[0].path.split("/").pop() ?? allChanges[0].path;
      return `${prefix} update ${fileName}`;
    }
    const first = allChanges[0].path.split("/").pop() ?? allChanges[0].path;
    const second = allChanges[1]?.path.split("/").pop() ?? "";
    return allChanges.length === 2
      ? `${prefix} update ${first}, ${second}`
      : `${prefix} update ${allChanges.length} files: ${first}, ${second}...`;
  }, [workspaceGitStatus]);

  const handleGenerateCommitMessage = useCallback(async () => {
    if (!dir || !workspaceGitStatus) return;
    setAiGenerating(true);
    try {
      // Prefer BYOK AI (OpenAI key in Settings → Voice); fall back to heuristic.
      try {
        const msg = await generateCommitMessage(dir);
        if (msg && msg.trim()) { setCommitMessage(msg.trim()); return; }
      } catch (e) {
        addToast(`AI message unavailable (${e}) — used a basic one.`, "warning");
      }
      setCommitMessage(buildHeuristicMessage());
    } finally {
      setAiGenerating(false);
    }
  }, [dir, workspaceGitStatus, buildHeuristicMessage, addToast]);

  // ⌘K "Generate AI commit message" dispatches this — open the commit form and
  // fill it in, so the feature is reachable without first hunting for the form.
  useEffect(() => {
    const onGenerate = () => {
      setCommitFormOpen(true);
      void handleGenerateCommitMessage();
    };
    window.addEventListener("codegrid:ai-commit-message", onGenerate);
    return () => window.removeEventListener("codegrid:ai-commit-message", onGenerate);
  }, [handleGenerateCommitMessage]);

  const handlePublish = useCallback(async () => {
    if (!dir || publishLoading) return;
    if (!workspaceGitStatus?.has_remote) {
      setGitSetupWizardOpen(true);
      return;
    }
    setPublishLoading(true);
    try {
      const result = await quickPublish(dir);
      if (result.files_changed === 0) {
        addToast("No changes to commit and push.", "info", 3000);
      } else {
        addToast(
          `Committed & pushed ${result.files_changed} file${result.files_changed === 1 ? "" : "s"} (${result.commit_hash})`,
          "success", 4000
        );
      }
      onRefreshGit();
      refreshBranchesAndLog();
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "");
      const needsPull = /rejected|fetch first|cannot fast-forward|non-fast-forward/i.test(msg);
      if (needsPull) {
        addToast("Push rejected — remote has changes you don't have locally. Pull first, then push.", "warning", 10000);
      } else {
        addToast(`Commit & push failed: ${msg}`, "error", 6000);
      }
    } finally {
      setPublishLoading(false);
    }
  }, [dir, publishLoading, workspaceGitStatus, addToast, onRefreshGit, setGitSetupWizardOpen]);

  const handleSave = useCallback(async () => {
    if (!dir || saveLoading) return;
    setSaveLoading(true);
    try {
      const result = await quickSave(dir);
      if (result.files_changed === 0) {
        addToast("No changes to commit.", "info", 3000);
      } else {
        addToast(
          `Committed ${result.files_changed} file${result.files_changed === 1 ? "" : "s"} (${result.commit_hash})`,
          "success", 4000
        );
      }
      onRefreshGit();
    } catch (e) {
      addToast(`Commit failed: ${String(e).replace(/^Error:\s*/, "")}`, "error", 6000);
    } finally {
      setSaveLoading(false);
    }
  }, [dir, saveLoading, addToast, onRefreshGit]);

  // ── Resizable sections state ──
  const [changesPct, setChangesPct] = useState(60); // percentage of available space for Changes
  const dragRef = useRef<{ active: boolean; startY: number; startPct: number; containerH: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const changesSectionRef = useRef<HTMLDivElement>(null);
  const historySectionRef = useRef<HTMLDivElement>(null);

  // Direct-DOM drag handlers (no React re-renders during drag)
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    dragRef.current = { active: true, startY: e.clientY, startPct: changesPct, containerH: containerRect.height };

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !d.active) return;
      const dy = ev.clientY - d.startY;
      const deltaPct = (dy / d.containerH) * 100;
      const newPct = Math.max(15, Math.min(85, d.startPct + deltaPct));
      // Direct DOM mutation for smooth dragging
      if (changesSectionRef.current) changesSectionRef.current.style.flex = `${newPct} 0 0`;
      if (historySectionRef.current) historySectionRef.current.style.flex = `${100 - newPct} 0 0`;
    };

    const onUp = () => {
      const d = dragRef.current;
      if (d && d.active) {
        // Read final position from DOM and commit to React state
        const changesEl = changesSectionRef.current;
        const historyEl = historySectionRef.current;
        if (changesEl && historyEl && containerRef.current) {
          const totalH = changesEl.offsetHeight + historyEl.offsetHeight;
          if (totalH > 0) {
            const finalPct = (changesEl.offsetHeight / totalH) * 100;
            setChangesPct(Math.max(15, Math.min(85, finalPct)));
          }
        }
      }
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [changesPct]);

  const totalChanges = (workspaceGitStatus?.staged.length ?? 0)
    + (workspaceGitStatus?.unstaged.length ?? 0)
    + (workspaceGitStatus?.untracked.length ?? 0);

  if (!workspaceGitStatus) {
    return (
      <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: 12 }}>
        No git repository detected.
      </div>
    );
  }

  const noChanges = totalChanges === 0;
  const hasRemote = workspaceGitStatus.has_remote;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Compact action bar: COMMIT & PUSH + AI commit-message wand, then the
          AI CODE REVIEW row with a "more git actions" dropdown. */}
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "5px", borderBottom: "1px solid var(--border-default)" }}>
        {!hasRemote ? (
          <button
            onClick={() => setGitSetupWizardOpen(true)}
            style={{ width: "100%", padding: "7px 12px", background: "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: 12, fontWeight: "bold", fontFamily: "var(--font-ui)", cursor: "pointer", borderRadius: 6 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#ffa333"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--text-accent)"; }}
          >
            {"\u2191 CONNECT REMOTE"}
          </button>
        ) : noChanges ? (
          <button
            disabled
            style={{ width: "100%", padding: "7px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-strong)", color: "var(--text-muted)", fontSize: 12, fontWeight: "bold", fontFamily: "var(--font-ui)", cursor: "default", borderRadius: 6 }}
          >
            {"\u2713 NO CHANGES"}
          </button>
        ) : (
          /* Row 1: Commit & Push (primary) with the AI commit-message wand beside it. */
          <div style={{ display: "flex", gap: "4px", alignItems: "stretch" }}>
            <button
              onClick={handlePublish}
              disabled={publishLoading}
              style={{ flex: 1, padding: "7px 12px", background: publishLoading ? "#cc7000" : "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: 12, fontWeight: "bold", fontFamily: "var(--font-ui)", cursor: publishLoading ? "wait" : "pointer", borderRadius: 6 }}
              onMouseEnter={(e) => { if (!publishLoading) e.currentTarget.style.background = "#ffa333"; }}
              onMouseLeave={(e) => { if (!publishLoading) e.currentTarget.style.background = "var(--text-accent)"; }}
            >
              {publishLoading ? "\u2191 PUBLISHING..." : `\u2191 COMMIT & PUSH (${totalChanges})`}
            </button>
            <button
              onClick={() => { setCommitFormOpen(true); void handleGenerateCommitMessage(); }}
              disabled={aiGenerating}
              title="Write a commit message with AI (uses your OpenAI key)"
              aria-label="Generate commit message with AI"
              style={{
                flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                padding: "0 11px", borderRadius: 6, cursor: aiGenerating ? "wait" : "pointer",
                background: "var(--accent-soft)", border: "1px solid var(--accent-border)",
                color: aiGenerating ? "var(--text-faint)" : "var(--text-accent)", fontFamily: "var(--font-ui)",
              }}
              onMouseEnter={(e) => { if (!aiGenerating) e.currentTarget.style.borderColor = "var(--text-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; }}
            >{aiGenerating ? <span className="cg-spinner" style={{ width: 12, height: 12 }} /> : <UI_ICON.ai size={15} weight="fill" style={{ flexShrink: 0 }} />}</button>
          </div>
        )}

        {/* Row 2: AI CODE REVIEW (background, with history) + more-git-actions menu. */}
        {(totalChanges > 0 || hasRemote) && (
          <div style={{ display: "flex", gap: "4px", alignItems: "stretch" }}>
            {totalChanges > 0 && (() => {
              const reviewRunning = reviews.some((r) => r.dir === dir && r.status === "running");
              return (
                <button
                  onClick={() => { if (dir) setReviewPanelOpen(true, dir); }}
                  title={reviewRunning ? "Review running \u2014 click to view" : "AI code review of all your uncommitted changes (uses your OpenAI key)"}
                  style={{
                    flex: 1, padding: "6px 12px", display: "inline-flex",
                    alignItems: "center", justifyContent: "center", gap: 6,
                    background: "var(--accent-soft)", border: "1px solid var(--accent-border)",
                    color: "var(--text-accent)", fontSize: 11.5, fontWeight: "bold",
                    fontFamily: "var(--font-ui)", cursor: "pointer", borderRadius: 6,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; }}
                >
                  {reviewRunning
                    ? <><span className="cg-spinner" style={{ width: 12, height: 12 }} /> REVIEWING\u2026</>
                    : <><UI_ICON.ai size={13} weight="fill" style={{ flexShrink: 0 }} /> AI CODE REVIEW</>}
                </button>
              );
            })()}
            <div ref={moreRef} style={{ position: "relative", flex: totalChanges > 0 ? "0 0 auto" : 1 }}>
              <button
                ref={moreBtnRef}
                onClick={() => setMoreOpen((o) => !o)}
                title="More git actions"
                aria-label="More git actions"
                style={{ ...gitMiniBtn("var(--border-strong)", "var(--text-secondary)"), padding: "4px 10px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
              >{totalChanges > 0 ? <UI_ICON.more size={16} weight="bold" /> : <><UI_ICON.more size={15} weight="bold" /> Git actions</>}</button>
              {moreOpen && createPortal(
                <div ref={morePopRef} style={{
                  position: "fixed", top: morePos?.top ?? -9999, left: morePos?.left ?? -9999,
                  visibility: morePos ? "visible" : "hidden", minWidth: 170, zIndex: 100000,
                  background: "var(--bg-secondary)", border: "1px solid var(--border-strong)", borderRadius: 8,
                  boxShadow: "0 10px 28px rgba(0,0,0,0.6)", padding: 5,
                }}>
                  {[
                    { label: "Open diff viewer", color: "var(--status-idle)", show: totalChanges > 0, run: () => { const first = workspaceGitStatus.staged[0]?.path ?? workspaceGitStatus.unstaged[0]?.path ?? workspaceGitStatus.untracked[0]; if (first) openDiffReview(first); } },
                    { label: "Commit only (no push)", color: "var(--text-accent)", show: totalChanges > 0, run: handleSave },
                    { label: "Pull", color: "var(--status-idle)", show: hasRemote, run: handleQuickPull },
                    { label: "Push", color: "var(--status-running)", show: hasRemote, run: handleQuickPush },
                    { label: "Stage all", color: "var(--status-running)", show: totalChanges > 0, run: async () => { if (dir) { try { await gitStageAll(dir); addToast("All staged", "success"); onRefreshGit(); } catch (e) { addToast(`Stage all failed: ${e}`, "error"); } } } },
                    { label: "Discard all", color: "var(--status-error)", show: totalChanges > 0, run: () => setDiscardConfirmOpen(true) },
                    { label: "Fetch", color: "var(--text-secondary)", show: true, run: async () => { if (dir) { try { await gitFetch(dir); addToast("Fetched", "success"); onRefreshGit(); } catch (e) { addToast(`Fetch failed: ${e}`, "error"); } } } },
                    { label: "Stash", color: "var(--text-secondary)", show: true, run: async () => { if (dir) { try { await gitStash(dir); addToast("Stashed", "success"); onRefreshGit(); } catch (e) { addToast(`Stash failed: ${e}`, "error"); } } } },
                  ].filter((i) => i.show).map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { setMoreOpen(false); void item.run(); }}
                      style={{ display: "flex", width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: "7px 10px", borderRadius: 5, textAlign: "left", color: item.color, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >{item.label}</button>
                  ))}
                </div>,
                document.body,
              )}
            </div>
          </div>
        )}
      </div>

      {/* Branch switcher */}
      <div ref={branchDropdownRef} style={{ borderBottom: "1px solid var(--border-default)", position: "relative" }}>
        <button
          onClick={() => { setBranchDropdownOpen((o) => !o); setBranchSearch(""); }}
          style={{
            width: "100%", padding: "7px 12px", background: "transparent", border: "none",
            display: "flex", alignItems: "center", gap: "6px", cursor: branchSwitching ? "default" : "pointer",
            borderBottom: branchDropdownOpen ? "1px solid #ff8c0066" : "none",
          }}
        >
          <span style={{ color: "#d500f9", fontSize: 12, fontWeight: "bold", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
            {branchSwitching ? "switching..." : (workspaceGitStatus.branch ?? "...")}
          </span>
          {workspaceGitStatus.ahead > 0 && <span style={{ color: "var(--status-running)", fontSize: 11 }}>+{workspaceGitStatus.ahead}</span>}
          {workspaceGitStatus.behind > 0 && <span style={{ color: "var(--status-error)", fontSize: 11 }}>-{workspaceGitStatus.behind}</span>}
          {workspaceGitStatus.has_remote
            ? <span title={workspaceGitStatus.remote_url ?? "Connected to remote"} style={{ fontSize: "10px", color: "var(--status-running)", background: "#00c85322", padding: "1px 4px", fontWeight: "bold" }}>● CONNECTED</span>
            : <span title="No remote configured" style={{ fontSize: "10px", color: "var(--status-error)", background: "#ff3d0022", padding: "1px 4px", fontWeight: "bold" }}>● NO REMOTE</span>}
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{branchDropdownOpen ? "▲" : "▼"}</span>
        </button>

        {branchDropdownOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
            background: "var(--bg-secondary)", border: "1px solid #ff8c0066", borderTop: "none",
            maxHeight: "260px", display: "flex", flexDirection: "column",
          }}>
            {/* Search */}
            <input
              autoFocus
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              placeholder="Search or create branch..."
              style={{
                background: "var(--bg-primary)", border: "none", borderBottom: "1px solid var(--border-default)",
                color: "var(--text-primary)", fontSize: 12,
                fontFamily: "var(--font-ui)",
                padding: "6px 10px", outline: "none", flexShrink: 0,
              }}
              onKeyDown={(e) => { if (e.key === "Escape") setBranchDropdownOpen(false); }}
            />
            {/* Branch list */}
            <div style={{ overflow: "auto", flex: 1 }}>
              {branches
                .filter((b) => !branchSearch || b.name.toLowerCase().includes(branchSearch.toLowerCase()))
                .map((b) => (
                  <div
                    key={b.name}
                    onClick={() => !b.is_current && handleSwitchBranch(b.name)}
                    style={{
                      padding: "5px 10px", cursor: b.is_current ? "default" : "pointer",
                      display: "flex", alignItems: "center", gap: "6px",
                      background: b.is_current ? "var(--bg-tertiary)" : "transparent",
                      borderLeft: b.is_current ? "2px solid var(--text-accent)" : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => { if (!b.is_current) e.currentTarget.style.background = "#1a1a1a"; }}
                    onMouseLeave={(e) => { if (!b.is_current) e.currentTarget.style.background = b.is_current ? "var(--bg-tertiary)" : "transparent"; }}
                  >
                    <span style={{ color: b.is_remote ? "var(--status-idle)" : b.is_current ? "var(--text-accent)" : "var(--text-primary)", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.name}
                    </span>
                    {b.is_current && <span style={{ color: "var(--status-running)", fontSize: "10px" }}>✓</span>}
                    {b.is_remote && <span style={{ color: "#4a9eff44", fontSize: "10px" }}>remote</span>}
                  </div>
                ))
              }
              {branches.filter((b) => !branchSearch || b.name.toLowerCase().includes(branchSearch.toLowerCase())).length === 0 && (
                <div style={{ padding: "5px 10px", color: "var(--text-muted)", fontSize: 12 }}>No matches</div>
              )}
            </div>
            {/* Create new branch */}
            <div style={{ borderTop: "1px solid var(--border-default)", padding: "5px 8px", display: "flex", gap: "4px", flexShrink: 0 }}>
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="New branch name..."
                style={{
                  flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)",
                  fontSize: 12, fontFamily: "var(--font-ui)",
                  padding: "4px 6px", outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--text-accent)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateBranch(); }}
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim() || branchSwitching}
                style={{
                  background: newBranchName.trim() ? "var(--text-accent)" : "var(--border-default)", border: "none",
                  color: newBranchName.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: 11,
                  fontFamily: "var(--font-ui)",
                  cursor: newBranchName.trim() ? "pointer" : "default", padding: "4px 8px", fontWeight: "bold",
                }}
              >+ CREATE</button>
            </div>
          </div>
        )}

      </div>

      {/* Resizable Changes + History container */}
      <div ref={containerRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Changes section */}
      <div ref={changesSectionRef} style={{ display: "flex", flexDirection: "column", flex: `${changesPct} 0 0`, minHeight: 0, overflow: "hidden" }}>
      <div style={{ padding: "6px 12px 4px", color: "var(--text-accent)", fontWeight: "bold", fontSize: 12, letterSpacing: "1px", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        CHANGES
        {totalChanges > 0 && (
          <span style={{
            color: "var(--bg-primary)", background: "var(--status-waiting)", fontSize: 11, fontWeight: "bold",
            padding: "0 4px", lineHeight: "14px", minWidth: "14px", textAlign: "center",
          }}>
            {totalChanges}
          </span>
        )}
      </div>

      {totalChanges > 0 && (
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {/* Staged files */}
          {workspaceGitStatus.staged.map((f) => {
            const fileName = f.path.split("/").pop() ?? f.path;
            const badge = f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M";
            return (
              <div
                key={`staged-${f.path}`}
                onClick={() => openDiffReview(f.path)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "3px 12px", fontSize: 12, cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  color: "var(--status-running)", fontWeight: "bold", fontSize: 11,
                  width: "14px", textAlign: "center", flexShrink: 0,
                }}>{badge}</span>
                <img src={getFileIconUrl(fileName)} alt="" width={14} height={14} style={{ width: 14, height: 14, flexShrink: 0, verticalAlign: "middle", objectFit: "contain" }} draggable={false} />
                <span style={{ color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, paddingLeft: 1 }}>
                  {fileName}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStageToggle(f.path, true); }}
                  title="Unstage file"
                  style={{
                    background: "#00c85322", border: "1px solid #00c85366", color: "var(--status-running)",
                    fontSize: "10px", fontFamily: "var(--font-ui)", cursor: "pointer",
                    padding: "0px 3px", lineHeight: "14px", fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--status-running)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#00c85366"; }}
                >S</button>
              </div>
            );
          })}
          {/* Unstaged (modified) files */}
          {workspaceGitStatus.unstaged.map((f) => {
            const fileName = f.path.split("/").pop() ?? f.path;
            const badge = f.status === "deleted" ? "D" : "M";
            const badgeColor = f.status === "deleted" ? "var(--status-error)" : "var(--status-waiting)";
            return (
              <div
                key={`unstaged-${f.path}`}
                onClick={() => openDiffReview(f.path)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "3px 12px", fontSize: 12, cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  color: badgeColor, fontWeight: "bold", fontSize: 11,
                  width: "14px", textAlign: "center", flexShrink: 0,
                }}>{badge}</span>
                <img src={getFileIconUrl(fileName)} alt="" width={14} height={14} style={{ width: 14, height: 14, flexShrink: 0, verticalAlign: "middle", objectFit: "contain" }} draggable={false} />
                <span style={{ color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, paddingLeft: 1 }}>
                  {fileName}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStageToggle(f.path, false); }}
                  title="Stage file"
                  style={{
                    background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-muted)",
                    fontSize: "10px", fontFamily: "var(--font-ui)", cursor: "pointer",
                    padding: "0px 3px", lineHeight: "14px", fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-muted)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                >S</button>
              </div>
            );
          })}
          {/* Untracked files */}
          {workspaceGitStatus.untracked.map((filePath) => {
            const fileName = filePath.split("/").pop() ?? filePath;
            return (
              <div
                key={`untracked-${filePath}`}
                onClick={() => openDiffReview(filePath)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "3px 12px", fontSize: 12, cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#1a1a1a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  color: "var(--status-idle)", fontWeight: "bold", fontSize: 11,
                  width: "14px", textAlign: "center", flexShrink: 0,
                }}>U</span>
                <img src={getFileIconUrl(fileName)} alt="" width={14} height={14} style={{ width: 14, height: 14, flexShrink: 0, verticalAlign: "middle", objectFit: "contain" }} draggable={false} />
                <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, paddingLeft: 1 }}>
                  {fileName}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleStageToggle(filePath, false); }}
                  title="Stage file"
                  style={{
                    background: "transparent", border: "1px solid var(--border-strong)", color: "var(--text-muted)",
                    fontSize: "10px", fontFamily: "var(--font-ui)", cursor: "pointer",
                    padding: "0px 3px", lineHeight: "14px", fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-muted)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                >S</button>
              </div>
            );
          })}
          {/* Commit / Push row */}
          <div style={{ padding: "6px 12px", display: "flex", gap: "2px", flexDirection: "column" }}>
            {commitFormOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", gap: "2px" }}>
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message..."
                    style={{
                      background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)",
                      fontSize: 12, fontFamily: "var(--font-ui)", padding: "5px 6px",
                      outline: "none", flex: 1, boxSizing: "border-box", minWidth: 0,
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--text-accent)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCommit(); if (e.key === "Escape") setCommitFormOpen(false); }}
                    autoFocus
                  />
                  <button
                    onClick={handleGenerateCommitMessage}
                    disabled={aiGenerating}
                    title="Write the commit message with AI (uses your OpenAI key)"
                    aria-label="Generate commit message"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent-border)",
                      color: aiGenerating ? "var(--text-faint)" : "var(--text-accent)",
                      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-ui)",
                      cursor: aiGenerating ? "wait" : "pointer",
                      padding: "0 7px", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { if (!aiGenerating) e.currentTarget.style.borderColor = "var(--text-accent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; }}
                  >{aiGenerating ? "\u2026" : <><UI_ICON.ai size={13} weight="fill" style={{ flexShrink: 0 }} /> AI</>}</button>
                </div>
                <div style={{ display: "flex", gap: "2px" }}>
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim()}
                    style={{
                      flex: 1, background: commitMessage.trim() ? "var(--text-accent)" : "var(--bg-tertiary)",
                      border: "1px solid var(--border-default)",
                      color: commitMessage.trim() ? "var(--bg-primary)" : "var(--text-faint)",
                      fontSize: 11, fontFamily: "var(--font-ui)", cursor: commitMessage.trim() ? "pointer" : "default",
                      padding: "3px", fontWeight: "bold",
                    }}
                  >COMMIT</button>
                  <button
                    onClick={() => setCommitFormOpen(false)}
                    style={{
                      background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", color: "var(--text-secondary)",
                      fontSize: 11, fontFamily: "var(--font-ui)", cursor: "pointer",
                      padding: "3px 6px",
                    }}
                  >ESC</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "2px" }}>
                <button
                  onClick={() => setCommitFormOpen(true)}
                  disabled={workspaceGitStatus.staged.length === 0}
                  style={{
                    flex: 1, background: "var(--bg-tertiary)", border: "1px solid var(--border-default)",
                    color: workspaceGitStatus.staged.length > 0 ? "var(--text-accent)" : "var(--border-strong)",
                    fontSize: 11, fontFamily: "var(--font-ui)",
                    cursor: workspaceGitStatus.staged.length > 0 ? "pointer" : "default",
                    padding: "3px", fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => { if (workspaceGitStatus.staged.length > 0) e.currentTarget.style.borderColor = "var(--text-accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
                >COMMIT</button>
                <button
                  onClick={() => {
                    if (!workspaceGitStatus.has_remote) {
                      addToast("No remote configured.", "warning", 5000);
                      return;
                    }
                    handleQuickPush();
                  }}
                  disabled={pushLoading}
                  style={{
                    flex: 1, background: "var(--bg-tertiary)", border: "1px solid var(--border-default)",
                    color: pushLoading ? "var(--border-strong)" : !workspaceGitStatus.has_remote ? "var(--border-strong)" : "var(--status-running)",
                    fontSize: 11, fontFamily: "var(--font-ui)",
                    cursor: pushLoading ? "default" : "pointer",
                    padding: "3px", fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => { if (!pushLoading) e.currentTarget.style.borderColor = workspaceGitStatus.has_remote ? "var(--status-running)" : "var(--border-strong)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
                >{workspaceGitStatus.has_remote ? "PUSH \u2191" : "PUSH"}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {totalChanges === 0 && (
        <div style={{ padding: "6px 12px 8px", color: "var(--border-strong)", fontSize: 12 }}>
          No changes
        </div>
      )}
      </div>{/* end Changes section */}

      {/* ── Drag divider between Changes and History ── */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          height: "4px",
          flexShrink: 0,
          background: "var(--border-default)",
          cursor: "row-resize",
          position: "relative",
          zIndex: 2,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--border-strong)"; }}
        onMouseLeave={(e) => { if (!dragRef.current?.active) e.currentTarget.style.background = "var(--border-default)"; }}
      />

      {/* History section */}
      <div ref={historySectionRef} style={{ display: "flex", flexDirection: "column", flex: `${100 - changesPct} 0 0`, minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => setHistoryExpanded((e) => !e)}
          style={{
            width: "100%", background: "none", border: "none", padding: "6px 12px",
            display: "flex", alignItems: "center", gap: "6px", cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: 12, letterSpacing: "1px", flex: 1, textAlign: "left" }}>
            HISTORY
          </span>
          {logEntries.length > 0 && (
            <span style={{ color: "var(--border-strong)", fontSize: 11 }}>{logEntries.length}</span>
          )}
          <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{historyExpanded ? "▲" : "▼"}</span>
        </button>
        {historyExpanded && (
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {logEntries.length === 0 ? (
              <div style={{ padding: "6px 12px", color: "var(--border-strong)", fontSize: 12 }}>No commits yet</div>
            ) : logEntries.map((entry) => (
              <CommitRow
                key={entry.hash}
                entry={entry}
                dir={dir}
                remoteUrl={workspaceGitStatus.remote_url}
                hasRemote={workspaceGitStatus.has_remote}
                addToast={addToast}
              />
            ))}
          </div>
        )}
      </div>
      </div>{/* end inner history flex */}
      </div>{/* end History section */}
      </div>{/* end resizable container */}

      {/* Discard All Confirmation Dialog */}
      {discardConfirmOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)",
          }}
          onClick={() => { if (!discardLoading) setDiscardConfirmOpen(false); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a1a", border: "1px solid var(--status-error)", borderRadius: "8px",
              padding: "20px 24px", maxWidth: "380px", width: "90%",
              boxShadow: "0 8px 32px rgba(255,61,0,0.15), 0 0 0 1px rgba(255,61,0,0.1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <span style={{ fontSize: "16px", color: "var(--status-error)" }}>&#9888;</span>
              <span style={{
                color: "var(--status-error)", fontSize: "13px", fontWeight: "bold", letterSpacing: "0.5px",
                fontFamily: "var(--font-ui)",
              }}>
                DISCARD ALL CHANGES
              </span>
            </div>
            <p style={{ color: "#cccccc", fontSize: "12px", lineHeight: "1.5", margin: "0 0 6px" }}>
              This will permanently discard <strong style={{ color: "#ffffff" }}>{totalChanges} file{totalChanges === 1 ? "" : "s"}</strong> with unsaved changes. This action cannot be undone.
            </p>
            <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: "0 0 18px" }}>
              {workspaceGitStatus!.staged.length > 0 && <span>{workspaceGitStatus!.staged.length} staged, </span>}
              {workspaceGitStatus!.unstaged.length > 0 && <span>{workspaceGitStatus!.unstaged.length} modified, </span>}
              {workspaceGitStatus!.untracked.length > 0 && <span>{workspaceGitStatus!.untracked.length} untracked</span>}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setDiscardConfirmOpen(false)}
                disabled={discardLoading}
                style={{
                  padding: "6px 16px", background: "transparent", border: "1px solid var(--border-strong)",
                  color: "#cccccc", fontSize: 12, fontWeight: "bold", cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                  borderRadius: "4px", letterSpacing: "0.3px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#ffffff0a"; e.currentTarget.style.borderColor = "#666666"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
              >
                CANCEL
              </button>
              <button
                onClick={async () => {
                  if (!dir) return;
                  setDiscardLoading(true);
                  try {
                    // Unstage staged files first, then discard
                    for (const c of workspaceGitStatus!.staged) {
                      await gitUnstageFile(dir, c.path);
                    }
                    const allFiles = [
                      ...workspaceGitStatus!.staged.map((c) => c.path),
                      ...workspaceGitStatus!.unstaged.map((c) => c.path),
                      ...workspaceGitStatus!.untracked,
                    ];
                    // Deduplicate (a file can appear in both staged and unstaged)
                    const unique = [...new Set(allFiles)];
                    for (const f of unique) { await gitDiscardFile(dir, f); }
                    addToast("All changes discarded", "success");
                    onRefreshGit();
                    setDiscardConfirmOpen(false);
                  } catch (e) {
                    addToast(`Discard failed: ${e}`, "error");
                  } finally {
                    setDiscardLoading(false);
                  }
                }}
                disabled={discardLoading}
                style={{
                  padding: "6px 16px", background: discardLoading ? "#661a00" : "#cc2200",
                  border: "1px solid var(--status-error)", color: "#ffffff", fontSize: 12, fontWeight: "bold",
                  cursor: discardLoading ? "default" : "pointer",
                  fontFamily: "var(--font-ui)",
                  borderRadius: "4px", letterSpacing: "0.3px",
                }}
                onMouseEnter={(e) => { if (!discardLoading) e.currentTarget.style.background = "var(--status-error)"; }}
                onMouseLeave={(e) => { if (!discardLoading) e.currentTarget.style.background = "#cc2200"; }}
              >
                {discardLoading ? "DISCARDING..." : "DISCARD ALL"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});


// ---------------------------------------------------------------------------
// Panel: Hub (opens the overlay HubBrowser)
// ---------------------------------------------------------------------------
const HubPanel = memo(function HubPanel() {
  const { setHubBrowserOpen } = useAppStore();
  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: 12, letterSpacing: "1px" }}>
        GITHUB HUB
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
        Browse, search, and clone GitHub repositories.
      </div>
      <button
        onClick={() => setHubBrowserOpen(true)}
        style={{
          background: "var(--bg-tertiary)", border: "1px solid var(--status-running)", color: "var(--status-running)",
          fontSize: 12, fontFamily: "var(--font-ui)",
          cursor: "pointer", padding: "8px 12px", fontWeight: "bold", letterSpacing: "0.5px",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#00c85322"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
      >
        OPEN HUB BROWSER
      </button>
    </div>
  );
});


// ---------------------------------------------------------------------------
// Panel: MCP
// ---------------------------------------------------------------------------
const McpPanel = memo(function McpPanel() {
  const { setMcpManagerOpen } = useAppStore();
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: 12, letterSpacing: "1px" }}>
        MCP SERVERS
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
        Manage Model Context Protocol servers for your workspace.
      </div>
      <button
        onClick={() => {
          const focused = sessions.find((s) => s.id === focusedSessionId);
          setMcpManagerOpen(true, focused?.working_dir ?? activeWorkspace?.repo_path ?? undefined);
        }}
        style={{
          background: "var(--bg-tertiary)", border: "1px solid #d500f9", color: "#d500f9",
          fontSize: 12, fontFamily: "var(--font-ui)",
          cursor: "pointer", padding: "8px 12px", fontWeight: "bold", letterSpacing: "0.5px",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#d500f922"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
      >
        OPEN MCP MANAGER
      </button>
    </div>
  );
});


// ---------------------------------------------------------------------------
// Panel: Settings
// ---------------------------------------------------------------------------
const SettingsPanel = memo(function SettingsPanel() {
  const { setSettingsOpen } = useWorkspaceStore();
  const { setSkillsPanelOpen, setClaudeMdEditorOpen, setGitSetupWizardOpen, setMcpManagerOpen, setHubBrowserOpen } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const sessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const activeSessions = sessions.filter((s) => s.workspace_id === activeWorkspaceId);

  const buttons = [
    { label: "SETTINGS", onClick: () => setSettingsOpen(true), color: "var(--text-accent)" },
    { label: "MCP SERVERS", onClick: () => {
      const focused = sessions.find((s) => s.id === focusedSessionId);
      setMcpManagerOpen(true, focused?.working_dir ?? activeWorkspace?.repo_path ?? undefined);
    }, color: "#d500f9" },
    { label: "SKILLS", onClick: () => setSkillsPanelOpen(true), color: "var(--status-idle)" },
    { label: "AGENTS.md", onClick: () => {
      const dir = activeWorkspace?.repo_path ?? activeSessions[0]?.working_dir;
      // Editor also exposes global scopes, so an open dir is preferred but not required.
      setClaudeMdEditorOpen(true, dir);
      if (!dir) addToast("No project open — editing global agent instructions", "info");
    }, color: "var(--status-waiting)" },
    { label: "GITHUB HUB", onClick: () => setHubBrowserOpen(true), color: "var(--status-running)" },
    { label: "GIT SETUP", onClick: () => setGitSetupWizardOpen(true), color: "var(--text-accent)" },
    { label: "CHECK FOR UPDATES", onClick: () => {
      window.open("https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal/releases/latest", "_blank");
    }, color: "var(--text-secondary)" },
  ];

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "6px", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: 12, letterSpacing: "1px" }}>
          SETTINGS & TOOLS
        </span>
        <VersionBadge />
      </div>
      {buttons.map((btn) => (
        <button
          key={btn.label}
          onClick={btn.onClick}
          style={{
            background: "var(--bg-tertiary)", border: `1px solid ${btn.color}66`, color: btn.color,
            fontSize: 12, fontFamily: "var(--font-ui)",
            cursor: "pointer", padding: "8px 12px", textAlign: "left", fontWeight: "bold",
            letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${btn.color}15`; e.currentTarget.style.borderColor = btn.color; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.borderColor = `${btn.color}66`; }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
});


// ---------------------------------------------------------------------------
// Main Sidebar export (top tabbed panel)
// ---------------------------------------------------------------------------
const SIDEBAR_WIDTH = 300;

export const Sidebar = memo(function Sidebar() {
  const { workspaces, activeWorkspaceId, sidebarOpen, activePanel, setActivePanel } = useWorkspaceStore();
  const sessions = useSessionStore((s) => s.sessions);
  const [workspaceGitStatus, setWorkspaceGitStatus] = useState<GitStatusInfo | null>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const activeSessions = sessions.filter((s) => s.workspace_id === activeWorkspaceId);

  // Fetch git status for active workspace repo
  useEffect(() => {
    const dir = activeWorkspace?.repo_path ?? activeSessions[0]?.working_dir;
    if (!dir) { setWorkspaceGitStatus(null); return; }
    gitStatus(dir).then(setWorkspaceGitStatus).catch(() => setWorkspaceGitStatus(null));
    const interval = setInterval(() => {
      gitStatus(dir).then(setWorkspaceGitStatus).catch(() => setWorkspaceGitStatus(null));
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keying on the first session's dir
  }, [activeWorkspace?.repo_path, activeSessions[0]?.working_dir]);

  const firstSessionDir = activeSessions[0]?.working_dir ?? null;

  const refreshGitStatus = useCallback(async () => {
    const dir = activeWorkspace?.repo_path ?? firstSessionDir;
    if (!dir) return;
    try {
      const s = await gitStatus(dir);
      setWorkspaceGitStatus(s);
    } catch (e) { console.warn("Failed to refresh git status:", e); }
  }, [activeWorkspace?.repo_path, firstSessionDir]);

  const totalChanges = (workspaceGitStatus?.staged.length ?? 0)
    + (workspaceGitStatus?.unstaged.length ?? 0)
    + (workspaceGitStatus?.untracked.length ?? 0);

  const fileTreeDir = activeWorkspace?.repo_path ?? firstSessionDir;

  const gitChangesMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!workspaceGitStatus) return map;
    for (const f of workspaceGitStatus.staged) {
      const name = f.path.split("/").pop() ?? f.path;
      map.set(name, f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M");
    }
    for (const f of workspaceGitStatus.unstaged) {
      const name = f.path.split("/").pop() ?? f.path;
      if (!map.has(name)) {
        map.set(name, f.status === "deleted" ? "D" : "M");
      }
    }
    for (const u of workspaceGitStatus.untracked) {
      const name = u.split("/").pop() ?? u;
      map.set(name, "?");
    }
    return map;
  }, [workspaceGitStatus]);

  const panel: ActivityPanel = activePanel ?? "files";
  const showPanel = sidebarOpen;

  return (
    <div
      style={{
        width: showPanel ? `${SIDEBAR_WIDTH}px` : "0px",
        height: "100%",
        overflow: "hidden",
        transition: "width 0.2s ease",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: SIDEBAR_WIDTH,
          height: "100%",
          background: "rgba(18, 18, 18, 0.94)",
          border: "1px solid var(--border-default)",
          borderRadius: 12,
          boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: "12px",
          overflow: "hidden",
          contain: "content",
        }}
      >
        {/* Top tab bar — Files / Search / Git / Agent Bus / Settings */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid var(--border-default)",
            background: "rgba(10,10,10,0.5)",
            flexShrink: 0,
          }}
        >
          {ACTIVITY_ITEMS.map((item) => {
            const isActive = panel === item.id;
            const badge = item.id === "git" ? totalChanges : 0;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                title={item.label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  padding: "7px 2px 5px",
                  background: isActive ? "rgba(255,140,0,0.10)" : "transparent",
                  border: "none",
                  borderBottom: `2px solid ${isActive ? "var(--text-accent)" : "transparent"}`,
                  color: isActive ? "var(--text-accent)" : "var(--text-faint)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "color 0.12s ease, background 0.12s ease",
                  minWidth: 0,
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--text-secondary)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--text-faint)"; }}
              >
                <ItemIcon size={18} weight={isActive ? "fill" : "regular"} />
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.2 }}>{item.label}</span>
                {badge > 0 && (
                  <span style={{
                    position: "absolute", top: 4, right: "50%", marginRight: -18,
                    background: "var(--status-waiting)", color: "var(--bg-primary)",
                    fontSize: 9, fontWeight: 700, fontFamily: "var(--font-ui)",
                    minWidth: 13, height: 13, lineHeight: "13px", textAlign: "center",
                    borderRadius: 7, padding: "0 3px",
                  }}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active workspace context line */}
        {activeWorkspace?.name && (
          <div style={{
            padding: "5px 12px", borderBottom: "1px solid var(--border-default)",
            color: "var(--text-muted)", fontSize: 10, letterSpacing: 0.5,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {activeWorkspace.name}
          </div>
        )}

        {/* Panel body */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {panel === "files" && (
            <FilesPanel fileTreeDir={fileTreeDir} gitChangesMap={gitChangesMap} />
          )}
          {panel === "search" && fileTreeDir && (
            <ProjectSearch rootPath={fileTreeDir} />
          )}
          {panel === "search" && !fileTreeDir && (
            <div style={{ padding: "16px 12px", color: "var(--text-muted)", fontSize: 12 }}>
              Open a session to search files.
            </div>
          )}
          {panel === "git" && (
            <GitPanel
              workspaceGitStatus={workspaceGitStatus}
              activeWorkspace={activeWorkspace ? { repo_path: activeWorkspace.repo_path, name: activeWorkspace.name } : undefined}
              activeSessions={activeSessions}
              onRefreshGit={refreshGitStatus}
            />
          )}
          {panel === "agentbus" && <AgentBusPanel />}
          {panel === "analytics" && <AnalyticsPanel />}
          {panel === "settings" && <SettingsPanel />}
        </div>
      </div>
    </div>
  );
});
