/**
 * Treasury data layer — server-side reads of the public $GRID treasury wallet.
 *
 * Pure public-data reads. No private keys, no signing, no secrets. The only
 * (optional) credential is a free BaseScan API key for richer transfer history;
 * when absent, the dashboard still renders balance + USD value.
 *
 * Designed to be called from React Server Components. Cached via Next's ISR
 * (`revalidate` in the page) — typical cadence ~5 minutes.
 */

import {
  GRID_TOKEN_ADDRESS,
  GRID_TREASURY_ADDRESS,
  WETH_BASE_ADDRESS,
} from "./token";

/**
 * Base RPC endpoints, tried in order. A single public endpoint flapping was
 * the root cause of intermittent "RPC unreachable": one slow/rate-limited call
 * would reject the whole render. We now try a configured/Alchemy endpoint first
 * (when available), then fall back across several public endpoints.
 *
 * `BASE_RPC_URL` (if set) takes priority. Alchemy is included automatically
 * when `ALCHEMY_API_KEY` is present — it's far more reliable than the public
 * endpoints.
 */
const PUBLIC_BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

/** Per-call request timeout (ms). Without this, a hung socket stalls render. */
const RPC_TIMEOUT_MS = 6000;
/** Attempts per endpoint before moving to the next one. */
const RPC_ATTEMPTS_PER_ENDPOINT = 2;

/**
 * Alchemy Base mainnet endpoint. The API key in env is read-only — it
 * cannot sign or move funds. Used for `alchemy_getAssetTransfers` to power
 * the claim-history feed.
 *
 * When unset, `getRecentClaims` returns `[]` and the dashboard gracefully
 * renders an "configure key" empty state.
 */
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY?.trim() || "";
const ALCHEMY_BASE_URL = ALCHEMY_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : "";

/** Block explorer URLs (public). */
export const BASESCAN_ADDRESS_URL = (addr: string) =>
  `https://basescan.org/address/${addr}`;
export const BASESCAN_TX_URL = (hash: string) =>
  `https://basescan.org/tx/${hash}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreasuryBalances {
  /** Native ETH on Base, in wei as a bigint-string (JSON-safe). */
  ethWei: string;
  /** WETH ERC-20 balance, raw wei (string). */
  wethWei: string;
  /** $GRID ERC-20 balance, raw wei (string). */
  gridWei: string;
  /** Outgoing nonce — proxy for "has the wallet done anything yet". */
  nonce: number;
  /** Timestamp of this snapshot (ms). */
  fetchedAt: number;
}

export interface TreasuryPrices {
  /** ETH/USD spot. */
  ethUsd: number | null;
  /** GRID/USD spot. */
  gridUsd: number | null;
  /** Source attribution shown in the footer. */
  source: string;
}

export interface ClaimEvent {
  /** Transaction hash. */
  hash: string;
  /** Block timestamp (ISO). */
  timestamp: string;
  /** Token symbol — "WETH" | "GRID" | "ETH" | other ERC-20s. */
  token: string;
  /** Token contract address (or null for native ETH). */
  tokenAddress: string | null;
  /** Amount in display units (already divided by 10^decimals). */
  amount: number;
  /** "in" (received) | "out" (sent). */
  direction: "in" | "out";
  /** Counterparty address. */
  counterparty: string;
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers (no extra deps)
// ---------------------------------------------------------------------------

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

/** Ordered list of endpoints: env override → Alchemy → public fallbacks. */
function baseRpcEndpoints(): string[] {
  const endpoints: string[] = [];
  const override = process.env.BASE_RPC_URL?.trim();
  if (override) endpoints.push(override);
  if (ALCHEMY_BASE_URL) endpoints.push(ALCHEMY_BASE_URL);
  for (const url of PUBLIC_BASE_RPCS) {
    if (!endpoints.includes(url)) endpoints.push(url);
  }
  return endpoints;
}

/** One JSON-RPC POST with an AbortController timeout. Throws on any failure. */
async function rpcOnce<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      // ISR handles caching at the page level; no per-call caching.
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    if (json.result === undefined)
      throw new Error(`RPC ${method}: empty result`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resilient JSON-RPC call. Retries each endpoint a couple of times (with a
 * small backoff), then fails over to the next endpoint. Only throws if every
 * endpoint is exhausted — so a single flaky public RPC no longer flips the
 * treasury page to "RPC unreachable".
 */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const endpoints = baseRpcEndpoints();
  let lastErr: unknown;
  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= RPC_ATTEMPTS_PER_ENDPOINT; attempt++) {
      try {
        return await rpcOnce<T>(endpoint, method, params);
      } catch (err) {
        lastErr = err;
        // Brief backoff before retrying the same endpoint (not before failover).
        if (attempt < RPC_ATTEMPTS_PER_ENDPOINT) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }
    }
  }
  throw new Error(
    `RPC ${method} failed across ${endpoints.length} endpoint(s): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** Encodes `balanceOf(address)` calldata for an ERC-20. */
function encodeBalanceOf(addr: string): string {
  const cleaned = addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return "0x70a08231" + cleaned;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read native ETH + WETH + GRID balances of the treasury wallet from a public
 * Base RPC. No API key required. Throws if the RPC is unreachable.
 */
export async function getTreasuryBalances(): Promise<TreasuryBalances> {
  const [ethHex, wethHex, gridHex, nonceHex] = await Promise.all([
    rpc<string>("eth_getBalance", [GRID_TREASURY_ADDRESS, "latest"]),
    rpc<string>("eth_call", [
      { to: WETH_BASE_ADDRESS, data: encodeBalanceOf(GRID_TREASURY_ADDRESS) },
      "latest",
    ]),
    rpc<string>("eth_call", [
      { to: GRID_TOKEN_ADDRESS, data: encodeBalanceOf(GRID_TREASURY_ADDRESS) },
      "latest",
    ]),
    rpc<string>("eth_getTransactionCount", [GRID_TREASURY_ADDRESS, "latest"]),
  ]);

  return {
    ethWei: hexToBigInt(ethHex).toString(),
    wethWei: hexToBigInt(wethHex).toString(),
    gridWei: hexToBigInt(gridHex).toString(),
    nonce: Number(hexToBigInt(nonceHex)),
    fetchedAt: Date.now(),
  };
}

/**
 * Fetch ETH/USD and GRID/USD spot prices.
 * - ETH/USD via CoinGecko's public no-key endpoint.
 * - GRID/USD via DexScreener (no key, pulls from the canonical pair).
 *
 * Returns `null` for either field on failure rather than throwing — price is
 * a "nice to have" overlay, balances should still render.
 */
export async function getTreasuryPrices(): Promise<TreasuryPrices> {
  const ethPromise = fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) },
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { ethereum?: { usd?: number } } | null) =>
      typeof j?.ethereum?.usd === "number" ? j.ethereum.usd : null,
    )
    .catch(() => null);

  const gridPromise = fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${GRID_TOKEN_ADDRESS}`,
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) },
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { pairs?: { priceUsd?: string }[] } | null) => {
      const usd = j?.pairs?.[0]?.priceUsd;
      const n = usd ? Number(usd) : NaN;
      return Number.isFinite(n) ? n : null;
    })
    .catch(() => null);

  const [ethUsd, gridUsd] = await Promise.all([ethPromise, gridPromise]);
  return { ethUsd, gridUsd, source: "CoinGecko + DexScreener" };
}

// ---------------------------------------------------------------------------
// Alchemy — claim history feed
// ---------------------------------------------------------------------------

interface AlchemyTransfer {
  hash: string;
  blockNum: string;
  from: string | null;
  to: string | null;
  /** Display-unit value (already divided), or null for very small / unknown. */
  value: number | null;
  /** Token symbol (e.g. "WETH", "GRID"). Null for unknown ERC-20s. */
  asset: string | null;
  category: string;
  rawContract?: { address: string | null; decimal: string | null };
  metadata?: { blockTimestamp: string };
}

interface AlchemyTransfersResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { transfers: AlchemyTransfer[]; pageKey?: string };
  error?: { code: number; message: string };
}

/**
 * Fetch recent transfers in + out of the treasury via Alchemy. Combines both
 * directions, sorts by block desc, returns up to `limit`. Returns `[]` if no
 * Alchemy key is configured or the request fails — the dashboard still
 * renders gracefully without this section.
 *
 * Filtered to category=["erc20","external"] so we capture WETH/GRID claim
 * transfers and native-ETH movements. We list whatever shows up — including
 * any unrelated tokens — for transparency. The UI can highlight WETH/GRID.
 */
export async function getRecentClaims(limit = 15): Promise<ClaimEvent[]> {
  if (!ALCHEMY_BASE_URL) return [];

  const fetchSide = async (
    side: "to" | "from",
  ): Promise<AlchemyTransfer[]> => {
    const params: Record<string, unknown> = {
      fromBlock: "0x0",
      toBlock: "latest",
      category: ["erc20", "external"],
      withMetadata: true,
      order: "desc",
      maxCount: `0x${Math.min(Math.max(limit * 2, 10), 1000).toString(16)}`,
    };
    if (side === "to") params.toAddress = GRID_TREASURY_ADDRESS;
    else params.fromAddress = GRID_TREASURY_ADDRESS;

    try {
      const res = await fetch(ALCHEMY_BASE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as AlchemyTransfersResponse;
      if (json.error || !json.result) return [];
      return json.result.transfers;
    } catch {
      return [];
    }
  };

  const [incoming, outgoing] = await Promise.all([
    fetchSide("to"),
    fetchSide("from"),
  ]);

  const me = GRID_TREASURY_ADDRESS.toLowerCase();
  const all = [...incoming, ...outgoing];

  /**
   * Filter to the two tokens we actually care about. The treasury wallet may
   * also receive unrelated tokens (random airdrops, mistaken sends, etc.) —
   * showing those in the public claim log would be misleading and noisy, so
   * we whitelist by symbol AND verify the contract address matches the
   * canonical $GRID / WETH on Base.
   */
  const WETH = WETH_BASE_ADDRESS.toLowerCase();
  const GRID = GRID_TOKEN_ADDRESS.toLowerCase();
  const isCanonical = (t: AlchemyTransfer): "WETH" | "GRID" | null => {
    const addr = (t.rawContract?.address ?? "").toLowerCase();
    const sym = (t.asset ?? "").toUpperCase();
    if (addr === WETH && sym === "WETH") return "WETH";
    if (addr === GRID && sym === "GRID") return "GRID";
    return null;
  };

  const mapped: ClaimEvent[] = all
    .map((t): ClaimEvent | null => {
      const canon = isCanonical(t);
      if (!canon) return null;
      const isIn = (t.to ?? "").toLowerCase() === me;
      const counterparty = (isIn ? t.from : t.to) ?? "0x0";
      const amount = typeof t.value === "number" ? t.value : 0;
      if (amount <= 0) return null;
      return {
        hash: t.hash,
        timestamp: t.metadata?.blockTimestamp ?? new Date(0).toISOString(),
        token: canon,
        tokenAddress: t.rawContract?.address ?? null,
        amount,
        direction: isIn ? "in" : "out",
        counterparty,
      };
    })
    .filter((x): x is ClaimEvent => x !== null);

  // Dedup by (hash + token + direction) — Alchemy can occasionally surface
  // the same logical transfer twice (once per direction query).
  const seen = new Set<string>();
  const deduped = mapped.filter((x) => {
    const k = `${x.hash}|${x.token}|${x.direction}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort by timestamp desc.
  deduped.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return deduped.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Convert raw wei (string) to a decimal number with the given precision. */
export function fromWei(wei: string, decimals = 18): number {
  if (!wei || wei === "0") return 0;
  const big = BigInt(wei);
  // Two-step to avoid precision loss for very large values.
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(big / divisor);
  const frac = Number(big % divisor) / Number(divisor);
  return whole + frac;
}

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdFmtSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
export function formatUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n >= 1000 ? usdFmt.format(n) : usdFmtSmall.format(n);
}

const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const numFmtLarge = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? numFmtLarge.format(n) : numFmt.format(n);
}

export function shortHash(hex: string, lead = 6, tail = 4): string {
  if (hex.length <= lead + tail + 2) return hex;
  return `${hex.slice(0, lead + 2)}…${hex.slice(-tail)}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
