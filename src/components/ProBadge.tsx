import type { CSSProperties } from "react";

/**
 * Legacy "PRO" pill. Renders nothing — CodeGrid is fully free and open source.
 * Kept so existing call sites compile without a wide rename.
 */
export function ProBadge(_props: { style?: CSSProperties; title?: string }) {
  return null;
}
