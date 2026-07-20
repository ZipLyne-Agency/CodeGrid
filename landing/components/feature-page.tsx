import type { ReactNode } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid";

export type FeatureItem = { name: string; desc: ReactNode };
export type FeatureSection = {
  title: string;
  blurb?: ReactNode;
  items: FeatureItem[];
  cols?: 2 | 3;
};

export interface FeaturePageProps {
  /** Small uppercase label above the title. */
  eyebrow: string;
  /** Optional pill before the eyebrow dot, e.g. "Pro". */
  badge?: string;
  title: ReactNode;
  intro: ReactNode;
  docsHref?: string;
  docsLabel?: string;
  sections: FeatureSection[];
  closingTitle?: ReactNode;
  closingBlurb?: ReactNode;
}

/**
 * Shared marketing layout for feature pages. Content is passed in as data so
 * every page stays consistent with the site's design system. All copy lives in
 * the page files — this component only lays it out.
 */
export function FeaturePage({
  eyebrow,
  badge,
  title,
  intro,
  docsHref,
  docsLabel = "Read the docs →",
  sections,
  closingTitle,
  closingBlurb,
}: FeaturePageProps) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pt-32 pb-16">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold px-3 py-1 border border-border text-text-secondary bg-bg-secondary/60">
              <span className="w-1.5 h-1.5 round-full inline-block bg-accent" />
              {badge ? <span className="text-accent">{badge}</span> : null}
              {eyebrow}
            </span>
            <h1 className="mt-6 font-display text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              {title}
            </h1>
            <p className="mt-6 text-text-secondary text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
              {intro}
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="/download"
                className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors"
              >
                Download for Mac ↓
              </a>
              {docsHref ? (
                <Link
                  href={docsHref}
                  className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors"
                >
                  {docsLabel}
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        {/* Sections */}
        {sections.map((section) => (
          <section key={section.title} className="py-14 border-t border-border">
            <div className="max-w-4xl mx-auto px-4 sm:px-6">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {section.title}
              </h2>
              {section.blurb ? (
                <p className="mt-3 text-text-secondary text-sm leading-relaxed max-w-2xl">
                  {section.blurb}
                </p>
              ) : null}
              <div
                className={`mt-8 grid grid-cols-1 ${
                  section.cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
                } gap-px bg-border border border-border`}
              >
                {section.items.map((item) => (
                  <div key={item.name} className="bg-bg-primary p-5">
                    <h3 className="font-mono text-sm font-semibold text-text-primary mb-1.5">
                      {item.name}
                    </h3>
                    <p className="text-text-secondary text-xs leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}

        {/* Closing CTA */}
        <section className="relative overflow-hidden py-20 sm:py-28 border-t border-border">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>
          <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight">
              {closingTitle ?? <>Run your whole fleet on one canvas.</>}
            </h2>
            {closingBlurb ? (
              <p className="mt-5 text-text-secondary text-sm sm:text-base max-w-xl mx-auto">
                {closingBlurb}
              </p>
            ) : null}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="/download"
                className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-8 py-4 transition-colors"
              >
                Download for Mac ↓
              </a>
              <a
                href={GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-8 py-4 transition-colors"
              >
                <span className="text-accent">★</span> Star on GitHub
              </a>
            </div>
            <p className="mt-5 text-xs font-mono text-text-secondary">
              macOS · Apple Silicon · Free &amp; open source
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
