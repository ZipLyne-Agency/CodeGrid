import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Work with CodeGrid. We're a small, founder-led, open-source project — not running a formal hiring pipeline, but always open to exceptional builders.",
  alternates: { canonical: "https://www.codegrid.app/careers" },
};

const OPEN_APPLICATION =
  "mailto:admin@codegrid.dev?subject=Open%20application%20%E2%80%94%20CodeGrid";

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Careers</h1>
        <p className="font-mono text-xs text-text-secondary mb-10">Work with CodeGrid.</p>

        <div className="space-y-6 text-sm leading-relaxed text-text-primary mb-12">
          <p>
            CodeGrid is a small, founder-led, open-source project. We&apos;re not running a formal
            hiring pipeline right now, and there are no staffed roles to apply for — what gets built
            comes from a tight, fully remote effort and the people who contribute in the open.
          </p>
          <p>
            That said, we&apos;re always open to exceptional builders. If working on a fast, native,
            keyboard-first workspace for AI coding agents is the kind of thing you&apos;d do for fun,
            we&apos;d genuinely like to hear from you — whenever that is.
          </p>
          <p>
            The best introduction isn&apos;t a résumé; it&apos;s your work. Send a short note about
            what you&apos;ve built (links &gt; CVs), or open a pull request — contributing to CodeGrid
            on GitHub is the most direct way to start a conversation.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={OPEN_APPLICATION}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-5 py-2.5 transition-colors"
          >
            admin@codegrid.dev
          </a>
          <a
            href="https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-5 py-2.5 transition-colors"
          >
            Contribute on GitHub
          </a>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
