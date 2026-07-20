import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { voiceSetApiKey } from "../lib/ipc";
import { useVoiceStore } from "../stores/voiceStore";
import { useToastStore } from "../stores/toastStore";
import { UI_ICON } from "../lib/icons";

const ACCENT = "#ff8c00";

/**
 * First-touch education for Max (voice control). Shown when the mic is
 * clicked with no OpenAI key saved: explains what the feature does, why a key
 * is needed (BYOK), and takes the key right here — then starts the session
 * immediately so the payoff is instant.
 */
export const VoiceSetupModal = memo(function VoiceSetupModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const start = useVoiceStore((s) => s.start);

  const saveAndStart = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      await voiceSetApiKey(key.trim());
      addToast("Key saved to the macOS Keychain.", "success");
      onClose();
      void start();
    } catch (e) {
      addToast(String(e), "error", 6000);
      setSaving(false);
    }
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(3px)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Set up voice control"
        style={{
          position: "relative", width: 480, maxWidth: "92vw",
          background: "#141414", border: `1px solid ${ACCENT}`, borderRadius: 12,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)", fontFamily: "var(--font-ui)",
          padding: "26px 28px 22px", color: "#e0e0e0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ display: "inline-flex", width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,140,0,0.14)", border: `1px solid ${ACCENT}`, color: ACCENT }}>
            <UI_ICON.mic size={17} weight="fill" />
          </span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>
              Meet <span style={{ color: ACCENT }}>Max</span> — talk to your canvas
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>Voice control for all your agents, hands-free.</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5, lineHeight: 1.6, color: "#bbb", margin: "14px 0 4px" }}>
          <div>🗣️ <i style={{ color: "#ddd" }}>"Spin up a Codex agent and have it fix the failing login test"</i> — pane appears, prompt typed, done.</div>
          <div>📋 <i style={{ color: "#ddd" }}>"What's Claude working on?"</i> — Max reads the pane and answers out loud.</div>
          <div>🤝 <i style={{ color: "#ddd" }}>"Get three agents collaborating on this refactor"</i> — Max spawns and coordinates the fleet.</div>
        </div>

        <div style={{ fontSize: 11.5, color: "#888", lineHeight: 1.6, margin: "12px 0 16px" }}>
          Max runs on OpenAI&apos;s Realtime API with <b style={{ color: "#ddd" }}>your own API key</b> — usage bills to your
          OpenAI account (≈$0.10 per minute of conversation). The key is stored in the macOS Keychain and never leaves
          your machine except to talk to OpenAI.
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveAndStart(); }}
            placeholder="Paste your OpenAI API key (sk-…)"
            autoFocus
            aria-label="OpenAI API key"
            style={{
              flex: 1, boxSizing: "border-box", background: "#0a0a0a", border: "1px solid #2a2a2a",
              color: "var(--text-primary)", fontSize: 12.5, fontFamily: "var(--font-mono)",
              padding: "9px 11px", outline: "none", borderRadius: 7,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
          />
          <button
            onClick={() => void saveAndStart()}
            disabled={!key.trim() || saving}
            style={{
              background: key.trim() ? ACCENT : "#2a2a2a", border: "none", borderRadius: 7,
              color: key.trim() ? "#0a0a0a" : "#666", fontSize: 12.5, fontWeight: 800,
              padding: "0 16px", cursor: key.trim() ? "pointer" : "default", fontFamily: "var(--font-ui)",
              whiteSpace: "nowrap",
            }}
          >
            {saving ? "Saving…" : "Save & talk"}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <button
            onClick={() => { openExternal("https://platform.openai.com/api-keys").catch(() => {}); }}
            style={{ background: "none", border: "none", color: ACCENT, fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 }}
          >
            Get an API key at platform.openai.com →
          </button>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
});
