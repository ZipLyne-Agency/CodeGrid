import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { CopyAddress } from "./copy-address";
import { GRID_CHAIN, GRID_LINKS, GRID_LINKS_MORE } from "@/lib/token";

export const metadata: Metadata = {
  title: "$GRID token — price, charts & where to buy",
  description:
    "$GRID is the community token for CodeGrid on Base. View live price and charts on CoinGecko, CoinMarketCap, DexScreener and DexTools, trade on Uniswap, or inspect the contract on BaseScan.",
  alternates: { canonical: "https://www.codegrid.app/token" },
};

/**
 * Category pill styling. To preserve the single-accent discipline of the
 * design system, only the primary action ("Trade") gets the accent; every
 * other category renders in the neutral secondary tone. The kind label itself
 * carries the meaning, so no multi-hue palette is needed.
 */
const KIND_CLASS: Record<string, string> = {
  Trade: "text-accent border-accent/40",
  Chart: "text-text-secondary border-border",
  Price: "text-text-secondary border-border",
  Explorer: "text-text-secondary border-border",
};
const KIND_CLASS_DEFAULT = "text-text-secondary border-border";

export default function TokenPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />

      <main className="pt-28 pb-24">
        {/* ===== Hero ===== */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold px-3 py-1 border border-border text-text-secondary bg-bg-secondary/60 backdrop-blur-sm">
              <span className="round-full w-1.5 h-1.5 inline-block bg-status-running" />
              Community token · {GRID_CHAIN}
            </span>

            <h1 className="mt-6 font-display text-4xl sm:text-5xl font-bold tracking-tight">
              <span className="text-accent">$GRID</span>
            </h1>
            <p className="mt-4 max-w-xl text-text-secondary text-sm sm:text-base leading-relaxed">
              The community token behind CodeGrid, live on Base. CodeGrid is free and open
              source — $GRID is <strong className="text-text-primary">not required</strong> to
              download or use the app. Below is every official place to view price, charts, and
              trade.
            </p>

            <div className="mt-8">
              <CopyAddress />
            </div>

            {/* Treasury quick-access — live terminal includes balance, claim
                history, allocation breakdown, full policy, and wallet info. */}
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                href="/token/treasury"
                className="group inline-flex items-center gap-2 font-mono text-xs px-3.5 py-2 border border-accent/40 bg-accent/5 hover:bg-accent/10 text-accent transition-colors"
              >
                <span className="round-full w-1.5 h-1.5 inline-block bg-status-running pulse-glow" />
                Open treasury terminal →
              </Link>
            </div>
          </div>
        </section>

        {/* ===== Featured destinations ===== */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-16">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-text-secondary mb-4">
            Trade & track $GRID
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
            {GRID_LINKS.map((l) => (
              <a
                key={l.name}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative bg-bg-primary p-5 flex items-start gap-4 hover:bg-bg-secondary transition-colors"
              >
                <span className="shrink-0 w-11 h-11 border border-border bg-bg-secondary flex items-center justify-center overflow-hidden">
                  <Image
                    src={l.logo}
                    alt={`${l.name} logo`}
                    width={28}
                    height={28}
                    className="w-7 h-7 object-contain"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-text-primary group-hover:text-accent transition-colors">
                      {l.name}
                    </span>
                    <span
                      className={`font-mono text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 border ${
                        KIND_CLASS[l.kind] ?? KIND_CLASS_DEFAULT
                      }`}
                    >
                      {l.kind}
                    </span>
                  </span>
                  <span className="block mt-1 font-mono text-xs text-text-secondary leading-relaxed">
                    {l.blurb}
                  </span>
                </span>
                <span className="absolute top-3 right-3 font-mono text-text-secondary opacity-0 group-hover:opacity-60 transition-opacity">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ===== Secondary links ===== */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-12">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-text-secondary mb-4">
            More places to find $GRID
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {GRID_LINKS_MORE.map((l) => (
              <a
                key={l.name}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                title={l.blurb}
                className="group inline-flex items-center gap-2.5 border border-border hover:border-text-secondary bg-bg-secondary/40 px-3.5 py-2 transition-colors"
              >
                <Image
                  src={l.logo}
                  alt={`${l.name} logo`}
                  width={18}
                  height={18}
                  className="w-[18px] h-[18px] object-contain"
                />
                <span className="font-mono text-xs text-text-primary group-hover:text-accent transition-colors">
                  {l.name}
                </span>
                <span className="font-mono text-text-secondary opacity-50 group-hover:opacity-100 transition-opacity">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ===== Disclaimer ===== */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-14">
          <p className="border-l-2 border-border pl-4 max-w-2xl font-mono text-[11px] text-text-secondary leading-relaxed">
            $GRID is a community token and is not an investment, security, or a means of
            payment for CodeGrid. CodeGrid is free, open source, and fully usable without it.
            Always verify the contract address ends in{" "}
            <span className="text-text-primary">…4311ba3</span> before transacting. Nothing here
            is financial advice.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
