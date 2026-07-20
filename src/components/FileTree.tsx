import { memo, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { createFolder, listDirectory, renameFile, deleteFile, copyFile, moveFile, writeFileContents, type FileEntry } from "../lib/ipc";
import { useAppStore } from "../stores/appStore";
import { getFileIconUrl } from "../lib/fileIcons";
import { invoke } from "@tauri-apps/api/core";
import { UI_ICON } from "../lib/icons";

// Request deduplication: tracks in-flight directory loads
const pendingLoads = new Set<string>();

// Binary file detection
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'exe', 'dll', 'so', 'dylib',
  'woff', 'woff2', 'ttf', 'eot',
  'class', 'o', 'obj', 'pyc', 'wasm', 'sqlite', 'db', 'DS_Store',
]);

function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

// File extension to color mapping for visual hints
const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#f7df1e",
  json: "#cb8742",
  md: "#519aba",
  css: "#563d7c",
  scss: "#c6538c",
  html: "#e34c26",
  rs: "#dea584",
  toml: "#9c4221",
  yaml: "#cb171e",
  yml: "#cb171e",
  py: "#3572a5",
  go: "#00add8",
  sh: "#89e051",
  zsh: "#89e051",
  bash: "#89e051",
  svg: "#ffb13b",
  png: "#a074c4",
  jpg: "#a074c4",
  gif: "#a074c4",
  lock: "var(--text-faint)",
  env: "#ecd53f",
  gitignore: "#f14e32",
  dockerfile: "#384d54",
};

function getFileColor(name: string): string {
  // Special file names
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile."))
    return EXT_COLORS.dockerfile || "var(--text-muted)";
  if (lower === ".gitignore") return EXT_COLORS.gitignore || "var(--text-muted)";
  if (lower === ".env" || lower.startsWith(".env."))
    return EXT_COLORS.env || "var(--text-muted)";

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_COLORS[ext] ?? "var(--text-muted)";
}

// Git status indicator colors
const GIT_STATUS_COLORS: Record<string, string> = {
  M: "var(--status-waiting)",
  A: "var(--status-running)",
  D: "var(--status-error)",
  U: "#d500f9",
  "?": "var(--text-faint)",
};

interface ContextMenuProps {
  x: number;
  y: number;
  entry: FileEntry;
  rootPath: string;
  onClose: () => void;
  onRefresh: () => void;
  onRefreshDir: (dirPath: string) => void;
}

const ContextMenu = memo(function ContextMenu({ x, y, entry, rootPath, onClose, onRefresh, onRefreshDir }: ContextMenuProps) {
  const [action, setAction] = useState<"rename" | "move" | "copy" | "delete" | "new-file" | "new-folder" | null>(null);
  const [inputValue, setInputValue] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") onClose();
        return;
      }
      const target = e.target as HTMLElement;
      if (!target.closest("[data-context-menu]")) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [onClose]);

  useEffect(() => {
    if (action === "rename") {
      setInputValue(entry.name);
      setTimeout(() => {
        inputRef.current?.focus();
        const dotIdx = entry.name.lastIndexOf(".");
        inputRef.current?.setSelectionRange(0, dotIdx > 0 && !entry.is_dir ? dotIdx : entry.name.length);
      }, 50);
    } else if (action === "move" || action === "copy") {
      const parent = entry.path.substring(0, entry.path.lastIndexOf("/"));
      setInputValue(parent);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (action === "new-file" || action === "new-folder") {
      setInputValue("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [action, entry]);

  const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/"));

  const handleRename = async () => {
    if (!inputValue.trim() || inputValue === entry.name) { onClose(); return; }
    setLoading(true);
    setError(null);
    try {
      await renameFile(entry.path, inputValue.trim());
      onRefreshDir(parentDir);
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await deleteFile(entry.path);
      onRefreshDir(parentDir);
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const handleMove = async () => {
    if (!inputValue.trim()) { onClose(); return; }
    setLoading(true);
    setError(null);
    try {
      await moveFile(entry.path, inputValue.trim());
      onRefreshDir(parentDir);
      onRefreshDir(inputValue.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!inputValue.trim()) { onClose(); return; }
    setLoading(true);
    setError(null);
    try {
      await copyFile(entry.path, inputValue.trim());
      onRefreshDir(inputValue.trim());
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const handleNewFile = async () => {
    if (!inputValue.trim()) { onClose(); return; }
    setLoading(true);
    setError(null);
    try {
      const targetDir = entry.is_dir ? entry.path : parentDir;
      const filePath = `${targetDir}/${inputValue.trim()}`;
      await writeFileContents(filePath, "");
      onRefreshDir(targetDir);
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  const handleNewFolder = async () => {
    if (!inputValue.trim()) { onClose(); return; }
    setLoading(true);
    setError(null);
    try {
      const targetDir = entry.is_dir ? entry.path : parentDir;
      await createFolder(targetDir, inputValue.trim());
      onRefreshDir(targetDir);
      onClose();
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  // --- New context menu actions ---

  const handleRevealInFinder = async () => {
    onClose();
    try {
      await invoke("reveal_in_finder", { path: entry.path });
    } catch { /* ignore */ }
  };

  const handleOpenInDefaultApp = async () => {
    onClose();
    try {
      await invoke("open_in_default_app", { path: entry.path });
    } catch { /* ignore */ }
  };

  const handleCopyPath = () => {
    onClose();
    invoke("clipboard_write", { text: entry.path }).catch(() => {});
  };

  const handleCopyRelativePath = () => {
    onClose();
    const relative = entry.path.startsWith(rootPath + "/")
      ? entry.path.substring(rootPath.length + 1)
      : entry.path.startsWith(rootPath)
        ? entry.path.substring(rootPath.length)
        : entry.path;
    invoke("clipboard_write", { text: relative }).catch(() => {});
  };

  const handleCopyFileName = () => {
    onClose();
    invoke("clipboard_write", { text: entry.name }).catch(() => {});
  };

  const handleOpenInTerminal = () => {
    onClose();
    const dir = entry.is_dir ? entry.path : parentDir;
    window.dispatchEvent(
      new CustomEvent("codegrid:open-terminal", { detail: { workingDir: dir } }),
    );
  };

  const MONO = "var(--font-ui)";

  // --- Sub-action panels (rename, delete, move, copy, new file/folder) ---

  if (action === "rename") {
    return createPortal(
      <div data-context-menu style={{ position: "fixed", left: x, top: y, zIndex: 9999, background: "#1a1a1a", border: "1px solid var(--text-accent)", padding: "8px", minWidth: "200px", borderRadius: "4px", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: "10px", color: "var(--text-accent)", marginBottom: "4px", fontFamily: MONO, letterSpacing: "1px" }}>RENAME</div>
        <input ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") onClose(); }}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", padding: "4px 6px", fontFamily: MONO, outline: "none" }}
        />
        {error && <div style={{ color: "var(--status-error)", fontSize: "10px", marginTop: "4px" }}>{error}</div>}
        <div style={{ display: "flex", gap: "4px", marginTop: "6px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-muted)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO }}>Cancel</button>
          <button onClick={handleRename} disabled={loading} style={{ background: "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO, fontWeight: "bold" }}>
            {loading ? "..." : "Rename"}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (action === "delete") {
    return createPortal(
      <div data-context-menu style={{ position: "fixed", left: x, top: y, zIndex: 9999, background: "#1a1a1a", border: "1px solid var(--status-error)", padding: "8px", minWidth: "200px", borderRadius: "4px", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: "10px", color: "var(--status-error)", marginBottom: "4px", fontFamily: MONO, letterSpacing: "1px" }}>DELETE</div>
        <div style={{ color: "var(--text-primary)", fontSize: "11px", fontFamily: MONO, marginBottom: "8px" }}>
          Delete <span style={{ color: "var(--text-accent)" }}>{entry.name}</span>?{entry.is_dir ? " (and all contents)" : ""}
        </div>
        {error && <div style={{ color: "var(--status-error)", fontSize: "10px", marginBottom: "4px" }}>{error}</div>}
        <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-muted)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO }}>Cancel</button>
          <button onClick={handleDelete} disabled={loading} style={{ background: "var(--status-error)", border: "none", color: "#fff", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO, fontWeight: "bold" }}>
            {loading ? "..." : "Delete"}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (action === "move" || action === "copy") {
    const isMove = action === "move";
    return createPortal(
      <div data-context-menu style={{ position: "fixed", left: x, top: y, zIndex: 9999, background: "#1a1a1a", border: "1px solid var(--text-accent)", padding: "8px", minWidth: "250px", borderRadius: "4px", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: "10px", color: "var(--text-accent)", marginBottom: "4px", fontFamily: MONO, letterSpacing: "1px" }}>{isMove ? "MOVE TO" : "COPY TO"}</div>
        <input ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") isMove ? handleMove() : handleCopy(); if (e.key === "Escape") onClose(); }}
          placeholder="Destination directory..."
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", padding: "4px 6px", fontFamily: MONO, outline: "none" }}
        />
        {error && <div style={{ color: "var(--status-error)", fontSize: "10px", marginTop: "4px" }}>{error}</div>}
        <div style={{ display: "flex", gap: "4px", marginTop: "6px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-muted)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO }}>Cancel</button>
          <button onClick={isMove ? handleMove : handleCopy} disabled={loading} style={{ background: "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO, fontWeight: "bold" }}>
            {loading ? "..." : isMove ? "Move" : "Copy"}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (action === "new-file" || action === "new-folder") {
    const isFile = action === "new-file";
    const handler = isFile ? handleNewFile : handleNewFolder;
    return createPortal(
      <div data-context-menu style={{ position: "fixed", left: x, top: y, zIndex: 9999, background: "#1a1a1a", border: "1px solid var(--text-accent)", padding: "8px", minWidth: "200px", borderRadius: "4px", boxShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: "10px", color: "var(--text-accent)", marginBottom: "4px", fontFamily: MONO, letterSpacing: "1px" }}>
          {isFile ? "NEW FILE" : "NEW FOLDER"}
        </div>
        <input ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handler(); if (e.key === "Escape") onClose(); }}
          placeholder={isFile ? "filename.ts" : "folder-name"}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", padding: "4px 6px", fontFamily: MONO, outline: "none" }}
        />
        {error && <div style={{ color: "var(--status-error)", fontSize: "10px", marginTop: "4px" }}>{error}</div>}
        <div style={{ display: "flex", gap: "4px", marginTop: "6px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-muted)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO }}>Cancel</button>
          <button onClick={handler} disabled={loading} style={{ background: "var(--text-accent)", border: "none", color: "var(--bg-primary)", fontSize: "10px", padding: "2px 8px", cursor: "pointer", fontFamily: MONO, fontWeight: "bold" }}>
            {loading ? "..." : "Create"}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // --- Default: VS Code-style context menu ---

  type MenuItem = { label: string; action: () => void; danger?: boolean; shortcut?: string } | null;

  const fileMenuItems: MenuItem[] = [
    { label: "Reveal in Finder", action: handleRevealInFinder },
    { label: "Open in Default App", action: handleOpenInDefaultApp },
    { label: "Open in Terminal", action: handleOpenInTerminal },
    null,
    { label: "Copy Path", action: handleCopyPath, shortcut: "Alt+Cmd+C" },
    { label: "Copy Relative Path", action: handleCopyRelativePath, shortcut: "Shift+Alt+Cmd+C" },
    { label: "Copy File Name", action: handleCopyFileName },
    null,
    { label: "New File", action: () => setAction("new-file") },
    { label: "New Folder", action: () => setAction("new-folder") },
    null,
    { label: "Rename", action: () => setAction("rename") },
    { label: "Move to...", action: () => setAction("move") },
    { label: "Delete", action: () => setAction("delete"), danger: true },
  ];

  const folderMenuItems: MenuItem[] = [
    { label: "Reveal in Finder", action: handleRevealInFinder },
    { label: "Open in Terminal", action: handleOpenInTerminal },
    null,
    { label: "Copy Path", action: handleCopyPath, shortcut: "Alt+Cmd+C" },
    { label: "Copy Relative Path", action: handleCopyRelativePath, shortcut: "Shift+Alt+Cmd+C" },
    null,
    { label: "New File", action: () => setAction("new-file") },
    { label: "New Folder", action: () => setAction("new-folder") },
    null,
    { label: "Rename", action: () => setAction("rename") },
    { label: "Move to...", action: () => setAction("move") },
    { label: "Delete", action: () => setAction("delete"), danger: true },
  ];

  const items = entry.is_dir ? folderMenuItems : fileMenuItems;

  // Clamp position so the menu doesn't overflow the viewport
  const menuWidth = 220;
  const menuHeight = items.length * 26;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 4);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 4);

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 9999,
        background: "#1a1a1a",
        border: "1px solid var(--border-strong)",
        borderRadius: "4px",
        minWidth: `${menuWidth}px`,
        padding: "4px 0",
        fontFamily: MONO,
        fontSize: "11px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
      }}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={`sep-${i}`} style={{ height: "1px", background: "var(--border-default)", margin: "3px 0" }} />
        ) : (
          <ContextMenuItem
            key={item.label}
            label={item.label}
            shortcut={item.shortcut}
            danger={item.danger}
            onClick={item.action}
          />
        ),
      )}
    </div>,
    document.body,
  );
});

// Extracted to avoid hooks-in-map violation
const ContextMenuItem = memo(function ContextMenuItem({ label, onClick, shortcut, danger }: { label: string; onClick: () => void; shortcut?: string; danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "5px 12px",
        fontSize: "11px",
        color: danger ? (hovered ? "#ff6040" : "var(--status-error)") : (hovered ? "var(--text-accent)" : "#cccccc"),
        background: hovered ? "var(--border-default)" : "transparent",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        border: "none",
        width: "100%",
        textAlign: "left",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span style={{ fontSize: "10px", color: "var(--text-faint)", marginLeft: "16px", flexShrink: 0 }}>
          {shortcut}
        </span>
      )}
    </div>
  );
});

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  filter: string;
  gitChanges: Map<string, string>;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  onMoveFile: (srcPath: string, destDir: string) => void;
}

const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
  filter,
  gitChanges,
  onFileClick,
  selectedPath,
  onContextMenu,
  onMoveFile,
}: FileTreeNodeProps) {
  // Folders always start collapsed — open them explicitly. Keeps the root tidy
  // (all folders first, then all root files) instead of expanded folders dumping
  // their children inline between sibling folders.
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(
    entry.children ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const isSelected = selectedPath === entry.path;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only handle left-click
      e.stopPropagation();
      // NOTE: do NOT preventDefault here — this runs on click, and calling
      // preventDefault on the preceding mousedown would cancel the native HTML5
      // drag (which is how files/folders get dragged into terminals).
      if (!entry.is_dir) {
        onFileClick(entry.path);
        return;
      }
      // Just flip the flag — loading the children is handled by the effect
      // below, which also covers folders that start expanded (depth 0). This is
      // what fixes the "click twice to expand" bug: previously the lazy-load
      // only fired on the collapse→expand transition, so a folder rendered with
      // a down-chevron but no loaded children never showed anything on first click.
      setExpanded((prev) => !prev);
    },
    [entry.is_dir, entry.path, onFileClick],
  );

  // Filter logic
  const matchesFilter =
    !filter ||
    entry.name.toLowerCase().includes(filter.toLowerCase());

  // For directories, also check if any children match
  const hasMatchingChildren = entry.is_dir && filter && children
    ? children.some((c) =>
        c.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : false;

  if (filter && !matchesFilter && !hasMatchingChildren && !entry.is_dir) {
    return null;
  }

  // Auto-expand directories when filtering
  const shouldShowExpanded =
    entry.is_dir && (expanded || (!!filter && hasMatchingChildren));

  // Load children whenever a directory needs to render expanded but hasn't been
  // loaded yet — covers both a fresh click and folders that start expanded.
  useEffect(() => {
    if (!entry.is_dir || !shouldShowExpanded || children !== null) return;
    if (pendingLoads.has(entry.path)) return;
    pendingLoads.add(entry.path);
    setLoading(true);
    listDirectory(entry.path, 1)
      .then((result) => setChildren(result))
      .catch(() => setChildren([]))
      .finally(() => {
        pendingLoads.delete(entry.path);
        setLoading(false);
      });
  }, [shouldShowExpanded, children, entry.is_dir, entry.path]);

  // Git status for this file
  const gitStatus = gitChanges.get(entry.name) ?? gitChanges.get(entry.path);

  return (
    <div>
      <div
        draggable
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(entry, e.clientX, e.clientY);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", entry.path);
          // copyMove so the same drag works both for moving into a folder
          // (move) and for inserting the path into a terminal (copy).
          e.dataTransfer.effectAllowed = "copyMove";
        }}
        onDragOver={(e) => {
          if (!entry.is_dir) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!entry.is_dir) return;
          const srcPath = e.dataTransfer.getData("text/plain");
          if (srcPath && srcPath !== entry.path && !entry.path.startsWith(srcPath + "/")) {
            onMoveFile(srcPath, entry.path);
          }
        }}
        title={entry.is_gitignored ? `${entry.name} — git-ignored (won't be committed)` : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "1px 0",
          paddingLeft: `${depth * 14 + 8}px`,
          paddingRight: "8px",
          cursor: "pointer",
          // Git-ignored entries are shown but dimmed so it's clear they exist
          // yet won't be committed.
          opacity: entry.is_gitignored ? 0.45 : 1,
          background: dragOver
            ? "rgba(255, 140, 0, 0.15)"
            : isSelected
              ? "var(--bg-tertiary)"
              : hovered
                ? "#1a1a1a"
                : "transparent",
          boxShadow: isSelected ? "inset 2px 0 0 var(--text-accent)" : dragOver ? "inset 2px 0 0 var(--text-accent)" : "none",
          minHeight: "20px",
          userSelect: "none",
        }}
      >
        {/* Folder: disclosure caret (no folder icon). File: type icon. */}
        {entry.is_dir ? (
          <span
            style={{
              width: "16px",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            {shouldShowExpanded ? (
              <UI_ICON.caretDown size={12} />
            ) : (
              <UI_ICON.caretRight size={12} />
            )}
          </span>
        ) : (
          <>
            {/* Spacer so file icons/names line up under folder names */}
            <span style={{ width: "16px", flexShrink: 0 }} />
            <img
              src={getFileIconUrl(entry.name)}
              width={16}
              height={16}
              style={{ flexShrink: 0, verticalAlign: "middle" }}
              draggable={false}
            />
          </>
        )}

        {/* File/dir name \u2014 single neutral color; only icons carry color */}
        <span
          style={{
            color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            marginLeft: 4,
          }}
        >
          {entry.name}
        </span>

        {/* Git status indicator */}
        {gitStatus && (
          <span
            style={{
              color: GIT_STATUS_COLORS[gitStatus] ?? "var(--text-muted)",
              fontSize: "10px",
              fontWeight: "bold",
              flexShrink: 0,
              marginLeft: "4px",
            }}
          >
            {gitStatus}
          </span>
        )}
      </div>

      {/* Children */}
      {entry.is_dir && shouldShowExpanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              filter={filter}
              gitChanges={gitChanges}
              onFileClick={onFileClick}
              selectedPath={selectedPath}
              onContextMenu={onContextMenu}
              onMoveFile={onMoveFile}
            />
          ))}
          {children.length === 0 && (
            <div
              style={{
                paddingLeft: `${(depth + 1) * 14 + 22}px`,
                paddingTop: "2px",
                paddingBottom: "2px",
                color: "var(--border-strong)",
                fontSize: "10px",
                fontStyle: "italic",
              }}
            >
              (empty)
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface FileTreeProps {
  rootPath: string;
  gitChanges?: Map<string, string>;
}

export const FileTree = memo(function FileTree({
  rootPath,
  gitChanges: externalGitChanges,
}: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showPath, setShowPath] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const showPathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emptyMap = useMemo(() => new Map<string, string>(), []);
  const gitChanges = externalGitChanges ?? emptyMap;

  const loadTree = useCallback(async () => {
    if (!rootPath) return;
    if (pendingLoads.has(rootPath)) return;
    pendingLoads.add(rootPath);
    setLoading(true);
    setError(null);
    try {
      const result = await listDirectory(rootPath, 1);
      setEntries(result);
    } catch (e) {
      setError(String(e));
    } finally {
      pendingLoads.delete(rootPath);
    }
    setLoading(false);
  }, [rootPath]);

  // Targeted refresh: only reload a specific directory's children in the tree
  const refreshDir = useCallback(async (dirPath: string) => {
    if (pendingLoads.has(dirPath)) return;
    pendingLoads.add(dirPath);
    try {
      const result = await listDirectory(dirPath, 1);
      if (dirPath === rootPath) {
        setEntries(result);
      } else {
        // Update entries by replacing the matching directory's children
        setEntries((prev) => {
          const updateChildren = (items: FileEntry[]): FileEntry[] =>
            items.map((item) => {
              if (item.path === dirPath) {
                return { ...item, children: result };
              }
              if (item.is_dir && item.children && dirPath.startsWith(item.path + "/")) {
                return { ...item, children: updateChildren(item.children) };
              }
              return item;
            });
          return updateChildren(prev);
        });
      }
    } catch (e) {
      console.error("Failed to refresh directory:", e);
    } finally {
      pendingLoads.delete(dirPath);
    }
  }, [rootPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Clean up the show-path timer on unmount to avoid state updates after unmount
  useEffect(() => {
    return () => {
      if (showPathTimerRef.current) {
        clearTimeout(showPathTimerRef.current);
      }
    };
  }, []);

  const setCodeViewerOpen = useAppStore((s) => s.setCodeViewerOpen);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath((prev) => (prev === path ? null : path));
    setShowPath(true);
    // Clear any previous timer before starting a new one
    if (showPathTimerRef.current) {
      clearTimeout(showPathTimerRef.current);
    }
    // Auto-hide path after 3 seconds
    showPathTimerRef.current = setTimeout(() => setShowPath(false), 3000);
    // Skip opening binary files in CodeViewer — just show path in status bar
    if (isBinaryFile(path)) {
      return;
    }
    // Open CodeViewer for the selected file, passing workingDir so DIFF mode works
    setCodeViewerOpen(true, path, { workingDir: rootPath });
  }, [setCodeViewerOpen, rootPath]);

  const handleRefresh = useCallback(() => {
    loadTree();
  }, [loadTree]);

  const handleMoveFile = useCallback(async (srcPath: string, destDir: string) => {
    try {
      await moveFile(srcPath, destDir);
      const srcParent = srcPath.substring(0, srcPath.lastIndexOf("/"));
      refreshDir(srcParent);
      refreshDir(destDir);
    } catch (e) {
      console.error("Move failed:", e);
    }
  }, [refreshDir]);

  const handleCreateFolder = useCallback(async () => {
    if (!rootPath || !newFolderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError(null);
    try {
      await createFolder(rootPath, newFolderName.trim());
      setNewFolderName("");
      await refreshDir(rootPath);
    } catch (e) {
      setFolderError(String(e));
    } finally {
      setCreatingFolder(false);
    }
  }, [rootPath, newFolderName, creatingFolder, refreshDir]);

  if (loading && entries.length === 0) {
    return (
      <div
        style={{
          padding: "8px 12px",
          color: "var(--text-faint)",
          fontSize: "10px",
          fontStyle: "italic",
        }}
      >
        Loading file tree...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "8px 12px",
          color: "var(--status-error)",
          fontSize: "10px",
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Search filter */}
      <div
        style={{
          padding: "4px 8px",
          display: "flex",
          gap: "4px",
          alignItems: "center",
        }}
      >
        <input
          ref={filterRef}
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            padding: "3px 6px",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--text-accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border-default)";
          }}
        />
        <button
          onClick={handleRefresh}
          title="Refresh"
          style={{
            background: "none",
            border: "1px solid var(--border-default)",
            color: "var(--text-faint)",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            cursor: "pointer",
            padding: "2px 5px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-accent)";
            e.currentTarget.style.borderColor = "var(--text-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-faint)";
            e.currentTarget.style.borderColor = "var(--border-default)";
          }}
        >
          {"\u21BB"}
        </button>
      </div>
      <div style={{ padding: "0 8px 4px 8px", display: "flex", gap: "4px", alignItems: "center" }}>
        <input
          type="text"
          placeholder="New folder name..."
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            padding: "3px 6px",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--status-idle)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border-default)";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateFolder();
          }}
        />
        <button
          onClick={handleCreateFolder}
          disabled={!newFolderName.trim() || creatingFolder}
          title="Create folder"
          style={{
            background: newFolderName.trim() && !creatingFolder ? "var(--bg-tertiary)" : "#111111",
            border: "1px solid var(--border-default)",
            color: newFolderName.trim() && !creatingFolder ? "var(--status-idle)" : "var(--border-strong)",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            cursor: newFolderName.trim() && !creatingFolder ? "pointer" : "default",
            padding: "2px 6px",
            lineHeight: 1,
          }}
        >
          {creatingFolder ? "..." : "+DIR"}
        </button>
      </div>
      {folderError && (
        <div style={{ padding: "0 8px 4px 8px", color: "var(--status-error)", fontSize: "10px" }}>
          {folderError}
        </div>
      )}

      {/* Tree entries */}
      <div style={{ overflow: "auto", flex: 1 }}>
        {entries.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            filter={filter}
            gitChanges={gitChanges}
            onFileClick={handleFileClick}
            selectedPath={selectedPath}
            onContextMenu={(entry: FileEntry, x: number, y: number) => setContextMenu({ x, y, entry })}
            onMoveFile={handleMoveFile}
          />
        ))}
        {entries.length === 0 && !loading && (
          <div
            style={{
              padding: "8px 12px",
              color: "var(--text-faint)",
              fontSize: "10px",
              textAlign: "center",
            }}
          >
            No files found.
          </div>
        )}
      </div>

      {/* Selected file path display */}
      {selectedPath && showPath && (
        <div
          style={{
            padding: "3px 8px",
            borderTop: "1px solid var(--border-default)",
            background: "var(--bg-primary)",
            color: "var(--text-faint)",
            fontSize: "10px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            direction: "ltr",
            textAlign: "left",
          }}
          title={selectedPath}
        >
          <span style={{ unicodeBidi: "plaintext" }}>{selectedPath}</span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          rootPath={rootPath}
          onClose={() => setContextMenu(null)}
          onRefresh={loadTree}
          onRefreshDir={refreshDir}
        />
      )}
    </div>
  );
});
