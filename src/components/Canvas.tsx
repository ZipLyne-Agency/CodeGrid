import { useCallback, useMemo, memo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clampMenuPosition } from "../lib/menuPosition";
import { Pane } from "./Pane";
import { BrowserPane } from "./BrowserPane";
import { NotePane } from "./NotePane";
import { ScratchPane } from "./ScratchPane";
import { AttentionBar } from "./AttentionBar";
import { ResourceIndicator } from "./ResourceIndicator";
import { StickyNote } from "./StickyNote";
import { MinimizedPaneBar } from "./MinimizedPaneBar";
import { TrialBanner } from "./TrialBanner";
import { useSessionStore } from "../stores/sessionStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useNotesStore } from "../stores/notesStore";
import { UI_ICON } from "../lib/icons";
import { useShallow } from "zustand/react/shallow";

interface CanvasProps {
  width: number;
  height: number;
  onCloseSession: (sessionId: string) => void;
}

const MONO = "var(--font-ui)";
const ZOOMED_OUT_LABEL_THRESHOLD = 0.35;
// Below this zoom the pane content is too small to interact with, so the WHOLE
// pane becomes a drag handle (not just the 34px header). Fixes "impossible to
// grab panes when zoomed out".
const DRAG_ANYWHERE_ZOOM = 0.6;

// Canvas dot-grid spacing (px, in canvas space). Panes/notes snap to this grid
// while dragging and resizing so they line up cleanly. Matches the visual grid
// rendered in the background below.
const GRID = 24;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// ── Perf-critical: all pan/drag/resize runs via refs + direct DOM mutation.
//    Zustand is only written on mouseup (commit), so React never re-renders mid-gesture.

export const Canvas = memo(function Canvas({ width, height, onCloseSession }: CanvasProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setNewSessionDialogOpen = useWorkspaceStore((s) => s.setNewSessionDialogOpen);
  // Render ALL sessions across all workspaces to keep xterm instances alive.
  // Non-active workspace sessions are hidden with CSS (display:none) to preserve
  // terminal buffer content when switching workspaces.
  const allSessions = useSessionStore(useShallow((s) => s.sessions));
  const sessions = useMemo(
    () => allSessions.filter((session) => session.workspace_id === activeWorkspaceId),
    [allSessions, activeWorkspaceId],
  );
  const layouts = useLayoutStore((s) => s.layouts);
  const maximizedPane = useLayoutStore((s) => s.maximizedPane);
  const minimizedPanes = useLayoutStore((s) => s.minimizedPanes);
  const canvas = useLayoutStore((s) => s.canvas);
  const toggleLocked = useLayoutStore((s) => s.toggleLocked);
  const zoomToFit = useLayoutStore((s) => s.zoomToFit);
  const autoLayout = useLayoutStore((s) => s.autoLayout);
  const setCanvas = useLayoutStore((s) => s.setCanvas);

  const allNotes = useNotesStore((s) => s.notes);
  const workspaceNotes = useMemo(
    () => allNotes.filter((n) => n.workspaceId === activeWorkspaceId),
    [allNotes, activeWorkspaceId],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  // Live mutable state — never triggers renders
  const live = useRef({
    zoom: canvas.zoom,
    panX: canvas.panX,
    panY: canvas.panY,
    locked: canvas.locked,
    // interaction
    mode: "idle" as "idle" | "pan" | "drag" | "resize" | "note-drag" | "note-resize",
    startX: 0,
    startY: 0,
    origPanX: 0,
    origPanY: 0,
    // drag
    dragId: "",
    dragOrigX: 0,
    dragOrigY: 0,
    dragEl: null as HTMLElement | null,
    // resize
    resizeId: "",
    resizeHandle: "",
    resizeOrigX: 0,
    resizeOrigY: 0,
    resizeOrigW: 0,
    resizeOrigH: 0,
    resizeEl: null as HTMLElement | null,
    panePreview: {} as Record<string, { x: number; y: number; w: number; h: number }>,
    // note drag/resize
    noteId: "",
    noteOrigX: 0,
    noteOrigY: 0,
    noteOrigW: 0,
    noteOrigH: 0,
    noteEl: null as HTMLElement | null,
    // space
    spaceHeld: false,
    // momentum
    velocitySamples: [] as { x: number; y: number; t: number }[],
    momentumRaf: 0,
  });

  // Sync zustand → live ref when store changes (e.g. preset, autoLayout, external)
  useEffect(() => {
    live.current.zoom = canvas.zoom;
    live.current.panX = canvas.panX;
    live.current.panY = canvas.panY;
    live.current.locked = canvas.locked;
    applySurfaceTransform();
    applyBgTransform();
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(canvas.zoom * 100)}%`;
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.locked]);

  const dragOverlayRef = useRef<HTMLDivElement>(null);
  // Full-canvas overlay that captures pointer events while the Space "hand tool"
  // is held, so a drag pans the whole canvas instead of clicking into a pane.
  const panOverlayRef = useRef<HTMLDivElement>(null);
  const hasMinimized = Object.keys(minimizedPanes).length > 0;
  const canvasHeight = height;
  // Explicit pan-tool mode — toggled by the bottom-bar "Pan" button. When on, a
  // full-canvas overlay shows a grab cursor and captures drags to pan.
  const [panMode, setPanMode] = useState(false);

  // ── Right-click "Add to canvas" context menu ──
  // Anything you can drop on the canvas lives here. Opens at the cursor on a
  // right-click of empty canvas (not over a pane/note, where the terminal or
  // note gets its own native menu). Mirrors the "+ New" menu's add items.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [ctxPos, setCtxPos] = useState<{ top: number; left: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    if (maximizedPane || panMode) return;
    // Right-clicking inside a pane or note: leave it to that element (xterm
    // paste menu, note actions). Only the bare canvas opens the add menu.
    const t = e.target as HTMLElement;
    if (t.closest("[data-pane-id]") || t.closest("[data-note-id]")) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [maximizedPane, panMode]);

  // Clamp the menu fully on-screen once measured (flips near a viewport edge).
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxRef.current) { setCtxPos(null); return; }
    const m = ctxRef.current.getBoundingClientRect();
    const anchor = { top: ctxMenu.y, bottom: ctxMenu.y, left: ctxMenu.x, right: ctxMenu.x };
    setCtxPos(clampMenuPosition(anchor, { width: m.width, height: m.height }, { gap: 2 }));
  }, [ctxMenu]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setCtxMenu(null); return; }
      if ((e.target as HTMLElement).closest("[data-canvas-ctx]")) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [ctxMenu]);

  const minimizedSessions = useMemo(() => {
    const minIds = new Set(Object.keys(minimizedPanes));
    return sessions.filter((s) => minIds.has(s.id));
  }, [sessions, minimizedPanes]);

  const visibleLayouts = useMemo(() => {
    if (maximizedPane) {
      const maximizedLayout = layouts.find((l) => l.i === maximizedPane);
      if (maximizedLayout) return [maximizedLayout];
    }
    return layouts;
  }, [layouts, maximizedPane]);
  const visibleLayoutMap = useMemo(
    () => new Map(visibleLayouts.map((layout) => [layout.i, layout])),
    [visibleLayouts],
  );

  const visibleSessions = useMemo(() => {
    const layoutIds = new Set(visibleLayouts.map((l) => l.i));
    return sessions.filter((s) => layoutIds.has(s.id));
  }, [sessions, visibleLayouts]);

  // ── Direct DOM helpers (no React) ──

  function applySurfaceTransform() {
    const el = surfaceRef.current;
    if (!el) return;
    const { zoom, panX, panY } = live.current;
    el.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
  }

  function applyBgTransform() {
    const el = bgRef.current;
    if (!el) return;
    const { zoom, panX, panY } = live.current;
    const size = 24 * zoom;
    el.style.backgroundSize = `${size}px ${size}px`;
    el.style.backgroundPosition = `${(panX * zoom) % size}px ${(panY * zoom) % size}px`;
  }

  function updateZoomLabel() {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(live.current.zoom * 100)}%`;
    }
  }

  function cancelMomentum() {
    if (live.current.momentumRaf) {
      cancelAnimationFrame(live.current.momentumRaf);
      live.current.momentumRaf = 0;
    }
  }

  function startMomentum(vx: number, vy: number) {
    const FRICTION = 0.92;
    const MIN_VELOCITY = 0.1;
    let velX = vx;
    let velY = vy;

    const tick = () => {
      velX *= FRICTION;
      velY *= FRICTION;

      if (Math.abs(velX) + Math.abs(velY) < MIN_VELOCITY) {
        live.current.momentumRaf = 0;
        commitCanvasState();
        return;
      }

      live.current.panX += velX;
      live.current.panY += velY;
      applySurfaceTransform();
      applyBgTransform();
      live.current.momentumRaf = requestAnimationFrame(tick);
    };

    live.current.momentumRaf = requestAnimationFrame(tick);
  }

  /** Commit current live state to zustand (triggers one render) */
  function commitCanvasState() {
    const { zoom, panX, panY } = live.current;
    const store = useLayoutStore.getState();
    // Batch into one set call
    useLayoutStore.setState({
      canvas: { ...store.canvas, zoom, panX, panY },
    });
  }

  function commitPaneLayout(id: string, x: number, y: number, w: number, h: number) {
    useLayoutStore.getState().updatePaneLayout(id, { x, y, w, h });
  }

  // ── Wheel zoom + pan (native event for passive:false) ──
  // Detects trackpad vs mouse and applies appropriate multipliers for snappy feel.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => {
      if (maximizedPane) return;
      const target = e.target as HTMLElement | null;
      const insideTerminal =
        !!target && !!target.closest(".terminal-container, .xterm, .xterm-screen");
      // Zoom works EVERYWHERE — including while hovering a terminal — via
      // Cmd/Ctrl+wheel or pinch-to-zoom. Plain wheel over a terminal is left
      // alone so the terminal can still scroll its own scrollback.
      if (insideTerminal && !e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      cancelMomentum();

      // Trackpad detection: trackpad events use deltaMode 0 (pixels) with small
      // fractional deltas. Mouse wheel uses deltaMode 1 (lines) or large deltaY jumps.
      const isTrackpad = e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY);

      const L = live.current;

      // Zoom on: pinch-to-zoom (ctrlKey), Cmd+wheel, or plain mouse scroll wheel.
      // Pan on: two-finger trackpad scroll (no modifiers, trackpad detected).
      const isZoom = e.ctrlKey || e.metaKey || !isTrackpad;

      if (isZoom) {
        // ── Zoom ──
        const rect = vp.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const oldZoom = L.zoom;

        // Pinch-to-zoom (ctrlKey) sends pre-scaled deltas — use a gentler multiplier.
        // Cmd+wheel is a deliberate zoom gesture — use a stronger multiplier.
        let zoomSensitivity: number;
        if (e.ctrlKey && !e.metaKey) {
          // Pinch-to-zoom: deltas are already amplified by the OS
          zoomSensitivity = isTrackpad ? 0.008 : 0.005;
        } else {
          // Cmd+scroll wheel
          zoomSensitivity = isTrackpad ? 0.006 : 0.003;
        }

        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.max(0.1, Math.min(3.0, oldZoom * (1 + delta)));

        // Zoom toward cursor
        const worldX = mouseX / oldZoom - L.panX;
        const worldY = mouseY / oldZoom - L.panY;

        L.zoom = newZoom;
        L.panX = mouseX / newZoom - worldX;
        L.panY = mouseY / newZoom - worldY;

        updateZoomLabel();
      } else {
        // ── Pan (two-finger scroll on trackpad, or scroll wheel without modifier) ──
        const panMultiplier = isTrackpad ? 2.0 : 3.0;
        L.panX -= (e.deltaX * panMultiplier) / L.zoom;
        L.panY -= (e.deltaY * panMultiplier) / L.zoom;
      }

      applySurfaceTransform();
      applyBgTransform();
    };
    // Capture phase: the canvas must see the wheel event before xterm (which
    // sits inside a pane) can consume it — otherwise zoom gestures are swallowed
    // whenever the cursor is over a terminal.
    vp.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => vp.removeEventListener("wheel", handler, true);
  }, [maximizedPane]);

  // Commit zoom on debounced idle (so zustand updates after scrolling stops)
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = () => {
      if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
      wheelCommitTimer.current = setTimeout(commitCanvasState, 150);
    };
    vp.addEventListener("wheel", handler, { passive: true });
    return () => { vp.removeEventListener("wheel", handler); if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current); };
  }, []);

  // ── Pan tool (explicit toggle, driven by the bottom-bar "Pan" button) ──
  // Pan mode is OFF by default so terminals stay fully interactive (scroll,
  // wheel-zoom, click). When ON, a full-canvas overlay captures drags to pan.
  // Escape or losing window focus exits so the grab cursor can never get stuck.
  useEffect(() => {
    if (!panMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanMode(false); };
    const onBlur = () => setPanMode(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("blur", onBlur); };
  }, [panMode]);

  // Maximizing a pane must drop out of pan mode (the overlay would block it).
  useEffect(() => { if (maximizedPane && panMode) setPanMode(false); }, [maximizedPane, panMode]);

  // ── External zoom-to-pane command (from top terminal tabs) ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
      const sessionId = detail?.sessionId;
      if (!sessionId) return;

      const store = useLayoutStore.getState();
      if (store.maximizedPane) {
        // Exit maximize mode so canvas zoom/pan can target any pane.
        store.toggleMaximize(store.maximizedPane);
      }
      if (store.isMinimized(sessionId)) {
        store.restorePane(sessionId);
      }

      const next = useLayoutStore.getState();
      const layout = next.layouts.find((l) => l.i === sessionId);
      if (!layout) return;

      // Use generous padding so the pane doesn't fill the entire viewport
      const padding = 120;
      const zoomX = (width - padding * 2) / layout.w;
      const zoomY = (canvasHeight - padding * 2) / layout.h;
      // Cap zoom at 1.0 so we never zoom in beyond 100% — just center the pane
      const zoom = Math.max(0.1, Math.min(1.0, Math.min(zoomX, zoomY)));
      const centerX = layout.x + layout.w / 2;
      const centerY = layout.y + layout.h / 2;
      const panX = width / (2 * zoom) - centerX;
      const panY = canvasHeight / (2 * zoom) - centerY;

      next.setCanvas({ zoom, panX, panY });

      // Apply immediately for snappy feedback (store sync effect will keep it in sync).
      live.current.zoom = zoom;
      live.current.panX = panX;
      live.current.panY = panY;
      applySurfaceTransform();
      applyBgTransform();
      updateZoomLabel();
    };

    window.addEventListener("codegrid:zoom-to-session", handler);
    return () => window.removeEventListener("codegrid:zoom-to-session", handler);
  }, [width, canvasHeight]);

  // ── Global mousemove / mouseup (native, on window for capture outside viewport) ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const L = live.current;
      if (L.mode === "idle") return;

      if (L.mode === "pan") {
        const dx = (e.clientX - L.startX) / L.zoom;
        const dy = (e.clientY - L.startY) / L.zoom;
        L.panX = L.origPanX + dx;
        L.panY = L.origPanY + dy;
        applySurfaceTransform();
        applyBgTransform();
        // Track velocity samples for momentum
        const now = performance.now();
        const samples = L.velocitySamples;
        samples.push({ x: e.clientX, y: e.clientY, t: now });
        if (samples.length > 5) samples.shift();
        return;
      }

      if (L.mode === "drag" && L.dragEl) {
        const dx = (e.clientX - L.startX) / L.zoom;
        const dy = (e.clientY - L.startY) / L.zoom;
        const nx = snap(L.dragOrigX + dx);
        const ny = snap(L.dragOrigY + dy);
        const existingPreview = L.panePreview[L.dragId];
        const fallbackLayout = useLayoutStore.getState().layouts.find((l) => l.i === L.dragId);
        L.panePreview[L.dragId] = {
          x: nx,
          y: ny,
          w: existingPreview?.w ?? fallbackLayout?.w ?? 600,
          h: existingPreview?.h ?? fallbackLayout?.h ?? 400,
        };
        L.dragEl.style.left = `${nx}px`;
        L.dragEl.style.top = `${ny}px`;
        return;
      }

      if (L.mode === "resize" && L.resizeEl) {
        const dx = (e.clientX - L.startX) / L.zoom;
        const dy = (e.clientY - L.startY) / L.zoom;
        let { resizeOrigX: x, resizeOrigY: y, resizeOrigW: w, resizeOrigH: h } = L;
        const handle = L.resizeHandle;
        // Snap the moving edge to the grid; the opposite edge stays fixed.
        if (handle.includes("e")) w = Math.max(200, snap(w + dx));
        if (handle.includes("s")) h = Math.max(150, snap(h + dy));
        if (handle.includes("w")) { const right = x + w; x = Math.min(snap(x + dx), right - 200); w = right - x; }
        if (handle.includes("n")) { const bottom = y + h; y = Math.min(snap(y + dy), bottom - 150); h = bottom - y; }
        L.panePreview[L.resizeId] = { x, y, w, h };
        L.resizeEl.style.left = `${x}px`;
        L.resizeEl.style.top = `${y}px`;
        L.resizeEl.style.width = `${w}px`;
        L.resizeEl.style.height = `${h}px`;
        return;
      }

      if (L.mode === "note-drag" && L.noteEl) {
        const dx = (e.clientX - L.startX) / L.zoom;
        const dy = (e.clientY - L.startY) / L.zoom;
        const nx = snap(L.noteOrigX + dx);
        const ny = snap(L.noteOrigY + dy);
        L.noteEl.style.left = `${nx}px`;
        L.noteEl.style.top = `${ny}px`;
        return;
      }

      if (L.mode === "note-resize" && L.noteEl) {
        const dx = (e.clientX - L.startX) / L.zoom;
        const dy = (e.clientY - L.startY) / L.zoom;
        const nw = Math.max(120, snap(L.noteOrigW + dx));
        const nh = Math.max(80, snap(L.noteOrigH + dy));
        L.noteEl.style.width = `${nw}px`;
        L.noteEl.style.height = `${nh}px`;
        return;
      }
    };

    const onUp = () => {
      const L = live.current;
      if (L.mode === "pan") {
        // Calculate release velocity from samples
        const samples = L.velocitySamples;
        let vx = 0;
        let vy = 0;
        if (samples.length >= 2) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dt = last.t - first.t;
          if (dt > 0 && dt < 200) {
            vx = (last.x - first.x) / dt / L.zoom;
            vy = (last.y - first.y) / dt / L.zoom;
          }
        }
        L.velocitySamples = [];

        const speed = Math.abs(vx) + Math.abs(vy);
        if (speed > 0.5) {
          // Convert px/ms to px/frame (~16ms)
          startMomentum(vx * 16, vy * 16);
        } else {
          commitCanvasState();
        }
      } else if (L.mode === "drag" && L.dragEl) {
        const preview = L.panePreview[L.dragId];
        // Use current layout w/h (drag doesn't change size)
        const layout = useLayoutStore.getState().layouts.find((l) => l.i === L.dragId);
        if (layout && preview) {
          commitPaneLayout(L.dragId, preview.x, preview.y, layout.w, layout.h);
        }
        delete L.panePreview[L.dragId];
      } else if (L.mode === "resize" && L.resizeEl) {
        const preview = L.panePreview[L.resizeId];
        if (preview) {
          commitPaneLayout(L.resizeId, preview.x, preview.y, preview.w, preview.h);
        }
        delete L.panePreview[L.resizeId];
      }
      if (L.mode === "note-drag" && L.noteEl) {
        const nx = parseFloat(L.noteEl.style.left) || L.noteOrigX;
        const ny = parseFloat(L.noteEl.style.top) || L.noteOrigY;
        useNotesStore.getState().moveNote(L.noteId, nx, ny);
      } else if (L.mode === "note-resize" && L.noteEl) {
        const nw = parseFloat(L.noteEl.style.width) || L.noteOrigW;
        const nh = parseFloat(L.noteEl.style.height) || L.noteOrigH;
        useNotesStore.getState().resizeNote(L.noteId, nw, nh);
      }
      if (L.dragEl) L.dragEl.style.zIndex = "";
      L.mode = "idle";
      L.dragId = "";
      L.resizeId = "";
      L.dragEl = null;
      L.resizeEl = null;
      L.noteId = "";
      L.noteEl = null;
      if (dragOverlayRef.current) dragOverlayRef.current.style.display = "none";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); cancelMomentum(); };
  }, []);

  // ── Canvas mousedown → pan ──
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (maximizedPane) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    cancelMomentum();
    const L = live.current;
    L.mode = "pan";
    L.startX = e.clientX;
    L.startY = e.clientY;
    L.origPanX = L.panX;
    L.origPanY = L.panY;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }, [maximizedPane]);

  // ── Pane drag start ──
  const handlePaneDragStart = useCallback((id: string, e: React.MouseEvent) => {
    const L = live.current;
    if (L.locked || maximizedPane) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = useLayoutStore.getState().layouts.find((l) => l.i === id);
    if (!layout) return;
    // Find the pane wrapper element by data attribute
    const el = document.querySelector(`[data-pane-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    L.mode = "drag";
    L.startX = e.clientX;
    L.startY = e.clientY;
    L.dragId = id;
    L.dragOrigX = layout.x;
    L.dragOrigY = layout.y;
    L.panePreview[id] = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    L.dragEl = el;
    el.style.zIndex = "999";
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = "block";
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
  }, [maximizedPane]);

  // ── Resize start ──
  const handleResizeStart = useCallback((id: string, handle: string, e: React.MouseEvent) => {
    const L = live.current;
    if (L.locked || maximizedPane) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = useLayoutStore.getState().layouts.find((l) => l.i === id);
    if (!layout) return;
    const el = document.querySelector(`[data-pane-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    L.mode = "resize";
    L.startX = e.clientX;
    L.startY = e.clientY;
    L.resizeId = id;
    L.resizeHandle = handle;
    L.resizeOrigX = layout.x;
    L.resizeOrigY = layout.y;
    L.resizeOrigW = layout.w;
    L.resizeOrigH = layout.h;
    L.panePreview[id] = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
    L.resizeEl = el;
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = "block";
    document.body.style.userSelect = "none";
  }, [maximizedPane]);

  // ── Note drag start ──
  const handleNoteDragStart = useCallback((noteId: string, e: React.MouseEvent) => {
    const L = live.current;
    if (L.locked || maximizedPane) return;
    e.preventDefault();
    e.stopPropagation();
    const note = useNotesStore.getState().notes.find((n) => n.id === noteId);
    if (!note) return;
    const el = document.querySelector(`[data-note-id="${noteId}"]`) as HTMLElement | null;
    if (!el) return;
    L.mode = "note-drag";
    L.startX = e.clientX;
    L.startY = e.clientY;
    L.noteId = noteId;
    L.noteOrigX = note.x;
    L.noteOrigY = note.y;
    L.noteEl = el;
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = "block";
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
  }, [maximizedPane]);

  // ── Note resize start (bottom-right only) ──
  const handleNoteResizeStart = useCallback((noteId: string, e: React.MouseEvent) => {
    const L = live.current;
    if (L.locked || maximizedPane) return;
    e.preventDefault();
    e.stopPropagation();
    const note = useNotesStore.getState().notes.find((n) => n.id === noteId);
    if (!note) return;
    const el = document.querySelector(`[data-note-id="${noteId}"]`) as HTMLElement | null;
    if (!el) return;
    L.mode = "note-resize";
    L.startX = e.clientX;
    L.startY = e.clientY;
    L.noteId = noteId;
    L.noteOrigW = note.w;
    L.noteOrigH = note.h;
    L.noteEl = el;
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = "block";
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  }, [maximizedPane]);

  const handleAutoGrid = useCallback(() => {
    const ids = visibleSessions.map((s) => s.id);
    autoLayout(ids, width, canvasHeight);
    // Reset zoom/pan to origin
    setCanvas({ zoom: 1, panX: 0, panY: 0 });
    live.current.zoom = 1;
    live.current.panX = 0;
    live.current.panY = 0;
    applySurfaceTransform();
    applyBgTransform();
    updateZoomLabel();
  }, [visibleSessions, width, canvasHeight, autoLayout, setCanvas]);

  const handleFitAll = useCallback(() => {
    zoomToFit(width, canvasHeight);
    // Sync live ref from store after zoomToFit updates it
    requestAnimationFrame(() => {
      const c = useLayoutStore.getState().canvas;
      live.current.zoom = c.zoom;
      live.current.panX = c.panX;
      live.current.panY = c.panY;
      applySurfaceTransform();
      applyBgTransform();
      updateZoomLabel();
    });
  }, [width, canvasHeight, zoomToFit]);

  // Keep the store's notion of the live viewport in sync so new-pane placement
  // (findBestPosition) uses the real canvas size instead of a hardcoded default.
  useEffect(() => {
    useLayoutStore.getState().setViewport(width, canvasHeight);
  }, [width, canvasHeight]);

  // Fit-all keyboard shortcut / command — Canvas owns the live dims, so it does the fit.
  useEffect(() => {
    const handler = () => handleFitAll();
    window.addEventListener("codegrid:fit-all", handler);
    return () => window.removeEventListener("codegrid:fit-all", handler);
  }, [handleFitAll]);

  const zoomPercent = Math.round(canvas.zoom * 100);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Canvas viewport */}
      <div
        ref={viewportRef}
        data-canvas-viewport
        onMouseDown={handleCanvasMouseDown}
        onContextMenu={handleCanvasContextMenu}
        style={{
          position: "relative",
          width: "100%",
          height: canvasHeight,
          overflow: "hidden",
          cursor: "grab",
        }}
      >
        {/* Transparent overlay during drag/resize — prevents pane internals (xterm, etc.)
            from stealing mouse events when dragging over overlapping panes */}
        <div
          ref={dragOverlayRef}
          style={{
            display: "none",
            position: "absolute",
            inset: 0,
            zIndex: 900,
            cursor: "move",
          }}
        />

        {/* Pan-tool overlay — only present while the Pan toggle is on. Sits above
            panes so a drag anywhere pans the whole canvas instead of clicking into
            a terminal. Uses the same pan machinery as the viewport. */}
        {panMode && !maximizedPane && (
          <div
            ref={panOverlayRef}
            data-pan-overlay
            onMouseDown={(e) => {
              // grab → grabbing for the duration of the drag.
              if (panOverlayRef.current) panOverlayRef.current.style.cursor = "grabbing";
              handleCanvasMouseDown(e);
            }}
            onMouseUp={() => {
              if (panOverlayRef.current) panOverlayRef.current.style.cursor = "grab";
            }}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 950,
              cursor: "grab",
            }}
          >
            <div style={{
              position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
              background: "rgba(20,20,20,0.92)", border: "1px solid var(--accent-border)",
              color: "var(--accent)", fontFamily: MONO, fontSize: 11, letterSpacing: "0.04em",
              padding: "4px 10px", borderRadius: 6, pointerEvents: "none", whiteSpace: "nowrap",
            }}>
              Pan mode — drag to move · Esc to exit
            </div>
          </div>
        )}

        {/* Dot grid background */}
        <div
          ref={bgRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            backgroundImage: "radial-gradient(circle, #222222 1px, transparent 1px)",
            backgroundSize: `${24 * canvas.zoom}px ${24 * canvas.zoom}px`,
            backgroundPosition: `${(canvas.panX * canvas.zoom) % (24 * canvas.zoom)}px ${(canvas.panY * canvas.zoom) % (24 * canvas.zoom)}px`,
            willChange: "background-size, background-position",
          }}
        />

        {/* Canvas surface */}
        <div
          ref={surfaceRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            transform: maximizedPane
              ? "none"
              : `scale(${canvas.zoom}) translate(${canvas.panX}px, ${canvas.panY}px)`,
            willChange: "transform",
            zIndex: 1,
          }}
        >
          {/* Sticky notes — rendered below panes (lower z-index) */}
          {!maximizedPane && workspaceNotes.map((note) => (
            <div
              key={note.id}
              data-note-id={note.id}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: note.x,
                top: note.y,
                width: note.w,
                height: note.h,
                zIndex: 0,
                willChange: "left, top, width, height",
              }}
            >
              <StickyNote
                note={note}
                onDragStart={handleNoteDragStart}
                onResizeStart={handleNoteResizeStart}
              />
            </div>
          ))}

          {/* Render ALL sessions in a single list so React preserves DOM nodes
              (and xterm instances) when sessions move between workspaces.
              Hidden sessions are positioned off-screen with visibility:hidden. */}
          {allSessions.map((session) => {
            const isHidden = session.workspace_id !== activeWorkspaceId;
            const layout = visibleLayoutMap.get(session.id);
            const preview = live.current.panePreview[session.id];

            const isMaximized = !isHidden && maximizedPane === session.id;

            let paneStyle: React.CSSProperties;
            if (isHidden || !layout) {
              // Off-screen but mounted — keeps xterm alive
              paneStyle = {
                position: "absolute",
                left: -9999,
                top: -9999,
                width: 600,
                height: 400,
                visibility: "hidden",
                pointerEvents: "none",
              };
            } else if (isMaximized) {
              paneStyle = { position: "absolute", left: 0, top: 0, width, height: canvasHeight, zIndex: 10 };
            } else {
              paneStyle = {
                position: "absolute",
                left: preview?.x ?? layout.x,
                top: preview?.y ?? layout.y,
                width: preview?.w ?? layout.w,
                height: preview?.h ?? layout.h,
              };
            }

            const isVisible = !isHidden && !!layout;

            return (
              <div
                key={session.id}
                data-pane-id={session.id}
                onMouseDown={isVisible ? (e) => {
                  // When zoomed out, the whole pane is a drag handle so it's
                  // easy to grab. Otherwise just block canvas pan from starting.
                  if (canvas.zoom <= DRAG_ANYWHERE_ZOOM && !canvas.locked && !maximizedPane) {
                    handlePaneDragStart(session.id, e);
                  } else {
                    e.stopPropagation();
                  }
                } : undefined}
                style={{ ...paneStyle, overflow: "hidden", cursor: isVisible && canvas.zoom <= DRAG_ANYWHERE_ZOOM && !canvas.locked && !maximizedPane ? "move" : undefined, willChange: isVisible ? "left, top, width, height" : undefined, contain: isVisible ? "layout style" : undefined }}
              >
                {/* Zoomed-out label overlay */}
                {isVisible && canvas.zoom < ZOOMED_OUT_LABEL_THRESHOLD && !maximizedPane && (
                  <ZoomedOutLabel session={session} zoom={canvas.zoom} />
                )}

                {(() => {
                  const kind = session.kind ?? "terminal";
                  const drag = isVisible
                    ? (e: React.MouseEvent) => handlePaneDragStart(session.id, e)
                    : undefined;
                  if (kind === "browser") {
                    return (
                      <BrowserPane
                        sessionId={session.id}
                        url={session.browserUrl ?? "about:blank"}
                        onClose={onCloseSession}
                        onDragStart={drag}
                      />
                    );
                  }
                  if (kind === "note") {
                    return (
                      <NotePane
                        session={session}
                        onClose={onCloseSession}
                        onDragStart={drag}
                      />
                    );
                  }
                  if (kind === "scratch") {
                    return (
                      <ScratchPane
                        session={session}
                        onClose={onCloseSession}
                        onDragStart={drag}
                      />
                    );
                  }
                  return (
                    <Pane
                      session={session}
                      onClose={onCloseSession}
                      onDragStart={drag}
                    />
                  );
                })()}

                {/* Resize handles */}
                {isVisible && !canvas.locked && !maximizedPane && (
                  <ResizeHandles sessionId={session.id} onResizeStart={handleResizeStart} />
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom-left: trial banner (everything else lives in the bottom bar) */}
        <div
          style={{
            position: "absolute",
            bottom: hasMinimized ? 44 : 8,
            left: 8,
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TrialBanner />
        </div>

        {/* Bottom bar — fleet status · resource recommendation · view controls.
            Pulled out of the canvas itself into one clean dock. */}
        <div
          style={{
            position: "absolute",
            bottom: hasMinimized ? 44 : 8,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 120,
            padding: "4px 8px",
            background: "rgba(13,13,13,0.82)",
            border: "1px solid var(--border-default)",
            borderRadius: 12,
            boxShadow: "0 8px 22px rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            fontFamily: MONO,
            fontSize: 12,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <AttentionBar />
          <ResourceIndicator />
          <span style={{ width: 1, height: 18, background: "var(--border-default)", margin: "0 2px" }} aria-hidden />
          <button
            onClick={() => setPanMode((v) => !v)}
            title={panMode ? "Pan mode ON — drag anywhere to move the canvas (Esc to exit)" : "Pan mode: drag the canvas without touching panes"}
            aria-pressed={panMode}
            style={{
              background: panMode ? "var(--accent-soft)" : "#1a1a1a",
              border: `1px solid ${panMode ? "var(--accent)" : "var(--border-default)"}`,
              color: panMode ? "var(--accent)" : "var(--text-muted)",
              padding: "3px 8px",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
            }}
            onMouseEnter={(e) => { if (!panMode) { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; } }}
            onMouseLeave={(e) => { if (!panMode) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; } }}
          >
            PAN
          </button>
          <button
            onClick={handleFitAll}
            title="Zoom to fit all panes into view"
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              color: "var(--text-muted)",
              padding: "3px 6px",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-accent)"; e.currentTarget.style.borderColor = "var(--text-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
          >
            FIT
          </button>
          <button
            onClick={() => toggleLocked()}
            title={canvas.locked ? "Canvas locked — click to unlock dragging/resizing" : "Lock canvas (prevent moving/resizing panes)"}
            aria-label={canvas.locked ? "Unlock canvas" : "Lock canvas"}
            style={{
              background: canvas.locked ? "rgba(255, 140, 0, 0.2)" : "#1a1a1a",
              border: `1px solid ${canvas.locked ? "var(--text-accent)" : "var(--border-default)"}`,
              color: canvas.locked ? "var(--text-accent)" : "var(--text-muted)",
              padding: "3px 8px",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: 12,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {canvas.locked
              ? <UI_ICON.lock size={13} weight="fill" style={{ flexShrink: 0 }} />
              : <UI_ICON.lockOpen size={13} weight="regular" style={{ flexShrink: 0 }} />}
          </button>
          <span
            ref={zoomLabelRef}
            onClick={() => {
              setCanvas({ zoom: 1, panX: 0, panY: 0 });
              live.current.zoom = 1; live.current.panX = 0; live.current.panY = 0;
              applySurfaceTransform(); applyBgTransform(); updateZoomLabel();
            }}
            title="Click to reset zoom to 100%"
            style={{
              background: "#1a1a1a",
              border: "1px solid var(--border-default)",
              color: "var(--text-muted)",
              padding: "3px 8px",
              fontFamily: MONO,
              fontSize: 12,
              minWidth: "40px",
              textAlign: "center",
              display: "inline-block",
              cursor: "pointer",
            }}
          >
            {zoomPercent}%
          </span>
        </div>
      </div>

      {/* Minimized panes dock */}
      {minimizedSessions.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 110,
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>
            <MinimizedPaneBar sessions={minimizedSessions} onCloseSession={onCloseSession} />
          </div>
        </div>
      )}

      {ctxMenu && createPortal(
        <div
          data-canvas-ctx
          ref={ctxRef}
          style={{
            position: "fixed", top: ctxPos?.top ?? -9999, left: ctxPos?.left ?? -9999,
            visibility: ctxPos ? "visible" : "hidden", width: 320, maxWidth: "92vw",
            background: "var(--bg-secondary)", border: "1px solid var(--border-strong)",
            borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.6)", zIndex: 100000, padding: 6,
            fontFamily: MONO,
          }}
        >
          <div style={{ padding: "4px 10px 6px", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            Add to canvas
          </div>
          {([
            { icon: UI_ICON.newAgent, color: "var(--accent)", label: "New agent session", hint: "pick agent", run: () => setNewSessionDialogOpen(true) },
            { icon: UI_ICON.scratch, color: "var(--agent-shell)", label: "Scratch terminal", hint: "⇧⌘J", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-scratch-pane", { detail: {} })) },
            { icon: UI_ICON.preview, color: "var(--agent-browser)", label: "Preview pane", hint: "localhost", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-browser-pane", { detail: { url: "", focusUrl: true } })) },
            { icon: UI_ICON.note, color: "var(--agent-note)", label: "Note", hint: "markdown", run: () => window.dispatchEvent(new CustomEvent("codegrid:new-note-pane", { detail: {} })) },
          ] as const).map((item) => (
            <button
              key={item.label}
              onClick={() => { setCtxMenu(null); item.run(); }}
              style={{
                display: "flex", alignItems: "center", gap: 11, width: "100%",
                background: "transparent", border: "none", cursor: "pointer",
                padding: "8px 10px", borderRadius: 6, textAlign: "left",
                color: "var(--text-primary)", fontFamily: MONO,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span aria-hidden style={{ color: item.color, width: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <item.icon size={15} weight="regular" />
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
              <span style={{ color: "var(--text-faint)", fontSize: 10, flexShrink: 0 }}>{item.hint}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
});

// ── Extracted pure components to avoid re-renders ──

const RESIZE_HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

const ResizeHandles = memo(function ResizeHandles({
  sessionId,
  onResizeStart,
}: {
  sessionId: string;
  onResizeStart: (id: string, handle: string, e: React.MouseEvent) => void;
}) {
  return (
    <>
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          onMouseDown={(e) => onResizeStart(sessionId, handle, e)}
          style={{
            position: "absolute",
            ...getResizeHandleStyle(handle),
            zIndex: 15,
          }}
        />
      ))}
    </>
  );
});

const STATUS_COLORS: Record<string, string> = {
  idle: "#4a9eff", running: "#00c853", waiting: "#ffab00",
  error: "#ff3d00", dead: "#555555",
};

const ZoomedOutLabel = memo(function ZoomedOutLabel({
  session,
  zoom,
}: {
  session: { pane_number: number; manualName?: string | null; activityName?: string | null; working_dir: string; status?: string | null };
  zoom: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10, 10, 10, 0.85)",
        zIndex: 20,
        pointerEvents: "none",
        flexDirection: "column",
        gap: `${4 / zoom}px`,
      }}
    >
      <span style={{
        fontSize: `${Math.min(48, 16 / zoom)}px`,
        fontWeight: "bold",
        color: "#ff8c00",
        fontFamily: MONO,
      }}>
        {session.pane_number}
      </span>
      <span style={{
        fontSize: `${Math.min(24, 10 / zoom)}px`,
        color: "var(--text-secondary)",
        fontFamily: MONO,
        textAlign: "center",
        maxWidth: "90%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {session.manualName ?? session.activityName ?? session.working_dir.split("/").pop()}
      </span>
      <div style={{
        width: `${Math.min(16, 6 / zoom)}px`,
        height: `${Math.min(16, 6 / zoom)}px`,
        borderRadius: "50%",
        background: STATUS_COLORS[session.status ?? "idle"] ?? "#4a9eff",
      }} />
    </div>
  );
});

function getResizeHandleStyle(handle: string): React.CSSProperties {
  const size = 6;
  const edge = 2;

  switch (handle) {
    case "n": return { top: 0, left: size, right: size, height: edge, cursor: "ns-resize" };
    case "s": return { bottom: 0, left: size, right: size, height: edge, cursor: "ns-resize" };
    case "e": return { right: 0, top: size, bottom: size, width: edge, cursor: "ew-resize" };
    case "w": return { left: 0, top: size, bottom: size, width: edge, cursor: "ew-resize" };
    case "ne": return { top: 0, right: 0, width: size, height: size, cursor: "nesw-resize" };
    case "nw": return { top: 0, left: 0, width: size, height: size, cursor: "nwse-resize" };
    case "se": return { bottom: 0, right: 0, width: size, height: size, cursor: "nwse-resize" };
    case "sw": return { bottom: 0, left: 0, width: size, height: size, cursor: "nesw-resize" };
    default: return {};
  }
}
