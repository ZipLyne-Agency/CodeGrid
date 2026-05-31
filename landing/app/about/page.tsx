import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "About ZipLyne",
  description:
    "ZipLyne LLC is a Wyoming software company building developer tools for the AI-native era. CodeGrid, a native macOS workspace for running many AI coding agents in parallel, is our first product.",
  alternates: { canonical: "https://www.codegrid.app/about" },
};

const facts: { k: string; v: React.ReactNode }[] = [
  { k: "Legal entity", v: "ZipLyne LLC" },
  { k: "Type", v: "Limited liability company (Wyoming)" },
  { k: "Founded", v: "February 2025" },
  { k: "Registered office", v: "30 N Gould St, Ste N, Sheridan, WY 82801" },
  { k: "Founder", v: <a href="/founder" className="text-accent hover:underline">Isaac Horowitz</a> },
  { k: "Contact", v: <a href="mailto:admin@codegrid.dev" className="text-accent hover:underline">admin@codegrid.dev</a> },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">About ZipLyne</h1>
        <p className="font-mono text-xs text-text-secondary mb-10">An independent studio shipping software for people who code with agents.</p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">Who we are</h2>
            <p>
              ZipLyne LLC is an independent, founder-led software company. We build tools for developers
              who work alongside AI coding agents every day. Our first product, <strong className="text-text-primary">CodeGrid</strong>,
              is a native macOS workspace for running many agents — Claude, Codex, Gemini, Cursor, and
              shells — in parallel on a single canvas.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">Why we build it</h2>
            <p>
              Working with AI agents means juggling a dozen terminals, editor windows, and desktops.
              CodeGrid started as a way to manage that sprawl: a keyboard-first, local-first workspace
              that keeps every session visible and under your control. We believe the best AI tooling is
              transparent, fast, and respectful of your machine and your data — which is why CodeGrid is
              open source and collects nothing.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">How we operate</h2>
            <p>
              We&apos;re a small, founder-led, fully remote team that ships in the open. CodeGrid&apos;s full source lives
              on{" "}
              <a href="https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a>{" "}
              under the MIT license, and our approach to data and safety is documented on our{" "}
              <a href="/security" className="text-accent hover:underline">Security</a> and{" "}
              <a href="/responsible-ai" className="text-accent hover:underline">Responsible AI</a> pages.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">Company details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-6 gap-y-2 mt-2">
              {facts.map((f) => (
                <div key={f.k} className="contents">
                  <dt className="font-mono text-[11px] text-text-secondary uppercase tracking-wide">{f.k}</dt>
                  <dd className="text-text-primary">{f.v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
