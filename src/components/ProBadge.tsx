import { type CSSProperties } from "react";

/**
 * Tiny "PRO" pill used to mark Pro-gated controls and surfaces. Accent-colored
 * so it reads as "premium" at a glance. Pair it with an upgrade-on-click handler
 * (open the Pro modal) so the affordance is obvious end to end.
 */
export function ProBadge({ style, title }: { style?: CSSProperties; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 8,
        fontWeight: 800,
        letterSpacing: "0.08em",
        fontFamily: "var(--font-mono)",
        color: "var(--accent, #ff8c00)",
        border: "1px solid var(--accent, #ff8c00)",
        borderRadius: 3,
        padding: "0 3px",
        lineHeight: "11px",
        textTransform: "uppercase",
        background: "rgba(255,140,0,0.12)",
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      PRO
    </span>
  );
}
