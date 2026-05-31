import { memo, useState, useEffect, useCallback } from "react";
import { gitDiffFile } from "../lib/ipc";

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
    // Skip file headers
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("diff ") || line.startsWith("index ")) continue;

    // Hunk header
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        currentHunk.lines.push({
          type: "hunk-header",
          content: match[3]?.trim() || "",
          oldLine: null,
          newLine: null,
        });
      }
      continue;
    }

    if (!currentHunk) {
      // Before first hunk, create an implicit one for untracked files
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        currentHunk = { header: "@@ new file @@", lines: [] };
        hunks.push(currentHunk);
        oldLine = 0;
        newLine = 1;
      } else {
        continue;
      }
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "del",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (line === "\\ No newline at end of file") {
      // skip
    } else if (line.length > 0) {
      // Treat as context
      currentHunk.lines.push({
        type: "context",
        content: line,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return hunks;
}

interface DiffViewerProps {
  workingDir: string;
  filePath: string;
  staged: boolean;
  onClose: () => void;
  files?: { path: string; staged: boolean }[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

export const DiffViewer = memo(function DiffViewer({
  workingDir,
  filePath,
  staged,
  onClose,
  files,
  currentIndex,
  onNavigate,
}: DiffViewerProps) {
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await gitDiffFile(workingDir, filePath, staged);
      setDiff(result);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [workingDir, filePath, staged]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (files && onNavigate && currentIndex !== undefined) {
        if (e.key === "ArrowLeft" && currentIndex > 0) {
          onNavigate(currentIndex - 1);
        }
        if (e.key === "ArrowRight" && currentIndex < files.length - 1) {
          onNavigate(currentIndex + 1);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, files, onNavigate, currentIndex]);

  const hunks = parseDiff(diff);
  const hasPrev = files && currentIndex !== undefined && currentIndex > 0;
  const hasNext = files && currentIndex !== undefined && currentIndex < files.length - 1;

  const lineNumWidth = 48;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "24px",
      }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Diff Viewer"
        style={{
          position: "relative",
          width: "900px",
          maxWidth: "95vw",
          maxHeight: "85vh",
          background: "#141414",
          border: "1px solid #ff8c00",
          fontFamily: "var(--font-ui)",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            {/* Navigation */}
            {files && onNavigate && currentIndex !== undefined && (
              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                <button
                  onClick={() => hasPrev && onNavigate(currentIndex - 1)}
                  disabled={!hasPrev}
                  style={{
                    background: "#1e1e1e",
                    border: "1px solid #2a2a2a",
                    color: hasPrev ? "#e0e0e0" : "#333333",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                    cursor: hasPrev ? "pointer" : "default",
                    padding: "2px 8px",
                    lineHeight: "16px",
                  }}
                >
                  &lt;
                </button>
                <button
                  onClick={() => hasNext && onNavigate(currentIndex + 1)}
                  disabled={!hasNext}
                  style={{
                    background: "#1e1e1e",
                    border: "1px solid #2a2a2a",
                    color: hasNext ? "#e0e0e0" : "#333333",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                    cursor: hasNext ? "pointer" : "default",
                    padding: "2px 8px",
                    lineHeight: "16px",
                  }}
                >
                  &gt;
                </button>
                <span style={{ color: "#555555", fontSize: "10px", alignSelf: "center" }}>
                  {currentIndex + 1}/{files.length}
                </span>
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ color: "#ff8c00", fontSize: "11px", fontWeight: "bold", letterSpacing: "0.5px" }}>
                DIFF
              </span>
              <span style={{ color: "#555555", fontSize: "11px", margin: "0 8px" }}>|</span>
              <span
                style={{
                  color: "#e0e0e0",
                  fontSize: "11px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {filePath}
              </span>
              {staged && (
                <span
                  style={{
                    color: "#00c853",
                    fontSize: "10px",
                    marginLeft: "8px",
                    border: "1px solid #00c85366",
                    padding: "1px 4px",
                  }}
                >
                  STAGED
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#555555",
              fontSize: "14px",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
              padding: "0 4px",
              flexShrink: 0,
            }}
          >
            x
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {loading && (
            <div style={{ padding: "24px", textAlign: "center", color: "#ffab00", fontSize: "11px" }}>
              Loading diff...
            </div>
          )}
          {error && (
            <div style={{ padding: "24px", textAlign: "center", color: "#ff3d00", fontSize: "11px" }}>
              {error}
            </div>
          )}
          {!loading && !error && hunks.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "#555555", fontSize: "11px" }}>
              No changes to display
            </div>
          )}
          {!loading &&
            !error &&
            hunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header divider */}
                <div
                  style={{
                    padding: "4px 16px",
                    background: "#1a1a2e",
                    color: "#4a9eff",
                    fontSize: "10px",
                    borderTop: hi > 0 ? "1px solid #2a2a2a" : "none",
                    borderBottom: "1px solid #2a2a2a",
                  }}
                >
                  {hunk.header}
                </div>
                {/* Lines */}
                {hunk.lines
                  .filter((l) => l.type !== "hunk-header")
                  .map((line, li) => {
                    let bg = "transparent";
                    let color = "#e0e0e0";
                    let prefix = " ";
                    if (line.type === "add") {
                      bg = "#0d3b0d";
                      color = "#a6e3a1";
                      prefix = "+";
                    } else if (line.type === "del") {
                      bg = "#3b0d0d";
                      color = "#f38ba8";
                      prefix = "-";
                    }

                    return (
                      <div
                        key={`${hi}-${li}`}
                        style={{
                          display: "flex",
                          background: bg,
                          fontSize: "12px",
                          lineHeight: "20px",
                          minHeight: "20px",
                        }}
                      >
                        {/* Old line number */}
                        <span
                          style={{
                            width: `${lineNumWidth}px`,
                            minWidth: `${lineNumWidth}px`,
                            textAlign: "right",
                            paddingRight: "8px",
                            color: "#555555",
                            fontSize: "10px",
                            lineHeight: "20px",
                            userSelect: "none",
                            borderRight: "1px solid #2a2a2a",
                          }}
                        >
                          {line.oldLine ?? ""}
                        </span>
                        {/* New line number */}
                        <span
                          style={{
                            width: `${lineNumWidth}px`,
                            minWidth: `${lineNumWidth}px`,
                            textAlign: "right",
                            paddingRight: "8px",
                            color: "#555555",
                            fontSize: "10px",
                            lineHeight: "20px",
                            userSelect: "none",
                            borderRight: "1px solid #2a2a2a",
                          }}
                        >
                          {line.newLine ?? ""}
                        </span>
                        {/* Prefix (+/-/space) */}
                        <span
                          style={{
                            width: "20px",
                            minWidth: "20px",
                            textAlign: "center",
                            color: line.type === "add" ? "#00c853" : line.type === "del" ? "#ff3d00" : "#555555",
                            fontWeight: "bold",
                            userSelect: "none",
                          }}
                        >
                          {prefix}
                        </span>
                        {/* Content */}
                        <span
                          style={{
                            flex: 1,
                            color,
                            whiteSpace: "pre",
                            overflow: "hidden",
                            paddingRight: "16px",
                          }}
                        >
                          {line.content}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ))}
        </div>

        {/* Footer with stats */}
        {!loading && !error && hunks.length > 0 && (
          <div
            style={{
              padding: "6px 16px",
              borderTop: "1px solid #2a2a2a",
              display: "flex",
              gap: "16px",
              fontSize: "10px",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "#00c853" }}>
              +{hunks.reduce((a, h) => a + h.lines.filter((l) => l.type === "add").length, 0)} additions
            </span>
            <span style={{ color: "#ff3d00" }}>
              -{hunks.reduce((a, h) => a + h.lines.filter((l) => l.type === "del").length, 0)} deletions
            </span>
            <span style={{ color: "#555555", marginLeft: "auto" }}>
              ESC to close{files ? " | Arrow keys to navigate" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
