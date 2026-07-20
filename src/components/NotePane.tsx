import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { writeToPty, type NoteMeta, notesWrite } from "../lib/ipc";
import { useToastStore } from "../stores/toastStore";
import type { SessionWithModel } from "../stores/sessionStore";

interface NotePaneProps {
  session: SessionWithModel;
  onClose: (sessionId: string) => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

const MONO = "var(--font-code)";
const UI_FONT = "var(--font-ui)";

export const NOTE_COLORS = [
  { name: "yellow", hex: "#ffab00" },
  { name: "blue", hex: "#4a9eff" },
  { name: "green", hex: "#10a37f" },
  { name: "pink", hex: "#ff6b9d" },
  { name: "orange", hex: "#ff8c00" },
  { name: "violet", hex: "#a855f7" },
] as const;

// ── Snippet model ──────────────────────────────────────────────────
//
// A note holds an ordered list of snippets. On disk we store them as a single
// markdown file using `## Title` as the divider — so the file is still human
// (and agent) readable as plain markdown:
//
//   ## Refactor login
//   Refactor the login flow to use…
//
//   ## Bug repro
//   Steps: 1. ...

interface Snippet {
  id: string;
  title: string;
  body: string;
}

function parseSnippets(md: string): Snippet[] {
  if (!md.trim()) {
    return [{ id: makeSnipId(), title: "", body: "" }];
  }
  const lines = md.split("\n");
  const snippets: Snippet[] = [];
  let current: Snippet | null = null;
  for (const line of lines) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      if (current) snippets.push(finalize(current));
      current = { id: makeSnipId(), title: h[1].trim(), body: "" };
    } else {
      if (!current) current = { id: makeSnipId(), title: "", body: "" };
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) snippets.push(finalize(current));
  return snippets.length ? snippets : [{ id: makeSnipId(), title: "", body: "" }];
}

function finalize(s: Snippet): Snippet {
  // Trim trailing blank lines but preserve internal whitespace.
  return { ...s, body: s.body.replace(/\n+$/, "") };
}

function serializeSnippets(snippets: Snippet[]): string {
  return snippets
    .map((s) => {
      const title = s.title.trim();
      if (!title) return s.body;
      return `## ${title}\n${s.body}`;
    })
    .join("\n\n")
    .trim();
}

let snipCounter = 0;
function makeSnipId(): string {
  return `snip-${Date.now()}-${++snipCounter}`;
}

export const NotePane = memo(function NotePane({
  session,
  onClose,
  onDragStart,
}: NotePaneProps) {
  const allSessions = useSessionStore((s) => s.sessions);
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setSessionManualName = useSessionStore((s) => s.setSessionManualName);
  const toggleMaximize = useLayoutStore((s) => s.toggleMaximize);
  const minimizePane = useLayoutStore((s) => s.minimizePane);
  const layouts = useLayoutStore((s) => s.layouts);

  const isFocused = focusedSessionId === session.id;
  const color = session.noteColor ?? NOTE_COLORS[0].hex;
  const text = session.noteText ?? "";

  // Local snippet state, hydrated from session.noteText. We keep this local so
  // every keystroke doesn't churn the session store; we propagate up on a
  // debounced timer.
  const [snippets, setSnippets] = useState<Snippet[]>(() => parseSnippets(text));
  // If session.noteText is replaced externally (e.g. restored from disk), re-hydrate.
  const lastSyncedText = useRef(text);
  useEffect(() => {
    if (text !== lastSyncedText.current) {
      lastSyncedText.current = text;
      setSnippets(parseSnippets(text));
    }
  }, [text]);

  const [showColors, setShowColors] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const pinCandidates = useMemo(
    () =>
      allSessions.filter(
        (s) =>
          s.id !== session.id &&
          s.workspace_id === session.workspace_id &&
          (s.kind ?? "terminal") !== "note",
      ),
    [allSessions, session.id, session.workspace_id],
  );
  const pinnedTarget = pinCandidates.find((s) => s.id === session.notePinnedTo);

  // Debounced persist. Rebuild markdown from snippets, write to store + disk.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Avoid toast spam on a sustained save failure — warn once until a save succeeds.
  const saveErrorShown = useRef(false);
  const persist = useCallback(
    (nextSnippets: Snippet[], partialMeta?: Partial<NoteMeta>) => {
      const nextText = serializeSnippets(nextSnippets);
      lastSyncedText.current = nextText;
      updateSession(session.id, { noteText: nextText });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const layout = useLayoutStore.getState().layouts.find((l) => l.i === session.id);
        const meta: NoteMeta = {
          id: session.id,
          workspace_id: session.workspace_id,
          title: session.manualName ?? null,
          color: session.noteColor ?? NOTE_COLORS[0].hex,
          x: layout?.x ?? 0,
          y: layout?.y ?? 0,
          w: layout?.w ?? 320,
          h: layout?.h ?? 280,
          pinned_to: session.notePinnedTo ?? null,
          created_at: Number(new Date(session.created_at).getTime()) || Date.now(),
          updated_at: Date.now(),
          ...(partialMeta ?? {}),
        };
        notesWrite(meta, nextText).then(
          () => { saveErrorShown.current = false; },
          (e) => {
            console.warn("[NotePane] persist failed:", e);
            if (!saveErrorShown.current) {
              saveErrorShown.current = true;
              useToastStore.getState().addToast(
                "Note didn't save — your latest changes may not be persisted",
                "error",
                5000,
              );
            }
          },
        );
      }, 500);
    },
    [
      session.id,
      session.workspace_id,
      session.manualName,
      session.noteColor,
      session.notePinnedTo,
      session.created_at,
      updateSession,
    ],
  );

  // Persist on layout change (drag/resize commits).
  const layoutForThis = layouts.find((l) => l.i === session.id);
  useEffect(() => {
    if (!layoutForThis) return;
    persist(snippets, {
      x: layoutForThis.x,
      y: layoutForThis.y,
      w: layoutForThis.w,
      h: layoutForThis.h,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutForThis?.x, layoutForThis?.y, layoutForThis?.w, layoutForThis?.h]);

  // ── Snippet operations ──
  const updateSnippet = useCallback(
    (id: string, patch: Partial<Snippet>) => {
      setSnippets((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addSnippet = useCallback(() => {
    setSnippets((prev) => {
      const next = [...prev, { id: makeSnipId(), title: "", body: "" }];
      persist(next);
      return next;
    });
  }, [persist]);

  const deleteSnippet = useCallback(
    (id: string) => {
      setSnippets((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        const next = filtered.length ? filtered : [{ id: makeSnipId(), title: "", body: "" }];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const moveSnippet = useCallback(
    (id: string, dir: -1 | 1) => {
      setSnippets((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx < 0) return prev;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const sendSnippet = useCallback(
    async (id: string) => {
      const snip = snippets.find((s) => s.id === id);
      if (!snip) return;
      const targetId = session.notePinnedTo ?? focusedSessionId;
      if (!targetId || targetId === session.id) return;
      const target = allSessions.find((s) => s.id === targetId);
      if (!target || (target.kind ?? "terminal") !== "terminal") return;
      const payload = snip.body.endsWith("\n") ? snip.body : snip.body + "\n";
      try {
        await writeToPty(target.id, new TextEncoder().encode(payload));
        window.dispatchEvent(
          new CustomEvent("codegrid:focus-terminal", { detail: { sessionId: target.id } }),
        );
      } catch (e) {
        console.warn("[NotePane] send failed:", e);
      }
    },
    [snippets, session.id, session.notePinnedTo, focusedSessionId, allSessions],
  );

  const handleColor = useCallback(
    (hex: string) => {
      updateSession(session.id, { noteColor: hex });
      setShowColors(false);
      persist(snippets, { color: hex });
    },
    [session.id, updateSession, persist, snippets],
  );

  const handlePin = useCallback(
    (targetId: string | null) => {
      updateSession(session.id, { notePinnedTo: targetId ?? undefined });
      setPinPickerOpen(false);
      persist(snippets, { pinned_to: targetId });
    },
    [session.id, updateSession, persist, snippets],
  );

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed) setSessionManualName(session.id, trimmed);
    setRenaming(false);
    persist(snippets, { title: trimmed || null });
  }, [renameValue, session.id, setSessionManualName, persist, snippets]);

  const title = session.manualName?.trim() || "notes";
  const sendTarget = pinnedTarget ?? allSessions.find((s) => s.id === focusedSessionId);
  const canSend =
    !!sendTarget && sendTarget.id !== session.id && (sendTarget.kind ?? "terminal") === "terminal";

  return (
    <div
      onClick={() => setFocusedSession(session.id)}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#16140d",
        border: `1px solid ${isFocused ? color : color + "55"}`,
        borderRadius: isFocused ? "4px" : "2px",
        boxShadow: isFocused ? `0 0 14px ${color}40` : "none",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("input, button, textarea, .cg-color-pop")) return;
          onDragStart?.(e);
        }}
        onDoubleClick={() => toggleMaximize(session.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          background: color,
          color: "#000",
          cursor: "grab",
          userSelect: "none",
          fontFamily: UI_FONT,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.5px",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <span style={{ fontSize: 12 }}>📝</span>
        {renaming ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(0,0,0,0.4)",
              color: "#000",
              padding: "1px 4px",
              fontFamily: UI_FONT,
              fontSize: 11,
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenameValue(title);
              setRenaming(true);
            }}
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={title + " — double-click to rename"}
          >
            {title.toUpperCase()}
          </span>
        )}

        {pinnedTarget && (
          <span
            title={`Pinned to [${pinnedTarget.pane_number}]`}
            style={{
              fontSize: 9,
              background: "rgba(0,0,0,0.2)",
              padding: "1px 4px",
              borderRadius: 2,
              flexShrink: 0,
            }}
          >
            📌 #{pinnedTarget.pane_number}
          </span>
        )}

        {/* Color swatch */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowColors((s) => !s);
            setPinPickerOpen(false);
          }}
          title="Color"
          style={{
            background: "rgba(0,0,0,0.15)",
            border: "1px solid rgba(0,0,0,0.3)",
            cursor: "pointer",
            padding: "0 4px",
            borderRadius: 2,
            display: "flex",
            gap: 2,
            alignItems: "center",
            height: 16,
          }}
        >
          {NOTE_COLORS.slice(0, 3).map((c) => (
            <span
              key={c.hex}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: c.hex,
                border: c.hex === color ? "1px solid #000" : "1px solid rgba(0,0,0,0.2)",
              }}
            />
          ))}
        </button>

        {/* Pin picker */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setPinPickerOpen((s) => !s);
            setShowColors(false);
          }}
          title="Pin to pane"
          style={{
            background: pinnedTarget ? "#000" : "rgba(0,0,0,0.15)",
            border: "1px solid rgba(0,0,0,0.3)",
            color: pinnedTarget ? color : "rgba(0,0,0,0.85)",
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 9,
            padding: "1px 5px",
            borderRadius: 2,
            fontWeight: 700,
          }}
        >
          📌
        </button>

        {/* Minimize */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            minimizePane(session.id);
          }}
          title="Minimize"
          style={{
            background: "none",
            border: "none",
            color: "rgba(0,0,0,0.45)",
            cursor: "pointer",
            fontSize: 11,
            padding: "0 3px",
            lineHeight: 1,
            fontFamily: UI_FONT,
          }}
        >
          −
        </button>
        {/* Close */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(session.id);
          }}
          title="Close note"
          style={{
            background: "none",
            border: "none",
            color: "rgba(0,0,0,0.45)",
            cursor: "pointer",
            fontSize: 13,
            padding: "0 3px",
            lineHeight: 1,
            fontFamily: UI_FONT,
          }}
        >
          ×
        </button>

        {showColors && (
          <div
            className="cg-color-pop"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "100%",
              right: 4,
              marginTop: 4,
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              padding: 6,
              display: "flex",
              gap: 4,
              zIndex: 30,
              boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
            }}
          >
            {NOTE_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => handleColor(c.hex)}
                title={c.name}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: c.hex,
                  border: c.hex === color ? "2px solid #fff" : "2px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
        )}

        {pinPickerOpen && (
          <div
            className="cg-color-pop"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "100%",
              right: 4,
              marginTop: 4,
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              padding: 4,
              minWidth: 200,
              zIndex: 30,
              boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            <div
              onClick={() => handlePin(null)}
              style={{
                padding: "5px 8px",
                cursor: "pointer",
                color: !pinnedTarget ? color : "#888",
                fontFamily: UI_FONT,
                fontSize: 10,
                borderRadius: 2,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2a")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              ◯ Unpinned (uses focused pane)
            </div>
            {pinCandidates.length === 0 && (
              <div style={{ padding: "5px 8px", color: "#555", fontFamily: UI_FONT, fontSize: 10 }}>
                No other panes in this workspace
              </div>
            )}
            {pinCandidates.map((p) => (
              <div
                key={p.id}
                onClick={() => handlePin(p.id)}
                style={{
                  padding: "5px 8px",
                  cursor: "pointer",
                  color: p.id === session.notePinnedTo ? color : "#cccccc",
                  fontFamily: UI_FONT,
                  fontSize: 10,
                  borderRadius: 2,
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: "#666" }}>#{p.pane_number}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.manualName ?? p.activityName ?? p.command ?? "session"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snippet rack */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "#16140d",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {snippets.map((snip, idx) => (
          <SnippetCard
            key={snip.id}
            index={idx + 1}
            snip={snip}
            color={color}
            canSend={canSend}
            sendTargetLabel={
              canSend && sendTarget
                ? `[${sendTarget.pane_number}] ${sendTarget.manualName ?? sendTarget.activityName ?? ""}`
                : null
            }
            isFirst={idx === 0}
            isLast={idx === snippets.length - 1}
            onChangeTitle={(t) => updateSnippet(snip.id, { title: t })}
            onChangeBody={(b) => updateSnippet(snip.id, { body: b })}
            onSend={() => sendSnippet(snip.id)}
            onDelete={() => deleteSnippet(snip.id)}
            onMoveUp={() => moveSnippet(snip.id, -1)}
            onMoveDown={() => moveSnippet(snip.id, 1)}
          />
        ))}

        <button
          onClick={addSnippet}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            marginTop: 2,
            background: "transparent",
            border: `1px dashed ${color}66`,
            color: color,
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 11,
            padding: "8px 10px",
            borderRadius: 4,
            letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${color}11`;
            e.currentTarget.style.borderStyle = "solid";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderStyle = "dashed";
          }}
        >
          + ADD PROMPT
        </button>
      </div>
    </div>
  );
});

interface SnippetCardProps {
  index: number;
  snip: Snippet;
  color: string;
  canSend: boolean;
  sendTargetLabel: string | null;
  isFirst: boolean;
  isLast: boolean;
  onChangeTitle: (t: string) => void;
  onChangeBody: (b: string) => void;
  onSend: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const SnippetCard = memo(function SnippetCard({
  index,
  snip,
  color,
  canSend,
  sendTargetLabel,
  isFirst,
  isLast,
  onChangeTitle,
  onChangeBody,
  onSend,
  onDelete,
  onMoveUp,
  onMoveDown,
}: SnippetCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea so it always fits its content (within a sensible cap).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(400, Math.max(60, el.scrollHeight)) + "px";
  }, [snip.body]);

  return (
    <div
      style={{
        background: "#0f0e08",
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 3,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Row 1: index + title input + reorder + delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontFamily: UI_FONT,
            fontSize: 9,
            fontWeight: 700,
            color: color,
            background: "#000",
            padding: "1px 5px",
            borderRadius: 2,
            flexShrink: 0,
            letterSpacing: "0.5px",
          }}
        >
          #{index}
        </span>
        <input
          value={snip.title}
          onChange={(e) => onChangeTitle(e.target.value)}
          placeholder="Untitled prompt…"
          spellCheck={false}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            borderBottom: "1px solid transparent",
            color: "#e0e0e0",
            fontFamily: UI_FONT,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 0",
            outline: "none",
            minWidth: 0,
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = `${color}66`)}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = "transparent")}
        />
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
          style={{
            background: "transparent",
            border: "none",
            color: isFirst ? "#333" : "#666",
            cursor: isFirst ? "default" : "pointer",
            fontFamily: UI_FONT,
            fontSize: 11,
            padding: "0 3px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (!isFirst) e.currentTarget.style.color = color; }}
          onMouseLeave={(e) => { if (!isFirst) e.currentTarget.style.color = "#666"; }}
        >
          ▲
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
          style={{
            background: "transparent",
            border: "none",
            color: isLast ? "#333" : "#666",
            cursor: isLast ? "default" : "pointer",
            fontFamily: UI_FONT,
            fontSize: 11,
            padding: "0 3px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (!isLast) e.currentTarget.style.color = color; }}
          onMouseLeave={(e) => { if (!isLast) e.currentTarget.style.color = "#666"; }}
        >
          ▼
        </button>
        <button
          onClick={onDelete}
          title="Delete prompt"
          style={{
            background: "transparent",
            border: "none",
            color: "#555",
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 12,
            padding: "0 3px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ff3d00")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
        >
          ×
        </button>
      </div>

      {/* Row 2: body textarea */}
      <textarea
        ref={textareaRef}
        value={snip.body}
        onChange={(e) => onChangeBody(e.target.value)}
        placeholder="Type your prompt here. SEND ↪ types this into the pinned (or focused) pane."
        spellCheck={false}
        rows={3}
        style={{
          width: "100%",
          background: "#000",
          border: "1px solid #1f1d14",
          color: "#d8d8d8",
          fontFamily: MONO,   /* prompt text — monospace for path/code legibility */
          fontSize: 13,
          lineHeight: 1.55,
          padding: "8px 10px",
          outline: "none",
          resize: "vertical",
          minHeight: 64,
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = `${color}55`)}
        onBlur={(e) => (e.currentTarget.style.borderColor = "#1f1d14")}
      />

      {/* Row 3: send button + target hint */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onSend}
          disabled={!canSend || !snip.body.trim()}
          title={
            !snip.body.trim()
              ? "Empty prompt"
              : canSend
                ? `Send to ${sendTargetLabel ?? "focused pane"}`
                : "Pin to a pane (or focus a terminal) to enable"
          }
          style={{
            background: canSend && snip.body.trim() ? color : "#1a1a1a",
            border: `1px solid ${canSend && snip.body.trim() ? color : "#2a2a2a"}`,
            color: canSend && snip.body.trim() ? "#000" : "#555",
            cursor: canSend && snip.body.trim() ? "pointer" : "not-allowed",
            fontFamily: UI_FONT,
            fontSize: 10,
            padding: "3px 10px",
            borderRadius: 3,
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          SEND ↪
        </button>
        <span
          style={{
            fontFamily: UI_FONT,
            fontSize: 9,
            color: "#555",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {canSend && sendTargetLabel ? `→ ${sendTargetLabel}` : "(no target)"}
        </span>
      </div>
    </div>
  );
});
