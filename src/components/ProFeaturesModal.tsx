import { memo, type CSSProperties } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useAppStore } from "../stores/appStore";
import { useEntitlementStore } from "../stores/entitlementStore";
import { STAKE_URL, PRO_POWER_THRESHOLD, TIER_NAMES } from "../lib/entitlement";

/**
 * "Everything Pro gets you" — the full explainer popup behind the Learn-more
 * buttons on the Pro surfaces. Mirrors the stake-page copy so the desktop and
 * the web make the same promise. Adapts to the viewer's current tier.
 */

const FEATURES: { glyph: string; name: string; blurb: string }[] = [
  { glyph: "◆", name: "AI code review", blurb: "Review your git changes — bugs, security & UX — straight from the Git panel, before you push. Powered by Claude Sonnet 4.6." },
  { glyph: "▤", name: "Coding analytics", blurb: "A local dashboard built from your agent-CLI logs — sessions, lines, models, streaks. Nothing ever leaves your machine." },
  { glyph: "⌁", name: "AI commit messages", blurb: "One click turns your staged diff into a clear, conventional commit message. No more \"wip\" or \"fix stuff\"." },
  { glyph: "✎", name: "AI terminal naming", blurb: "Name any terminal from what it's actually doing — a real tab title, not just \"zsh\"." },
];

const CAPS = "Fair-use limits: 30 AI reviews + 300 AI assists (commit & terminal names) per month. Coding analytics is local and uncapped.";

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
}

const primaryBtn: CSSProperties = {
  border: "1px solid var(--text-accent)", padding: "9px 20px", fontSize: 12.5,
  fontFamily: "var(--font-mono)", color: "var(--text-accent)",
  background: "rgba(255,140,0,0.10)", cursor: "pointer", fontWeight: 600,
};
const ghostBtn: CSSProperties = {
  border: "1px solid var(--border-default)", padding: "9px 16px", fontSize: 12,
  fontFamily: "var(--font-mono)", color: "var(--text-muted)", background: "transparent", cursor: "pointer",
};

export const ProFeaturesModal = memo(function ProFeaturesModal() {
  const proModalOpen = useAppStore((s) => s.proModalOpen);
  const setProModalOpen = useAppStore((s) => s.setProModalOpen);
  const tier = useEntitlementStore((s) => s.tier);
  const startLink = useEntitlementStore((s) => s.startLink);

  if (!proModalOpen) return null;

  const isPro = tier >= 1;
  const close = () => setProModalOpen(false);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "40px", overflow: "auto" }}
      onClick={close}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.66)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="CodeGrid Pro"
        style={{
          position: "relative", width: "560px", maxWidth: "calc(100vw - 32px)", marginBottom: "40px",
          background: "var(--bg-secondary)", border: "1px solid var(--text-accent)",
          fontFamily: "var(--font-ui)", zIndex: 1, display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 22px 16px", borderBottom: "1px solid var(--border-default)", position: "relative", background: "linear-gradient(180deg, rgba(255,140,0,0.08), transparent)" }}>
          <button onClick={close} aria-label="Close" style={{
            position: "absolute", top: 12, right: 14, background: "none", border: "none",
            color: "var(--text-faint)", fontSize: 15, cursor: "pointer", fontFamily: "var(--font-ui)",
          }}>×</button>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.2em", color: "var(--text-accent)", border: "1px solid var(--text-accent)", padding: "2px 8px" }}>
              CODEGRID PRO
            </span>
            {isPro && (
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--status-running)" }}>
                ✓ active — {TIER_NAMES[tier] ?? "Pro"}
              </span>
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            {isPro ? "Everything you've unlocked" : "A subscription you don't pay for"}
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
            Pro is powered by staking <b style={{ color: "var(--text-primary)" }}>$GRID</b>. You stake instead of subscribing —
            no monthly fee, no yield, and your principal is always returned when you unstake. Stake enough to reach Pro and
            every feature below turns on.
          </div>
        </div>

        {/* Features */}
        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {FEATURES.map((f) => (
            <div key={f.name} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{
                flexShrink: 0, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px solid var(--text-accent)", color: "var(--text-accent)", fontSize: 14,
                background: "rgba(255,140,0,0.08)",
              }}>{f.glyph}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{f.name}</span>
                  {isPro && <span style={{ fontSize: 10, color: "var(--status-running)", fontFamily: "var(--font-mono)" }}>ON</span>}
                </div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{f.blurb}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Fair-use caps */}
        <div style={{ margin: "0 22px 14px", padding: "9px 12px", border: "1px solid var(--border-default)", background: "var(--bg-tertiary)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, fontFamily: "var(--font-mono)" }}>
          {CAPS}
        </div>

        {/* Footer / CTAs */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {isPro ? (
            <>
              <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
                Manage your linked wallet in <b style={{ color: "var(--text-primary)" }}>Settings → Premium</b>.
              </span>
              <button style={primaryBtn} onClick={close}>Done</button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                Pro unlocks at <b style={{ color: "var(--text-primary)" }}>{abbrev(PRO_POWER_THRESHOLD)}</b> staking power.
                <br />Stake on the token page, then link your wallet — it unlocks automatically.
              </div>
              <button style={ghostBtn} onClick={() => openExternal(STAKE_URL)}>Get $GRID →</button>
              <button style={primaryBtn} onClick={() => { startLink(); close(); }}>Link wallet</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
