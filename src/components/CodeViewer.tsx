import { memo, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { readFileContents, gitDiffFile, writeFileContents, gitStageHunk } from "../lib/ipc";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { loadLanguageExtension } from "../lib/codemirrorLangs";
import { getFileIconUrl } from "../lib/fileIcons";

// ─── Language Detection ───
const EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX",
  json: "JSON", md: "Markdown", css: "CSS", scss: "SCSS",
  html: "HTML", rs: "Rust", toml: "TOML", yaml: "YAML", yml: "YAML",
  py: "Python", go: "Go", sh: "Shell", zsh: "Shell", bash: "Shell",
  rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", cpp: "C++", h: "C Header", hpp: "C++ Header",
  sql: "SQL", graphql: "GraphQL", gql: "GraphQL",
  xml: "XML", svg: "SVG", vue: "Vue", svelte: "Svelte",
  lua: "Lua", zig: "Zig", asm: "Assembly", makefile: "Makefile",
  dockerfile: "Dockerfile", lock: "Lock", gitignore: "Git Ignore",
  env: "Environment",
};

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "Dockerfile";
  if (lower === "makefile") return "Makefile";
  if (lower === ".gitignore") return "Git Ignore";
  if (lower === ".env" || lower.startsWith(".env.")) return "Environment";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANGUAGE[ext] ?? (ext.toUpperCase() || "Plain Text");
}

/** Language extensions are lazy-loaded (see `lib/codemirrorLangs.ts`).
 *  Returning a Promise lets us keep them out of the main bundle. */

// ─── Diff Parser ───
interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

function parseDiff(raw: string): DiffHunk[] {
  const lines = raw.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("diff ") || line.startsWith("index ")) continue;

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        currentHunk.lines.push({
          type: "hunk-header", content: match[3]?.trim() || "",
          oldLine: null, newLine: null,
        });
      }
      continue;
    }

    if (!currentHunk) {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        currentHunk = { header: "@@ new file @@", lines: [] };
        hunks.push(currentHunk);
        oldLine = 0;
        newLine = 1;
      } else continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "del", content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else if (line === "\\ No newline at end of file") {
      // skip
    } else if (line.length > 0) {
      currentHunk.lines.push({ type: "context", content: line, oldLine: oldLine++, newLine: newLine++ });
    }
  }

  return hunks;
}

// ─── Custom theme to match app styling ───
const customTheme = EditorView.theme({
  "&": {
    backgroundColor: "#0a0a0a",
    fontSize: "15px",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
  },
  ".cm-content": {
    caretColor: "#ff8c00",
    lineHeight: "1.6",
  },
  ".cm-cursor": {
    borderLeftColor: "#ff8c00",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  ".cm-gutters": {
    backgroundColor: "#0a0a0a",
    color: "#555555",
    border: "none",
    borderRight: "1px solid #2a2a2a",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#1a1a1a",
  },
  ".cm-activeLine": {
    backgroundColor: "#1a1a1a",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

export const CodeViewer = memo(function CodeViewer() {
  const {
    codeViewerOpen, codeViewerFile, codeViewerDiffMode, codeViewerWorkingDir,
    codeViewerLineNumber, setCodeViewerOpen,
  } = useAppStore();

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "diff">("code");
  const [diffContent, setDiffContent] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(Math.floor(window.innerHeight * 0.7));
  const [isResizing, setIsResizing] = useState(false);
  const [editBuffer, setEditBuffer] = useState("");
  const [saving, setSaving] = useState(false);
  const [stagingHunk, setStagingHunk] = useState<string | null>(null);
  const [stageSuccess, setStageSuccess] = useState<string | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Track which file we have fetched content for, so we can show loading
  // state on the very first render (before the fetch effect runs).
  const [loadedFile, setLoadedFile] = useState<string | null>(null);

  // Sync viewMode with diffMode from store.
  useEffect(() => {
    if (codeViewerOpen) {
      setViewMode(codeViewerDiffMode ? "diff" : "code");
    }
  }, [codeViewerDiffMode, codeViewerFile, codeViewerOpen]);

  const fetchContent = useCallback(async () => {
    if (!codeViewerFile) return;
    setLoading(true);
    setError(null);
    try {
      const result = await readFileContents(codeViewerFile);
      setContent(result);
      setEditBuffer(result);
      setLoadedFile(codeViewerFile);
    } catch (e) {
      setError(String(e));
      setContent("");
      setEditBuffer("");
      setLoadedFile(codeViewerFile);
    }
    setLoading(false);
  }, [codeViewerFile]);

  const fetchDiff = useCallback(async () => {
    if (!codeViewerFile || !codeViewerWorkingDir) {
      setDiffError("No working directory available for diff");
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    try {
      let relativePath = codeViewerFile;
      if (codeViewerFile.startsWith(codeViewerWorkingDir)) {
        relativePath = codeViewerFile.slice(codeViewerWorkingDir.length);
        if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
      }
      let result = await gitDiffFile(codeViewerWorkingDir, relativePath, false);
      if (!result.trim()) {
        result = await gitDiffFile(codeViewerWorkingDir, relativePath, true);
      }
      setDiffContent(result);
    } catch (e) {
      setDiffError(String(e));
      setDiffContent("");
    }
    setDiffLoading(false);
  }, [codeViewerFile, codeViewerWorkingDir]);

  const handleStageHunk = useCallback(async (hunkHeader: string, filePath: string) => {
    if (!codeViewerWorkingDir || stagingHunk) return;
    setStagingHunk(hunkHeader);
    setStageSuccess(null);
    try {
      let relativePath = filePath || codeViewerFile || "";
      if (codeViewerWorkingDir && relativePath.startsWith(codeViewerWorkingDir)) {
        relativePath = relativePath.slice(codeViewerWorkingDir.length);
        if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
      }
      await gitStageHunk(codeViewerWorkingDir, relativePath, hunkHeader);
      setStageSuccess(hunkHeader);
      setTimeout(() => {
        fetchDiff();
        setStageSuccess(null);
      }, 1000);
    } catch (e) {
      setError(String(e));
    } finally {
      setStagingHunk(null);
    }
  }, [codeViewerWorkingDir, codeViewerFile, stagingHunk, fetchDiff]);

  useEffect(() => {
    if (codeViewerOpen && codeViewerFile) {
      fetchContent();
    }
    if (!codeViewerOpen) {
      // Reset loaded file tracker when viewer closes so next open shows loading state
      setLoadedFile(null);
    }
  }, [codeViewerOpen, codeViewerFile, fetchContent]);

  // Fetch diff when switching to diff mode
  useEffect(() => {
    if (viewMode === "diff" && codeViewerOpen && codeViewerFile) {
      fetchDiff();
    }
  }, [viewMode, codeViewerOpen, codeViewerFile, fetchDiff]);

  // Scroll to target line number when content is loaded
  useEffect(() => {
    if (!codeViewerOpen || !codeViewerLineNumber || loading || viewMode !== "code") return;
    // Small delay to let CodeMirror render
    const timer = setTimeout(() => {
      const view = editorViewRef.current;
      if (view) {
        const lineNum = Math.min(codeViewerLineNumber, view.state.doc.lines);
        if (lineNum > 0) {
          const line = view.state.doc.line(lineNum);
          view.dispatch({
            selection: { anchor: line.from, head: line.to },
            effects: EditorView.scrollIntoView(line.from, { y: "center" }),
          });
          view.focus();
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [codeViewerOpen, codeViewerLineNumber, loading, viewMode, content]);

  // ESC to close
  useEffect(() => {
    if (!codeViewerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setCodeViewerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [codeViewerOpen, setCodeViewerOpen]);

  const hasPendingChanges = viewMode === "code" && editBuffer !== content;

  const handleApply = useCallback(async () => {
    if (!codeViewerFile || !hasPendingChanges || saving) return;
    setSaving(true);
    try {
      await writeFileContents(codeViewerFile, editBuffer);
      setContent(editBuffer);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [codeViewerFile, hasPendingChanges, saving, editBuffer]);

  // Cmd+S to save
  useEffect(() => {
    if (!codeViewerOpen || viewMode !== "code") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleApply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [codeViewerOpen, viewMode, handleApply]);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startY: e.clientY, startHeight: panelHeight };

    const handleMove = (me: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startY - me.clientY;
      const newHeight = Math.max(200, Math.min(window.innerHeight * 0.95, resizeRef.current.startHeight + delta));
      setPanelHeight(newHeight);
    };

    const handleUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [panelHeight]);

  // Parse diff
  const diffHunks = useMemo(() => {
    if (viewMode !== "diff") return [];
    return parseDiff(diffContent);
  }, [diffContent, viewMode]);

  // CodeMirror extensions
  // Language extensions are lazy-loaded by file extension (see codemirrorLangs).
  // While the pack is loading we render with just the theme; CodeMirror seamlessly
  // adds syntax highlighting when the extension array updates.
  const [langExt, setLangExt] = useState<Extension[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLangExt([]); // reset while the new pack loads
    if (!codeViewerFile) return;
    const fileName = codeViewerFile.split("/").pop() ?? "";
    loadLanguageExtension(fileName).then((ext) => {
      if (!cancelled) setLangExt(ext);
    });
    return () => { cancelled = true; };
  }, [codeViewerFile]);
  const extensions = useMemo(() => [customTheme, ...langExt], [langExt]);

  if (!codeViewerOpen || !codeViewerFile) return null;

  const fileName = codeViewerFile.split("/").pop() ?? codeViewerFile;
  const shortPath = codeViewerFile.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
  const language = detectLanguage(fileName);
  const hasDiffCapability = !!codeViewerWorkingDir;

  const diffLineNumWidth = 48;
  const diffAdditions = diffHunks.reduce((a, h) => a + h.lines.filter(l => l.type === "add").length, 0);
  const diffDeletions = diffHunks.reduce((a, h) => a + h.lines.filter(l => l.type === "del").length, 0);

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: `min(${panelHeight}px, 95vh)`,
        zIndex: 900,
        background: "#141414",
        borderTop: "1px solid #ff8c00",
        fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.5)",
        animation: "slideInBottom 0.15s ease-out",
      }}
    >
      {/* Inline animation keyframes */}
      <style>{`
        @keyframes slideInBottom {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>

      {/* Resize handle on top edge */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: "absolute",
          top: -3,
          left: 0,
          right: 0,
          height: "6px",
          cursor: "row-resize",
          zIndex: 10,
          background: isResizing ? "rgba(255, 140, 0, 0.3)" : "transparent",
        }}
        onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.background = "rgba(255, 140, 0, 0.15)"; }}
        onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.background = "transparent"; }}
      />

      {/* Header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #2a2a2a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          background: "#0f0f0f",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* CODE | DIFF toggle */}
            <button
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "#1e1e1e" : "transparent",
                border: viewMode === "code" ? "1px solid #ff8c00" : "1px solid #2a2a2a",
                color: viewMode === "code" ? "#ff8c00" : "#555555",
                fontSize: "10px",
                fontWeight: "bold",
                fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
                letterSpacing: "1px",
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              CODE
            </button>
            {hasDiffCapability && (
              <button
                onClick={() => setViewMode("diff")}
                style={{
                  background: viewMode === "diff" ? "#1e1e1e" : "transparent",
                  border: viewMode === "diff" ? "1px solid #ff8c00" : "1px solid #2a2a2a",
                  color: viewMode === "diff" ? "#ff8c00" : "#555555",
                  fontSize: "10px",
                  fontWeight: "bold",
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
                  letterSpacing: "1px",
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                DIFF
              </button>
            )}
            <span style={{ color: "#555555", fontSize: "11px" }}>|</span>
            <img src={getFileIconUrl(fileName)} width={16} height={16} style={{ flexShrink: 0, verticalAlign: "middle" }} draggable={false} />
            <span
              style={{
                color: "#e0e0e0",
                fontSize: "11px",
                fontWeight: "bold",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fileName}
            </span>
            {/* Language indicator */}
            <span
              style={{
                color: "#888888",
                fontSize: "10px",
                background: "#1e1e1e",
                border: "1px solid #2a2a2a",
                padding: "1px 6px",
                letterSpacing: "0.5px",
                flexShrink: 0,
              }}
            >
              {language}
            </span>
          </div>
          <div
            style={{
              color: "#555555",
              fontSize: "10px",
              marginTop: "2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={codeViewerFile}
          >
            {shortPath}
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center", flexShrink: 0 }}>
          {viewMode === "code" && hasPendingChanges && (
            <>
              <button
                onClick={() => setEditBuffer(content)}
                title="Discard changes"
                style={{
                  background: "transparent",
                  border: "1px solid #ff3d0066",
                  color: "#ff3d00",
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
                  padding: "2px 6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                DISCARD
              </button>
              <button
                onClick={handleApply}
                disabled={saving}
                title="Save changes"
                style={{
                  background: "#ff8c00",
                  border: "1px solid #ff8c00",
                  color: "#0a0a0a",
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
                  padding: "2px 6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                {saving ? "SAVING..." : "SAVE"}
              </button>
            </>
          )}
          <button
            onClick={() => setCodeViewerOpen(false)}
            style={{
              background: "none",
              border: "none",
              color: "#555555",
              fontSize: "14px",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
              padding: "0 4px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff8c00")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#555555")}
          >
            x
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        style={{ flex: 1, overflow: "auto", position: "relative", minHeight: 0 }}
      >
        {/* CODE VIEW */}
        {viewMode === "code" && (
          <>
            {(loading || loadedFile !== codeViewerFile) && !error && (
              <div style={{ padding: "24px", textAlign: "center", color: "#ffab00", fontSize: "11px" }}>
                Loading file...
              </div>
            )}
            {error && loadedFile === codeViewerFile && (
              <div style={{ padding: "24px", textAlign: "center", color: "#ff3d00", fontSize: "11px" }}>
                {error}
              </div>
            )}
            {!loading && !error && loadedFile === codeViewerFile && (
              <div style={{ position: "absolute", inset: 0 }}>
                <CodeMirror
                  key={codeViewerFile}
                  value={editBuffer}
                  onChange={(value) => setEditBuffer(value)}
                  onCreateEditor={(view) => { editorViewRef.current = view; }}
                  theme={oneDark}
                  extensions={extensions}
                  height="100%"
                  style={{ height: "100%" }}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLineGutter: true,
                    highlightActiveLine: true,
                    foldGutter: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: false,
                    highlightSelectionMatches: true,
                    searchKeymap: true,
                  }}
                />
              </div>
            )}
          </>
        )}

        {/* DIFF VIEW */}
        {viewMode === "diff" && (
          <>
            {diffLoading && (
              <div style={{ padding: "24px", textAlign: "center", color: "#ffab00", fontSize: "11px" }}>
                Loading diff...
              </div>
            )}
            {diffError && (
              <div style={{ padding: "24px", textAlign: "center", color: "#ff3d00", fontSize: "11px" }}>
                {diffError}
              </div>
            )}
            {!diffLoading && !diffError && diffHunks.length === 0 && (
              <div style={{ padding: "24px", textAlign: "center", color: "#555555", fontSize: "11px" }}>
                No changes to display for this file
              </div>
            )}
            {!diffLoading && !diffError && diffHunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header */}
                <div
                  style={{
                    padding: "4px 16px",
                    background: "#1a1a2e",
                    color: "#4a9eff",
                    fontSize: "10px",
                    borderTop: hi > 0 ? "1px solid #2a2a2a" : "none",
                    borderBottom: "1px solid #2a2a2a",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{hunk.header}</span>
                  <button
                    onClick={() => handleStageHunk(hunk.header, codeViewerFile ?? "")}
                    disabled={stagingHunk !== null}
                    style={{
                      background: stageSuccess === hunk.header ? "#00c853" : "#1e1e1e",
                      border: "1px solid #4a9eff66",
                      color: stageSuccess === hunk.header ? "#fff" : "#4a9eff",
                      fontSize: "10px",
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
                      padding: "2px 8px",
                      cursor: stagingHunk ? "default" : "pointer",
                      fontWeight: "bold",
                      letterSpacing: "0.5px",
                      flexShrink: 0,
                      marginLeft: "8px",
                    }}
                  >
                    {stagingHunk === hunk.header ? "STAGING..." : stageSuccess === hunk.header ? "STAGED" : "STAGE HUNK"}
                  </button>
                </div>
                {/* Lines */}
                {hunk.lines.filter(l => l.type !== "hunk-header").map((line, li) => {
                  let bg = "transparent";
                  let color = "#e0e0e0";
                  let prefix = " ";
                  if (line.type === "add") { bg = "#0d3b0d"; color = "#a6e3a1"; prefix = "+"; }
                  else if (line.type === "del") { bg = "#3b0d0d"; color = "#f38ba8"; prefix = "-"; }

                  return (
                    <div
                      key={`${hi}-${li}`}
                      style={{
                        display: "flex",
                        background: bg,
                        fontSize: "13px",
                        lineHeight: "1.5",
                        minHeight: "20px",
                      }}
                    >
                      <span style={{
                        width: `${diffLineNumWidth}px`, minWidth: `${diffLineNumWidth}px`,
                        textAlign: "right", paddingRight: "8px", color: "#555555",
                        fontSize: "11px", lineHeight: "1.5", userSelect: "none",
                        borderRight: "1px solid #2a2a2a",
                      }}>
                        {line.oldLine ?? ""}
                      </span>
                      <span style={{
                        width: `${diffLineNumWidth}px`, minWidth: `${diffLineNumWidth}px`,
                        textAlign: "right", paddingRight: "8px", color: "#555555",
                        fontSize: "11px", lineHeight: "1.5", userSelect: "none",
                        borderRight: "1px solid #2a2a2a",
                      }}>
                        {line.newLine ?? ""}
                      </span>
                      <span style={{
                        width: "20px", minWidth: "20px", textAlign: "center",
                        color: line.type === "add" ? "#00c853" : line.type === "del" ? "#ff3d00" : "#555555",
                        fontWeight: "bold", userSelect: "none",
                      }}>
                        {prefix}
                      </span>
                      <span style={{
                        flex: 1, color, whiteSpace: "pre", overflow: "hidden",
                        paddingRight: "16px", fontWeight: 400,
                      }}>
                        {line.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      {viewMode === "code" && !loading && !error && content && (
        <div
          style={{
            padding: "6px 16px",
            borderTop: "1px solid #2a2a2a",
            display: "flex",
            gap: "16px",
            fontSize: "10px",
            flexShrink: 0,
            background: "#0f0f0f",
            fontWeight: 500,
          }}
        >
          <span style={{ color: "#555555" }}>
            {content.split("\n").length} lines
          </span>
          <span style={{ color: "#555555" }}>
            {content.length.toLocaleString()} chars
          </span>
          <span style={{ color: "#888888" }}>
            {language}
          </span>
          {hasPendingChanges && (
            <span style={{ color: "#ff8c00" }}>
              modified
            </span>
          )}
          <span style={{ color: "#555555", marginLeft: "auto" }}>
            ESC to close
          </span>
        </div>
      )}
      {viewMode === "diff" && !diffLoading && !diffError && diffHunks.length > 0 && (
        <div
          style={{
            padding: "6px 16px",
            borderTop: "1px solid #2a2a2a",
            display: "flex",
            gap: "16px",
            fontSize: "10px",
            flexShrink: 0,
            background: "#0f0f0f",
            fontWeight: 500,
          }}
        >
          <span style={{ color: "#00c853" }}>
            +{diffAdditions} additions
          </span>
          <span style={{ color: "#ff3d00" }}>
            -{diffDeletions} deletions
          </span>
          <span style={{ color: "#555555", marginLeft: "auto" }}>
            ESC to close
          </span>
        </div>
      )}
    </div>
  );
});
