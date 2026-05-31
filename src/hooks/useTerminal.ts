import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { CODEGRID_DARK } from "../lib/themes";
import { useResourceStore } from "../stores/resourceStore";
import { useSessionStore } from "../stores/sessionStore";

/**
 * Browsers cap live WebGL contexts (~16 in Chromium/WebKit). With 50–100
 * terminal panes, handing every pane a WebGL renderer triggers context-loss
 * churn that degrades ALL terminals. Cap WebGL to a safe number of panes and
 * render the rest with the Canvas addon (still GPU-free-fast, no context cost).
 */
const MAX_WEBGL_CONTEXTS = 12;
let activeWebglContexts = 0;

interface UseTerminalOptions {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "bar" | "block" | "underline";
  cursorBlink?: boolean;
  agentColor?: string;
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseTerminalOptions,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const disposedRef = useRef(false);
  // Use refs for callbacks to avoid recreating terminal on callback changes
  const onDataRef = useRef(options.onData);
  const onResizeRef = useRef(options.onResize);
  onDataRef.current = options.onData;
  onResizeRef.current = options.onResize;

  const write = useCallback((data: Uint8Array | string) => {
    if (!disposedRef.current) {
      terminalRef.current?.write(data);
    }
  }, []);

  const fit = useCallback(() => {
    if (!disposedRef.current && fitAddonRef.current && containerRef.current) {
      try {
        fitAddonRef.current.fit();
        const term = terminalRef.current;
        if (term) {
          onResizeRef.current(term.cols, term.rows);
        }
      } catch {
        // Ignore fit errors during transitions
      }
    }
  }, [containerRef]);

  const focus = useCallback(() => {
    if (!disposedRef.current) {
      terminalRef.current?.focus();
    }
  }, []);

  const clear = useCallback(() => {
    if (!disposedRef.current) {
      terminalRef.current?.clear();
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    disposedRef.current = false;

    // Build scrollbar colors from agent color (default to theme accent)
    const ac = options.agentColor ?? "#ff8c00";
    const scrollbarTheme = {
      scrollbarSliderBackground: ac + "40",        // 25% opacity
      scrollbarSliderHoverBackground: ac + "80",   // 50% opacity
      scrollbarSliderActiveBackground: ac + "b3",  // 70% opacity
    };

    const terminal = new Terminal({
      theme: { ...CODEGRID_DARK.terminal, ...scrollbarTheme },
      fontSize: options.fontSize ?? 13,
      fontFamily: options.fontFamily ?? "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace",
      cursorBlink: options.cursorBlink ?? true,
      /* Bar reads more reliably than block when the renderer draws the cursor. */
      cursorStyle: options.cursorStyle ?? "bar",
      scrollback: useResourceStore.getState().getScrollbackForCount(
        useSessionStore.getState().sessions.length,
      ),
      allowProposedApi: true,
      convertEol: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    terminal.open(container);

    // Renderer: prefer WebGL for performance up to the context cap, otherwise
    // Canvas (fall back to DOM). `usedWebglSlot` tracks whether THIS terminal
    // holds a WebGL slot so we release it exactly once on loss/dispose.
    let usedWebglSlot = false;
    const releaseWebglSlot = () => {
      if (usedWebglSlot) { usedWebglSlot = false; activeWebglContexts = Math.max(0, activeWebglContexts - 1); }
    };
    if (activeWebglContexts < MAX_WEBGL_CONTEXTS) {
      try {
        const webgl = new WebglAddon();
        usedWebglSlot = true;
        activeWebglContexts++;
        // If GPU context is lost at runtime, release the slot and fall back to Canvas.
        webgl.onContextLoss(() => {
          releaseWebglSlot();
          webgl.dispose();
          try { terminal.loadAddon(new CanvasAddon()); } catch { /* DOM fallback */ }
        });
        terminal.loadAddon(webgl);
      } catch {
        releaseWebglSlot();
        try { terminal.loadAddon(new CanvasAddon()); } catch { /* DOM fallback */ }
      }
    } else {
      try {
        terminal.loadAddon(new CanvasAddon());
      } catch {
        // Fall back to xterm's default DOM renderer
      }
    }

    // Unicode 11 support for wider character coverage
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";

    // Fit to container
    requestAnimationFrame(() => {
      if (!disposedRef.current) {
        try {
          fitAddon.fit();
          onResizeRef.current(terminal.cols, terminal.rows);
        } catch {
          // Ignore
        }
      }
    });

    // Handle data input -- use ref to avoid stale closure
    const dataDisposable = terminal.onData((data) => onDataRef.current(data));

    // Handle resize with debouncing to avoid thrashing during layout transitions.
    // Without debouncing, rapid resize events (e.g. dragging a grid splitter)
    // cause excessive fit() calls which can visually glitch and flood the PTY
    // with SIGWINCH-equivalent resize sequences.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          if (!disposedRef.current) {
            try {
              fitAddon.fit();
              onResizeRef.current(terminal.cols, terminal.rows);
            } catch {
              // Ignore
            }
          }
        });
      }, 50);
    });
    observer.observe(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      disposedRef.current = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      dataDisposable.dispose();
      observer.disconnect();
      releaseWebglSlot();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [containerRef]);

  // Live-apply font-size changes (terminal zoom) without recreating the
  // terminal — just update the option and refit so cols/rows recompute.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || disposedRef.current || options.fontSize == null) return;
    if (term.options.fontSize === options.fontSize) return;
    term.options.fontSize = options.fontSize;
    requestAnimationFrame(() => {
      if (disposedRef.current) return;
      try {
        fitAddonRef.current?.fit();
        onResizeRef.current(term.cols, term.rows);
      } catch {
        // Ignore fit errors during transitions
      }
    });
  }, [options.fontSize]);

  // Live-apply cursor style / blink changes without recreating the terminal.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || disposedRef.current) return;
    if (options.cursorStyle) term.options.cursorStyle = options.cursorStyle;
    if (options.cursorBlink != null) term.options.cursorBlink = options.cursorBlink;
  }, [options.cursorStyle, options.cursorBlink]);

  return { write, fit, focus, clear, terminal: terminalRef, searchAddon: searchAddonRef };
}
