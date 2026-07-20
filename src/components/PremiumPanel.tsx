/**
 * Legacy Premium / staking panel. CodeGrid is free and open source — no wallet,
 * no stake, no entitlement. AI features that need a provider key use bring-your-
 * own-key under Settings → Voice (OpenAI for voice + AI assists).
 */
export function PremiumPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "var(--font-ui)" }}>
      <header>
        <h2 style={{ fontSize: 15, color: "var(--text-primary)", margin: 0, fontWeight: 600 }}>
          Free &amp; open source
        </h2>
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Every CodeGrid feature is free. There is no paid tier, no wallet link, and no crypto stake.
          AI extras (code review, commit messages, terminal naming, voice) use your own API key when
          a model is required — nothing is billed through CodeGrid.
        </p>
      </header>
      <div
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          background: "var(--bg-secondary)",
          padding: 14,
          fontSize: 12,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
        }}
      >
        <div style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
          Bring your own key
        </div>
        Add an OpenAI API key under <b style={{ color: "var(--text-primary)" }}>Settings → Voice</b>.
        The same key powers voice control and the optional AI assists (review, commit messages,
        terminal naming). Usage bills to your OpenAI account; the key stays in the macOS Keychain.
      </div>
    </div>
  );
}
