/**
 * $GRID token — single source of truth for the contract address and every
 * external listing / explorer / trading link. Used by the hero token pill,
 * the dedicated /token page, and the docs token page.
 */

/** ERC-20 contract address on Base (the canonical token address). */
export const GRID_TOKEN_ADDRESS = "0x6B456E66524aEC1792013eF9DFE87e3F84311ba3";

/** Liquidity pair / pool address on Base (used by pair-explorer charts). */
export const GRID_PAIR_ADDRESS =
  "0xb0d7ea797f552b4871eb3c82208ab14b1755e663c374d030d5d000a3291d80d1";

export const GRID_CHAIN = "Base";

/**
 * Named, public $GRID treasury wallet on Base.
 * Receives Doppler creator fees (WETH + GRID), funds development, community
 * rewards, and ecosystem programs. See /token/policy for the full policy.
 *
 * Publicly verifiable on BaseScan — do NOT use this wallet for personal funds.
 */
export const GRID_TREASURY_ADDRESS =
  "0x4b7c120eb8cd4383d5d035ab365c23e0a34030ca";

/** Canonical WETH (Base) — the wrapped-ETH token paired with GRID in the pool. */
export const WETH_BASE_ADDRESS = "0x4200000000000000000000000000000000000006";

/** Native USDC (Base) — Circle's official USDC on Base. 6 decimals. */
export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface TokenLink {
  /** Display name. */
  name: string;
  /** One-line description of what you'll find there. */
  blurb: string;
  href: string;
  /** Logo in /public/token (favicon-sourced). */
  logo: string;
  /** Short category chip. */
  kind: "Trade" | "Chart" | "Price" | "Explorer";
}

/** Featured destinations — shown as logo cards, in priority order. */
export const GRID_LINKS: TokenLink[] = [
  {
    name: "Uniswap",
    blurb: "Swap ETH for $GRID on Base",
    href: `https://app.uniswap.org/explore/tokens/base/${GRID_TOKEN_ADDRESS}?chain=base`,
    logo: "/token/uniswap.png",
    kind: "Trade",
  },
  {
    name: "CoinGecko",
    blurb: "Price, market cap & charts",
    href: "https://www.coingecko.com/en/coins/codegrid",
    logo: "/token/coingecko.png",
    kind: "Price",
  },
  {
    name: "CoinMarketCap",
    blurb: "DEX price & liquidity data",
    href: `https://dex.coinmarketcap.com/token/base/${GRID_TOKEN_ADDRESS}/`,
    logo: "/token/coinmarketcap.png",
    kind: "Price",
  },
  {
    name: "DexScreener",
    blurb: "Real-time pair chart",
    href: `https://dexscreener.com/base/${GRID_PAIR_ADDRESS}`,
    logo: "/token/dexscreener.png",
    kind: "Chart",
  },
  {
    name: "DexTools",
    blurb: "Pair explorer & trends",
    href: `https://www.dextools.io/app/base/pair-explorer/${GRID_PAIR_ADDRESS}`,
    logo: "/token/dextools.png",
    kind: "Chart",
  },
  {
    name: "BaseScan",
    blurb: "On-chain contract & transfers",
    href: `https://basescan.org/token/${GRID_TOKEN_ADDRESS}`,
    logo: "/token/basescan.png",
    kind: "Explorer",
  },
];

/** Secondary destinations — shown as a compact link row. */
export const GRID_LINKS_MORE: TokenLink[] = [
  {
    name: "Bankr",
    blurb: "Launch details",
    href: `https://bankr.bot/launches/${GRID_TOKEN_ADDRESS}`,
    logo: "/token/bankr.png",
    kind: "Explorer",
  },
  {
    name: "FOMO",
    blurb: "Token overview",
    href: `https://fomo.family/tokens/base/${GRID_TOKEN_ADDRESS}`,
    logo: "/token/fomo.png",
    kind: "Price",
  },
  {
    name: "Moralis",
    blurb: "Token price explorer",
    href: `https://explorer.moralis.com/chain/base/token/price/${GRID_TOKEN_ADDRESS}`,
    logo: "/token/moralis.png",
    kind: "Price",
  },
];

/** Primary "view chart" destination used by compact surfaces (hero pill). */
export const GRID_DEXSCREENER = `https://dexscreener.com/base/${GRID_PAIR_ADDRESS}`;
