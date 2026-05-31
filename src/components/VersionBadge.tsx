import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "../stores/updaterStore";
import { checkForUpdates } from "../lib/updater";

const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace";
const ACCENT = "#ff8c00";

/**
 * Records (in localStorage) the first time each version is seen running, which
 * is a good proxy for "when you last updated". Returns that timestamp (ms).
 */
function recordAndGetUpdatedAt(version: string): number {
  const VKEY = "codegrid:installedVersion";
  const TKEY = "codegrid:updatedAt";
  try {
    const prevVersion = localStorage.getItem(VKEY);
    const prevTime = localStorage.getItem(TKEY);
    if (prevVersion === version && prevTime) {
      return parseInt(prevTime, 10);
    }
    const now = Date.now();
    localStorage.setItem(VKEY, version);
    localStorage.setItem(TKEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const VersionBadge = memo(function VersionBadge() {
  const [version, setVersion] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const status = useUpdaterStore((s) => s.status);
  const offeredVersion = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const progress = useUpdaterStore((s) => s.progress);
  const install = useUpdaterStore((s) => s.install);
  const error = useUpdaterStore((s) => s.error);

  useEffect(() => {
    getVersion()
      .then((v) => {
        setVersion(v);
        setUpdatedAt(recordAndGetUpdatedAt(v));
      })
      .catch(() => {});
  }, []);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-version-popover]") && !t.closest("[data-version-badge]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!version) return null;

  const updateReady = status === "ready";
  const busy = status === "checking" || status === "downloading";

  const togglePopover = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen((v) => !v);
  };

  const badgeTitle = updateReady
    ? "An update is ready — click to install"
    : `CodeGrid v${version}${updatedAt ? ` · Updated ${formatDate(updatedAt)}` : ""} · Click for version & updates`;

  return (
    <>
      <button
        ref={btnRef}
        data-version-badge
        onClick={togglePopover}
        title={badgeTitle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: MONO,
          fontSize: "10px",
          color: updateReady ? ACCENT : "#555",
          padding: "3px 8px",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { if (!updateReady) e.currentTarget.style.color = "#888"; }}
        onMouseLeave={(e) => { if (!updateReady) e.currentTarget.style.color = "#555"; }}
      >
        {updateReady && (
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: ACCENT, flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: updateReady ? "bold" : "normal" }}>
          {updateReady ? "UPDATE READY" : busy ? `v${version} · …` : `v${version}`}
        </span>
      </button>

      {open && anchor && createPortal(
        <div
          data-version-popover
          style={{
            position: "fixed",
            top: anchor.top,
            right: anchor.right,
            zIndex: 10000,
            width: 280,
            background: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            fontFamily: MONO,
            color: "#e0e0e0",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #2a2a2a" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>CodeGrid</span>
              <span style={{ fontSize: 12, color: ACCENT, fontWeight: 700 }}>v{version}</span>
            </div>
            {updatedAt && (
              <div style={{ fontSize: 10, color: "#777", marginTop: 4 }}>
                Updated {formatDate(updatedAt)}
              </div>
            )}
          </div>

          {/* Body — update status */}
          <div style={{ padding: "12px 14px" }}>
            {updateReady ? (
              <>
                <div style={{ fontSize: 11, color: "#ccc", lineHeight: 1.5, marginBottom: 10 }}>
                  Version <b style={{ color: ACCENT }}>{offeredVersion}</b> is downloaded and ready.
                </div>
                <button
                  onClick={async () => { try { await install?.(); } catch (e) { console.error(e); } }}
                  style={primaryBtn}
                >
                  Restart to Update
                </button>
              </>
            ) : status === "downloading" ? (
              <>
                <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8 }}>
                  Downloading v{offeredVersion}… {progress > 0 ? `${Math.round(progress * 100)}%` : ""}
                </div>
                <div style={{ height: 4, background: "#2a2a2a", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(4, Math.round(progress * 100))}%`, background: ACCENT, transition: "width 0.25s ease" }} />
                </div>
              </>
            ) : status === "checking" ? (
              <div style={{ fontSize: 11, color: "#aaa" }}>Checking for updates…</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: status === "error" ? "#ff6b6b" : "#999", lineHeight: 1.5, marginBottom: 10 }}>
                  {status === "error"
                    ? `Update check failed${error ? `: ${error}` : ""}.`
                    : status === "uptodate"
                      ? "You're on the latest version."
                      : "Check whether a newer version is available."}
                </div>
                <button onClick={() => void checkForUpdates({ silent: false })} style={primaryBtn}>
                  Check for Updates
                </button>
              </>
            )}

            {notes && (updateReady || status === "downloading") && (
              <div
                style={{
                  marginTop: 10,
                  maxHeight: 110,
                  overflow: "auto",
                  background: "#0a0a0a",
                  border: "1px solid #2a2a2a",
                  borderRadius: 4,
                  padding: 8,
                  fontSize: 10,
                  color: "#999",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                }}
              >
                {notes}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});

const primaryBtn: React.CSSProperties = {
  width: "100%",
  background: ACCENT,
  color: "#0a0a0a",
  border: "none",
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 700,
  fontFamily: MONO,
  letterSpacing: 0.5,
  borderRadius: 5,
};
