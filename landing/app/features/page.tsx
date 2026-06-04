import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal";

export const metadata: Metadata = {
  title: "Features — everything CodeGrid does | CodeGrid",
  description:
    "A canvas for your coding agents: run Claude, Codex, Gemini, Grok, Cursor, and Venice side by side, let them collaborate over the Agent Bus, and keep Git, files, preview, and notes on one canvas. Pro adds AI code review, analytics, and more — powered by staking $GRID.",
  alternates: { canonical: "https://www.codegrid.app/features" },
};

type Card = { title: string; desc: string; href: string; external?: boolean };
type Group = { heading: string; blurb?: string; cards: Card[] };

const groups: Group[] = [
  {
    heading: "Agents",
    blurb: "Run the agents you already use — the real CLIs, in real PTYs.",
    cards: [
      { title: "Supported agents", desc: "Claude, Codex, Gemini, Grok, Cursor, Venice, and your shell — side by side, no wrappers.", href: "/agents" },
      { title: "Agent Bus", desc: "Let one agent message and read another's pane, so they can hand off and review work.", href: "/agent-bus" },
      { title: "Skills", desc: "Drop-in SKILL.md packages that teach your agents how to operate CodeGrid.", href: "/skills" },
    ],
  },
  {
    heading: "The workspace",
    blurb: "A canvas-first home for dense, multi-agent work.",
    cards: [
      { title: "The canvas", desc: "Infinite 2D space with layout presets, pane numbers, maximize, swap, a dock, and live activity indicators.", href: "/canvas" },
      { title: "Command palette & shortcuts", desc: "⌘K to reach any action, plus a full set of keyboard shortcuts.", href: "/command-palette" },
      { title: "Live preview", desc: "An in-app browser pane for your dev server, with localhost auto-detection.", href: "/preview" },
      { title: "Notes", desc: "Markdown scratchpads pinned to the canvas — and to specific panes.", href: "/notes" },
    ],
  },
  {
    heading: "Code & Git",
    blurb: "Keep the whole loop on one canvas.",
    cards: [
      { title: "Git & GitHub", desc: "A full Git UI in the sidebar — commit, branch, diff, plus repo browsing, cloning, and worktree isolation.", href: "/git" },
      { title: "Files & editor", desc: "File tree with Git status, code editor, diff viewer, project search, and a dependency graph.", href: "/editor" },
      { title: "MCP", desc: "Manage Model Context Protocol servers per agent, with one-click presets.", href: "/mcp" },
    ],
  },
  {
    heading: "CodeGrid Pro",
    blurb: "Powered by staking $GRID — a subscription you don't pay for.",
    cards: [
      { title: "Pro overview", desc: "What Pro unlocks and how staking $GRID turns it on, with your principal always kept.", href: "/pro" },
      { title: "AI code review", desc: "Review changes for correctness, security, and UX before you push.", href: "/code-review" },
      { title: "Coding analytics", desc: "A local, uncapped dashboard of your agent usage — nothing leaves your machine.", href: "/analytics" },
    ],
  },
  {
    heading: "Native & trustworthy",
    blurb: "Local-first, signed, and verifiable.",
    cards: [
      { title: "Notifications", desc: "Native alerts, a dock badge, and a menu-bar status for agents that finish, error, or need you.", href: "/docs/notifications" },
      { title: "Updates & signing", desc: "Code-signed and notarized, with a built-in updater.", href: "/docs/updates" },
      { title: "Security", desc: "No account, no telemetry, no servers — everything we claim is in the code.", href: "/security" },
      { title: "Source on GitHub", desc: "MIT-licensed. Audit anything you like.", href: GITHUB, external: true },
    ],
  },
];

export default function FeaturesPage() {
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
              Features
            </span>
            <h1 className="mt-6 font-display text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              Everything CodeGrid <span className="text-accent">does.</span>
            </h1>
            <p className="mt-6 text-text-secondary text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
              An army of coding agents on a canvas per project — with Git, files, preview, and notes
              all in one native, local-first macOS app. Free and open source; Pro is optional.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href="/download" className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors">
                Download for Mac ↓
              </a>
              <Link href="/docs" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors">
                Read the docs →
              </Link>
            </div>
          </div>
        </section>

        {/* Groups */}
        {groups.map((group) => (
          <section key={group.heading} className="py-14 border-t border-border">
            <div className="max-w-5xl mx-auto px-4 sm:px-6">
              <h2 className="font-display text-2xl font-bold tracking-tight">{group.heading}</h2>
              {group.blurb ? (
                <p className="mt-3 text-text-secondary text-sm leading-relaxed max-w-2xl">{group.blurb}</p>
              ) : null}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
                {group.cards.map((card) =>
                  card.external ? (
                    <a
                      key={card.title}
                      href={card.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group bg-bg-primary p-5 hover:bg-bg-secondary transition-colors border-t-2 border-t-transparent hover:border-t-accent"
                    >
                      <h3 className="font-mono text-sm font-semibold text-text-primary mb-1.5 flex items-center gap-1 group-hover:text-accent transition-colors">
                        {card.title}
                        <span className="opacity-0 -translate-x-1 group-hover:opacity-50 group-hover:translate-x-0 transition-all">↗</span>
                      </h3>
                      <p className="text-text-secondary text-xs leading-relaxed">{card.desc}</p>
                    </a>
                  ) : (
                    <Link
                      key={card.title}
                      href={card.href}
                      className="group bg-bg-primary p-5 hover:bg-bg-secondary transition-colors border-t-2 border-t-transparent hover:border-t-accent"
                    >
                      <h3 className="font-mono text-sm font-semibold text-text-primary mb-1.5 flex items-center gap-1 group-hover:text-accent transition-colors">
                        {card.title}
                        <span className="opacity-0 -translate-x-1 group-hover:opacity-50 group-hover:translate-x-0 transition-all">→</span>
                      </h3>
                      <p className="text-text-secondary text-xs leading-relaxed">{card.desc}</p>
                    </Link>
                  )
                )}
              </div>
            </div>
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
