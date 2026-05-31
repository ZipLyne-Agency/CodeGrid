/**
 * View identifiers for the treasury terminal — shared by the server component
 * (page.tsx) and the client shell (TerminalShell.tsx).
 *
 * IMPORTANT: this module is intentionally NOT `"use client"`. `isViewId` is
 * called from the server component to validate the `?view=` query param, and a
 * runtime function exported from a client module cannot be invoked on the
 * server (Next throws "Attempted to call isViewId() from the server…").
 */

export type ViewId =
  | "status"
  | "balances"
  | "claims"
  | "allocations"
  | "policy"
  | "wallet"
  | "help";

export const VIEW_IDS: readonly ViewId[] = [
  "status",
  "balances",
  "claims",
  "allocations",
  "policy",
  "wallet",
  "help",
];

/** Type guard for a `?view=` value against the known views. */
export function isViewId(value: string | undefined | null): value is ViewId {
  return value != null && (VIEW_IDS as readonly string[]).includes(value);
}
