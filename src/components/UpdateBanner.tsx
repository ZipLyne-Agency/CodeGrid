import { memo, useState } from "react";
import { useUpdaterStore } from "../stores/updaterStore";

const MONO = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace";
const ACCENT = "#ff8c00";

/**
 * Bottom-right update banner. Appears while an update is downloading and once
 * it's ready to install. Reads entirely from the updater store; hidden in all
 * other states (idle / checking / up-to-date / dismissed).
 */
export const UpdateBanner = memo(function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const notes = useUpdaterStore((s) => s.notes);
  const progress = useUpdaterStore((s) => s.progress);
  const install = useUpdaterStore((s) => s.install);
  const dismissed = useUpdaterStore((s) => s.dismissed);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  const [installing, setInstalling] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const downloading = status === "downloading" || status === "available";
  const ready = status === "ready" && !dismissed;

  if (!downloading && !ready) return null;

  const pct = Math.round(progress * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 9999,
        width: "300px",
        background: "#141414",
        border: `1px solid ${ACCENT}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        fontFamily: MONO,
        color: "#e0e0e0",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 12px",
          borderBottom: "1px solid #2a2a2a",
        }}
      >
        <span style={{ color: ACCENT, fontSize: "10px", fontWeight: "bold", letterSpacing: "1.5px" }}>
          {downloading ? "DOWNLOADING UPDATE" : "UPDATE READY"}
        </span>
        {version && (
          <span style={{ color: "#888", fontSize: "10px" }}>v{version}</span>
        )}
      </div>

      <div style={{ padding: "12px" }}>
        {downloading ? (
          <>
            <div style={{ fontSize: "11px", color: "#aaa", marginBottom: "8px" }}>
              Downloading in the background… {pct > 0 ? `${pct}%` : ""}
            </div>
            <div style={{ height: "4px", background: "#2a2a2a", borderRadius: "2px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(4, pct)}%`,
                  background: ACCENT,
                  transition: "width 0.25s ease",
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "11px", color: "#ccc", lineHeight: 1.5, marginBottom: notes ? "8px" : "12px" }}>
              A new version is downloaded and ready. Restart to update.
            </div>

            {notes && (
              <div style={{ marginBottom: "12px" }}>
                <button
                  onClick={() => setShowNotes((v) => !v)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#888",
                    fontSize: "10px",
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: MONO,
                    letterSpacing: "0.5px",
                  }}
                >
                  {showNotes ? "▾ what's new" : "▸ what's new"}
                </button>
                {showNotes && (
                  <div
                    style={{
                      marginTop: "6px",
                      maxHeight: "120px",
                      overflow: "auto",
                      background: "#0a0a0a",
                      border: "1px solid #2a2a2a",
                      padding: "8px",
                      fontSize: "10px",
                      color: "#999",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                    }}
                  >
                    {notes}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                disabled={installing}
                onClick={async () => {
                  if (!install) return;
                  setInstalling(true);
                  try {
                    await install();
                  } catch (e) {
                    console.error("Install failed:", e);
                    setInstalling(false);
                  }
                }}
                style={{
                  flex: 1,
                  background: ACCENT,
                  color: "#0a0a0a",
                  border: "none",
                  padding: "7px 10px",
                  cursor: installing ? "default" : "pointer",
                  fontSize: "11px",
                  fontWeight: "bold",
                  fontFamily: MONO,
                  letterSpacing: "0.5px",
                  opacity: installing ? 0.6 : 1,
                }}
              >
                {installing ? "Restarting…" : "Restart to Update"}
              </button>
              <button
                onClick={dismiss}
                disabled={installing}
                style={{
                  background: "transparent",
                  color: "#666",
                  border: "1px solid #2a2a2a",
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontFamily: MONO,
                }}
              >
                Later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
