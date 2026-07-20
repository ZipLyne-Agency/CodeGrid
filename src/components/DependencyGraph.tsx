import { useEffect, useRef, useState, useCallback } from "react";
import { analyzeDependencies, type DepGraph, type DepNode, type DepEdge } from "../lib/ipc";
import { useAppStore } from "../stores/appStore";

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#61dafb",
  js: "#f7df1e",
  jsx: "#f7df1e",
  py: "#3572a5",
  rs: "#dea584",
};

interface SimNode {
  path: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
}

function getExtColor(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return EXT_COLORS[ext] ?? "#888888";
}

function GraphCanvas({ graph }: { graph: DepGraph }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<DepEdge[]>(graph.edges);
  const animRef = useRef<number>(0);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef<{ dragging: boolean; nodeIdx: number; lastMouse: { x: number; y: number }; isPan: boolean }>({
    dragging: false, nodeIdx: -1, lastMouse: { x: 0, y: 0 }, isPan: false,
  });
  const selectedRef = useRef<number>(-1);
  const hoverRef = useRef<number>(-1);
  const convergedRef = useRef(false);
  const pathToIdxRef = useRef(new Map<string, number>());
  const connectedCacheRef = useRef<{ sel: number; set: Set<number> }>({ sel: -2, set: new Set() });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Initialize nodes
  useEffect(() => {
    const w = canvasRef.current?.width ?? 800;
    const h = canvasRef.current?.height ?? 600;
    nodesRef.current = graph.nodes.map((n, i) => ({
      ...n,
      x: w / 2 + (Math.random() - 0.5) * Math.min(w, 600),
      y: h / 2 + (Math.random() - 0.5) * Math.min(h, 400),
      vx: 0,
      vy: 0,
      color: getExtColor(n.name),
    }));
    edgesRef.current = graph.edges;
    selectedRef.current = -1;
    convergedRef.current = false;
    connectedCacheRef.current = { sel: -2, set: new Set() };
    // Rebuild pathToIdx map
    const m = new Map<string, number>();
    nodesRef.current.forEach((n, i) => m.set(n.path, i));
    pathToIdxRef.current = m;
  }, [graph]);

  // Build adjacency lookup (cached)
  const getConnected = useCallback((idx: number) => {
    if (connectedCacheRef.current.sel === idx) return connectedCacheRef.current.set;
    const path = nodesRef.current[idx]?.path;
    if (!path) return new Set<number>();
    const connected = new Set<number>();
    const pathToIdx = pathToIdxRef.current;
    for (const e of edgesRef.current) {
      if (e.from === path) { const t = pathToIdx.get(e.to); if (t !== undefined) connected.add(t); }
      if (e.to === path) { const t = pathToIdx.get(e.from); if (t !== undefined) connected.add(t); }
    }
    connectedCacheRef.current = { sel: idx, set: connected };
    return connected;
  }, []);

  // Animation loop with force simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const pathToIdx = pathToIdxRef.current;

      if (!convergedRef.current) {
        // Force simulation step
        const REPULSION = 3000;
        const SPRING = 0.005;
        const SPRING_LEN = 120;
        const CENTER = 0.01;
        const DAMPING = 0.85;

        // Repulsion (Coulomb)
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let dist = Math.sqrt(dx * dx + dy * dy) || 1;
            let force = REPULSION / (dist * dist);
            let fx = (dx / dist) * force;
            let fy = (dy / dist) * force;
            nodes[i].vx += fx;
            nodes[i].vy += fy;
            nodes[j].vx -= fx;
            nodes[j].vy -= fy;
          }
        }

        // Spring (edges)
        for (const e of edges) {
          const i = pathToIdx.get(e.from);
          const j = pathToIdx.get(e.to);
          if (i === undefined || j === undefined) continue;
          let dx = nodes[j].x - nodes[i].x;
          let dy = nodes[j].y - nodes[i].y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          let force = SPRING * (dist - SPRING_LEN);
          let fx = (dx / dist) * force;
          let fy = (dy / dist) * force;
          nodes[i].vx += fx;
          nodes[i].vy += fy;
          nodes[j].vx -= fx;
          nodes[j].vy -= fy;
        }

        // Centering
        const cx = w / 2, cy = h / 2;
        for (const n of nodes) {
          n.vx += (cx - n.x) * CENTER;
          n.vy += (cy - n.y) * CENTER;
        }

        // Integrate
        let totalKE = 0;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (dragRef.current.dragging && i === dragRef.current.nodeIdx) continue;
          n.vx *= DAMPING;
          n.vy *= DAMPING;
          n.x += n.vx;
          n.y += n.vy;
          totalKE += n.vx * n.vx + n.vy * n.vy;
        }

        // Convergence check
        if (totalKE < 0.01 && !dragRef.current.dragging) {
          convergedRef.current = true;
        }
      }

      // Draw
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      const sel = selectedRef.current;
      const connected = sel >= 0 ? getConnected(sel) : new Set<number>();

      // Edges
      for (const e of edges) {
        const i = pathToIdx.get(e.from);
        const j = pathToIdx.get(e.to);
        if (i === undefined || j === undefined) continue;

        const highlight = sel >= 0 && (i === sel || j === sel);
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.strokeStyle = highlight ? "#ff8c00" : sel >= 0 ? "rgba(60,60,60,0.3)" : "rgba(100,100,100,0.4)";
        ctx.lineWidth = highlight ? 2 : 0.8;
        ctx.stroke();
      }

      // Nodes
      const NODE_R = 6;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const isSelected = i === sel;
        const isConnected = connected.has(i);
        const isHovered = i === hoverRef.current;
        const dimmed = sel >= 0 && !isSelected && !isConnected;

        ctx.beginPath();
        ctx.arc(n.x, n.y, isSelected ? NODE_R + 2 : isHovered ? NODE_R + 1 : NODE_R, 0, Math.PI * 2);
        ctx.fillStyle = dimmed ? "rgba(60,60,60,0.5)" : n.color;
        ctx.fill();
        if (isSelected || isHovered) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label
        if (!dimmed || isHovered) {
          ctx.font = "10px 'JetBrains Mono', monospace";
          ctx.fillStyle = dimmed ? "rgba(100,100,100,0.5)" : "#cccccc";
          ctx.textAlign = "center";
          ctx.fillText(n.name, n.x, n.y + NODE_R + 14);
        }
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [graph, getConnected]);

  // Hit test helper
  const hitTest = useCallback((mx: number, my: number): number => {
    const nodes = nodesRef.current;
    const z = zoomRef.current;
    const px = panRef.current.x;
    const py = panRef.current.y;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const sx = nodes[i].x * z + px;
      const sy = nodes[i].y * z + py;
      const dist = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
      if (dist < 10) return i;
    }
    return -1;
  }, []);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = hitTest(mx, my);
    convergedRef.current = false;
    if (idx >= 0) {
      dragRef.current = { dragging: true, nodeIdx: idx, lastMouse: { x: mx, y: my }, isPan: false };
      selectedRef.current = idx;
    } else {
      dragRef.current = { dragging: true, nodeIdx: -1, lastMouse: { x: mx, y: my }, isPan: true };
      selectedRef.current = -1;
    }
  }, [hitTest]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const d = dragRef.current;

    if (d.dragging && d.isPan) {
      panRef.current.x += mx - d.lastMouse.x;
      panRef.current.y += my - d.lastMouse.y;
      d.lastMouse = { x: mx, y: my };
    } else if (d.dragging && d.nodeIdx >= 0) {
      const z = zoomRef.current;
      const n = nodesRef.current[d.nodeIdx];
      n.x += (mx - d.lastMouse.x) / z;
      n.y += (my - d.lastMouse.y) / z;
      n.vx = 0;
      n.vy = 0;
      d.lastMouse = { x: mx, y: my };
    } else {
      const idx = hitTest(mx, my);
      hoverRef.current = idx;
      if (idx >= 0) {
        setTooltip({ x: e.clientX, y: e.clientY, text: nodesRef.current[idx].path });
      } else {
        setTooltip(null);
      }
    }
  }, [hitTest]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    convergedRef.current = false;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZoom = zoomRef.current;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * delta));
    // Zoom toward mouse
    panRef.current.x = mx - (mx - panRef.current.x) * (newZoom / oldZoom);
    panRef.current.y = my - (my - panRef.current.y) * (newZoom / oldZoom);
    zoomRef.current = newZoom;
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        width={1200}
        height={700}
        style={{ width: "100%", height: "100%", cursor: dragRef.current.dragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            background: "#1e1e1e",
            border: "1px solid #444",
            color: "#e0e0e0",
            padding: "4px 8px",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            pointerEvents: "none",
            zIndex: 10000,
            whiteSpace: "nowrap",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export function DependencyGraph() {
  const { dependencyGraphOpen, dependencyGraphDir, setDependencyGraphOpen } = useAppStore();
  const [graph, setGraph] = useState<DepGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dependencyGraphOpen || !dependencyGraphDir) return;
    setLoading(true);
    setError(null);
    setGraph(null);
    analyzeDependencies(dependencyGraphDir)
      .then(setGraph)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [dependencyGraphOpen, dependencyGraphDir]);

  // ESC to close
  useEffect(() => {
    if (!dependencyGraphOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDependencyGraphOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dependencyGraphOpen, setDependencyGraphOpen]);

  if (!dependencyGraphOpen) return null;

  const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setDependencyGraphOpen(false); }}
    >
      <div
        style={{
          width: "90vw",
          height: "80vh",
          background: "#111111",
          border: "1px solid #333",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            fontFamily: MONO,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "#ff8c00", fontWeight: "bold", fontSize: "13px" }}>DEPENDENCY GRAPH</span>
            {dependencyGraphDir && (
              <span style={{ color: "#666", fontSize: "11px" }}>
                {dependencyGraphDir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
              </span>
            )}
            {graph && (
              <span style={{ color: "#555", fontSize: "10px" }}>
                {graph.nodes.length} files, {graph.edges.length} edges
              </span>
            )}
          </div>
          <button
            onClick={() => setDependencyGraphOpen(false)}
            style={{
              background: "none",
              border: "1px solid #333",
              color: "#888",
              cursor: "pointer",
              padding: "4px 10px",
              fontSize: "11px",
              fontFamily: MONO,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          >
            ESC
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "12px", padding: "6px 16px", borderBottom: "1px solid #1a1a1a" }}>
          {Object.entries(EXT_COLORS).map(([ext, color]) => (
            <div key={ext} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", fontFamily: MONO, color: "#666" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              .{ext}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontFamily: MONO, fontSize: "13px" }}>
              Analyzing dependencies...
            </div>
          )}
          {error && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#ff4444", fontFamily: MONO, fontSize: "12px" }}>
              {error}
            </div>
          )}
          {graph && !loading && (
            graph.nodes.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontFamily: MONO, fontSize: "13px" }}>
                No source files found
              </div>
            ) : (
              <GraphCanvas graph={graph} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
