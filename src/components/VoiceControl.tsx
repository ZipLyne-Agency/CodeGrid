import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useVoiceStore } from "../stores/voiceStore";
import { voiceKeyStatus, getSetting, setSetting, voiceRequestNotifications } from "../lib/ipc";
import { useToastStore } from "../stores/toastStore";
import { VoiceSetupModal } from "./VoiceSetupModal";
import { UI_ICON } from "../lib/icons";

/**
 * TopBar mic button for CodeGrid Voice + a floating transcript strip.
 * BYOK — available to everyone with an OpenAI key in Settings → Voice.
 * Active session: glow per status, elapsed timer, click to stop,
 * right-click to mute.
 */

const STATUS_COLOR: Record<string, string> = {
  off: "#555555",
  connecting: "#ffab00",
  listening: "var(--accent, #ff8c00)",
  speaking: "#00c853",
  tool: "#d500f9",
  sleeping: "#4a9eff",
  error: "#ff3d00",
};

function useElapsed(startedAt: number | null): string {
  const [, force] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return "";
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const VoiceControl = memo(function VoiceControl() {
  const status = useVoiceStore((s) => s.status);
  const micPaused = useVoiceStore((s) => s.micPaused);
  const startedAt = useVoiceStore((s) => s.startedAt);
  const userLine = useVoiceStore((s) => s.userLine);
  const assistantLine = useVoiceStore((s) => s.assistantLine);
  const lastTool = useVoiceStore((s) => s.lastTool);
  const mode = useVoiceStore((s) => s.mode);
  const pttShortcut = useVoiceStore((s) => s.pttShortcut);
  const start = useVoiceStore((s) => s.start);
  const stop = useVoiceStore((s) => s.stop);
  const toggleMic = useVoiceStore((s) => s.toggleMic);

  const [setupOpen, setSetupOpen] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  // "Alerts" — background notifications, completely independent of voice/mic.
  // Just `voice_announce_push`, surfaced as a one-click toggle next to the mic.
  const [alertsOn, setAlertsOn] = useState(true);
  useEffect(() => {
    getSetting("voice_announce_push").then((v) => setAlertsOn(v !== "false")).catch(() => {});
  }, []);

  const toggleAlerts = async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    setSetting("voice_announce_push", String(next)).catch(() => {});
    if (next) {
      // Turning on → make sure macOS will actually let banners through.
      try {
        const granted = await voiceRequestNotifications();
        if (!granted) {
          addToast("Allow notifications in System Settings → Notifications → CodeGrid to get background alerts.", "warning", 6000);
        } else {
          addToast("Alerts on — you'll be notified when agents finish or need you, even with Max off.", "success", 4000);
        }
      } catch { /* permission probe failed; banners may still work */ }
    } else {
      addToast("Alerts off.", "info", 2500);
    }
  };

  const elapsed = useElapsed(startedAt);
  const active = status !== "off" && status !== "error";
  const color = micPaused && active ? "#777777" : STATUS_COLOR[status] ?? "#555555";
  const MicIcon = micPaused && active ? UI_ICON.micOff : UI_ICON.mic;

  const title = !active
    ? "Max — voice control: speak to spawn, message, and read agents"
    : micPaused
      ? `Max paused (${status}) — click to stop, right-click to unmute`
      : `Max ${status} — click to stop, right-click to mute`;

  const handleClick = async () => {
    if (active) {
      void stop();
      return;
    }
    // No key yet → educate + collect it, instead of a cryptic error toast.
    try {
      const hasKey = await voiceKeyStatus();
      if (!hasKey) {
        setSetupOpen(true);
        return;
      }
    } catch {
      /* keychain hiccup — fall through, voice_start will surface it */
    }
    void start();
  };

  const AlertIcon = alertsOn ? UI_ICON.bell : UI_ICON.bellOff;

  return (
    <>
      {/* Alerts — background notifications, no mic/voice. Sits beside Max. */}
      <button
        onClick={() => void toggleAlerts()}
        title={
          alertsOn
            ? "Alerts ON — get notified when agents finish or need you in the background, even when Max isn't listening. Click to turn off."
            : "Alerts OFF — click to get background notifications about your agents (no microphone, no voice)."
        }
        aria-pressed={alertsOn}
        className="cg-focus-ring"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          height: "var(--ctl-h)",
          width: "var(--ctl-h)",
          boxSizing: "border-box",
          background: alertsOn ? "rgba(74,158,255,0.12)" : "transparent",
          border: `1px solid ${alertsOn ? "rgba(74,158,255,0.5)" : "var(--border-default)"}`,
          borderRadius: 6,
          color: alertsOn ? "#4a9eff" : "var(--text-muted)",
          cursor: "pointer",
          transition: "color 0.15s ease, border-color 0.15s ease, background 0.15s ease",
        }}
        onMouseEnter={(e) => { if (!alertsOn) { e.currentTarget.style.color = "#4a9eff"; e.currentTarget.style.borderColor = "#4a9eff"; } }}
        onMouseLeave={(e) => { if (!alertsOn) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-default)"; } }}
      >
        <AlertIcon size={14} weight={alertsOn ? "fill" : "regular"} style={{ flexShrink: 0 }} />
      </button>

      <button
        data-tour="voice"
        onClick={() => void handleClick()}
        onContextMenu={(e) => {
          e.preventDefault();
          if (active) void toggleMic();
        }}
        title={title}
        className="cg-focus-ring"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
          height: "var(--ctl-h)",
          boxSizing: "border-box",
          // Prominent by design: the one colorful pill in a monochrome bar.
          background: active
            ? "rgba(255,140,0,0.16)"
            : "linear-gradient(135deg, rgba(255,140,0,0.18), rgba(213,0,249,0.12))",
          border: `1px solid ${active ? color : "rgba(255,140,0,0.55)"}`,
          borderRadius: 999,
          boxShadow: active ? `0 0 10px ${color}55` : "0 0 8px rgba(255,140,0,0.18)",
          color: active ? color : "var(--accent, #ff8c00)",
          cursor: "pointer",
          padding: "0 12px",
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.02em",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
          animation: status === "connecting" ? "cg-voice-pulse 1.1s ease-in-out infinite" : undefined,
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.borderColor = "var(--accent, #ff8c00)";
            e.currentTarget.style.boxShadow = "0 0 12px rgba(255,140,0,0.4)";
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.borderColor = "rgba(255,140,0,0.55)";
            e.currentTarget.style.boxShadow = "0 0 8px rgba(255,140,0,0.18)";
          }
        }}
      >
        <MicIcon size={14} weight={active ? "fill" : "regular"} style={{ flexShrink: 0 }} />
        <span>{active ? (elapsed || "Max") : "Max"}</span>
      </button>

      {setupOpen && <VoiceSetupModal onClose={() => setSetupOpen(false)} />}

      {/* Floating transcript strip — only while a session is live. */}
      {active &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 86,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9000,
              maxWidth: 560,
              minWidth: 260,
              pointerEvents: "none",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              background: "rgba(14,14,14,0.92)",
              border: "1px solid var(--border-default, #2a2a2a)",
              borderRadius: 10,
              boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
              backdropFilter: "blur(6px)",
              padding: "8px 12px",
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, color, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: "50%", background: color,
                  animation: status === "listening" && !micPaused ? "cg-voice-pulse 1.4s ease-in-out infinite" : undefined,
                }}
              />
              {mode === "ptt" && micPaused
                ? `hold ${pttShortcut} to talk`
                : micPaused
                  ? "mic paused"
                  : status === "sleeping"
                    ? "asleep — say \"Max\""
                    : status}
            </div>
            {userLine?.text && (
              <div style={{ color: "var(--text-secondary, #888)" }}>
                <span style={{ color: "var(--text-faint, #666)" }}>you · </span>
                {userLine.text}
              </div>
            )}
            {assistantLine?.text && (
              <div style={{ color: "var(--text-primary, #e0e0e0)" }}>
                <span style={{ color: "var(--accent, #ff8c00)" }}>max · </span>
                {assistantLine.text}
              </div>
            )}
            {lastTool && (
              <div style={{ color: "#d500f9", fontFamily: "var(--font-mono)", fontSize: 10 }}>{lastTool}</div>
            )}
          </div>,
          document.body,
        )}

      <style>{`@keyframes cg-voice-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
    </>
  );
});
