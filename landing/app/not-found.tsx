import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "404 — Not found",
  robots: { index: false },
};

const links: [string, string][] = [
  ["Home", "/"],
  ["Features", "/#features"],
  ["Pricing", "/pricing"],
  ["Docs", "/docs"],
  ["Blog", "/blog"],
  ["Security", "/security"],
];

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center pt-28 pb-24 dot-grid">
        <div className="max-w-md mx-auto px-4 sm:px-6 text-center">
          <div className="font-mono text-6xl sm:text-7xl font-bold text-accent mb-4">404</div>
          <h1 className="font-display text-xl font-bold mb-3">Pane not found</h1>
          <p className="text-text-secondary text-sm leading-relaxed mb-8">
            This route doesn&apos;t exist — like a session that already closed. Try one of these:
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {links.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="inline-flex items-center min-h-[44px] font-mono text-xs text-text-secondary hover:text-accent border border-border hover:border-text-secondary px-4 py-3 transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-6 py-3 transition-colors"
          >
            Back to home
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
