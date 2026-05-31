import { type ReactNode, type CSSProperties } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEntitlementStore } from "../stores/entitlementStore";
import { TIER_NAMES, STAKE_URL, PRO_POWER_THRESHOLD } from "../lib/entitlement";

/**
 * Gate a premium feature behind a minimum tier.
 *
 *   <Gated tier={1}><ReviewPanel /></Gated>
 *
 * Below the required tier, renders a clear upsell that distinguishes the two
 * steps — stake $GRID, then link your wallet — and, once linked, shows exactly
 * how much more $GRID to stake to reach Pro.
 */

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
}

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  margin: 12,
  padding: 24,
  maxWidth: 420,
  marginInline: "auto",
  textAlign: "center",
  border: "1px solid var(--border-default, #2a2a2a)",
  background: "var(--bg-secondary, #141414)",
  fontFamily: "var(--font-ui)",
};
const label: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--text-accent)",
};
const primaryBtn: CSSProperties = {
  border: "1px solid var(--text-accent)",
  padding: "8px 18px",
  fontSize: 12.5,
  fontFamily: "var(--font-mono)",
  color: "var(--text-accent)",
  background: "rgba(255,140,0,0.10)",
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  border: "1px solid var(--border-default, #2a2a2a)",
  padding: "8px 14px",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--text-secondary)",
  background: "transparent",
  cursor: "pointer",
};

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 11,
        height: 11,
        border: "2px solid var(--text-accent)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "gated-spin 0.7s linear infinite",
      }}
    />
  );
}

export function Gated({
  tier,
  children,
  fallback,
  loadingFallback,
}: {
  tier: number;
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}) {
  const current = useEntitlementStore((s) => s.tier);
  const loading = useEntitlementStore((s) => s.loading);
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const linkStatus = useEntitlementStore((s) => s.linkStatus);
  const startLink = useEntitlementStore((s) => s.startLink);
  const cancelLink = useEntitlementStore((s) => s.cancelLink);

  if (loading) return <>{loadingFallback ?? null}</>;
  if (current >= tier) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;

  const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`;
  const linked = !!entitlement;
  const powerTokens = entitlement ? Number(BigInt(entitlement.power) / 10n ** 18n) : 0;
  const needed = Math.max(0, PRO_POWER_THRESHOLD - powerTokens);

  // ---- Waiting for the browser sign-in (hands-free relay in progress) ----
  if (linkStatus === "waiting") {
    return (
      <div style={card}>
        <style>{`@keyframes gated-spin{to{transform:rotate(360deg)}}`}</style>
        <div style={label}>Linking</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "var(--text-primary)" }}>
          <Spinner /> Waiting for you to sign in your browser…
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Connect your wallet and approve the signature. This window unlocks automatically — no need to switch back.
        </div>
        <button style={ghostBtn} onClick={() => cancelLink()}>Cancel</button>
      </div>
    );
  }

  // ---- Linked, but this wallet isn't at Pro yet → show how much more to stake ----
  if (linked && current < tier) {
    return (
      <div style={card}>
        <div style={label}>{tierName} feature</div>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
          Wallet linked <span style={{ color: "var(--status-running, #00c853)" }}>✓</span> — but it&apos;s{" "}
          <b>{TIER_NAMES[current] ?? "Free"}</b>, not {tierName} yet.
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-secondary)",
            border: "1px solid var(--border-default, #2a2a2a)",
            padding: "10px 12px",
            lineHeight: 1.7,
          }}
        >
          your power&nbsp;&nbsp;<b style={{ color: "var(--text-primary)" }}>{abbrev(powerTokens)}</b>
          <br />
          {tierName} needs&nbsp;&nbsp;<b style={{ color: "var(--text-primary)" }}>{abbrev(PRO_POWER_THRESHOLD)}</b>
          <br />
          <span style={{ color: "var(--text-accent)" }}>
            stake ~{abbrev(needed)} more $GRID
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button style={primaryBtn} onClick={() => openExternal(STAKE_URL)}>Get $GRID →</button>
          <button style={ghostBtn} onClick={() => startLink()}>Re-check</button>
        </div>
      </div>
    );
  }

  // ---- Not linked yet → two clear steps ----
  return (
    <div style={card}>
      <div style={label}>{tierName} feature</div>
      <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
        Unlock <b>AI code review</b>, <b>coding analytics</b>, <b>AI commit messages</b> &amp; <b>terminal naming</b>.
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {tierName} is powered by staking $GRID — a subscription you don&apos;t pay for. No yield, principal always
        returned.
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          textAlign: "left",
          marginInline: "auto",
        }}
      >
        <span>
          <span style={{ color: "var(--text-accent)" }}>1.</span> Stake $GRID on the token page
        </span>
        <span>
          <span style={{ color: "var(--text-accent)" }}>2.</span> Link your wallet to this app
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button style={primaryBtn} onClick={() => startLink()}>Link wallet</button>
        <button style={ghostBtn} onClick={() => openExternal(STAKE_URL)}>Get $GRID →</button>
      </div>
      {linkStatus === "timeout" ? (
        <div style={{ fontSize: 11, color: "var(--status-waiting, #ffab00)" }}>
          Didn&apos;t hear back from the browser — finish signing, then click Link wallet again.
        </div>
      ) : linkStatus === "error" ? (
        <div style={{ fontSize: 11, color: "var(--status-error, #ff3d00)" }}>
          Couldn&apos;t verify the link. Try again.
        </div>
      ) : null}
    </div>
  );
}

/** Hook form for conditional logic outside JSX. */
export function useHasTier(min: number): boolean {
  return useEntitlementStore((s) => s.tier >= min);
}
