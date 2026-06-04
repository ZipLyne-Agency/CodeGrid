"use client";

import Link from "next/link";

/**
 * Shared chrome for the on-chain "CodeGrid dashboard" terminals. Treasury and
 * Staking are two routes that read as one product: this strip sits in each
 * terminal's title bar and gives (a) a clear way back to the main site and
 * (b) tabs to switch between the two surfaces.
 */
export function DashboardTabs({ active }: { active: "treasury" | "stake" }) {
  const tab = (href: string, id: "treasury" | "stake", label: string) => (
    <Link
      href={href}
      aria-current={active === id ? "page" : undefined}
      className={`font-mono text-[11px] px-2.5 py-1 border-b-2 -mb-px transition-colors ${
        active === id
          ? "border-accent text-accent"
          : "border-transparent text-text-secondary hover:text-text-primary"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Link
        href="/"
        title="Back to CodeGrid"
        className="flex items-center gap-1.5 font-mono text-[11px] text-text-secondary hover:text-accent transition-colors shrink-0"
      >
        <span aria-hidden>←</span>
        <span className="font-semibold text-text-primary">CodeGrid</span>
        <span className="hidden sm:inline text-text-secondary opacity-60">dashboard</span>
      </Link>
      <span className="text-text-secondary opacity-30" aria-hidden>/</span>
      <nav className="flex items-center" aria-label="Dashboard sections">
        {tab("/token/treasury", "treasury", "Treasury")}
        {tab("/token/stake", "stake", "Staking")}
      </nav>
    </div>
  );
}
