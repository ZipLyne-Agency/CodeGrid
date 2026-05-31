import { create } from "zustand";

export interface CanvasLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PresetLayout = "auto" | "focus" | "columns" | "rows" | "grid";

const MIN_W = 200;
const MIN_H = 150;
const DEFAULT_W = 600;
const DEFAULT_H = 400;
const CASCADE_OFFSET = 30;
const PANE_GAP = 8;

/**
 * Find the best non-overlapping position for a new pane of size (w, h).
 * Strategy:
 *  1. Right of the rightmost pane
 *  2. Below the bottommost pane
 *  3. Scan for gaps in the occupied area
 *  4. Fallback: right of all panes (extends canvas)
 */
function findBestPosition(
  existing: CanvasLayout[],
  w: number,
  h: number,
  viewportW = 1200,
  viewportH = 800,
  panX = 0,
  panY = 0,
  zoom = 1,
): { x: number; y: number } {
  if (existing.length === 0) return { x: 0, y: 0 };

  // Visible viewport bounds in canvas coordinates
  const vpLeft = -panX;
  const vpTop = -panY;
  const vpRight = vpLeft + viewportW / zoom;
  const vpBottom = vpTop + viewportH / zoom;

  const rectsOverlap = (
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
  ) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  const fitsWithoutOverlap = (cx: number, cy: number) =>
    existing.every(
      (l) => !rectsOverlap(cx, cy, w, h, l.x, l.y, l.w, l.h),
    );

  // Bounding box of all existing panes
  const rightEdge = Math.max(...existing.map((l) => l.x + l.w));
  const bottomEdge = Math.max(...existing.map((l) => l.y + l.h));
  const leftEdge = Math.min(...existing.map((l) => l.x));
  const topEdge = Math.min(...existing.map((l) => l.y));

  // 1. Right of the rightmost pane, aligned to top of viewport
  {
    const cx = rightEdge + PANE_GAP;
    const cy = Math.max(topEdge, vpTop);
    if (fitsWithoutOverlap(cx, cy) && cx + w <= vpRight) {
      return { x: cx, y: cy };
    }
  }

  // 2. Below the bottommost pane, aligned to left of viewport
  {
    const cx = Math.max(leftEdge, vpLeft);
    const cy = bottomEdge + PANE_GAP;
    if (fitsWithoutOverlap(cx, cy) && cy + h <= vpBottom) {
      return { x: cx, y: cy };
    }
  }

  // 3. Scan anchor points (right and bottom edges of each existing pane) for gaps
  const candidatesX: number[] = [vpLeft, leftEdge];
  const candidatesY: number[] = [vpTop, topEdge];
  for (const l of existing) {
    candidatesX.push(l.x + l.w + PANE_GAP);
    candidatesY.push(l.y + l.h + PANE_GAP);
    candidatesX.push(l.x);
    candidatesY.push(l.y);
  }

  // Sort candidates to prefer positions closer to top-left of viewport
  candidatesX.sort((a, b) => a - b);
  candidatesY.sort((a, b) => a - b);

  for (const cy of candidatesY) {
    for (const cx of candidatesX) {
      if (
        fitsWithoutOverlap(cx, cy) &&
        cx >= vpLeft &&
        cy >= vpTop &&
        cx + w <= vpRight &&
        cy + h <= vpBottom
      ) {
        return { x: cx, y: cy };
      }
    }
  }

  // 4. Fallback: place right of everything (extends canvas)
  return { x: rightEdge + PANE_GAP, y: Math.max(topEdge, vpTop) };
}

/** Saved layout info for a minimized pane so we can restore it later */
export interface MinimizedPaneInfo {
  layout: CanvasLayout;
}

interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  locked: boolean;
}

/** The full per-workspace canvas view, round-tripped through `layout_json`. */
export interface WorkspaceView {
  layouts: CanvasLayout[];
  canvas: CanvasState;
  minimizedPanes: Record<string, MinimizedPaneInfo>;
  maximizedPane: string | null;
}

interface LayoutState {
  layouts: CanvasLayout[];
  canvas: CanvasState;
  maximizedPane: string | null;
  savedLayouts: CanvasLayout[];
  minimizedPanes: Record<string, MinimizedPaneInfo>;
  /** Live canvas pixel size, kept in sync by Canvas so placement matches reality. */
  viewport: { w: number; h: number };

  setLayouts: (layouts: CanvasLayout[]) => void;
  setViewport: (w: number, h: number) => void;
  /** Atomically swap the entire canvas view for a workspace (used on switch/restore). */
  applyWorkspaceView: (view: WorkspaceView) => void;
  /** Rename one layout slot id in place, preserving minimized/maximized state. */
  renameLayoutId: (oldId: string, newId: string) => void;
  /**
   * Add a layout slot for a session. When `opts.nearSessionId` is set, anchor
   * the new pane immediately right/below that reference (used so new browser
   * and note panes land next to the terminal the user was working in).
   */
  addPaneLayout: (sessionId: string, opts?: { nearSessionId?: string }) => void;
  removePaneLayout: (sessionId: string) => void;
  applyPreset: (preset: PresetLayout, sessionIds: string[], viewportW?: number, viewportH?: number) => void;
  toggleMaximize: (sessionId: string) => void;
  swapPanes: (id1: string, id2: string) => void;
  minimizePane: (sessionId: string) => void;
  restorePane: (sessionId: string) => void;
  isMinimized: (sessionId: string) => boolean;
  autoLayout: (sessionIds: string[], viewportW?: number, viewportH?: number) => void;

  // Canvas actions
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  toggleLocked: () => void;
  setCanvas: (canvas: Partial<CanvasState>) => void;
  zoomToFit: (viewportW: number, viewportH: number) => void;
  updatePaneLayout: (id: string, update: Partial<CanvasLayout>) => void;
}

function enforceMinSize(l: CanvasLayout): CanvasLayout {
  return {
    ...l,
    w: Math.max(l.w, MIN_W),
    h: Math.max(l.h, MIN_H),
  };
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Detect old 12x12 grid format: all x/y/w/h values are in 0-12 range */
function isOldGridFormat(layouts: unknown[]): boolean {
  if (layouts.length === 0) return false;
  return layouts.every((item) => {
    if (!item || typeof item !== "object") return false;
    const obj = item as Record<string, unknown>;
    const x = typeof obj.x === "number" ? obj.x : -1;
    const y = typeof obj.y === "number" ? obj.y : -1;
    const w = typeof obj.w === "number" ? obj.w : -1;
    const h = typeof obj.h === "number" ? obj.h : -1;
    return x >= 0 && x <= 12 && y >= 0 && y <= 12 && w >= 0 && w <= 12 && h >= 0 && h <= 12;
  });
}

/** Migrate old 12-col grid layout to pixel coords */
function migrateFromGrid(raw: Record<string, unknown>[], viewportW: number, viewportH: number): CanvasLayout[] {
  const colW = viewportW / 12;
  const rowH = viewportH / 12;
  return raw.map((obj) => enforceMinSize({
    i: String(obj.i),
    x: toFiniteNumber(obj.x, 0) * colW,
    y: toFiniteNumber(obj.y, 0) * rowH,
    w: toFiniteNumber(obj.w, 4) * colW,
    h: toFiniteNumber(obj.h, 4) * rowH,
  }));
}

export function sanitizeLayouts(raw: unknown, viewportW = 1200, viewportH = 800): CanvasLayout[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasLayout[] = [];

  // Check if this is old grid format and needs migration
  if (isOldGridFormat(raw)) {
    return migrateFromGrid(raw as Record<string, unknown>[], viewportW, viewportH);
  }

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.i !== "string" || obj.i.length === 0) continue;
    const layout: CanvasLayout = enforceMinSize({
      i: obj.i,
      x: toFiniteNumber(obj.x, 0),
      y: toFiniteNumber(obj.y, 0),
      w: toFiniteNumber(obj.w, DEFAULT_W),
      h: toFiniteNumber(obj.h, DEFAULT_H),
    });
    out.push(layout);
  }
  return out;
}

function sanitizeMinimizedPanes(raw: unknown): Record<string, MinimizedPaneInfo> {
  const out: Record<string, MinimizedPaneInfo> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object") continue;
    const layoutRaw = (value as Record<string, unknown>).layout;
    const parsed = sanitizeLayouts([layoutRaw]);
    if (parsed.length > 0) out[key] = { layout: parsed[0] };
  }
  return out;
}

/**
 * Parse a workspace's persisted `layout_json` into a full canvas view. Tolerant
 * of three formats: a bare layouts array (oldest), `{ layouts, canvas }`, and the
 * current `{ layouts, canvas, minimizedPanes, maximizedPane }`.
 */
export function sanitizeWorkspaceView(raw: unknown): WorkspaceView {
  const view: WorkspaceView = {
    layouts: [],
    canvas: sanitizeCanvasState(null),
    minimizedPanes: {},
    maximizedPane: null,
  };
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return view; }
  }
  if (Array.isArray(parsed)) {
    view.layouts = sanitizeLayouts(parsed);
    return view;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    view.layouts = sanitizeLayouts(Array.isArray(obj.layouts) ? obj.layouts : parsed);
    view.canvas = obj.canvas ? sanitizeCanvasState(obj.canvas) : sanitizeCanvasState(null);
    view.minimizedPanes = sanitizeMinimizedPanes(obj.minimizedPanes);
    const max = obj.maximizedPane;
    view.maximizedPane =
      typeof max === "string" && view.layouts.some((l) => l.i === max) ? max : null;
  }
  return view;
}

export function sanitizeCanvasState(raw: unknown): CanvasState {
  const defaults: CanvasState = { zoom: 1, panX: 0, panY: 0, locked: false };
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, unknown>;
  return {
    // Max matches the wheel-zoom ceiling (3.0) so a zoomed-in canvas survives a
    // reload / workspace switch instead of snapping back to 200%.
    zoom: Math.max(0.1, Math.min(3.0, toFiniteNumber(obj.zoom, 1))),
    panX: toFiniteNumber(obj.panX, 0),
    panY: toFiniteNumber(obj.panY, 0),
    locked: typeof obj.locked === "boolean" ? obj.locked : false,
  };
}

/**
 * Compute optimal grid dimensions for N items to fill a viewport.
 * Picks cols/rows that minimize wasted space while keeping aspect ratios reasonable.
 */
function optimalGrid(n: number, viewportW: number, viewportH: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  let bestCols = 1;
  let bestScore = Infinity;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const cellAspect = (viewportW / c) / (viewportH / r);
    // Prefer cell aspect ratios close to 16:9 (terminal-friendly)
    const aspectScore = Math.abs(Math.log(cellAspect / (16 / 9)));
    // Penalize wasted cells
    const wasteScore = (c * r - n) / n;
    const score = aspectScore + wasteScore * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestCols = c;
    }
  }
  return { cols: bestCols, rows: Math.ceil(n / bestCols) };
}

function computeAutoLayout(sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  const n = sessionIds.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ i: sessionIds[0], x: 0, y: 0, w: viewportW, h: viewportH }];
  }

  const gap = 4;
  const { cols, rows } = optimalGrid(n, viewportW, viewportH);
  const cellW = (viewportW - gap * (cols - 1)) / cols;
  const cellH = (viewportH - gap * (rows - 1)) / rows;

  return sessionIds.map((id, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    // Last row may have fewer items -- center or stretch them
    const isLastRow = row === rows - 1;
    const itemsInLastRow = n - (rows - 1) * cols;
    let x: number, w: number;
    if (isLastRow && itemsInLastRow < cols) {
      // Stretch last row items to fill the full width evenly
      const lastW = (viewportW - gap * (itemsInLastRow - 1)) / itemsInLastRow;
      const lastCol = idx - (rows - 1) * cols;
      x = lastCol * (lastW + gap);
      w = lastW;
    } else {
      x = col * (cellW + gap);
      w = cellW;
    }
    return enforceMinSize({
      i: id,
      x,
      y: row * (cellH + gap),
      w,
      h: cellH,
    });
  });
}

function computeFocusLayout(sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  const n = sessionIds.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ i: sessionIds[0], x: 0, y: 0, w: viewportW, h: viewportH }];
  }

  const gap = 4;
  const mainW = Math.floor(viewportW * 2 / 3 - gap / 2);
  const sideW = viewportW - mainW - gap;
  const sideCount = n - 1;
  const sideH = (viewportH - gap * (sideCount - 1)) / sideCount;

  return sessionIds.map((id, idx) => {
    if (idx === 0) {
      return enforceMinSize({ i: id, x: 0, y: 0, w: mainW, h: viewportH });
    }
    const sideIdx = idx - 1;
    return enforceMinSize({
      i: id,
      x: mainW + gap,
      y: sideIdx * (sideH + gap),
      w: sideW,
      h: sideH,
    });
  });
}

function computeColumnsLayout(sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  const n = sessionIds.length;
  if (n === 0) return [];
  const gap = 4;
  const colW = (viewportW - gap * (n - 1)) / n;

  return sessionIds.map((id, idx) =>
    enforceMinSize({
      i: id,
      x: idx * (colW + gap),
      y: 0,
      w: colW,
      h: viewportH,
    })
  );
}

function computeRowsLayout(sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  const n = sessionIds.length;
  if (n === 0) return [];
  const gap = 4;
  const rowH = (viewportH - gap * (n - 1)) / n;

  return sessionIds.map((id, idx) =>
    enforceMinSize({
      i: id,
      x: 0,
      y: idx * (rowH + gap),
      w: viewportW,
      h: rowH,
    })
  );
}

function computeGridLayout(sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  const n = sessionIds.length;
  if (n === 0) return [];
  const gap = 4;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = (viewportW - gap * (cols - 1)) / cols;
  const cellH = (viewportH - gap * (rows - 1)) / rows;

  return sessionIds.map((id, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return enforceMinSize({
      i: id,
      x: col * (cellW + gap),
      y: row * (cellH + gap),
      w: cellW,
      h: cellH,
    });
  });
}

function generatePresetLayout(preset: PresetLayout, sessionIds: string[], viewportW = 1200, viewportH = 800): CanvasLayout[] {
  switch (preset) {
    case "auto":
      return computeAutoLayout(sessionIds, viewportW, viewportH);
    case "focus":
      return computeFocusLayout(sessionIds, viewportW, viewportH);
    case "columns":
      return computeColumnsLayout(sessionIds, viewportW, viewportH);
    case "rows":
      return computeRowsLayout(sessionIds, viewportW, viewportH);
    case "grid":
      return computeGridLayout(sessionIds, viewportW, viewportH);
    default:
      return computeAutoLayout(sessionIds, viewportW, viewportH);
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layouts: [],
  canvas: { zoom: 1, panX: 0, panY: 0, locked: false },
  maximizedPane: null,
  savedLayouts: [],
  minimizedPanes: {},
  viewport: { w: 1200, h: 800 },

  setLayouts: (layouts) =>
    set({
      layouts: layouts.map(enforceMinSize),
      // setLayouts is used for workspace restore/switch; clear transient view state to prevent stale hidden panes.
      maximizedPane: null,
      savedLayouts: [],
      minimizedPanes: {},
    }),

  setViewport: (w, h) =>
    set((state) =>
      state.viewport.w === w && state.viewport.h === h
        ? state
        : { viewport: { w, h } },
    ),

  // Atomically install a workspace's saved view. Unlike setLayouts this keeps
  // minimized/maximized state (round-tripped via layout_json) instead of wiping it.
  applyWorkspaceView: (view) =>
    set({
      layouts: view.layouts.map(enforceMinSize),
      canvas: view.canvas,
      minimizedPanes: view.minimizedPanes,
      maximizedPane: view.maximizedPane,
      savedLayouts: [],
    }),

  // Used when a session id changes (restart/restore) — swaps the id everywhere
  // it can live without disturbing other panes' minimized/maximized state.
  renameLayoutId: (oldId, newId) =>
    set((state) => {
      const minimizedPanes = { ...state.minimizedPanes };
      if (minimizedPanes[oldId]) {
        minimizedPanes[newId] = { layout: { ...minimizedPanes[oldId].layout, i: newId } };
        delete minimizedPanes[oldId];
      }
      return {
        layouts: state.layouts.map((l) => (l.i === oldId ? { ...l, i: newId } : l)),
        minimizedPanes,
        maximizedPane: state.maximizedPane === oldId ? newId : state.maximizedPane,
      };
    }),

  addPaneLayout: (sessionId, opts) =>
    set((state) => {
      // Idempotent: never create a second layout for a session that already has
      // one (protects against double-adds, the reconciler, and restore races).
      if (state.layouts.some((l) => l.i === sessionId)) return state;
      const visible = state.layouts.filter((l) => !state.minimizedPanes[l.i]);

      const rectsOverlap = (
        ax: number, ay: number, aw: number, ah: number,
        bx: number, by: number, bw: number, bh: number,
      ) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
      const collides = (cx: number, cy: number) =>
        visible.some((l) => rectsOverlap(cx, cy, DEFAULT_W, DEFAULT_H, l.x, l.y, l.w, l.h));

      let x: number;
      let y: number;

      // Try to land next to a specific reference pane first. Used when the
      // user opens a browser/note/etc. while a terminal is focused.
      const near = opts?.nearSessionId
        ? visible.find((l) => l.i === opts.nearSessionId)
        : undefined;

      const { w: vpW, h: vpH } = state.viewport;
      if (near) {
        const rightX = near.x + near.w + PANE_GAP;
        const rightY = near.y;
        const belowX = near.x;
        const belowY = near.y + near.h + PANE_GAP;
        if (!collides(rightX, rightY)) {
          x = rightX; y = rightY;
        } else if (!collides(belowX, belowY)) {
          x = belowX; y = belowY;
        } else {
          // Both adjacent slots taken — fall through to the global search.
          const fb = findBestPosition(
            visible, DEFAULT_W, DEFAULT_H,
            vpW, vpH,
            state.canvas.panX, state.canvas.panY, state.canvas.zoom,
          );
          x = fb.x; y = fb.y;
        }
      } else {
        const fb = findBestPosition(
          visible, DEFAULT_W, DEFAULT_H,
          vpW, vpH,
          state.canvas.panX, state.canvas.panY, state.canvas.zoom,
        );
        x = fb.x; y = fb.y;
      }

      const newLayout = enforceMinSize({ i: sessionId, x, y, w: DEFAULT_W, h: DEFAULT_H });
      const nextLayouts = [...state.layouts, newLayout];
      if (state.maximizedPane) {
        // New panes should always appear immediately instead of being hidden behind maximize mode.
        return {
          layouts: nextLayouts,
          maximizedPane: null,
          savedLayouts: [],
        };
      }
      return { layouts: nextLayouts };
    }),

  removePaneLayout: (sessionId) =>
    set((state) => {
      const newMinimized = { ...state.minimizedPanes };
      delete newMinimized[sessionId];
      return {
        layouts: state.layouts.filter((l) => l.i !== sessionId),
        maximizedPane: state.maximizedPane === sessionId ? null : state.maximizedPane,
        minimizedPanes: newMinimized,
      };
    }),

  applyPreset: (preset, sessionIds, viewportW = 1200, viewportH = 800) => {
    // All presets now handle ALL sessions -- none are hidden or overflowed
    const layouts = generatePresetLayout(preset, sessionIds, viewportW, viewportH);
    set({
      layouts,
      maximizedPane: null,
    });
  },

  toggleMaximize: (sessionId) =>
    set((state) => {
      if (state.maximizedPane === sessionId) {
        return {
          maximizedPane: null,
          layouts: state.savedLayouts.length > 0 ? state.savedLayouts : state.layouts,
          savedLayouts: [],
        };
      }
      return {
        maximizedPane: sessionId,
        savedLayouts: state.layouts,
      };
    }),

  swapPanes: (id1, id2) =>
    set((state) => {
      const l1 = state.layouts.find((l) => l.i === id1);
      const l2 = state.layouts.find((l) => l.i === id2);
      if (!l1 || !l2) return state;
      return {
        layouts: state.layouts.map((l) => {
          if (l.i === id1) return { ...l, x: l2.x, y: l2.y, w: l2.w, h: l2.h };
          if (l.i === id2) return { ...l, x: l1.x, y: l1.y, w: l1.w, h: l1.h };
          return l;
        }),
      };
    }),

  minimizePane: (sessionId) =>
    set((state) => {
      const existing = state.layouts.find((l) => l.i === sessionId);
      if (!existing || state.minimizedPanes[sessionId]) return state;
      return {
        minimizedPanes: {
          ...state.minimizedPanes,
          [sessionId]: { layout: { ...existing } },
        },
        layouts: state.layouts.filter((l) => l.i !== sessionId),
        maximizedPane: state.maximizedPane === sessionId ? null : state.maximizedPane,
      };
    }),

  restorePane: (sessionId) =>
    set((state) => {
      const info = state.minimizedPanes[sessionId];
      if (!info) return state;
      const newMinimized = { ...state.minimizedPanes };
      delete newMinimized[sessionId];
      return {
        minimizedPanes: newMinimized,
        layouts: [...state.layouts, enforceMinSize(info.layout)],
      };
    }),

  isMinimized: (sessionId) => !!get().minimizedPanes[sessionId],

  autoLayout: (sessionIds, viewportW = 1200, viewportH = 800) =>
    set((state) => {
      const visibleIds = sessionIds.filter((id) => !state.minimizedPanes[id]);
      return {
        layouts: computeAutoLayout(visibleIds, viewportW, viewportH),
        maximizedPane: null,
      };
    }),

  // Canvas actions
  setZoom: (zoom) => set((state) => ({
    canvas: { ...state.canvas, zoom: Math.max(0.1, Math.min(3.0, zoom)) },
  })),

  setPan: (panX, panY) => set((state) => ({
    canvas: { ...state.canvas, panX, panY },
  })),

  toggleLocked: () => set((state) => ({
    canvas: { ...state.canvas, locked: !state.canvas.locked },
  })),

  setCanvas: (partial) => set((state) => ({
    canvas: { ...state.canvas, ...partial },
  })),

  zoomToFit: (viewportW, viewportH) =>
    set((state) => {
      const visible = state.layouts.filter((l) => !state.minimizedPanes[l.i]);
      if (visible.length === 0) return state;

      const minX = Math.min(...visible.map((l) => l.x));
      const minY = Math.min(...visible.map((l) => l.y));
      const maxX = Math.max(...visible.map((l) => l.x + l.w));
      const maxY = Math.max(...visible.map((l) => l.y + l.h));

      const contentW = maxX - minX;
      const contentH = maxY - minY;
      if (contentW === 0 || contentH === 0) return state;

      const padding = 40;
      const zoom = Math.max(0.1, Math.min(2.0,
        Math.min((viewportW - padding * 2) / contentW, (viewportH - padding * 2) / contentH)
      ));

      const panX = (viewportW / zoom - contentW) / 2 - minX;
      const panY = (viewportH / zoom - contentH) / 2 - minY;

      return { canvas: { ...state.canvas, zoom, panX, panY } };
    }),

  updatePaneLayout: (id, update) =>
    set((state) => ({
      layouts: state.layouts.map((l) =>
        l.i === id ? enforceMinSize({ ...l, ...update }) : l
      ),
    })),
}));
