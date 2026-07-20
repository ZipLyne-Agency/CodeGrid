import { memo, useState, useRef, useCallback, useEffect } from "react";
import { type StickyNote as StickyNoteType, NOTE_COLORS, useNotesStore } from "../stores/notesStore";

const MONO = "var(--font-ui)";

interface StickyNoteProps {
  note: StickyNoteType;
  onDragStart: (noteId: string, e: React.MouseEvent) => void;
  onResizeStart: (noteId: string, e: React.MouseEvent) => void;
}

export const StickyNote = memo(function StickyNote({ note, onDragStart, onResizeStart }: StickyNoteProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [showColors, setShowColors] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  // Sync external text changes
  useEffect(() => {
    if (!editing) setText(note.text);
  }, [note.text, editing]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    updateNote(note.id, { text });
  }, [note.id, text, updateNote]);

  const handleColorChange = useCallback((hex: string) => {
    updateNote(note.id, { color: hex });
    setShowColors(false);
  }, [note.id, updateNote]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1a1a1a",
        border: "1px solid #2a2a2a",
        borderRadius: "4px",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header bar */}
      <div
        onMouseDown={(e) => {
          // Don't start drag from buttons
          if ((e.target as HTMLElement).closest("button")) return;
          onDragStart(note.id, e);
        }}
        style={{
          height: "24px",
          minHeight: "24px",
          background: note.color,
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          cursor: "grab",
          gap: "4px",
          position: "relative",
        }}
      >
        {/* Color picker toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowColors(!showColors); }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            display: "flex",
            gap: "2px",
            alignItems: "center",
          }}
          title="Change color"
        >
          {NOTE_COLORS.slice(0, 3).map((c) => (
            <span
              key={c.hex}
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: c.hex === note.color ? "#fff" : c.hex,
                border: "1px solid rgba(0,0,0,0.3)",
                display: "inline-block",
              }}
            />
          ))}
        </button>

        <span
          style={{
            flex: 1,
            fontSize: "10px",
            fontFamily: MONO,
            color: "rgba(0,0,0,0.6)",
            fontWeight: "bold",
            letterSpacing: "1px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          NOTE
        </span>

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
          style={{
            background: "none",
            border: "none",
            color: "rgba(0,0,0,0.5)",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px 6px",
            fontFamily: MONO,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(0,0,0,0.9)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,0,0,0.5)")}
          title="Delete note"
          aria-label="Delete note"
        >
          ×
        </button>

        {/* Color picker dropdown */}
        {showColors && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              background: "#1e1e1e",
              border: "1px solid #2a2a2a",
              borderRadius: "4px",
              padding: "6px",
              display: "flex",
              gap: "4px",
              zIndex: 100,
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {NOTE_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => handleColorChange(c.hex)}
                title={c.name}
                style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  background: c.hex,
                  border: c.hex === note.color ? "2px solid #fff" : "2px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Text area */}
      <div
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
        onClick={() => {
          if (!editing) {
            setEditing(true);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                handleBlur();
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              background: "transparent",
              border: "none",
              color: "#cccccc",
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: "1.5",
              padding: "8px",
              resize: "none",
              outline: "none",
              overflow: "auto",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              color: note.text ? "#cccccc" : "#555555",
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: "1.5",
              padding: "8px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "hidden",
              cursor: "text",
            }}
          >
            {note.text || "Click to type..."}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(note.id, e);
        }}
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: "12px",
          height: "12px",
          cursor: "nwse-resize",
          zIndex: 10,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
          <line x1="10" y1="2" x2="2" y2="10" stroke="#444" strokeWidth="1" />
          <line x1="10" y1="6" x2="6" y2="10" stroke="#444" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
});
