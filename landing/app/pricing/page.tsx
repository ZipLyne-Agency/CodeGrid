import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "The CodeGrid desktop app is free and open source — every feature, no account, no license keys. Download it for macOS.",
  alternates: { canonical: "https://www.codegrid.app/pricing" },
};

const included = [
  "All 5 agents — Claude, Codex, Gemini, Cursor, shells",
  "Unlimited concurrent sessions",
  "2D canvas, layout presets, multiple workspaces",
  "Attention detection across every agent",
  "Built-in Git + GitHub UI",
  "File tree, project search, code viewer",
  "MCP server manager & command palette",
  "Signed & notarized · auto-updates",
];

const faqs: { q: string; a: string }[] = [
  { q: "Is it really free?", a: "Yes — the CodeGrid desktop app is free and open source under the MIT license, with no account or license keys, and every feature included. We may later offer optional hosted or premium services, but the desktop app stays free and open source." },
  { q: "How do you make money?", a: "Today we don't — CodeGrid is free and open source, with no paid tier and nothing to sell you. It's a product from ZipLyne LLC, and we're investing in it to grow the user base first. Down the road we may offer optional paid extras for teams — things like a hosted sync or collaboration service — but those would be add-ons you can ignore. The desktop app you download stays free and open source either way." },
  { q: "Do I need an account?", a: "No. There's no sign-up and no telemetry. You bring your own AI agent logins; CodeGrid stores nothing." },
  { q: "Can I use it at work?", a: "Yes — the MIT license permits commercial use. See the Terms for details." },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main className="pt-28 pb-24">
        <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 mb-5 font-mono text-[11px] font-semibold px-3 py-1 border border-border text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full inline-block bg-accent" />
            Pricing
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mb-3">
            Free. <span className="text-accent">Open source.</span>
          </h1>
          <p className="text-text-secondary text-sm sm:text-base max-w-xl mx-auto">
            The CodeGrid desktop app is free and open source — every feature, no account, no license keys.
          </p>
        </section>

        {/* The one plan */}
        <section className="max-w-md mx-auto px-4 sm:px-6 mt-12">
          <div className="border border-accent/40 bg-bg-secondary p-8">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-mono text-4xl font-bold">$0</span>
              <span className="font-mono text-sm text-text-secondary">to download</span>
            </div>
            <div className="font-mono text-[11px] tracking-widest uppercase text-text-secondary mb-6">
              Open source · MIT
            </div>
            <a
              href="/download"
              className="block text-center bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-6 py-3 transition-colors mb-6"
            >
              Download for Mac
            </a>
            <ul className="flex flex-col gap-2.5">
              {included.map((f) => (
                <li key={f} className="flex items-start gap-2 text-text-secondary text-xs leading-relaxed">
                  <span aria-hidden className="text-accent mt-0.5 shrink-0">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-center font-mono text-[11px] text-text-secondary mt-4">
            macOS · Apple Silicon · Signed &amp; notarized
          </p>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-24">
          <h2 className="font-display text-xl font-bold text-center mb-10">Pricing FAQ</h2>
          <div className="space-y-px bg-border border border-border">
            {faqs.map((f) => (
              <div key={f.q} className="bg-bg-secondary p-6 sm:p-8 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-12">
                <p className="font-mono text-sm font-semibold sm:w-1/3 shrink-0">{f.q}</p>
                <p className="text-text-secondary text-sm leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
