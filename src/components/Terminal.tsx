import { useRef, useEffect, useCallback, useState, memo } from "react";
import { useTerminal } from "../hooks/useTerminal";
import { usePty } from "../hooks/usePty";
import { useSessionStore } from "../stores/sessionStore";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import { updateSessionStatus } from "../lib/ipc";
import { detectActivity, detectAttentionNeeded, detectAgentBusy } from "../lib/terminalActivity";
import { registerTerminalSnapshot, unregisterTerminalSnapshot } from "../lib/terminalSnapshots";
import { UI_ICON } from "../lib/icons";

/** Agent CLIs whose status we infer from spinner/prompt markers rather than raw output. */
function commandIsAgent(command: string | null | undefined): boolean {
  return /\b(claude|codex|gemini|cursor|grok)\b/.test((command ?? "").toLowerCase());
}

/** Quote a filesystem path so it can be safely pasted onto a shell command line. */
function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Extract dropped filesystem paths from a drag event (file-tree drags carry the
 *  absolute path as text/plain; Finder/OS drags use file:// URIs in text/uri-list). */
function pathsFromDrop(dt: DataTransfer): string[] {
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    return uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => (l.startsWith("file://") ? decodeURIComponent(l.replace(/^file:\/\/(localhost)?/, "")) : l));
  }
  const plain = dt.getData("text/plain").trim();
  return plain ? [plain] : [];
}

// NOTE: Do NOT share a single TextDecoder across components when using
// { stream: true } -- streaming mode keeps internal state for incomplete
// multi-byte sequences, so sharing it between sessions would cause one
// session's partial UTF-8 bytes to corrupt another session's output.

interface TerminalProps {
  sessionId: string;
  agentColor?: string;
}

type SessionStatus = "idle" | "running" | "waiting" | "error" | "dead";

export const TerminalView = memo(function TerminalView({ sessionId, agentColor }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputRef = useRef("");
  const outputBufferRef = useRef<Uint8Array[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<SessionStatus | null>(null);
  const lastAttentionRef = useRef<{ reason: string; at: number } | null>(null);
  // Output that arrives just after a focus/resize is a repaint, NOT real work —
  // suppress flipping an at-rest pane to "running" during this window.
  const suppressRunningUntilRef = useRef(0);
  // True while the agent is blocked on a prompt (needs the user). Cleared when
  // the user types into the pane or the agent resumes producing work.
  const waitingRef = useRef(false);
  const statusToastSentRef = useRef<{ idle: boolean; dead: boolean }>({ idle: false, dead: false });
  // Each terminal needs its own TextDecoder because { stream: true } maintains
  // internal state for incomplete multi-byte UTF-8 sequences.
  const textDecoderRef = useRef(new TextDecoder());
  const updateSession = useSessionStore((s) => s.updateSession);
  const setSessionActivityName = useSessionStore((s) => s.setSessionActivityName);
  const broadcastMode = useSessionStore((s) => s.broadcastMode);
  // Whether this is an agent CLI — drives spinner-based status instead of the
  // "any byte = running" heuristic that made shells/empty panes look busy.
  const sessionCommand = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId)?.command);
  const isAgentRef = useRef(false);
  isAgentRef.current = commandIsAgent(sessionCommand);
  const addToast = useToastStore((s) => s.addToast);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [fileDragOver, setFileDragOver] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use refs to avoid stale closures in callbacks that reference each other
  const ptyControlsRef = useRef<{ write: (data: string) => void; resize: (cols: number, rows: number) => void }>({
    write: () => {},
    resize: () => {},
  });

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      // A resize makes the TUI repaint; treat the immediate output as a repaint,
      // not as the agent starting work.
      suppressRunningUntilRef.current = Date.now() + 1500;
      ptyControlsRef.current.resize(cols, rows);
    },
    [],
  );

  const handleData = useCallback(
    (data: string) => {
      // The user is interacting → they're answering any prompt; the agent's
      // subsequent output is genuine work, so stop suppressing "running".
      waitingRef.current = false;
      suppressRunningUntilRef.current = 0;
      if (broadcastMode) {
        window.dispatchEvent(
          new CustomEvent("codegrid:broadcast-input", { detail: { data } }),
        );
      } else {
        ptyControlsRef.current.write(data);
      }
    },
    [broadcastMode],
  );

  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const terminalCursorStyle = useAppStore((s) => s.terminalCursorStyle);
  const terminalCursorBlink = useAppStore((s) => s.terminalCursorBlink);

  const { write, fit, focus, searchAddon, terminal } = useTerminal(containerRef, {
    onData: handleData,
    onResize: handleResize,
    agentColor,
    fontSize: terminalFontSize,
    cursorStyle: terminalCursorStyle,
    cursorBlink: terminalCursorBlink,
  });

  // Expose this terminal's buffer to the pane chrome (✨ name-this-terminal).
  useEffect(() => {
    registerTerminalSnapshot(sessionId, terminal);
    return () => unregisterTerminalSnapshot(sessionId);
  }, [sessionId, terminal]);

  const flushOutput = useCallback(() => {
    const chunks = outputBufferRef.current;
    if (chunks.length === 0) return;
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    outputBufferRef.current = [];
    write(merged);
  }, [write]);

  const setSessionStatus = useCallback(
    (status: SessionStatus) => {
      if (statusRef.current === status) return;
      statusRef.current = status;
      updateSession(sessionId, { status });
    },
    [sessionId, updateSession],
  );

  const handleOutput = useCallback(
    (data: Uint8Array) => {
      outputBufferRef.current.push(data);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushOutput, 5);

      // Accumulate output for activity detection (debounced to avoid excessive processing)
      const text = textDecoderRef.current.decode(data, { stream: true });
      pendingOutputRef.current += text;
      // Keep only the last 2000 chars to avoid unbounded growth
      if (pendingOutputRef.current.length > 2000) {
        pendingOutputRef.current = pendingOutputRef.current.slice(-2000);
      }

      // Debounce activity detection: wait 300ms after last output chunk
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
      activityTimerRef.current = setTimeout(() => {
        const detected = detectActivity(pendingOutputRef.current);
        if (detected) {
          setSessionActivityName(sessionId, detected);
        }
        // Clear accumulated output after processing
        pendingOutputRef.current = "";
      }, 300);

      // Decide this session's status from what just arrived.
      const attention = detectAttentionNeeded(pendingOutputRef.current);
      const isAgent = isAgentRef.current;
      const busy = isAgent && detectAgentBusy(pendingOutputRef.current);
      if (attention) {
        // The agent is blocked on a prompt — it needs the user, not "running".
        waitingRef.current = true;
        setSessionStatus("waiting");
        const now = Date.now();
        const last = lastAttentionRef.current;
        const isDuplicate = !!last && last.reason === attention && now - last.at < 15000;
        if (!isDuplicate) {
          lastAttentionRef.current = { reason: attention, at: now };
          window.dispatchEvent(
            new CustomEvent("codegrid:session-attention", {
              detail: { sessionId, reason: attention },
            }),
          );
        }
      } else if (isAgent) {
        // Agent terminals: trust the spinner / "esc to interrupt" marker as the
        // authoritative "working" signal. Plain output (e.g. a streamed answer
        // or a repaint) does NOT mean running — that's what made idle agents
        // look busy and flash for no reason.
        if (busy) {
          waitingRef.current = false;
          setSessionStatus("running");
        }
        // If not busy, fall through to the idle timer below, which settles the
        // pane to idle shortly after the spinner stops ("done generating").
      } else {
        // Non-agent shell: any real output means work — unless it's a repaint
        // from focusing/resizing an at-rest pane.
        const atRest =
          statusRef.current === "idle" || statusRef.current === "waiting" || statusRef.current === null;
        const isRepaint = Date.now() < suppressRunningUntilRef.current && atRest;
        if (!isRepaint) {
          waitingRef.current = false;
          setSessionStatus("running");
        }
      }

      // Reset idle timer. Agents settle quickly once the spinner stops so "done"
      // is detected promptly; shells use a longer quiet window.
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      const idleDelay = isAgent && !busy ? 1500 : 10000;
      statusTimerRef.current = setTimeout(() => {
        // Never resurrect a finished session back to "idle".
        if (statusRef.current === "dead") return;
        // A pane blocked on a prompt stays "waiting" until the user acts; going
        // quiet doesn't mean it became idle.
        if (waitingRef.current || statusRef.current === "waiting") return;
        setSessionStatus("idle");
        updateSessionStatus(sessionId, "idle").catch((err) => {
          if (!statusToastSentRef.current.idle) {
            statusToastSentRef.current.idle = true;
            addToast(`Could not sync idle status for terminal ${sessionId.slice(0, 6)}: ${err}`, "warning", 5000);
          }
        });
      }, 10000);
    },
    [sessionId, write, flushOutput, setSessionStatus, setSessionActivityName, addToast],
  );

  const handleEnded = useCallback(() => {
    // Cancel the pending idle timer so it can't flip the dead session back to
    // "idle" after it has ended.
    if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); statusTimerRef.current = null; }
    if (activityTimerRef.current) { clearTimeout(activityTimerRef.current); activityTimerRef.current = null; }
    // Flush any buffered output BEFORE the end marker so final CLI output
    // doesn't render after "[Session ended]".
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    flushOutput();
    setSessionStatus("dead");
    updateSessionStatus(sessionId, "dead").catch((err) => {
      if (!statusToastSentRef.current.dead) {
        statusToastSentRef.current.dead = true;
        addToast(`Could not sync ended status for terminal ${sessionId.slice(0, 6)}: ${err}`, "warning", 5000);
      }
    });
    write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
  }, [sessionId, write, flushOutput, setSessionStatus, addToast]);

  const ptyControls = usePty({
    sessionId,
    onOutput: handleOutput,
    onEnded: handleEnded,
  });

  // Keep ref in sync
  ptyControlsRef.current = ptyControls;

  // Clean up timers on unmount — flush remaining buffered output first
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      // Drain any buffered output before terminal disposes
      const chunks = outputBufferRef.current;
      if (chunks.length > 0) {
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
        outputBufferRef.current = [];
        write(merged);
      }
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
    };
  }, [write]);

  // Listen for focus events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.sessionId === sessionId) {
        // Focusing re-renders the TUI; the resulting output is a repaint, not work.
        suppressRunningUntilRef.current = Date.now() + 1500;
        focus();
      }
    };
    window.addEventListener("codegrid:focus-terminal", handler);
    return () => window.removeEventListener("codegrid:focus-terminal", handler);
  }, [sessionId, focus]);

  // Listen for broadcast write -- use ref to avoid stale closure
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; data?: string }>).detail;
      if (!detail || detail.sessionId !== sessionId || typeof detail.data !== "string") return;
      ptyControlsRef.current.write(detail.data);
    };
    window.addEventListener("codegrid:broadcast-write", handler);
    return () => window.removeEventListener("codegrid:broadcast-write", handler);
  }, [sessionId]);

  // Fit on mount
  useEffect(() => {
    const timer = setTimeout(fit, 100);
    return () => clearTimeout(timer);
  }, [fit]);

  // Re-fit when workspace switches back to this terminal's workspace
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId?: string }>).detail;
      const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      if (session && detail?.workspaceId === session.workspace_id) {
        // Small delay to let CSS visibility change take effect before fitting
        setTimeout(fit, 50);
      }
    };
    window.addEventListener("codegrid:workspace-changed", handler);
    return () => window.removeEventListener("codegrid:workspace-changed", handler);
  }, [sessionId, fit]);

  // ── Drag files/folders into the terminal (like Cursor) ──
  // Dropping a file or folder inserts its shell-quoted path at the prompt.
  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes("text/plain") || types.includes("text/uri-list") || types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!fileDragOver) setFileDragOver(true);
    }
  }, [fileDragOver]);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    // Clear only when the pointer actually leaves the container (not when moving
    // onto a child element). relatedTarget is what the pointer entered next.
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) setFileDragOver(false);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    const paths = pathsFromDrop(e.dataTransfer);
    if (paths.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    const text = paths.map(shellQuote).join(" ") + " ";
    ptyControlsRef.current.write(text);
    focus();
  }, [focus]);

  // Safety net: any drag that ends or drops anywhere clears the hover overlay,
  // so it can never get stuck if a dragleave is missed (e.g. dropped elsewhere).
  useEffect(() => {
    const clear = () => setFileDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); };
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchAddon.current && searchTerm) {
      searchAddon.current.findNext(searchTerm);
    }
  }, [searchTerm, searchAddon]);

  const handleSearchPrev = useCallback(() => {
    if (searchAddon.current && searchTerm) {
      searchAddon.current.findPrevious(searchTerm);
    }
  }, [searchTerm, searchAddon]);

  // Auto-search on term change
  useEffect(() => {
    if (searchAddon.current && searchTerm) {
      searchAddon.current.findNext(searchTerm);
    }
  }, [searchTerm, searchAddon]);

  // Intercept Cmd+F / Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    const el = containerRef.current;
    if (el) {
      el.addEventListener("keydown", handler, true);
      return () => el.removeEventListener("keydown", handler, true);
    }
  }, [containerRef]);

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      onClick={() => { suppressRunningUntilRef.current = Date.now() + 1500; focus(); }}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {fileDragOver && (
        <div
          style={{
            position: "absolute", inset: 0, zIndex: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255, 140, 0, 0.10)",
            border: "2px dashed #ff8c00",
            pointerEvents: "none",
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            color: "#ff8c00", fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
          }}
        >
          Drop to insert path
        </div>
      )}
      {searchOpen && (
        <div style={{
          position: "absolute", top: 4, right: 16, zIndex: 10,
          display: "flex", gap: "4px", alignItems: "center",
          background: "#1e1e1e", border: "1px solid #ff8c00",
          padding: "4px 8px",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
        }}>
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.shiftKey ? handleSearchPrev() : handleSearchNext();
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchTerm("");
                searchAddon.current?.clearDecorations();
                focus();
              }
            }}
            placeholder="Find..."
            style={{
              background: "#0a0a0a", border: "1px solid #2a2a2a", color: "#e0e0e0",
              fontSize: "11px", padding: "3px 6px", outline: "none", width: "160px",
              fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            }}
          />
          <button onClick={handleSearchPrev} style={{
            background: "none", border: "1px solid #2a2a2a", color: "#888", fontSize: "10px",
            cursor: "pointer", padding: "2px 6px", fontFamily: "monospace",
          }}>↑</button>
          <button onClick={handleSearchNext} style={{
            background: "none", border: "1px solid #2a2a2a", color: "#888", fontSize: "10px",
            cursor: "pointer", padding: "2px 6px", fontFamily: "monospace",
          }}>↓</button>
          <button onClick={() => {
            setSearchOpen(false);
            setSearchTerm("");
            searchAddon.current?.clearDecorations();
            focus();
          }} style={{
            background: "none", border: "none", color: "#555", fontSize: "12px",
            cursor: "pointer", padding: "0 4px", fontFamily: "monospace",
            display: "inline-flex", alignItems: "center",
          }}><UI_ICON.close size={13} /></button>
        </div>
      )}
    </div>
  );
});
