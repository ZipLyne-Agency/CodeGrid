import type { Metadata } from "next";
import {
  getRecentClaims,
  getTreasuryBalances,
  getTreasuryPrices,
} from "@/lib/treasury";
import { TerminalShell } from "./TerminalShell";
import { isViewId, type ViewId } from "./views";

export const metadata: Metadata = {
  title: "$GRID treasury — live balance, claims & policy",
  description:
    "Live, public balance of the $GRID treasury on Base — WETH and GRID fees from the Doppler pool, claim history, allocation breakdown, and the full treasury policy. All on one terminal.",
  alternates: { canonical: "https://www.codegrid.app/token/treasury" },
};

/**
 * ISR — re-render every 5 minutes. Server fetches public on-chain data once,
 * the client shell renders without polling. Public RPCs stay happy, page
 * stays snappy.
 */
export const revalidate = 300;

export default async function TreasuryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ view }, [balances, prices, claims]] = await Promise.all([
    searchParams,
    Promise.all([
      getTreasuryBalances().catch(() => null),
      getTreasuryPrices(),
      getRecentClaims(15),
    ]),
  ]);

  const requested = Array.isArray(view) ? view[0] : view;
  const initialView: ViewId = isViewId(requested) ? requested : "status";

  return (
    <TerminalShell
      balances={balances}
      prices={prices}
      claims={claims}
      renderedAt={Date.now()}
      initialView={initialView}
    />
  );
}
