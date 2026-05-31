import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Press & Brand",
  description:
    "CodeGrid press kit and brand assets: logo, colors, typography, and company boilerplate for ZipLyne LLC.",
  alternates: { canonical: "https://www.codegrid.app/press" },
};

const facts: [string, React.ReactNode][] = [
  ["Product", "CodeGrid"],
  ["Company", "ZipLyne LLC (Wyoming)"],
  ["Founded", "February 2025"],
  ["Founder", <a key="f" href="/founder" className="text-accent hover:underline">Isaac Horowitz</a>],
  ["Category", "Developer tools · macOS"],
  ["License", "MIT (open source)"],
  ["Press contact", <a key="c" href="mailto:admin@codegrid.dev" className="text-accent hover:underline">admin@codegrid.dev</a>],
];

// Values verified against the design tokens in app/globals.css.
const colors: [string, string][] = [
  ["Accent", "#ff8c00"],
  ["Background", "#0a0a0a"],
  ["Surface", "#141414"],
  ["Text", "#e0e0e0"],
];

const boilerplate =
  "CodeGrid is a native macOS workspace for running many AI coding agents — Claude Code, Codex, Gemini, Cursor, and shells — in parallel on a single 2D canvas. It's free, open source, and local-first. CodeGrid is built by ZipLyne LLC, a Wyoming software company founded in February 2025.";

/**
 * Launch-coverage pickups. These are syndicated reprints of the CodeGrid launch
 * press release (EIN Presswire distribution) carried by the outlets' affiliate
 * networks — framed honestly as "press-release pickups," not commissioned
 * editorial. Each links to that outlet's reprint.
 */
const RELEASE =
  "915028636/codegrid-launches-a-free-open-source-canvas-for-running-multiple-ai-coding-agents-at-once";
const coverage: { name: string; src: string; href: string; h: number }[] = [
  { name: "AP News", src: "/press/ap.svg", h: 30, href: "https://apnews.com/press-release/ein-presswire-newsmatics/codegrid-launches-a-free-open-source-canvas-for-running-multiple-ai-coding-agents-at-once-9d2b00d83154d638c8136cfa8518a3c8" },
  { name: "CBS", src: "/press/cbs.svg", h: 34, href: `https://www.wkrg.com/business/press-releases/ein-presswire/${RELEASE}` },
  { name: "NBC", src: "/press/nbc.svg", h: 32, href: `https://www.wavy.com/business/press-releases/ein-presswire/${RELEASE}` },
  { name: "ABC", src: "/press/abc.png", h: 26, href: `https://www.abc27.com/business/press-releases/ein-presswire/${RELEASE}` },
  { name: "FOX", src: "/press/fox.png", h: 42, href: `https://fox40.com/business/press-releases/ein-presswire/${RELEASE}` },
  { name: "The CW", src: "/press/cw.svg", h: 30, href: `https://cw39.com/business/press-releases/ein-presswire/${RELEASE}` },
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main className="pt-28 pb-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Press &amp; Brand</h1>
          <p className="text-text-secondary text-sm mb-12">Assets and facts for writing about CodeGrid.</p>

          <section className="mb-12">
            <h2 className="font-display text-lg font-bold mb-4">Brand assets</h2>

            {/* Logo / wordmark */}
            <div className="border border-border bg-bg-secondary p-8 flex items-center gap-6 flex-wrap mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.webp" alt="CodeGrid logo" className="h-16 w-auto" />
              <div className="font-mono text-sm">
                <a href="/logo.webp" download className="text-accent hover:underline">Download logo (.webp)</a>
                <p className="text-text-secondary text-xs mt-1 font-sans">Keep clear space around the mark. Don&apos;t recolor or distort it.</p>
              </div>
            </div>

            {/* App icon + social card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-border bg-bg-secondary p-6 flex items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon-512.png" alt="CodeGrid app icon" className="h-16 w-16 border border-border" />
                <div className="font-mono text-xs leading-relaxed">
                  <div className="text-text-primary font-semibold mb-1">App icon</div>
                  <a href="/icon-512.png" download className="text-accent hover:underline">PNG&nbsp;512</a>
                  <span className="text-text-secondary"> · </span>
                  <a href="/icon-1024.webp" download className="text-accent hover:underline">WebP&nbsp;1024</a>
                </div>
              </div>
              <a
                href="/og.png"
                download
                className="group border border-border bg-bg-secondary overflow-hidden block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/og.png" alt="CodeGrid social/share image" className="w-full aspect-[1200/630] object-cover" />
                <div className="px-4 py-2 font-mono text-xs flex items-center justify-between">
                  <span className="text-text-primary font-semibold">Social card</span>
                  <span className="text-accent group-hover:underline">Download (1200×630) ↓</span>
                </div>
              </a>
            </div>
            <p className="text-text-secondary text-xs mt-3 max-w-prose">
              Need a vector logo or product screenshots? Email{" "}
              <a href="mailto:admin@codegrid.dev" className="font-mono text-accent hover:underline">admin@codegrid.dev</a>.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="font-display text-lg font-bold mb-4">Colors</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border">
              {colors.map(([name, hex]) => (
                <div key={name} className="bg-bg-secondary p-4">
                  <div className="h-12 w-full border border-border mb-3" style={{ background: hex }} />
                  <div className="font-mono text-xs font-semibold">{name}</div>
                  <div className="font-mono text-[11px] text-text-secondary">{hex}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-12">
            <h2 className="font-display text-lg font-bold mb-4">Typography</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              CodeGrid pairs three typefaces: <span className="text-text-primary font-semibold">Space Grotesk</span> for
              display headings, <span className="text-text-primary font-semibold">Geist</span> for body text, and{" "}
              <span className="text-text-primary font-semibold font-mono">JetBrains Mono</span> as the terminal-native
              signature — used for code, labels, and data to match the product.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="font-display text-lg font-bold mb-4">Boilerplate</h2>
            <p className="border border-border bg-bg-secondary p-5 text-text-secondary text-sm leading-relaxed">
              {boilerplate}
            </p>
          </section>

          <section className="mb-12">
            <h2 className="font-display text-lg font-bold mb-2">Launch coverage</h2>
            <p className="text-text-secondary text-sm leading-relaxed mb-5 max-w-prose">
              CodeGrid&apos;s launch press release was distributed via EIN Presswire and picked up
              across these outlets&apos; syndication networks. These are press-release pickups, not
              commissioned editorial — each links to the outlet&apos;s reprint.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {coverage.map((c) => (
                <a
                  key={c.name}
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Read the CodeGrid launch pickup on ${c.name}`}
                  className="group flex h-16 items-center justify-center border border-border bg-white px-4 ring-1 ring-black/10 transition-transform duration-200 hover:-translate-y-0.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.src} alt={`${c.name} logo`} style={{ height: c.h }} className="w-auto" loading="lazy" decoding="async" />
                </a>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold mb-4">Facts</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-6 gap-y-2">
              {facts.map(([k, v], i) => (
                <div key={i} className="contents">
                  <dt className="font-mono text-[11px] text-text-secondary uppercase tracking-wide">{k}</dt>
                  <dd className="text-sm text-text-primary mb-1">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
