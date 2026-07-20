import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Founder — Isaac Horowitz",
  description:
    "Isaac Horowitz is the founder of ZipLyne LLC and the creator of CodeGrid, a native macOS workspace for running many AI coding agents in parallel.",
  alternates: { canonical: "https://www.codegrid.app/founder" },
};

const LINKEDIN = "https://www.linkedin.com/in/iowitz/";

export default function FounderPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-1">Isaac Horowitz</h1>
        <p className="font-mono text-xs text-text-secondary mb-10">Founder, ZipLyne LLC · Creator of CodeGrid · Miami, FL</p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          <section>
            <p>
              I&apos;m the founder of <a href="/about" className="text-accent hover:underline">ZipLyne LLC</a> and
              the creator of CodeGrid. I build developer tooling for the AI-native era — software for
              people who work alongside multiple AI coding agents every day.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">CodeGrid</h2>
            <p>
              I built CodeGrid because the tool I wanted didn&apos;t exist yet: a single place to run and
              watch every agent at once, without losing track of what each one was doing. It&apos;s a
              keyboard-first, local-first macOS workspace, and it&apos;s open source so anyone can inspect
              it and shape where it goes.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-base font-semibold text-text-primary mb-3">Connect</h2>
            <p className="mb-4">
              The most current background, work history, and contact details are on LinkedIn. Reach out
              if you&apos;re building in this space.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href={LINKEDIN}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-5 py-2.5 transition-colors"
              >
                LinkedIn →
              </a>
              <a
                href="mailto:admin@codegrid.dev"
                className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-5 py-2.5 transition-colors"
              >
                Email
              </a>
            </div>
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
