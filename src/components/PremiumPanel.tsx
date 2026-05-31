import { type ReactNode } from "react";
import { useEntitlementStore } from "../stores/entitlementStore";
import { TIER_NAMES } from "../lib/entitlement";
import { startPremiumLink } from "../hooks/useEntitlement";
import { open as openExternal } from "@tauri-apps/plugin-shell";

/**
 * Premium / $GRID staking settings panel. Shows the current entitlement, links a
 * wallet (web sign-in round-trip), opens the stake page, or signs out. Styled
 * with inline styles + CSS vars to match the rest of the app (the desktop build
 * has no Tailwind theme tokens).
 */
export function PremiumPanel() {
  const entitlement = useEntitlementStore((s) => s.entitlement);
  const tier = useEntitlementStore((s) => s.tier);
  const loading = useEntitlementStore((s) => s.loading);
  const clear = useEntitlementStore((s) => s.clear);

  // power is wei; show whole-token power.
  const powerTokens = entitlement
    ? Math.floor(Number(BigInt(entitlement.power) / 10n ** 15n) / 1000)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, fontFamily: "var(--font-ui)" }}>
      <header>
        <h2 style={{ fontSize: 15, color: "var(--text-primary)", margin: 0, fontWeight: 600 }}>
          Premium · $GRID staking
        </h2>
        <p style={{ marginTop: 4, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Stake $GRID on Base to unlock premium features. No monthly fee — you keep your principal and
          exit anytime with a short cooldown. A utility access stake: no yield, no revenue share.
        </p>
      </header>

      <div
        style={{
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          background: "var(--bg-secondary)",
          padding: 16,
        }}
      >
        {loading ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Checking entitlement…</div>
        ) : entitlement ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            <Row label="Tier">
              <span style={{ color: "var(--text-accent)" }}>{TIER_NAMES[tier] ?? `Tier ${tier}`}</span>
            </Row>
            <Row label="Access power">{powerTokens.toLocaleString()}</Row>
            <Row label="Wallet">
              <span style={{ fontFamily: "var(--font-code)", fontSize: 12 }}>
                {entitlement.address.slice(0, 6)}…{entitlement.address.slice(-4)}
              </span>
            </Row>
            <Row label="Verified until">{new Date(entitlement.exp * 1000).toLocaleString()}</Row>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            No premium entitlement linked. Stake $GRID and connect your wallet to unlock.
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Btn primary onClick={() => startPremiumLink()}>
          {entitlement ? "Re-link / refresh" : "Link wallet"}
        </Btn>
        <Btn onClick={() => openExternal("https://codegrid.app/token/stake")}>Manage stake ↗</Btn>
        {entitlement ? (
          <Btn danger onClick={() => clear()}>
            Unlink wallet
          </Btn>
        ) : null}
      </div>

      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
        Access is read from the chain when you link and refreshes about every 24 hours — staking or
        unstaking can take up to a day to reflect here. Re-link to refresh sooner. Manage your stake,
        cooldown and withdrawals on the stake page.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{children}</span>
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const color = danger ? "var(--status-error, #ff3d00)" : primary ? "var(--text-accent)" : "var(--text-secondary)";
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${danger ? "var(--status-error, #ff3d00)55" : primary ? "var(--text-accent)" : "var(--border-default)"}`,
        borderRadius: 5,
        padding: "6px 16px",
        fontSize: 12,
        color,
        background: primary ? "rgba(255,140,0,0.10)" : danger ? "rgba(255,61,0,0.08)" : "transparent",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
