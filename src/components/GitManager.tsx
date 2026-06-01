import { memo, useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { UI_ICON } from "../lib/icons";
import {
  gitStatus, gitPush, gitPull, gitCommit, gitStageFile, gitUnstageFile,
  gitCreateBranch, gitSwitchBranch, gitListBranches, gitLog, gitDiscardFile,
  gitFetch, gitStash, gitStageAll, gitShowCommit,
  gitInit, gitDeleteBranch, gitMergeBranch, gitAmendCommit, gitDiscardAll,
  gitTag, gitListTags, gitCherryPick, gitRevertCommit, gitStashList, gitStashDrop,
  gitStashApply, gitTagDelete, gitRenameBranch, gitListRemotes, gitAddRemote, gitRemoveRemote,
  type GitStatusInfo, type GitBranchInfo, type GitLogEntry, type GitStashEntry, type GitRemote,
} from "../lib/ipc";

function resolveFilePath(dir: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath;
  return dir.endsWith("/") ? dir + relativePath : dir + "/" + relativePath;
}

type Tab = "changes" | "branches" | "log";

const STATUS_ICON: Record<string, { label: string; color: string; tooltip: string }> = {
  modified: { label: "M", color: "var(--status-waiting)", tooltip: "Modified" },
  added: { label: "A", color: "var(--status-running)", tooltip: "Added" },
  deleted: { label: "D", color: "var(--status-error)", tooltip: "Deleted" },
  renamed: { label: "R", color: "var(--status-idle)", tooltip: "Renamed" },
  copied: { label: "C", color: "var(--status-idle)", tooltip: "Copied" },
  untracked: { label: "?", color: "var(--text-muted)", tooltip: "Untracked" },
  conflict: { label: "!", color: "var(--status-error)", tooltip: "Conflict" },
};

const MONO_FONT = "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace";

export const GitManager = memo(function GitManager() {
  const { gitManagerOpen, setGitManagerOpen, gitManagerDir } = useAppStore();
  const { setCodeViewerOpen } = useAppStore();
  const setReviewPanelOpen = useAppStore((s) => s.setReviewPanelOpen);
  const [tab, setTab] = useState<Tab>("changes");
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [aiNaming, setAiNaming] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<string | null>(null);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [stageAllChecked, setStageAllChecked] = useState(false);
  const [amendMode, setAmendMode] = useState(false);
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [stashList, setStashList] = useState<GitStashEntry[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameBranchValue, setRenameBranchValue] = useState("");
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null);
  const [confirmRemoveRemote, setConfirmRemoveRemote] = useState<string | null>(null);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");

  const dir = gitManagerDir ?? "";
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const flash = useCallback((msg: string) => {
    setSuccess(msg);
    setError(null);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSuccess(null), 3000);
  }, []);

  const showError = useCallback((msg: string) => {
    const cleaned = String(msg).replace(/^Error:\s*/, "");
    setError(cleaned);
    setSuccess(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 8000);
  }, []);

  const refresh = useCallback(async () => {
    if (!dir) return;
    try {
      const s = await gitStatus(dir);
      setStatus(s);
      setIsGitRepo(true);
    } catch (e) {
      const msg = String(e);
      if (msg.toLowerCase().includes("not a git repository") || msg.toLowerCase().includes("not_a_repo")) {
        setIsGitRepo(false);
        setStatus(null);
      } else {
        showError(msg);
      }
    }
  }, [dir, showError]);

  const refreshBranches = useCallback(async () => {
    if (!dir) return;
    try { setBranches(await gitListBranches(dir)); } catch (e) { showError(String(e)); }
  }, [dir, showError]);

  const refreshLog = useCallback(async () => {
    if (!dir) return;
    try { setLogEntries(await gitLog(dir, 30)); } catch (e) { showError(String(e)); }
  }, [dir, showError]);

  const refreshTags = useCallback(async () => {
    if (!dir) return;
    try { setTags(await gitListTags(dir)); } catch { setTags([]); }
  }, [dir]);

  const refreshStashList = useCallback(async () => {
    if (!dir) return;
    try { setStashList(await gitStashList(dir)); } catch { setStashList([]); }
  }, [dir]);

  const refreshRemotes = useCallback(async () => {
    if (!dir) return;
    try { setRemotes(await gitListRemotes(dir)); } catch { setRemotes([]); }
  }, [dir]);

  // Refresh everything on open or dir change
  useEffect(() => {
    if (gitManagerOpen && dir) {
      refresh();
      refreshBranches();
      refreshLog();
      refreshTags();
      refreshRemotes();
      refreshStashList();
    }
  }, [gitManagerOpen, dir, refresh, refreshBranches, refreshLog, refreshTags, refreshStashList, refreshRemotes]);

  // Close the dialog on Escape (don't steal Escape from the branch-search dropdown)
  useEffect(() => {
    if (!gitManagerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !branchDropdownOpen) {
        e.preventDefault();
        setGitManagerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gitManagerOpen, branchDropdownOpen, setGitManagerOpen]);

  // Refresh specific tab data when tab changes
  useEffect(() => {
    if (gitManagerOpen && dir) {
      if (tab === "branches") { refreshBranches(); refreshTags(); }
      if (tab === "log") refreshLog();
      if (tab === "changes") refreshStashList();
    }
  }, [tab, gitManagerOpen, dir, refreshBranches, refreshLog]);

  // --- Git operations with feedback ---

  const handlePush = useCallback(async () => {
    if (!dir) return;
    setLoading("push");
    setError(null);
    try {
      if (!status?.has_remote) {
        showError("No remote configured. Add one with: git remote add origin <url>");
        setLoading("");
        return;
      }
      const result = await gitPush(dir, false);
      const branchName = status?.branch ?? "branch";
      const aheadCount = status?.ahead ?? 0;
      const detail = aheadCount > 0
        ? `Pushed ${aheadCount} commit${aheadCount > 1 ? "s" : ""} to origin/${branchName}`
        : result || `Pushed to origin/${branchName}`;
      flash(detail);
      await refresh();
      await refreshLog();
    } catch (e) {
      showError(`Push failed: ${e}`);
    }
    setLoading("");
  }, [dir, status, refresh, refreshLog, flash, showError]);

  const handlePull = useCallback(async () => {
    if (!dir) return;
    setLoading("pull");
    setError(null);
    try {
      const result = await gitPull(dir);
      const detail = result?.includes("Already up to date")
        ? "Already up to date"
        : result || "Pulled latest changes";
      flash(detail);
      await refresh();
      await refreshLog();
    } catch (e) {
      showError(`Pull failed: ${e}`);
    }
    setLoading("");
  }, [dir, refresh, refreshLog, flash, showError]);

  const handleFetch = useCallback(async () => {
    if (!dir) return;
    setLoading("fetch");
    setError(null);
    try {
      await gitFetch(dir);
      flash("Fetched from remote");
      await refresh();
    } catch (e) {
      showError(`Fetch failed: ${e}`);
    }
    setLoading("");
  }, [dir, refresh, flash, showError]);

  const handleStash = useCallback(async (pop: boolean) => {
    if (!dir) return;
    setLoading("stash");
    setError(null);
    try {
      await gitStash(dir, pop);
      flash(pop ? "Stash popped" : "Changes stashed");
      await refresh();
      await refreshStashList();
    } catch (e) {
      showError(`Stash failed: ${e}`);
    }
    setLoading("");
  }, [dir, refresh, refreshStashList, flash, showError]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || !dir) return;
    setLoading("commit");
    setError(null);
    try {
      // If stageAllChecked, stage everything first
      if (stageAllChecked) {
        await gitStageAll(dir);
      }
      const hasStagedFiles = stageAllChecked || (status?.staged.length ?? 0) > 0;
      if (!hasStagedFiles) {
        showError("Nothing staged to commit. Stage files first or use Stage All.");
        setLoading("");
        return;
      }
      if (amendMode) {
        await gitAmendCommit(dir, commitMsg.trim() || undefined);
      } else {
        await gitCommit(dir, commitMsg.trim(), false);
      }
      setCommitMsg("");
      setStageAllChecked(false);
      setAmendMode(false);
      flash(amendMode ? "Amended successfully" : "Committed successfully");
      await refresh();
      await refreshLog();
    } catch (e) {
      showError(`Commit failed: ${e}`);
    }
    setLoading("");
  }, [dir, commitMsg, stageAllChecked, status, refresh, refreshLog, flash, showError]);

  const handleStage = useCallback(async (path: string) => {
    try { await gitStageFile(dir, path); await refresh(); } catch (e) { showError(String(e)); }
  }, [dir, refresh, showError]);

  const handleUnstage = useCallback(async (path: string) => {
    try { await gitUnstageFile(dir, path); await refresh(); } catch (e) { showError(String(e)); }
  }, [dir, refresh, showError]);

  const handleStageAllToggle = useCallback(async () => {
    if (!dir) return;
    if (!stageAllChecked) {
      // Stage everything
      try {
        await gitStageAll(dir);
        setStageAllChecked(true);
        await refresh();
      } catch (e) { showError(String(e)); }
    } else {
      // Already checked -- uncheck (visual only, files stay staged)
      setStageAllChecked(false);
    }
  }, [dir, stageAllChecked, refresh, showError]);

  const handleDiscard = useCallback(async (path: string) => {
    if (confirmDiscard !== path) {
      setConfirmDiscard(path);
      setTimeout(() => setConfirmDiscard(null), 3000);
      return;
    }
    setConfirmDiscard(null);
    try {
      await gitDiscardFile(dir, path);
      flash(`Discarded changes to ${path.split("/").pop()}`);
      await refresh();
    } catch (e) { showError(String(e)); }
  }, [dir, refresh, confirmDiscard, flash, showError]);

  const handleViewFile = useCallback((relativePath: string) => {
    const fullPath = resolveFilePath(dir, relativePath);
    setCodeViewerOpen(true, fullPath, { workingDir: dir });
  }, [dir, setCodeViewerOpen]);

  const handleViewDiff = useCallback((relativePath: string, _staged: boolean) => {
    const fullPath = resolveFilePath(dir, relativePath);
    setCodeViewerOpen(true, fullPath, { diffMode: true, workingDir: dir });
  }, [dir, setCodeViewerOpen]);

  const handleNewBranch = useCallback(async () => {
    if (!newBranch.trim()) return;
    setLoading("branch");
    setError(null);
    try {
      await gitCreateBranch(dir, newBranch.trim(), true);
      flash(`Created and switched to ${newBranch.trim()}`);
      setNewBranch("");
      await refresh();
      await refreshBranches();
    } catch (e) { showError(String(e)); }
    setLoading("");
  }, [dir, newBranch, refresh, refreshBranches, flash, showError]);

  const handleSwitchBranch = useCallback(async (name: string) => {
    setLoading("branch");
    setError(null);
    setBranchDropdownOpen(false);
    try {
      await gitSwitchBranch(dir, name.replace(/^origin\//, ""));
      flash(`Switched to ${name}`);
      await refresh();
      await refreshBranches();
      await refreshLog();
    } catch (e) { showError(String(e)); }
    setLoading("");
  }, [dir, refresh, refreshBranches, refreshLog, flash, showError]);

  const handleViewCommit = useCallback(async (hash: string) => {
    if (selectedCommit === hash) {
      setSelectedCommit(null);
      setCommitDetail(null);
      return;
    }
    setSelectedCommit(hash);
    setCommitDetail(null);
    try {
      const detail = await gitShowCommit(dir, hash);
      setCommitDetail(detail);
    } catch (e) {
      setCommitDetail(`Error loading commit: ${e}`);
    }
  }, [dir, selectedCommit]);

  const handleDiscardAll = useCallback(async () => {
    if (!confirmDiscardAll) {
      setConfirmDiscardAll(true);
      setTimeout(() => setConfirmDiscardAll(false), 3000);
      return;
    }
    setConfirmDiscardAll(false);
    setLoading("discard");
    try {
      await gitDiscardAll(dir);
      flash("Discarded all changes");
      await refresh();
    } catch (e) { showError(`Discard failed: ${e}`); }
    setLoading("");
  }, [dir, confirmDiscardAll, refresh, flash, showError]);

  const handleDeleteBranch = useCallback(async (name: string) => {
    if (confirmDeleteBranch !== name) {
      setConfirmDeleteBranch(name);
      setTimeout(() => setConfirmDeleteBranch(null), 3000);
      return;
    }
    setConfirmDeleteBranch(null);
    try {
      await gitDeleteBranch(dir, name, false);
      flash(`Deleted branch ${name}`);
      await refreshBranches();
    } catch (e) { showError(`Delete failed: ${e}`); }
  }, [dir, confirmDeleteBranch, refreshBranches, flash, showError]);

  const handleMergeBranch = useCallback(async (name: string) => {
    setLoading("merge");
    try {
      await gitMergeBranch(dir, name);
      flash(`Merged ${name} into ${status?.branch ?? "current"}`);
      await refresh();
      await refreshBranches();
      await refreshLog();
    } catch (e) { showError(`Merge failed: ${e}`); }
    setLoading("");
  }, [dir, status, refresh, refreshBranches, refreshLog, flash, showError]);

  const handleGitInit = useCallback(async () => {
    if (!dir) return;
    setLoading("init");
    try {
      await gitInit(dir);
      flash("Initialized git repository");
      setIsGitRepo(true);
      await refresh();
      await refreshBranches();
    } catch (e) { showError(`Init failed: ${e}`); }
    setLoading("");
  }, [dir, refresh, refreshBranches, flash, showError]);

  const handleCreateTag = useCallback(async () => {
    if (!newTag.trim() || !dir) return;
    try {
      await gitTag(dir, newTag.trim());
      flash(`Created tag ${newTag.trim()}`);
      setNewTag("");
      await refreshTags();
    } catch (e) { showError(`Tag failed: ${e}`); }
  }, [dir, newTag, refreshTags, flash, showError]);

  const handleCherryPick = useCallback(async (hash: string) => {
    setLoading("cherrypick");
    try {
      await gitCherryPick(dir, hash);
      flash(`Cherry-picked ${hash.slice(0, 7)}`);
      await refresh();
      await refreshLog();
    } catch (e) { showError(`Cherry-pick failed: ${e}`); }
    setLoading("");
  }, [dir, refresh, refreshLog, flash, showError]);

  const handleRevert = useCallback(async (hash: string) => {
    setLoading("revert");
    try {
      await gitRevertCommit(dir, hash);
      flash(`Reverted ${hash.slice(0, 7)}`);
      await refresh();
      await refreshLog();
    } catch (e) { showError(`Revert failed: ${e}`); }
    setLoading("");
  }, [dir, refresh, refreshLog, flash, showError]);

  const handleStashDrop = useCallback(async (index: number) => {
    try {
      await gitStashDrop(dir, index);
      flash(`Dropped stash@{${index}}`);
      await refreshStashList();
    } catch (e) { showError(`Stash drop failed: ${e}`); }
  }, [dir, refreshStashList, flash, showError]);

  const handleStashApply = useCallback(async (index: number) => {
    try {
      await gitStashApply(dir, index);
      flash(`Applied stash@{${index}}`);
      await refresh();
    } catch (e) { showError(`Stash apply failed: ${e}`); }
  }, [dir, refresh, flash, showError]);

  const handleTagDelete = useCallback(async (name: string) => {
    if (confirmDeleteTag !== name) { setConfirmDeleteTag(name); setTimeout(() => setConfirmDeleteTag((c) => (c === name ? null : c)), 3000); return; }
    setConfirmDeleteTag(null);
    try {
      await gitTagDelete(dir, name);
      flash(`Deleted tag ${name}`);
      await refreshTags();
    } catch (e) { showError(`Tag delete failed: ${e}`); }
  }, [dir, confirmDeleteTag, refreshTags, flash, showError]);

  const handleRenameBranch = useCallback(async (oldName: string) => {
    const next = renameBranchValue.trim();
    if (!next || next === oldName) { setRenamingBranch(null); return; }
    try {
      await gitRenameBranch(dir, oldName, next);
      flash(`Renamed ${oldName} → ${next}`);
      setRenamingBranch(null);
      setRenameBranchValue("");
      await refreshBranches();
      await refresh();
    } catch (e) { showError(`Rename failed: ${e}`); }
  }, [dir, renameBranchValue, refreshBranches, refresh, flash, showError]);

  const handleAddRemote = useCallback(async () => {
    const name = newRemoteName.trim();
    const url = newRemoteUrl.trim();
    if (!name || !url) return;
    try {
      await gitAddRemote(dir, name, url);
      flash(`Added remote ${name}`);
      setNewRemoteName("");
      setNewRemoteUrl("");
      await refreshRemotes();
      await refresh();
    } catch (e) { showError(`Add remote failed: ${e}`); }
  }, [dir, newRemoteName, newRemoteUrl, refreshRemotes, refresh, flash, showError]);

  const handleRemoveRemote = useCallback(async (name: string) => {
    if (confirmRemoveRemote !== name) { setConfirmRemoveRemote(name); setTimeout(() => setConfirmRemoveRemote((c) => (c === name ? null : c)), 3000); return; }
    setConfirmRemoveRemote(null);
    try {
      await gitRemoveRemote(dir, name);
      flash(`Removed remote ${name}`);
      await refreshRemotes();
      await refresh();
    } catch (e) { showError(`Remove remote failed: ${e}`); }
  }, [dir, confirmRemoveRemote, refreshRemotes, refresh, flash, showError]);

  if (!gitManagerOpen) return null;

  const totalChanges = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const localBranches = branches.filter((b) => !b.is_remote);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "40px" }}
      onClick={() => { setGitManagerOpen(false); setBranchDropdownOpen(false); }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        onClick={(e) => { e.stopPropagation(); setBranchDropdownOpen(false); }}
        role="dialog"
        aria-modal="true"
        aria-label="Git Manager"
        style={{
          position: "relative", width: "660px", maxHeight: "700px", background: "var(--bg-secondary)",
          border: "1px solid var(--text-accent)", fontFamily: MONO_FONT, zIndex: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* === Header: Branch + Remote info === */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
              {/* Branch display + dropdown */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setBranchDropdownOpen(!branchDropdownOpen); }}
                  style={{
                    background: "var(--bg-tertiary)", border: "1px solid var(--border-default)", color: "#d500f9",
                    fontSize: "12px", fontFamily: MONO_FONT, cursor: "pointer", padding: "4px 10px",
                    fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px",
                    maxWidth: "200px",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {status?.branch ?? "..."}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{branchDropdownOpen ? "\u25B2" : "\u25BC"}</span>
                </button>
                {branchDropdownOpen && localBranches.length > 0 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute", top: "100%", left: 0, zIndex: 10,
                      background: "var(--bg-tertiary)", border: "1px solid var(--text-accent)", minWidth: "200px", maxHeight: "200px",
                      overflow: "auto",
                    }}
                  >
                    {localBranches.map((b) => (
                      <div
                        key={b.name}
                        onClick={() => !b.is_current && handleSwitchBranch(b.name)}
                        style={{
                          padding: "6px 10px", cursor: b.is_current ? "default" : "pointer",
                          color: b.is_current ? "var(--text-accent)" : "var(--text-primary)", fontSize: "11px",
                          background: b.is_current ? "var(--bg-secondary)" : "transparent",
                          borderLeft: b.is_current ? "2px solid var(--text-accent)" : "2px solid transparent",
                        }}
                        onMouseEnter={(e) => { if (!b.is_current) e.currentTarget.style.background = "var(--border-default)"; }}
                        onMouseLeave={(e) => { if (!b.is_current) e.currentTarget.style.background = b.is_current ? "var(--bg-secondary)" : "transparent"; }}
                      >
                        {b.name}
                        {b.is_current && <span style={{ marginLeft: "6px", color: "var(--status-running)", fontSize: "10px" }}>*</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ahead/Behind badges */}
              {status && status.ahead > 0 && (
                <span style={{ background: "#00c85333", color: "var(--status-running)", fontSize: "10px", padding: "2px 6px", fontWeight: "bold" }}>
                  +{status.ahead} AHEAD
                </span>
              )}
              {status && status.behind > 0 && (
                <span style={{ background: "#ff3d0033", color: "var(--status-error)", fontSize: "10px", padding: "2px 6px", fontWeight: "bold" }}>
                  -{status.behind} BEHIND
                </span>
              )}

              {/* Remote indicator */}
              {status?.has_remote ? (
                <span style={{ color: "var(--status-running)", fontSize: "10px", fontWeight: "bold" }}>
                  REMOTE
                </span>
              ) : (
                <span style={{ color: "var(--text-accent)", fontSize: "10px", fontWeight: "bold" }}>LOCAL ONLY</span>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "3px", alignItems: "center", flexShrink: 0 }}>
              <ActionBtn label="★ REVIEW" loading={false} onClick={() => setReviewPanelOpen(true, dir)} color="var(--text-accent)" bold />
              <ActionBtn label="FETCH" loading={loading === "fetch"} onClick={handleFetch} color="var(--text-muted)" />
              <ActionBtn label="STASH" loading={loading === "stash"} onClick={() => handleStash(false)} color="var(--text-muted)" />
              <ActionBtn label="POP" loading={false} onClick={() => handleStash(true)} color="var(--text-muted)" />
              <ActionBtn label={loading === "pull" ? "PULLING..." : "PULL"} loading={loading === "pull"} onClick={handlePull} color="var(--status-idle)" bold />
              <ActionBtn
                label={loading === "push" ? "PUSHING..." : `PUSH${status && status.ahead > 0 ? ` (${status.ahead})` : ""}`}
                loading={loading === "push"} onClick={handlePush} color="var(--status-running)" bold
              />
              <button onClick={() => setGitManagerOpen(false)} title="Close Git Manager (Esc)" aria-label="Close Git Manager" style={{
                background: "none", border: "none", color: "var(--text-muted)", fontSize: "16px", lineHeight: 1, cursor: "pointer",
                fontFamily: MONO_FONT, marginLeft: "6px", padding: "0 4px",
              }}>×</button>
            </div>
          </div>
          {/* Path display */}
          <div style={{ color: "var(--border-strong)", fontSize: "10px", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
          </div>
        </div>

        {/* === Feedback bars === */}
        {loading && (
          <div style={{ padding: "4px 16px", background: "#ffab0015", display: "flex", alignItems: "center", gap: "8px" }}>
            <LoadingDots />
            <span style={{ color: "var(--status-waiting)", fontSize: "10px" }}>
              {loading === "push" ? "Pushing to remote..." :
               loading === "pull" ? "Pulling from remote..." :
               loading === "commit" ? "Committing changes..." :
               loading === "fetch" ? "Fetching from remote..." :
               loading === "stash" ? "Stashing changes..." :
               loading === "branch" ? "Switching branch..." :
               loading === "discard" ? "Discarding all changes..." :
               loading === "merge" ? "Merging branch..." :
               loading === "init" ? "Initializing repository..." :
               loading === "cherrypick" ? "Cherry-picking commit..." :
               loading === "revert" ? "Reverting commit..." : "Working..."}
            </span>
          </div>
        )}
        {error && (
          <div
            style={{ padding: "6px 16px", background: "#ff3d0018", color: "var(--status-error)", fontSize: "10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}
          >
            <span style={{ flex: 1, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#ff3d0088", fontSize: "10px", cursor: "pointer", fontFamily: MONO_FONT, flexShrink: 0 }}>x</button>
          </div>
        )}
        {success && !loading && (
          <div style={{ padding: "6px 16px", background: "#00c85318", color: "var(--status-running)", fontSize: "10px" }}>{success}</div>
        )}

        {/* === Tabs === */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)" }}>
          {([
            { id: "changes" as Tab, label: "CHANGES", count: totalChanges },
            { id: "branches" as Tab, label: "BRANCHES", count: branches.length },
            { id: "log" as Tab, label: "HISTORY", count: logEntries.length },
          ]).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px", background: tab === t.id ? "var(--bg-tertiary)" : "transparent",
              border: "none", borderBottom: tab === t.id ? "2px solid var(--text-accent)" : "2px solid transparent",
              color: tab === t.id ? "var(--text-accent)" : "var(--text-faint)", fontSize: "10px", fontFamily: MONO_FONT,
              cursor: "pointer", letterSpacing: "1px",
            }}>
              {t.label}{t.count !== undefined && t.count > 0 ? ` (${t.count})` : ""}
            </button>
          ))}
        </div>

        {/* === Tab content === */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>

          {/* ---- CHANGES TAB ---- */}
          {tab === "changes" && status && (
            <div>
              {/* Commit area */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-default)" }}>
                <textarea
                  ref={commitInputRef}
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message..."
                  rows={2}
                  style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical",
                    background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)",
                    fontSize: "11px", fontFamily: MONO_FONT, padding: "8px", outline: "none",
                    minHeight: "36px", maxHeight: "100px",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--text-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleCommit(); } }}
                />
                <div style={{ display: "flex", gap: "4px", marginTop: "6px", alignItems: "center" }}>
                  {/* AI commit message (Pro) */}
                  <button
                    onClick={async () => {
                      if (!dir || aiNaming) return;
                      setAiNaming(true);
                      try {
                        const { generateCommitMessage } = await import("../lib/ipc");
                        setCommitMsg(await generateCommitMessage(dir));
                      } catch (e) {
                        showError(typeof e === "string" ? e : (e as Error)?.message ?? "Couldn't generate a message.");
                      } finally {
                        setAiNaming(false);
                      }
                    }}
                    disabled={aiNaming || !dir}
                    title="Write a commit message with AI (Pro)"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: "var(--accent-soft)", border: "1px solid var(--text-accent)",
                      color: "var(--text-accent)", fontSize: "10px", fontFamily: MONO_FONT,
                      cursor: aiNaming || !dir ? "default" : "pointer", padding: "2px 8px", fontWeight: "bold",
                    }}
                  >
                    <UI_ICON.ai size={12} weight="fill" style={{ flexShrink: 0 }} /> {aiNaming ? "…" : "AI"}
                  </button>
                  {/* Stage All checkbox */}
                  <label
                    style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", userSelect: "none" }}
                    onClick={(e) => { e.preventDefault(); handleStageAllToggle(); }}
                  >
                    <span style={{
                      width: "12px", height: "12px", border: `1px solid ${stageAllChecked ? "var(--status-running)" : "var(--text-faint)"}`,
                      background: stageAllChecked ? "#00c85333" : "transparent", display: "inline-flex",
                      alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--status-running)",
                    }}>
                      {stageAllChecked ? "\u2713" : ""}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>STAGE ALL</span>
                  </label>

                  {/* Discard All */}
                  <button
                    onClick={handleDiscardAll}
                    disabled={loading === "discard" || totalChanges === 0}
                    style={{
                      background: "none", border: "1px solid #ff3d0066", color: confirmDiscardAll ? "var(--status-error)" : "#ff3d0088",
                      fontSize: "10px", fontFamily: MONO_FONT, cursor: totalChanges > 0 ? "pointer" : "default",
                      padding: "2px 6px", fontWeight: confirmDiscardAll ? "bold" : "normal",
                    }}
                  >
                    {confirmDiscardAll ? "CONFIRM DISCARD ALL?" : "DISCARD ALL"}
                  </button>

                  <span style={{ flex: 1 }} />

                  {/* Amend checkbox */}
                  <label
                    style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", userSelect: "none" }}
                    onClick={(e) => { e.preventDefault(); setAmendMode(!amendMode); }}
                  >
                    <span style={{
                      width: "12px", height: "12px", border: `1px solid ${amendMode ? "var(--status-waiting)" : "var(--text-faint)"}`,
                      background: amendMode ? "#ffab0033" : "transparent", display: "inline-flex",
                      alignItems: "center", justifyContent: "center", fontSize: "10px", color: "var(--status-waiting)",
                    }}>
                      {amendMode ? "\u2713" : ""}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>AMEND</span>
                  </label>

                  <span style={{ color: "var(--border-strong)", fontSize: "10px" }}>Cmd+Enter</span>

                  {/* Commit button */}
                  <button
                    onClick={handleCommit}
                    disabled={!commitMsg.trim() || loading === "commit"}
                    style={{
                      background: commitMsg.trim() ? (amendMode ? "var(--status-waiting)" : "var(--text-accent)") : "var(--border-default)", border: "none",
                      color: commitMsg.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: "10px",
                      fontFamily: MONO_FONT, cursor: commitMsg.trim() ? "pointer" : "default",
                      padding: "5px 14px", fontWeight: "bold",
                    }}
                  >
                    {loading === "commit" ? "COMMITTING..." : amendMode ? "AMEND" : "COMMIT"}
                  </button>
                </div>
              </div>

              {/* Staged files */}
              {status.staged.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-running)", letterSpacing: "1px", fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
                    <span>STAGED ({status.staged.length})</span>
                    <button
                      onClick={async () => {
                        for (const f of status.staged) {
                          await gitUnstageFile(dir, f.path).catch(() => {});
                        }
                        await refresh();
                      }}
                      style={{ background: "none", border: "none", color: "#ffab0088", fontSize: "10px", cursor: "pointer", fontFamily: MONO_FONT }}
                    >UNSTAGE ALL</button>
                  </div>
                  {status.staged.map((f) => (
                    <FileRow key={`s-${f.path}`} path={f.path} status={f.status} onAction={() => handleUnstage(f.path)} actionLabel="UNSTAGE" actionColor="var(--status-waiting)"
                      onDiff={() => handleViewDiff(f.path, true)} onView={() => handleViewFile(f.path)} />
                  ))}
                </div>
              )}

              {/* Unstaged files */}
              {status.unstaged.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-waiting)", letterSpacing: "1px", fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
                    <span>MODIFIED ({status.unstaged.length})</span>
                    <button
                      onClick={async () => {
                        for (const f of status.unstaged) {
                          await gitStageFile(dir, f.path).catch(() => {});
                        }
                        await refresh();
                      }}
                      style={{ background: "none", border: "none", color: "#00c85388", fontSize: "10px", cursor: "pointer", fontFamily: MONO_FONT }}
                    >STAGE ALL</button>
                  </div>
                  {status.unstaged.map((f) => (
                    <FileRow key={`u-${f.path}`} path={f.path} status={f.status} onAction={() => handleStage(f.path)} actionLabel="STAGE"
                      actionColor="var(--status-running)" secondAction={() => handleDiscard(f.path)} secondLabel={confirmDiscard === f.path ? "CONFIRM?" : "DISCARD"}
                      onDiff={() => handleViewDiff(f.path, false)} onView={() => handleViewFile(f.path)} />
                  ))}
                </div>
              )}

              {/* Untracked files */}
              {status.untracked.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-idle)", letterSpacing: "1px", fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
                    <span>UNTRACKED ({status.untracked.length})</span>
                    <button
                      onClick={async () => {
                        for (const p of status.untracked) {
                          await gitStageFile(dir, p).catch(() => {});
                        }
                        await refresh();
                      }}
                      style={{ background: "none", border: "none", color: "#00c85388", fontSize: "10px", cursor: "pointer", fontFamily: MONO_FONT }}
                    >STAGE ALL</button>
                  </div>
                  {status.untracked.map((p) => (
                    <FileRow key={`t-${p}`} path={p} status="added" onAction={() => handleStage(p)} actionLabel="STAGE" actionColor="var(--status-running)"
                      onDiff={() => handleViewDiff(p, false)} onView={() => handleViewFile(p)} />
                  ))}
                </div>
              )}

              {/* Stash list */}
              {stashList.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--text-muted)", letterSpacing: "1px", fontWeight: "bold", marginTop: "4px" }}>
                    STASHES ({stashList.length})
                  </div>
                  {stashList.map((s) => (
                    <div
                      key={s.index}
                      style={{ display: "flex", alignItems: "center", padding: "4px 16px", gap: "8px", fontSize: "11px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: "bold", minWidth: "20px" }}>{s.index}</span>
                      <span style={{ color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.message}</span>
                      <button
                        onClick={() => handleStashApply(Number(s.index))}
                        title="Apply this stash, keeping it in the list"
                        style={{ background: "none", border: "1px solid #5fa8ff66", color: "var(--status-idle)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px" }}
                      >APPLY</button>
                      <button
                        onClick={() => handleStash(true)}
                        title="Apply the latest stash and remove it"
                        style={{ background: "none", border: "1px solid #00c85366", color: "var(--status-running)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px" }}
                      >POP</button>
                      <button
                        onClick={() => handleStashDrop(Number(s.index))}
                        style={{ background: "none", border: "1px solid #ff3d0066", color: "var(--status-error)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px" }}
                      >DROP</button>
                    </div>
                  ))}
                </div>
              )}

              {totalChanges === 0 && stashList.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-faint)", fontSize: "11px" }}>
                  Working tree clean -- no changes
                </div>
              )}
              {totalChanges === 0 && stashList.length > 0 && (
                <div style={{ padding: "12px 16px", textAlign: "center", color: "var(--text-faint)", fontSize: "10px" }}>
                  Working tree clean
                </div>
              )}
            </div>
          )}

          {/* ---- BRANCHES TAB ---- */}
          {tab === "branches" && !isGitRepo && (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <div style={{ color: "var(--text-faint)", fontSize: "11px", marginBottom: "12px" }}>Not a git repository</div>
              <button
                onClick={handleGitInit}
                disabled={loading === "init"}
                style={{
                  background: "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: "11px",
                  fontFamily: MONO_FONT, cursor: "pointer", padding: "8px 20px", fontWeight: "bold",
                }}
              >
                {loading === "init" ? "INITIALIZING..." : "GIT INIT"}
              </button>
            </div>
          )}
          {tab === "branches" && isGitRepo && (
            <div>
              {/* Current branch display */}
              {status && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ color: "var(--text-faint)", fontSize: "10px", letterSpacing: "1px" }}>CURRENT</span>
                  <span style={{ color: "#d500f9", fontSize: "13px", fontWeight: "bold" }}>{status.branch}</span>
                  {status.ahead > 0 && <span style={{ background: "#00c85333", color: "var(--status-running)", fontSize: "10px", padding: "1px 5px" }}>+{status.ahead}</span>}
                  {status.behind > 0 && <span style={{ background: "#ff3d0033", color: "var(--status-error)", fontSize: "10px", padding: "1px 5px" }}>-{status.behind}</span>}
                </div>
              )}

              {/* New branch */}
              <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", gap: "4px" }}>
                <input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  placeholder="New branch name..."
                  style={{ flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO_FONT, padding: "6px 8px", outline: "none" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--text-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                  onKeyDown={(e) => { if (e.key === "Enter") handleNewBranch(); }}
                />
                <button onClick={handleNewBranch} disabled={!newBranch.trim() || loading === "branch"} style={{
                  background: newBranch.trim() ? "var(--text-accent)" : "var(--border-default)", border: "none",
                  color: newBranch.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: "10px",
                  fontFamily: MONO_FONT, cursor: newBranch.trim() ? "pointer" : "default",
                  padding: "6px 12px", fontWeight: "bold",
                }}>
                  {loading === "branch" ? "..." : "NEW BRANCH"}
                </button>
              </div>

              {/* Local branches */}
              <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--text-accent)", letterSpacing: "1px", fontWeight: "bold" }}>LOCAL</div>
              {branches.filter((b) => !b.is_remote).map((b) => (
                <div
                  key={b.name}
                  onClick={() => !b.is_current && handleSwitchBranch(b.name)}
                  style={{
                    display: "flex", alignItems: "center", padding: "6px 16px", gap: "8px",
                    cursor: b.is_current ? "default" : "pointer",
                    background: b.is_current ? "var(--bg-tertiary)" : "transparent",
                    borderLeft: b.is_current ? "2px solid var(--text-accent)" : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!b.is_current) e.currentTarget.style.background = "#1a1a1a"; }}
                  onMouseLeave={(e) => { if (!b.is_current) e.currentTarget.style.background = b.is_current ? "var(--bg-tertiary)" : "transparent"; }}
                >
                  {renamingBranch === b.name ? (
                    <input
                      autoFocus
                      value={renameBranchValue}
                      onChange={(e) => setRenameBranchValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") handleRenameBranch(b.name); if (e.key === "Escape") setRenamingBranch(null); }}
                      onBlur={() => handleRenameBranch(b.name)}
                      style={{ flex: 1, background: "var(--bg-primary)", border: "1px solid var(--text-accent)", color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO_FONT, padding: "2px 6px", outline: "none" }}
                    />
                  ) : (
                    <span style={{ color: b.is_current ? "var(--text-accent)" : "var(--text-primary)", fontSize: "11px", fontWeight: b.is_current ? "bold" : "normal" }}>{b.name}</span>
                  )}
                  {b.is_current && renamingBranch !== b.name && <span style={{ color: "var(--status-running)", fontSize: "10px" }}>*</span>}
                  {renamingBranch !== b.name && <span style={{ color: "var(--text-faint)", fontSize: "10px", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" }}>{b.last_commit}</span>}
                  {renamingBranch !== b.name && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenameBranchValue(b.name); setRenamingBranch(b.name); }}
                        title="Rename branch"
                        style={{ background: "none", border: "1px solid var(--border-strong)", color: "var(--text-muted)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px", flexShrink: 0 }}
                      >RENAME</button>
                      {!b.is_current && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMergeBranch(b.name); }}
                            style={{ background: "none", border: "1px solid #4a9eff66", color: "var(--status-idle)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px", flexShrink: 0 }}
                          >MERGE</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBranch(b.name); }}
                            style={{ background: "none", border: "1px solid #ff3d0066", color: confirmDeleteBranch === b.name ? "var(--status-error)" : "#ff3d0088", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px", flexShrink: 0, fontWeight: confirmDeleteBranch === b.name ? "bold" : "normal" }}
                          >{confirmDeleteBranch === b.name ? "CONFIRM?" : "\u2715"}</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}

              {/* Remote branches */}
              {branches.some((b) => b.is_remote) && (
                <>
                  <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-idle)", letterSpacing: "1px", fontWeight: "bold", marginTop: "4px" }}>REMOTE</div>
                  {branches.filter((b) => b.is_remote).map((b) => (
                    <div
                      key={b.name}
                      onClick={() => handleSwitchBranch(b.name)}
                      style={{ display: "flex", alignItems: "center", padding: "6px 16px", gap: "8px", cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{b.name}</span>
                      <span style={{ color: "var(--text-faint)", fontSize: "10px", marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "250px" }}>{b.last_commit}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Tags section */}
              <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-waiting)", letterSpacing: "1px", fontWeight: "bold", marginTop: "4px" }}>TAGS</div>
              <div style={{ padding: "4px 16px 8px", display: "flex", gap: "4px" }}>
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="New tag name..."
                  style={{ flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO_FONT, padding: "4px 8px", outline: "none" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--text-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateTag(); }}
                />
                <button onClick={handleCreateTag} disabled={!newTag.trim()} style={{
                  background: newTag.trim() ? "var(--status-waiting)" : "var(--border-default)", border: "none",
                  color: newTag.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: "10px",
                  fontFamily: MONO_FONT, cursor: newTag.trim() ? "pointer" : "default",
                  padding: "4px 10px", fontWeight: "bold",
                }}>TAG</button>
              </div>
              {tags.length > 0 ? tags.map((t) => (
                <div
                  key={t}
                  style={{ display: "flex", alignItems: "center", padding: "3px 16px", fontSize: "11px", color: "var(--text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: "var(--status-waiting)", marginRight: "8px", fontSize: "10px" }}>#</span>
                  <span style={{ flex: 1 }}>{t}</span>
                  <button
                    onClick={() => handleTagDelete(t)}
                    title="Delete tag"
                    style={{ background: "none", border: "1px solid #ff3d0066", color: confirmDeleteTag === t ? "var(--status-error)" : "#ff3d0088", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px", fontWeight: confirmDeleteTag === t ? "bold" : "normal" }}
                  >{confirmDeleteTag === t ? "CONFIRM?" : "✕"}</button>
                </div>
              )) : (
                <div style={{ padding: "4px 16px", fontSize: "10px", color: "var(--text-faint)" }}>No tags</div>
              )}

              {/* Remotes section */}
              <div style={{ padding: "6px 16px", fontSize: "10px", color: "var(--status-idle)", letterSpacing: "1px", fontWeight: "bold", marginTop: "4px" }}>REMOTES</div>
              {remotes.map((r) => (
                <div
                  key={r.name}
                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 16px", fontSize: "11px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: "var(--text-primary)", fontWeight: "bold", minWidth: "56px" }}>{r.name}</span>
                  <span style={{ color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.url}>{r.url}</span>
                  <button
                    onClick={() => handleRemoveRemote(r.name)}
                    title="Remove remote"
                    style={{ background: "none", border: "1px solid #ff3d0066", color: confirmRemoveRemote === r.name ? "var(--status-error)" : "#ff3d0088", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px", fontWeight: confirmRemoveRemote === r.name ? "bold" : "normal" }}
                  >{confirmRemoveRemote === r.name ? "CONFIRM?" : "✕"}</button>
                </div>
              ))}
              <div style={{ padding: "4px 16px 10px", display: "flex", gap: "4px" }}>
                <input
                  value={newRemoteName}
                  onChange={(e) => setNewRemoteName(e.target.value)}
                  placeholder="name"
                  style={{ width: "70px", background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO_FONT, padding: "4px 6px", outline: "none" }}
                />
                <input
                  value={newRemoteUrl}
                  onChange={(e) => setNewRemoteUrl(e.target.value)}
                  placeholder="git remote URL..."
                  style={{ flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO_FONT, padding: "4px 8px", outline: "none" }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddRemote(); }}
                />
                <button onClick={handleAddRemote} disabled={!newRemoteName.trim() || !newRemoteUrl.trim()} style={{
                  background: newRemoteName.trim() && newRemoteUrl.trim() ? "var(--status-idle)" : "var(--border-default)", border: "none",
                  color: newRemoteName.trim() && newRemoteUrl.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: "10px",
                  fontFamily: MONO_FONT, cursor: newRemoteName.trim() && newRemoteUrl.trim() ? "pointer" : "default",
                  padding: "4px 10px", fontWeight: "bold",
                }}>ADD</button>
              </div>
            </div>
          )}

          {/* ---- HISTORY TAB ---- */}
          {tab === "log" && (
            <div>
              {logEntries.map((entry) => (
                <div key={entry.hash}>
                  <div
                    onClick={() => handleViewCommit(entry.hash)}
                    style={{
                      display: "flex", padding: "7px 16px", gap: "8px", cursor: "pointer",
                      borderBottom: `1px solid ${selectedCommit === entry.hash ? "#ff8c0044" : "var(--bg-tertiary)"}`,
                      background: selectedCommit === entry.hash ? "var(--bg-tertiary)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (selectedCommit !== entry.hash) e.currentTarget.style.background = "#1a1a1a"; }}
                    onMouseLeave={(e) => { if (selectedCommit !== entry.hash) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ color: "var(--text-accent)", fontSize: "10px", fontWeight: "bold", flexShrink: 0, minWidth: "56px", fontFamily: MONO_FONT }}>{entry.short_hash}</span>
                    <span style={{ color: "var(--text-primary)", fontSize: "11px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.message}</span>
                    <span style={{ color: "#666666", fontSize: "10px", flexShrink: 0, minWidth: "60px", textAlign: "right" }}>{entry.author.split(" ")[0]}</span>
                    <span style={{ color: "var(--border-strong)", fontSize: "10px", flexShrink: 0, minWidth: "80px", textAlign: "right" }}>{entry.date}</span>
                  </div>
                  {/* Expanded commit detail */}
                  {selectedCommit === entry.hash && (
                    <div style={{
                      padding: "8px 16px 10px 80px", background: "#0e0e0e",
                      borderBottom: "1px solid #ff8c0033", fontSize: "10px",
                    }}>
                      <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
                        <button
                          onClick={() => handleCherryPick(entry.hash)}
                          disabled={loading === "cherrypick"}
                          style={{ background: "none", border: "1px solid #00c85366", color: "var(--status-running)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "2px 6px" }}
                        >CHERRY-PICK</button>
                        <button
                          onClick={() => handleRevert(entry.hash)}
                          disabled={loading === "revert"}
                          style={{ background: "none", border: "1px solid #ff3d0066", color: "var(--status-error)", fontSize: "10px", fontFamily: MONO_FONT, cursor: "pointer", padding: "2px 6px" }}
                        >REVERT</button>
                      </div>
                      {commitDetail === null ? (
                        <span style={{ color: "var(--text-faint)" }}>Loading...</span>
                      ) : (
                        <pre style={{
                          color: "#bbbbbb", fontFamily: MONO_FONT, fontSize: "10px",
                          whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
                          lineHeight: "1.5",
                        }}>
                          {commitDetail}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {logEntries.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-faint)", fontSize: "11px" }}>No commits yet</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// --- Sub-components ---

function ActionBtn({ label, loading, onClick, color, bold }: {
  label: string; loading: boolean; onClick: () => void; color: string; bold?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        background: "var(--bg-tertiary)", border: "1px solid var(--border-default)",
        color: loading ? "var(--status-waiting)" : color,
        fontSize: "10px", fontFamily: MONO_FONT, cursor: loading ? "default" : "pointer",
        padding: "4px 8px", fontWeight: bold ? "bold" : "normal",
      }}
    >
      {loading ? "..." : label}
    </button>
  );
}

function LoadingDots() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const iv = setInterval(() => setDots((d) => (d % 3) + 1), 400);
    return () => clearInterval(iv);
  }, []);
  return <span style={{ color: "var(--status-waiting)", fontSize: "10px", fontFamily: MONO_FONT, width: "20px", display: "inline-block" }}>{".".repeat(dots)}</span>;
}

function FileRow({ path, status, onAction, actionLabel, actionColor, secondAction, secondLabel, onDiff, onView }: {
  path: string; status: string; onAction: () => void; actionLabel: string; actionColor: string;
  secondAction?: () => void; secondLabel?: string; onDiff?: () => void; onView?: () => void;
}) {
  const icon = STATUS_ICON[status] ?? { label: "?", color: "var(--text-muted)", tooltip: "Unknown" };
  return (
    <div
      style={{ display: "flex", alignItems: "center", padding: "4px 16px", gap: "8px", fontSize: "11px", cursor: onDiff ? "pointer" : "default" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onClick={onDiff}
    >
      <span
        title={icon.tooltip}
        style={{ color: icon.color, fontWeight: "bold", minWidth: "14px", width: "14px", flexShrink: 0, textAlign: "center", fontSize: "10px", display: "inline-block" }}
      >{icon.label}</span>
      <span style={{ color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{path}</span>
      {onView && (
        <button onClick={(e) => { e.stopPropagation(); onView(); }} style={{
          background: "none", border: "1px solid #4a9eff66", color: "var(--status-idle)", fontSize: "10px",
          fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px",
        }}>VIEW</button>
      )}
      {onDiff && (
        <button onClick={(e) => { e.stopPropagation(); onDiff(); }} style={{
          background: "none", border: "1px solid #ff8c0066", color: "var(--text-accent)", fontSize: "10px",
          fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px",
        }}>DIFF</button>
      )}
      {secondAction && (
        <button onClick={(e) => { e.stopPropagation(); secondAction(); }} style={{
          background: "none", border: "1px solid #ff3d0066", color: "var(--status-error)", fontSize: "10px",
          fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px",
        }}>{secondLabel}</button>
      )}
      <button onClick={(e) => { e.stopPropagation(); onAction(); }} style={{
        background: "none", border: `1px solid ${actionColor}66`, color: actionColor, fontSize: "10px",
        fontFamily: MONO_FONT, cursor: "pointer", padding: "1px 4px",
      }}>{actionLabel}</button>
    </div>
  );
}
