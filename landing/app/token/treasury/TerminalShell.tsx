"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  BASESCAN_ADDRESS_URL,
  BASESCAN_TX_URL,
  formatAmount,
  formatUsd,
  fromWei,
  relativeTime,
  shortHash,
  type ClaimEvent,
  type TreasuryBalances,
  type TreasuryPrices,
} from "@/lib/treasury";
import {
  GRID_CHAIN,
  GRID_TOKEN_ADDRESS,
  GRID_TREASURY_ADDRESS,
} from "@/lib/token";
import { type ViewId } from "./views";

// Re-export the view type for back-compat with any consumer importing it here.
export type { ViewId } from "./views";

interface ShellProps {
  balances: TreasuryBalances | null;
  prices: TreasuryPrices;
  claims: ClaimEvent[];
  /** Server time the page rendered, ms. */
  renderedAt: number;
  /** Which view to open on first render (from the `?view=` query param). */
  initialView?: ViewId;
}

interface ViewDef {
  id: ViewId;
  cmd: string;
  label: string;
  desc: string;
}

const VIEWS: ViewDef[] = [
  { id: "status", cmd: "status", label: "Overview", desc: "Health & totals" },
  { id: "balances", cmd: "balances", label: "Balances", desc: "WETH · GRID · ETH" },
  { id: "claims", cmd: "claims --weth-grid", label: "Claims log", desc: "Recent on-chain claims · WETH + GRID only" },
  { id: "allocations", cmd: "allocations", label: "Allocations", desc: "How fees are used" },
  { id: "policy", cmd: "cat POLICY.md", label: "Policy", desc: "Full treasury policy" },
  { id: "wallet", cmd: "whoami --treasury", label: "Wallet", desc: "Address & verification" },
  { id: "help", cmd: "help", label: "Help", desc: "Commands & shortcuts" },
];

export function TerminalShell({
  balances,
  prices,
  claims,
  renderedAt,
  initialView = "status",
}: ShellProps) {
  const [view, setView] = useState<ViewId>(initialView);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tick, setTick] = useState(0); // for "last sync" relative timer
  const paneRef = useRef<HTMLDivElement>(null);

  // Tick every 10s so the status bar "last sync" stays live without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // Lock the document — no body scroll on this page, ever. Restore on unmount.
  useEffect(() => {
    document.documentElement.classList.add("page-locked");
    return () => document.documentElement.classList.remove("page-locked");
  }, []);

  // Reset scroll when switching views.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setSidebarOpen(false);
  }, [view]);

  // Keyboard shortcuts: number keys 1-7 jump to the matching view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const idx = ["1", "2", "3", "4", "5", "6", "7"].indexOf(e.key);
      if (idx >= 0 && VIEWS[idx]) {
        e.preventDefault();
        setView(VIEWS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totals = useMemo(() => computeTotals(balances, prices), [balances, prices]);
  void tick; // keep the dep alive — `tick` is referenced only via re-render trigger

  return (
    <div className="terminal-shell">
      {/* Outer terminal chrome */}
      <div className="terminal-window">
        {/* ===== Title bar ===== */}
        <header className="terminal-titlebar">
          <div className="flex items-center gap-2">
            <span className="traffic" style={{ background: "#ff5f57" }} />
            <span className="traffic" style={{ background: "#febc2e" }} />
            <span className="traffic" style={{ background: "#28c840" }} />
          </div>
          <div className="terminal-title">
            <span className="text-text-secondary">treasury@grid</span>
            <span className="text-text-secondary opacity-60">:~/</span>
            <span className="text-accent">{view}</span>
            <span className="cursor-blink text-accent">▍</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={sidebarOpen}
              className="lg:hidden font-mono text-[11px] text-text-secondary border border-border px-2 py-1 hover:text-accent hover:border-text-secondary"
            >
              {sidebarOpen ? "✕" : "☰"}
            </button>
            <Link
              href="/token"
              className="hidden sm:inline font-mono text-[11px] text-text-secondary hover:text-accent"
            >
              ← /token
            </Link>
          </div>
        </header>

        {/* ===== Body — sidebar + pane ===== */}
        <div className="terminal-body">
          {/* Sidebar */}
          <aside
            className={`terminal-sidebar ${sidebarOpen ? "terminal-sidebar-open" : ""}`}
          >
            <SidebarHeader />
            <nav className="flex flex-col gap-0.5 px-2">
              {VIEWS.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`group flex items-baseline gap-2 px-2 py-1.5 border-l-2 text-left transition-colors ${
                    view === v.id
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:border-border"
                  }`}
                >
                  <span className="font-mono text-[10px] text-text-secondary opacity-60 w-3">
                    {i + 1}
                  </span>
                  <span className="font-mono text-accent">$</span>
                  <span className="font-mono text-[13px] truncate flex-1">
                    {v.cmd}
                  </span>
                </button>
              ))}
            </nav>
            <SidebarFooter />
          </aside>

          {/* Main pane — fixed height, no page scroll. The pane-body
              scrolls for views without an internal scroll region, and
              specific views (claims, policy) take over the whole pane and
              scroll internally instead. */}
          <main className="terminal-pane" ref={paneRef} aria-live="polite">
            <CommandHeader view={VIEWS.find((v) => v.id === view)!} />
            {view === "claims" || view === "policy" ? (
              // Views with potentially-tall content take over the whole pane
              // and manage their own internal scrolling — no page scroll.
              <div className="pane-body-fixed flex-1 min-h-0 flex flex-col px-4 sm:px-6 pb-4">
                {view === "claims" && (
                  <ClaimsView claims={claims} prices={prices} />
                )}
                {view === "policy" && <PolicyView />}
              </div>
            ) : (
              <div className="pane-body px-4 sm:px-6 pb-10">
                {view === "status" && (
                  <StatusView totals={totals} balances={balances} claims={claims} />
                )}
                {view === "balances" && (
                  <BalancesView balances={balances} prices={prices} totals={totals} />
                )}
                {view === "allocations" && <AllocationsView />}
                {view === "wallet" && <WalletView balances={balances} />}
                {view === "help" && <HelpView />}
              </div>
            )}
          </main>
        </div>

        {/* ===== Status bar ===== */}
        <footer className="terminal-statusbar">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`round-full w-1.5 h-1.5 inline-block ${
                balances ? "bg-status-running pulse-glow" : "bg-status-error"
              }`}
              aria-hidden
            />
            <span className="text-text-primary">treasury</span>
            <span className="text-text-secondary opacity-60">·</span>
            <span className="text-text-secondary truncate">base · mainnet</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-text-secondary">
            <span>RPC:</span>
            <span className={balances ? "text-status-running" : "text-status-error"}>
              {balances ? "200 OK" : "ERR"}
            </span>
            <span className="opacity-40">|</span>
            <span>sync: {relativeTime(new Date(renderedAt).toISOString())}</span>
            <span className="opacity-40">|</span>
            <span>auto-refresh 5m</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary shrink-0">
            <span className="hidden md:inline opacity-60">press</span>
            <kbd className="terminal-kbd">1</kbd>
            <kbd className="terminal-kbd">…</kbd>
            <kbd className="terminal-kbd">7</kbd>
            <span className="hidden md:inline opacity-60">to switch</span>
          </div>
        </footer>
      </div>

      <TerminalStyles />
    </div>
  );
}

// ===========================================================================
// Sidebar bits
// ===========================================================================

function SidebarHeader() {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border">
      <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-1">
        $GRID treasury
      </div>
      <div className="font-mono text-[11px] text-text-primary leading-relaxed">
        Live, public, on-chain.
        <br />
        <span className="text-text-secondary">
          Doppler creator fees on {GRID_CHAIN}.
        </span>
      </div>
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto px-4 py-3 border-t border-border space-y-1.5">
      <Link
        href="/token"
        className="block font-mono text-[11px] text-text-secondary hover:text-accent"
      >
        ← $GRID token page
      </Link>
      <a
        href={BASESCAN_ADDRESS_URL(GRID_TREASURY_ADDRESS)}
        target="_blank"
        rel="noopener noreferrer"
        className="block font-mono text-[11px] text-text-secondary hover:text-accent"
      >
        BaseScan ↗
      </a>
      <Link
        href="/"
        className="block font-mono text-[11px] text-text-secondary hover:text-accent"
      >
        codegrid.app ↗
      </Link>
    </div>
  );
}

function CommandHeader({ view }: { view: ViewDef }) {
  return (
    <div className="cmd-header px-4 sm:px-6 pt-5 pb-3 border-b border-border bg-bg-secondary/30">
      <div className="flex items-baseline gap-2 font-mono text-sm">
        <span className="text-status-running">grid@treasury</span>
        <span className="text-text-secondary">:</span>
        <span className="text-status-idle">~</span>
        <span className="text-text-secondary">$</span>
        <span className="text-text-primary">{view.cmd}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-text-secondary">
        {view.desc}
      </div>
    </div>
  );
}

// ===========================================================================
// Views
// ===========================================================================

interface Totals {
  weth: number;
  grid: number;
  eth: number;
  wethUsd: number | null;
  gridUsd: number | null;
  ethUsd: number | null;
  totalUsd: number | null;
}

function computeTotals(
  balances: TreasuryBalances | null,
  prices: TreasuryPrices,
): Totals {
  const weth = balances ? fromWei(balances.wethWei) : 0;
  const grid = balances ? fromWei(balances.gridWei) : 0;
  const eth = balances ? fromWei(balances.ethWei) : 0;
  const wethUsd = prices.ethUsd !== null ? weth * prices.ethUsd : null;
  const ethUsd = prices.ethUsd !== null ? eth * prices.ethUsd : null;
  const gridUsd = prices.gridUsd !== null ? grid * prices.gridUsd : null;
  const totalUsd =
    wethUsd !== null && ethUsd !== null && gridUsd !== null
      ? wethUsd + ethUsd + gridUsd
      : null;
  return { weth, grid, eth, wethUsd, gridUsd, ethUsd, totalUsd };
}

function StatusView({
  totals,
  balances,
  claims,
}: {
  totals: Totals;
  balances: TreasuryBalances | null;
  claims: ClaimEvent[];
}) {
  const lastClaim = claims.find((c) => c.direction === "in");
  // Derive the indicator from real state instead of hardcoding it: healthy
  // when balances loaded from RPC, degraded when the RPC read failed. Only
  // surface "claiming" when there is at least one recent inbound claim. Keep
  // this consistent with the footer `RPC: 200 OK | ERR` state.
  const healthy = balances !== null;
  const statusNode = healthy ? (
    <span className="text-status-running">
      ● healthy{lastClaim ? " — claiming" : ""}
    </span>
  ) : (
    <span className="text-status-error">● degraded — RPC unreachable</span>
  );
  return (
    <div className="space-y-6 pt-6">
      <AsciiBox title="treasury status">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-8 font-mono text-[13px]">
          <Line k="chain" v={`${GRID_CHAIN} mainnet`} />
          <Line k="wallet" v={shortHash(GRID_TREASURY_ADDRESS, 10, 6)} />
          <Line k="status" v={statusNode} />
          <Line
            k="nonce"
            v={balances ? `${balances.nonce} tx out` : "—"}
          />
          <Line
            k="last claim"
            v={lastClaim ? relativeTime(lastClaim.timestamp) : "configure key"}
          />
          <Line k="claim cadence" v="monthly + on-demand" />
        </div>
      </AsciiBox>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border">
        <BigTile
          label="WETH"
          accent="#4a9eff"
          n={totals.weth}
          usd={totals.wethUsd}
          tag="money side"
        />
        <BigTile
          label="GRID"
          accent="#00c853"
          n={totals.grid}
          usd={totals.gridUsd}
          tag="token side"
        />
        <BigTile
          label="ETH"
          accent="#a855f7"
          n={totals.eth}
          usd={totals.ethUsd}
          tag="gas"
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3 px-1">
        <div className="font-mono text-sm">
          <span className="text-text-secondary">total value:</span>{" "}
          <span className="text-text-primary text-lg font-bold">
            {totals.totalUsd === null ? "—" : formatUsd(totals.totalUsd)}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-secondary">
          prices: coingecko + dexscreener · cached 5m
        </div>
      </div>

      <AsciiBox title="next actions">
        <ul className="font-mono text-[13px] text-text-primary space-y-1.5 list-none">
          <ActionLine>
            Press <Kbd>3</Kbd> to view recent claim transactions
          </ActionLine>
          <ActionLine>
            Press <Kbd>4</Kbd> to see how WETH and GRID fees are allocated
          </ActionLine>
          <ActionLine>
            Press <Kbd>5</Kbd> to read the full treasury policy
          </ActionLine>
        </ul>
      </AsciiBox>
    </div>
  );
}

function BalancesView({
  balances,
  prices,
  totals,
}: {
  balances: TreasuryBalances | null;
  prices: TreasuryPrices;
  totals: Totals;
}) {
  if (!balances) {
    return (
      <ErrorBlock>
        Could not reach Base RPC. Try refreshing or read the wallet directly on{" "}
        <a
          href={BASESCAN_ADDRESS_URL(GRID_TREASURY_ADDRESS)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          BaseScan
        </a>
        .
      </ErrorBlock>
    );
  }
  return (
    <div className="space-y-6 pt-6">
      <AsciiBox title="erc-20 holdings">
        <div className="font-mono text-[13px] space-y-1.5">
          <RowAsset
            sym="WETH"
            color="#4a9eff"
            n={totals.weth}
            usd={totals.wethUsd}
            note="from doppler pool · money side of every swap fee"
          />
          <RowAsset
            sym="GRID"
            color="#00c853"
            n={totals.grid}
            usd={totals.gridUsd}
            note="from doppler pool · not market-sold"
          />
          <RowAsset
            sym="ETH"
            color="#a855f7"
            n={totals.eth}
            usd={totals.ethUsd}
            note="native · used for gas only"
          />
        </div>
      </AsciiBox>

      <AsciiBox title="composition">
        <CompositionBar totals={totals} />
        <div className="mt-3 font-mono text-[11px] text-text-secondary">
          total ≈{" "}
          <span className="text-text-primary">
            {totals.totalUsd === null ? "—" : formatUsd(totals.totalUsd)}
          </span>
          {prices.gridUsd === null && " (GRID price unavailable — partial total)"}
        </div>
      </AsciiBox>

      <AsciiBox title="raw on-chain values">
        <div className="font-mono text-[11px] text-text-secondary space-y-1">
          <div>
            wethWei = <span className="text-text-primary">{balances.wethWei}</span>
          </div>
          <div>
            gridWei = <span className="text-text-primary">{balances.gridWei}</span>
          </div>
          <div>
            ethWei = <span className="text-text-primary">{balances.ethWei}</span>
          </div>
          <div>
            nonce = <span className="text-text-primary">{balances.nonce}</span>
          </div>
        </div>
      </AsciiBox>
    </div>
  );
}

/** USD price for a given claim's asset symbol. Returns null if unknown. */
function priceFor(
  sym: string,
  prices: TreasuryPrices,
): number | null {
  if (sym === "WETH") return prices.ethUsd; // WETH = wrapped ETH
  if (sym === "GRID") return prices.gridUsd;
  return null;
}

function ClaimsView({
  claims,
  prices,
}: {
  claims: ClaimEvent[];
  prices: TreasuryPrices;
}) {
  if (claims.length === 0) {
    return (
      <div className="pt-6">
        <AsciiBox title="claims --weth-grid">
          <div className="font-mono text-[13px] text-text-primary leading-relaxed">
            <div className="mb-3">
              <span className="text-status-waiting">$</span> no WETH / GRID
              transfers in range
            </div>
            <div className="text-text-secondary leading-relaxed">
              Either <code className="text-accent">ALCHEMY_API_KEY</code> is
              not configured, the wallet has no qualifying transfers, or
              they&apos;re older than the indexed window. Every transaction is
              visible on{" "}
              <a
                href={BASESCAN_ADDRESS_URL(GRID_TREASURY_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                BaseScan ↗
              </a>
              .
            </div>
          </div>
        </AsciiBox>
      </div>
    );
  }

  const totals = claims.reduce(
    (acc, c) => {
      const k = c.token as "WETH" | "GRID";
      const slot = acc[k] ?? { in: 0, out: 0 };
      slot[c.direction] += c.amount;
      acc[k] = slot;
      return acc;
    },
    {} as Record<"WETH" | "GRID", { in: number; out: number }>,
  );

  // Sum USD across the window for the strip below the cards.
  const totalsUsd = (["WETH", "GRID"] as const).reduce(
    (acc, sym) => {
      const px = priceFor(sym, prices);
      const t = totals[sym];
      if (!t || px === null) return acc;
      acc.in += t.in * px;
      acc.out += t.out * px;
      return acc;
    },
    { in: 0, out: 0 },
  );
  const totalsUsdAvailable =
    prices.ethUsd !== null && prices.gridUsd !== null;

  return (
    <div className="pt-6 view-flex">
      {/* Totals row — sticky context above the scrolling table */}
      <AsciiBox title="totals (in window)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-[13px]">
          {(["WETH", "GRID"] as const).map((sym) => {
            const t = totals[sym] ?? { in: 0, out: 0 };
            const net = t.in - t.out;
            const color = sym === "WETH" ? "#4a9eff" : "#00c853";
            const px = priceFor(sym, prices);
            const netUsd = px !== null ? net * px : null;
            const inUsd = px !== null ? t.in * px : null;
            const outUsd = px !== null ? t.out * px : null;
            return (
              <div
                key={sym}
                className="border border-border bg-bg-secondary/40 p-3"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="font-bold text-[12px] tracking-wider"
                    style={{ color }}
                  >
                    {sym}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-text-secondary">
                    net {net >= 0 ? "+" : ""}
                    {formatAmount(net)}{" "}
                    {netUsd !== null && (
                      <span className="text-text-primary normal-case">
                        ({netUsd >= 0 ? "+" : "-"}
                        {formatUsd(Math.abs(netUsd))})
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="text-status-running">
                    ← claimed {formatAmount(t.in)}
                    {inUsd !== null && (
                      <span className="block text-text-secondary text-[10px]">
                        ≈ {formatUsd(inUsd)}
                      </span>
                    )}
                  </div>
                  <div className="text-text-secondary">
                    → sent {formatAmount(t.out)}
                    {outUsd !== null && (
                      <span className="block text-text-secondary text-[10px] opacity-70">
                        ≈ {formatUsd(outUsd)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {totalsUsdAvailable && (
          <div className="mt-3 pt-2 border-t border-border flex justify-between font-mono text-[11px]">
            <span className="text-text-secondary">total USD value moved</span>
            <span className="text-text-primary tabular-nums">
              <span className="text-status-running">
                ← {formatUsd(totalsUsd.in)}
              </span>{" "}
              <span className="opacity-40">·</span>{" "}
              <span className="text-text-secondary">
                → {formatUsd(totalsUsd.out)}
              </span>
            </span>
          </div>
        )}
      </AsciiBox>

      <div className="view-grow min-h-0 mt-4">
        <ClaimsTable claims={claims} prices={prices} />
      </div>
    </div>
  );
}

/**
 * TanStack Table — sortable columns, sticky header, scroll inside the box.
 * Every row link goes to BaseScan for the tx hash.
 */
function ClaimsTable({
  claims,
  prices,
}: {
  claims: ClaimEvent[];
  prices: TreasuryPrices;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "timestamp", desc: true },
  ]);

  const cols = useMemo<ColumnDef<ClaimEvent, unknown>[]>(() => {
    const ch = createColumnHelper<ClaimEvent>();
    return ([
      ch.accessor("direction", {
        id: "direction",
        header: "Type",
        size: 80,
        cell: (info) => {
          const isIn = info.getValue() === "in";
          return (
            <span
              className={`font-mono text-[10px] uppercase tracking-widest font-bold ${
                isIn ? "text-status-running" : "text-text-secondary"
              }`}
            >
              {isIn ? "← claim" : "→ send"}
            </span>
          );
        },
      }),
      ch.accessor("token", {
        id: "token",
        header: "Asset",
        size: 64,
        cell: (info) => {
          const sym = info.getValue();
          const color = sym === "WETH" ? "#4a9eff" : "#00c853";
          return (
            <span
              className="font-mono text-[11px] font-bold"
              style={{ color }}
            >
              {sym}
            </span>
          );
        },
      }),
      ch.accessor("amount", {
        id: "amount",
        header: "Amount",
        size: 140,
        cell: (info) => {
          const c = info.row.original;
          const isIn = c.direction === "in";
          return (
            <span className="font-mono text-[12px] text-text-primary tabular-nums">
              {isIn ? "+" : "-"}
              {formatAmount(info.getValue())}
            </span>
          );
        },
      }),
      ch.display({
        id: "usd",
        header: "USD",
        size: 110,
        cell: ({ row }) => {
          const c = row.original;
          const px = priceFor(c.token, prices);
          if (px === null) {
            return (
              <span className="font-mono text-[11px] text-text-secondary opacity-50">
                —
              </span>
            );
          }
          const usd = c.amount * px;
          const isIn = c.direction === "in";
          return (
            <span
              className={`font-mono text-[11px] tabular-nums ${
                isIn ? "text-status-running" : "text-text-secondary"
              }`}
              title={`@ ${formatUsd(px)} / ${c.token}`}
            >
              {isIn ? "+" : "-"}
              {formatUsd(usd)}
            </span>
          );
        },
      }),
      ch.accessor("counterparty", {
        id: "counterparty",
        header: "Counterparty",
        size: 220,
        cell: (info) => {
          const c = info.row.original;
          return (
            <span className="font-mono text-[11px] text-text-secondary">
              {c.direction === "in" ? "from " : "to "}
              <a
                href={BASESCAN_ADDRESS_URL(info.getValue())}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-text-primary hover:text-accent"
                title={info.getValue()}
              >
                {shortHash(info.getValue(), 6, 4)}
              </a>
            </span>
          );
        },
      }),
      ch.accessor("timestamp", {
        id: "timestamp",
        header: "When",
        size: 110,
        cell: (info) => (
          <span
            className="font-mono text-[11px] text-text-secondary"
            title={new Date(info.getValue()).toLocaleString()}
          >
            {relativeTime(info.getValue())}
          </span>
        ),
        sortingFn: (a, b) =>
          new Date(a.getValue<string>("timestamp")).getTime() -
          new Date(b.getValue<string>("timestamp")).getTime(),
      }),
      ch.accessor("hash", {
        id: "hash",
        header: "Tx",
        size: 100,
        enableSorting: false,
        cell: (info) => (
          <a
            href={BASESCAN_TX_URL(info.getValue())}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-text-secondary hover:text-accent"
          >
            {shortHash(info.getValue(), 4, 4)} ↗
          </a>
        ),
      }),
    ] as ColumnDef<ClaimEvent, unknown>[]);
  }, [prices]);

  const table = useReactTable({
    data: claims,
    columns: cols,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Stable, composite row id — kills the duplicate-key warning even for
    // transactions with multiple log entries.
    getRowId: (row, i) => `${row.hash}-${row.token}-${row.direction}-${i}`,
  });

  return (
    <section className="border border-border bg-bg-secondary/30 flex flex-col h-full min-h-0">
      <header className="flex items-baseline gap-2 px-4 py-2 border-b border-border bg-bg-secondary/60 shrink-0">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
          ┌─
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-text-primary">
          $ claims --weth-grid · {claims.length} rows
        </span>
        <span className="ml-auto font-mono text-[10px] text-text-secondary opacity-60">
          click headers to sort · click hash for tx
        </span>
      </header>

      {/* The ONLY scroll region in this view */}
      <div className="claims-scroll flex-1 min-h-0 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-secondary/95 backdrop-blur-sm">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sortDir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-text-secondary"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-accent transition-colors"
                        >
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext(),
                          )}
                          <span className="text-accent opacity-70 w-2 inline-block">
                            {sortDir === "asc"
                              ? "↑"
                              : sortDir === "desc"
                                ? "↓"
                                : ""}
                          </span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border last:border-b-0 hover:bg-bg-secondary/40 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AllocationsView() {
  return (
    <div className="space-y-6 pt-6">
      <AsciiBox title="WETH → operating budget" accent="#4a9eff">
        <Allocation
          pct={60}
          label="CodeGrid development"
          note="engineering, design, infra, distribution"
        />
        <Allocation
          pct={25}
          label="Community rewards"
          note="recurring contests · creator grants · builder bounties"
        />
        <Allocation
          pct={15}
          label="Runway reserve"
          note="≥ 12 months held in WETH / stables"
        />
        <div className="font-mono text-[10px] text-text-secondary opacity-60 mt-3 pt-3 border-t border-border">
          % shown are target priorities, not fixed allocations. Actual spend is
          claim-log transparent.
        </div>
      </AsciiBox>

      <AsciiBox title="GRID → long-term hold (not market-sold)" accent="#00c853">
        <div className="font-mono text-[13px] text-text-primary">
          No committed allocation.
        </div>
        <div className="font-mono text-[11px] text-text-secondary mt-1 leading-relaxed">
          The treasury holds its own GRID for the long term. We&apos;re not
          earmarking it for specific programs we haven&apos;t built yet — any
          future use will be announced on-chain before deployment.
        </div>
        <div className="font-mono text-[10px] text-text-secondary opacity-60 mt-3 pt-3 border-t border-border">
          GRID is never market-sold from the treasury.
        </div>
      </AsciiBox>
    </div>
  );
}

function PolicyView() {
  return (
    <div className="pt-6 view-flex max-w-3xl w-full">
      <section className="border border-border bg-bg-secondary/30 flex flex-col h-full min-h-0">
        <header className="flex items-baseline gap-2 px-4 py-2 border-b border-border bg-bg-secondary/60 shrink-0">
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
            ┌─
          </span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-primary">
            POLICY.md
          </span>
          <span className="ml-auto font-mono text-[10px] text-text-secondary opacity-60">
            scroll inside · last updated 2026-05-28
          </span>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 claims-scroll">
        <div className="font-mono text-[13px] text-text-primary leading-relaxed space-y-4">
          <p>
            <span className="text-text-secondary"># </span>
            <span className="text-accent">$GRID Treasury Policy</span>
          </p>
          <p className="text-text-secondary">
            Plain-language policy for creator fees that accrue on the $GRID
            Doppler pool — how they&apos;re claimed, where they go, and the
            commitments around the public treasury wallet.
          </p>

          <Heading n={2}>The basics</Heading>
          <Kvs
            rows={[
              ["token", "$GRID on Base"],
              ["pool", "Doppler (Uniswap v4), 0.7% fee"],
              ["fees accrue in", "WETH + GRID"],
              ["who claims", "ZipLyne LLC (creator)"],
              ["cadence", "monthly + on-demand"],
              [
                "treasury wallet",
                shortHash(GRID_TREASURY_ADDRESS, 10, 6) + " (public)",
              ],
            ]}
          />

          <Heading n={2}>WETH fees → development &amp; community</Heading>
          <ol className="list-decimal list-inside space-y-1 marker:text-text-secondary">
            <li>CodeGrid development (engineering, design, infra)</li>
            <li>
              Community rewards (recurring contests, creator grants, bounties)
            </li>
            <li>Runway reserve — ≥ 12 months in WETH / stables</li>
          </ol>

          <Heading n={2}>GRID fees → not market-sold</Heading>
          <ul className="list-disc list-inside space-y-1 marker:text-text-secondary">
            <li>
              <span className="text-text-primary">Premium-feature staking</span>{" "}
              — hold/stake $GRID to unlock CodeGrid premium features.
            </li>
            <li>
              <span className="text-text-primary">
                OpenClaw / Bankr integration bounties
              </span>{" "}
              — paid in GRID to authors of skills, MCP servers, integrations.
            </li>
            <li>
              Future ecosystem programs — announced{" "}
              <span className="text-text-primary">before</span> deployment.
            </li>
          </ul>

          <Heading n={2}>Transparency commitments</Heading>
          <ul className="list-disc list-inside space-y-1 marker:text-text-secondary">
            <li>Named, single treasury wallet (this page).</li>
            <li>Live dashboard with balance + claim transactions.</li>
            <li>Public log of every GRID deployment.</li>
            <li>
              No off-chain promises — everything that affects holders is posted
              on-chain or in a permanent public post.
            </li>
          </ul>

          <Heading n={2}>Disclaimer</Heading>
          <p className="text-text-secondary leading-relaxed">
            Not financial, legal, or tax advice. Holding $GRID does not
            entitle anyone to a share of revenue, profits, governance, or any
            return. Anything resembling buyback, price support, or
            distributions will get professional review before it ships.
          </p>
        </div>
        </div>
      </section>
    </div>
  );
}

function WalletView({ balances }: { balances: TreasuryBalances | null }) {
  return (
    <div className="space-y-6 pt-6">
      <AsciiBox title="treasury wallet">
        <div className="font-mono text-[13px] space-y-2">
          <Line k="address" v={
            <a
              href={BASESCAN_ADDRESS_URL(GRID_TREASURY_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline break-all"
            >
              {GRID_TREASURY_ADDRESS}
            </a>
          } />
          <Line k="chain" v={`${GRID_CHAIN} mainnet (chainId 8453)`} />
          <Line
            k="role"
            v="receives Doppler creator fees · operating treasury"
          />
          <Line
            k="signing"
            v="ZipLyne LLC · claims via Bankr platform"
          />
          {balances && (
            <Line
              k="activity"
              v={`${balances.nonce} outgoing tx · readable via public RPC`}
            />
          )}
        </div>
      </AsciiBox>

      <AsciiBox title="$GRID contract">
        <div className="font-mono text-[13px] space-y-2">
          <Line
            k="address"
            v={
              <a
                href={`https://basescan.org/token/${GRID_TOKEN_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline break-all"
              >
                {GRID_TOKEN_ADDRESS}
              </a>
            }
          />
          <Line k="verify" v="always confirm the address ends in …4311ba3" />
          <Line k="standard" v="ERC-20 · 18 decimals" />
          <Line k="launchpad" v="Doppler (Uniswap v4) via Bankr" />
        </div>
      </AsciiBox>

      <AsciiBox title="external explorers">
        <div className="font-mono text-[13px] space-y-1.5">
          <ExtLink
            href={BASESCAN_ADDRESS_URL(GRID_TREASURY_ADDRESS)}
            label="BaseScan — treasury wallet"
          />
          <ExtLink
            href={`https://basescan.org/token/${GRID_TOKEN_ADDRESS}?a=${GRID_TREASURY_ADDRESS}`}
            label="BaseScan — treasury $GRID transfers"
          />
          <ExtLink
            href={`https://basescan.org/token/${GRID_TOKEN_ADDRESS}`}
            label="BaseScan — $GRID contract"
          />
          <ExtLink
            href={`https://bankr.bot/launches/${GRID_TOKEN_ADDRESS}`}
            label="Bankr — launch details"
          />
          <ExtLink
            href={`https://dexscreener.com/base/${GRID_TOKEN_ADDRESS}`}
            label="DexScreener — live chart"
          />
        </div>
      </AsciiBox>
    </div>
  );
}

function HelpView() {
  return (
    <div className="pt-6 space-y-6">
      <AsciiBox title="commands">
        <div className="font-mono text-[13px] space-y-1.5">
          {VIEWS.map((v, i) => (
            <div key={v.id} className="grid grid-cols-[2rem_1fr_2fr] gap-3">
              <Kbd>{i + 1}</Kbd>
              <span className="text-accent">$ {v.cmd}</span>
              <span className="text-text-secondary">{v.desc}</span>
            </div>
          ))}
        </div>
      </AsciiBox>

      <AsciiBox title="data sources">
        <div className="font-mono text-[12px] text-text-secondary leading-relaxed space-y-1">
          <div>
            <span className="text-text-primary">balances</span> · public Base
            RPC (mainnet.base.org) — no key required
          </div>
          <div>
            <span className="text-text-primary">ETH price</span> · CoinGecko
            public API
          </div>
          <div>
            <span className="text-text-primary">GRID price</span> · DexScreener
            (canonical pair)
          </div>
          <div>
            <span className="text-text-primary">claim history</span> · Alchemy
            `alchemy_getAssetTransfers` on Base (read-only key)
          </div>
          <div className="pt-2 text-text-secondary opacity-60">
            cache: 5 minutes (ISR). no client-side polling. all reads are
            public and verifiable independently.
          </div>
        </div>
      </AsciiBox>
    </div>
  );
}

// ===========================================================================
// Primitives
// ===========================================================================

function AsciiBox({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section className="border border-border bg-bg-secondary/30">
      <header
        className="flex items-baseline gap-2 px-4 py-2 border-b border-border bg-bg-secondary/60"
        style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
          ┌─
        </span>
        <span
          className="font-mono text-[11px] uppercase tracking-widest"
          style={{ color: accent ?? "var(--text-primary)" }}
        >
          {title}
        </span>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-text-secondary min-w-[6.5rem]">{k}</span>
      <span className="text-text-primary truncate">{v}</span>
    </div>
  );
}

function BigTile({
  label,
  accent,
  n,
  usd,
  tag,
}: {
  label: string;
  accent: string;
  n: number;
  usd: number | null;
  tag: string;
}) {
  return (
    <div className="bg-bg-primary p-5 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-sm font-bold tracking-wider"
          style={{ color: accent }}
        >
          {label}
        </span>
        <span
          className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 border"
          style={{ color: accent, borderColor: accent + "55" }}
        >
          {tag}
        </span>
      </div>
      <div className="font-mono text-2xl font-bold text-text-primary tabular-nums truncate">
        {formatAmount(n)}
      </div>
      <div className="font-mono text-[11px] text-text-secondary tabular-nums">
        {usd === null ? "—" : `${formatUsd(usd)} USD`}
      </div>
    </div>
  );
}

function RowAsset({
  sym,
  color,
  n,
  usd,
  note,
}: {
  sym: string;
  color: string;
  n: number;
  usd: number | null;
  note: string;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1 border-b border-border last:border-b-0">
      <span
        className="font-bold w-14 tabular-nums"
        style={{ color }}
      >
        {sym}
      </span>
      <span className="text-text-primary tabular-nums w-32">
        {formatAmount(n)}
      </span>
      <span className="text-text-secondary tabular-nums w-24">
        {usd === null ? "—" : formatUsd(usd)}
      </span>
      <span className="text-text-secondary text-[11px] truncate flex-1">
        {note}
      </span>
    </div>
  );
}

function CompositionBar({ totals }: { totals: Totals }) {
  const parts = [
    { sym: "WETH", color: "#4a9eff", usd: totals.wethUsd ?? 0 },
    { sym: "GRID", color: "#00c853", usd: totals.gridUsd ?? 0 },
    { sym: "ETH", color: "#a855f7", usd: totals.ethUsd ?? 0 },
  ];
  const sum = parts.reduce((s, p) => s + p.usd, 0);
  if (sum === 0) {
    return (
      <div className="font-mono text-[11px] text-text-secondary">
        composition unavailable — prices missing
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-3 w-full border border-border overflow-hidden">
        {parts.map((p) => (
          <div
            key={p.sym}
            style={{
              width: `${(p.usd / sum) * 100}%`,
              background: p.color,
            }}
            title={`${p.sym} ${((p.usd / sum) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
        {parts.map((p) => (
          <div key={p.sym} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 inline-block"
              style={{ background: p.color }}
              aria-hidden
            />
            <span style={{ color: p.color }}>{p.sym}</span>
            <span className="text-text-secondary">
              {((p.usd / sum) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Allocation({
  pct,
  label,
  note,
}: {
  pct: number;
  label: string;
  note: string;
}) {
  const cells = 24;
  const filled = Math.round((pct / 100) * cells);
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between font-mono text-[13px]">
        <span className="text-text-primary">{label}</span>
        <span className="text-text-secondary tabular-nums">
          {pct}% <span className="opacity-50">target</span>
        </span>
      </div>
      <div className="font-mono text-[11px] text-text-secondary mt-0.5">
        <span className="text-accent">[</span>
        <span className="text-accent">{"█".repeat(filled)}</span>
        <span className="text-text-secondary opacity-30">
          {"░".repeat(cells - filled)}
        </span>
        <span className="text-accent">]</span>{" "}
        <span className="ml-1">{note}</span>
      </div>
    </div>
  );
}

function Kvs({ rows }: { rows: [string, string][] }) {
  return (
    <div className="border border-border">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-[8rem_1fr] gap-2 px-3 py-1.5 border-b border-border last:border-b-0 font-mono text-[12px]"
        >
          <span className="text-text-secondary">{k}</span>
          <span className="text-text-primary">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Heading({ n, children }: { n: 2 | 3; children: React.ReactNode }) {
  const hashes = n === 2 ? "##" : "###";
  return (
    <p className="pt-2">
      <span className="text-text-secondary">{hashes} </span>
      <span className="text-text-primary font-bold">{children}</span>
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="terminal-kbd">{children}</kbd>;
}

function ActionLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="text-accent">›</span>
      <span>{children}</span>
    </li>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block text-accent hover:underline"
    >
      → {label}
    </a>
  );
}

function ErrorBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-6">
      <div className="border border-status-error/40 bg-status-error/5 p-4 font-mono text-[13px] text-text-primary">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-status-error">●</span>
          <span className="text-status-error uppercase tracking-widest text-[10px]">
            error
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

// ===========================================================================
// Inline styles for the terminal shell (kept colocated so the experience is
// self-contained and easy to tweak).
// ===========================================================================

function TerminalStyles() {
  return (
    <style>{`
      .terminal-shell {
        height: 100dvh;
        width: 100%;
        padding: 16px;
        background: var(--bg-primary);
        display: flex;
      }
      @media (max-width: 640px) { .terminal-shell { padding: 0; } }

      .terminal-window {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        background: var(--bg-primary);
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.02),
          0 30px 80px -20px rgba(0,0,0,0.6),
          0 0 60px -20px rgba(255,140,0,0.08);
        overflow: hidden;
      }

      .terminal-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: linear-gradient(180deg, #181818 0%, #121212 100%);
        border-bottom: 1px solid var(--border);
      }
      .traffic {
        display: inline-block;
        width: 10px; height: 10px;
        border-radius: 9999px;
        box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.4);
      }
      .terminal-title {
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.02em;
        opacity: 0.9;
        text-align: center;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .terminal-body {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: row;
      }
      .terminal-sidebar {
        display: none;
        flex-direction: column;
        width: 15rem;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        background: linear-gradient(180deg, #0e0e0e 0%, #0a0a0a 100%);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      @media (min-width: 1024px) {
        .terminal-sidebar { display: flex; }
      }
      .terminal-sidebar-open {
        display: flex !important;
        position: absolute;
        inset: 49px 0 28px 0;
        z-index: 20;
        width: 100%;
        max-width: 18rem;
      }

      .terminal-pane {
        flex: 1 1 0%;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;            /* never scrolls — children handle it */
      }
      /* The header bar inside each pane (command line + desc) stays pinned. */
      .terminal-pane > .cmd-header { flex-shrink: 0; }
      /* The body of each view scrolls internally if needed. */
      .pane-body {
        flex: 1 1 0%;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      /* Helpers for views that want to lay out a fixed header + a growing
         table region whose body alone scrolls. */
      .view-flex {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .view-grow {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      /* The claims-table inner scroll. */
      .claims-scroll { scrollbar-gutter: stable; }

      .terminal-statusbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.4rem 0.75rem;
        font-family: var(--font-mono);
        font-size: 11px;
        border-top: 1px solid var(--border);
        background: linear-gradient(180deg, #121212 0%, #0c0c0c 100%);
      }

      .terminal-kbd {
        font-family: var(--font-mono);
        font-size: 10px;
        padding: 1px 5px;
        border: 1px solid var(--border);
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        border-radius: 2px;
        line-height: 1.2;
      }
    `}</style>
  );
}
