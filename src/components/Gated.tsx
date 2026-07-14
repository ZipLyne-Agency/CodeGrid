import { type ReactNode } from "react";

/**
 * Legacy premium gate — CodeGrid is fully free and open source.
 * Always renders children. Kept as a thin pass-through so call sites
 * (Analytics, Review) need no structural rewrite.
 */
export function Gated({
  children,
}: {
  tier?: number;
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}) {
  return <>{children}</>;
}

/** Always true — every feature is free. */
export function useHasTier(_min?: number): boolean {
  return true;
}
