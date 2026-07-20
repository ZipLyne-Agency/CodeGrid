import { memo, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import { readFileContents, writeFileContents, getHomeDir } from "../lib/ipc";

interface Target {
  id: string;
  label: string;
  agents: string;
  path: string;
  kind: "project" | "global";
  /** Returns the prefilled template used when the file does not exist yet. */
  template: (path: string) => string;
}

const PROJECT_AGENTS_TEMPLATE = `# AGENTS.md

Cross-agent instructions for this repository. Read by Codex, Cursor, and Gemini
natively; Claude Code reads CLAUDE.md (often symlinked to this file).

## Project overview
Describe what this project is and its high-level architecture.

## Key files & directories
- \`src/\` —
- \`...\` —

## Development guidelines
- Match the existing stack and conventions; read the config before changing anything.
- Keep changes focused; don't reformat unrelated code.

## Testing
- How to run the test suite:
- What to verify before considering a change done:
`;

const GLOBAL_STUB = `# Agent instructions

Universal rules for coding agents. Keep this terse and high-signal.

## Behavior
-

## Conventions
-
`;

function makeTargets(home: string, projectDir: string | null): Target[] {
  const list: Target[] = [];
  if (projectDir) {
    const trimmed = projectDir.replace(/\/+$/, "");
    list.push({
      id: "project-agents",
      label: "This project — AGENTS.md",
      agents: "Read by Codex, Cursor, Gemini in this repo",
      path: `${trimmed}/AGENTS.md`,
      kind: "project",
      template: () => PROJECT_AGENTS_TEMPLATE,
    });
    list.push({
      id: "project-claude",
      label: "This project — CLAUDE.md",
      agents: "Read by Claude Code in this repo",
      path: `${trimmed}/CLAUDE.md`,
      kind: "project",
      template: () => PROJECT_AGENTS_TEMPLATE,
    });
  }
  list.push({
    id: "global-agents",
    label: "Global — AGENTS.md",
    agents: "Universal agent rules (Codex/Cursor via symlink)",
    path: `${home}/AGENTS.md`,
    kind: "global",
    template: () => GLOBAL_STUB,
  });
  list.push({
    id: "global-claude",
    label: "Global — CLAUDE.md",
    agents: "Claude Code global rules",
    path: `${home}/.claude/CLAUDE.md`,
    kind: "global",
    template: () => GLOBAL_STUB,
  });
  list.push({
    id: "global-gemini",
    label: "Global — GEMINI.md",
    agents: "Gemini CLI global rules",
    path: `${home}/.gemini/GEMINI.md`,
    kind: "global",
    template: () => GLOBAL_STUB,
  });
  return list;
}

/** Turn an absolute path into a ~-prefixed display path. */
function tildePath(path: string, home: string): string {
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

export const ClaudeMdEditor = memo(function ClaudeMdEditor() {
  const { claudeMdEditorOpen, setClaudeMdEditorOpen, claudeMdDir } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);

  const [home, setHome] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [isNew, setIsNew] = useState(false);
  const [existsMap, setExistsMap] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const targets = useMemo(
    () => (home ? makeTargets(home, claudeMdDir ?? null) : []),
    [home, claudeMdDir],
  );

  const selected = useMemo(
    () => targets.find((t) => t.id === selectedId) ?? null,
    [targets, selectedId],
  );

  const hasChanges = content !== originalContent;

  // Resolve home dir once the modal opens.
  useEffect(() => {
    if (!claudeMdEditorOpen) return;
    let cancelled = false;
    getHomeDir()
      .then((h) => {
        if (!cancelled) setHome(h);
      })
      .catch(() => {
        if (!cancelled) setHome("");
      });
    return () => {
      cancelled = true;
    };
  }, [claudeMdEditorOpen]);

  // Pick a default target once targets are known.
  useEffect(() => {
    if (!claudeMdEditorOpen || targets.length === 0) return;
    setSelectedId((cur) => {
      if (cur && targets.some((t) => t.id === cur)) return cur;
      const preferred = claudeMdDir ? "project-agents" : "global-agents";
      return targets.find((t) => t.id === preferred)?.id ?? targets[0].id;
    });
  }, [claudeMdEditorOpen, targets, claudeMdDir]);

  // Probe existence of every target (for (new) badges) when the modal opens.
  useEffect(() => {
    if (!claudeMdEditorOpen || targets.length === 0) return;
    let cancelled = false;
    Promise.all(
      targets.map((t) =>
        readFileContents(t.path)
          .then(() => [t.id, true] as const)
          .catch(() => [t.id, false] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      for (const [id, exists] of entries) map[id] = exists;
      setExistsMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [claudeMdEditorOpen, targets]);

  // Load the selected target's contents.
  const loadTarget = useCallback((target: Target) => {
    setLoading(true);
    readFileContents(target.path)
      .then((text) => {
        setContent(text);
        setOriginalContent(text);
        setIsNew(false);
        setExistsMap((m) => ({ ...m, [target.id]: true }));
      })
      .catch(() => {
        // File does not exist — treat as a new file with a template.
        setContent(target.template(target.path));
        setOriginalContent("");
        setIsNew(true);
        setExistsMap((m) => ({ ...m, [target.id]: false }));
      })
      .finally(() => {
        setLoading(false);
        setTimeout(() => textareaRef.current?.focus(), 80);
      });
  }, []);

  useEffect(() => {
    if (!claudeMdEditorOpen || !selected) return;
    loadTarget(selected);
    // Only reload when the selected target path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeMdEditorOpen, selected?.path]);

  const switchTarget = useCallback(
    (target: Target) => {
      if (target.id === selectedId) return;
      if (hasChanges) {
        const ok = window.confirm(
          "You have unsaved changes. Discard them and switch?",
        );
        if (!ok) return;
      }
      setSelectedId(target.id);
    },
    [selectedId, hasChanges],
  );

  const handleSave = useCallback(async () => {
    if (!selected) return;
    try {
      await writeFileContents(selected.path, content);
      setOriginalContent(content);
      setIsNew(false);
      setExistsMap((m) => ({ ...m, [selected.id]: true }));
      addToast(`Saved ${selected.path.split("/").pop()}`, "success");
    } catch {
      const dirDisplay = tildePath(
        selected.path.slice(0, selected.path.lastIndexOf("/")),
        home,
      );
      addToast(
        `Couldn't save: ${dirDisplay} may not exist (is the agent installed?)`,
        "error",
      );
    }
  }, [selected, content, addToast, home]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      const ok = window.confirm("You have unsaved changes. Close anyway?");
      if (!ok) return;
    }
    setClaudeMdEditorOpen(false);
  }, [hasChanges, setClaudeMdEditorOpen]);

  if (!claudeMdEditorOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        paddingTop: "40px",
      }}
      onClick={handleClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AGENTS.md Editor"
        style={{
          position: "relative",
          width: "860px",
          maxHeight: "650px",
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
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                color: "#ff8c00",
                fontSize: "12px",
                fontWeight: "bold",
                letterSpacing: "1px",
              }}
            >
              AGENTS.md
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              Cross-agent instructions standard — Codex, Cursor, Gemini & Claude Code
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {hasChanges && (
              <span style={{ color: "#ffab00", fontSize: "10px", letterSpacing: "0.5px" }}>
                UNSAVED
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              style={{
                background: hasChanges ? "#ff8c00" : "#2a2a2a",
                border: "none",
                color: hasChanges ? "#0a0a0a" : "#555555",
                fontSize: "10px",
                fontFamily: "var(--font-ui)",
                cursor: hasChanges ? "pointer" : "default",
                padding: "4px 12px",
                fontWeight: "bold",
              }}
            >
              SAVE
            </button>
            <button
              onClick={handleClose}
              style={{
                background: "none",
                border: "none",
                color: "#555555",
                fontSize: "14px",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
                marginLeft: "8px",
              }}
            >
              x
            </button>
          </div>
        </div>

        {/* Body: scope list + editor */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Scope / target selector */}
          <div
            style={{
              width: "280px",
              flexShrink: 0,
              borderRight: "1px solid #2a2a2a",
              background: "#0f0f0f",
              overflowY: "auto",
              padding: "8px 0",
            }}
          >
            {targets.map((t, i) => {
              const isSel = t.id === selectedId;
              const exists = existsMap[t.id];
              const isNewBadge = exists === false;
              const prevKind = i > 0 ? targets[i - 1].kind : null;
              const showDivider = prevKind !== null && prevKind !== t.kind;
              return (
                <div key={t.id}>
                  {showDivider && (
                    <div
                      style={{
                        height: "1px",
                        background: "#2a2a2a",
                        margin: "6px 12px",
                      }}
                    />
                  )}
                  <button
                    onClick={() => switchTarget(t)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: isSel ? "#1e1407" : "transparent",
                      border: "none",
                      borderLeft: isSel
                        ? "2px solid #ff8c00"
                        : "2px solid transparent",
                      cursor: "pointer",
                      padding: "8px 12px",
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          color: isSel ? "#ff8c00" : "#cccccc",
                          fontSize: "11px",
                          fontWeight: isSel ? "bold" : "normal",
                        }}
                      >
                        {t.label}
                      </span>
                      {isNewBadge && (
                        <span
                          style={{
                            color: "#0a0a0a",
                            background: "#ffab00",
                            fontSize: "8px",
                            fontWeight: "bold",
                            letterSpacing: "0.5px",
                            padding: "1px 4px",
                            borderRadius: "2px",
                          }}
                        >
                          NEW
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        color: "#777777",
                        fontSize: "9px",
                        marginTop: "3px",
                        lineHeight: "1.3",
                      }}
                    >
                      {t.agents}
                    </div>
                    <div
                      style={{
                        color: "#444444",
                        fontSize: "9px",
                        marginTop: "2px",
                        wordBreak: "break-all",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      {tildePath(t.path, home)}
                    </div>
                  </button>
                </div>
              );
            })}
            {targets.length === 0 && (
              <div
                style={{
                  padding: "16px 12px",
                  color: "#555555",
                  fontSize: "10px",
                }}
              >
                Loading scopes...
              </div>
            )}
          </div>

          {/* Editor */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  color: "#555555",
                  fontSize: "11px",
                }}
              >
                Loading...
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                spellCheck={false}
                style={{
                  flex: 1,
                  width: "100%",
                  background: "#0a0a0a",
                  border: "none",
                  color: "#e0e0e0",
                  fontSize: "12px",
                  fontFamily: "var(--font-ui)",
                  padding: "12px 16px",
                  outline: "none",
                  resize: "none",
                  lineHeight: "1.6",
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "6px 16px",
            borderTop: "1px solid #2a2a2a",
            color: "#333333",
            fontSize: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            {selected ? tildePath(selected.path, home) : ""}
            {isNew ? "  (new file)" : ""}
          </span>
          <span>
            Cmd+S to save · {content.split("\n").length} lines
          </span>
        </div>
      </div>
    </div>
  );
});
