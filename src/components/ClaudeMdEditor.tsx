import { memo, useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import { readClaudeMd, writeClaudeMd } from "../lib/ipc";

export const ClaudeMdEditor = memo(function ClaudeMdEditor() {
  const { claudeMdEditorOpen, setClaudeMdEditorOpen, claudeMdDir } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [isNew, setIsNew] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dir = claudeMdDir ?? "";

  useEffect(() => {
    if (!claudeMdEditorOpen || !dir) return;
    setLoading(true);
    readClaudeMd(dir).then((md) => {
      if (md !== null) {
        setContent(md);
        setOriginalContent(md);
        setIsNew(false);
      } else {
        const defaultContent = `# Project Instructions\n\n## Overview\nDescribe your project here.\n\n## Key Files\n- \n\n## Development Guidelines\n- \n\n## Testing\n- \n`;
        setContent(defaultContent);
        setOriginalContent("");
        setIsNew(true);
      }
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }).catch(() => {
      setLoading(false);
    });
  }, [claudeMdEditorOpen, dir]);

  const handleSave = useCallback(async () => {
    if (!dir) return;
    try {
      await writeClaudeMd(dir, content);
      setOriginalContent(content);
      setIsNew(false);
      addToast("CLAUDE.md saved", "success");
    } catch (e) {
      addToast(`Failed to save: ${e}`, "error");
    }
  }, [dir, content, addToast]);

  const hasChanges = content !== originalContent;
  const dirName = dir.split("/").pop() ?? dir;

  if (!claudeMdEditorOpen) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "40px" }}
      onClick={() => setClaudeMdEditorOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="CLAUDE.md Editor"
        style={{
          position: "relative", width: "700px", maxHeight: "650px", background: "#141414",
          border: "1px solid #ff8c00", fontFamily: "var(--font-ui)", zIndex: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#ff8c00", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px" }}>
              CLAUDE.md {isNew ? "(NEW)" : ""}
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              {dirName} — Project instructions for Claude Code
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {hasChanges && (
              <span style={{ color: "#ffab00", fontSize: "10px", letterSpacing: "0.5px" }}>UNSAVED</span>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              style={{
                background: hasChanges ? "#ff8c00" : "#2a2a2a", border: "none",
                color: hasChanges ? "#0a0a0a" : "#555555", fontSize: "10px",
                fontFamily: "var(--font-ui)", cursor: hasChanges ? "pointer" : "default",
                padding: "4px 12px", fontWeight: "bold",
              }}
            >
              SAVE
            </button>
            <button onClick={() => setClaudeMdEditorOpen(false)} style={{
              background: "none", border: "none", color: "#555555", fontSize: "14px", cursor: "pointer",
              fontFamily: "var(--font-ui)", marginLeft: "8px",
            }}>x</button>
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loading ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#555555", fontSize: "11px" }}>Loading...</div>
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
                flex: 1, width: "100%", background: "#0a0a0a", border: "none",
                color: "#e0e0e0", fontSize: "12px", fontFamily: "var(--font-ui)",
                padding: "12px 16px", outline: "none", resize: "none",
                lineHeight: "1.6",
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "6px 16px", borderTop: "1px solid #2a2a2a", color: "#333333", fontSize: "10px", display: "flex", justifyContent: "space-between" }}>
          <span>Cmd+S to save</span>
          <span>{content.split("\n").length} lines</span>
        </div>
      </div>
    </div>
  );
});
