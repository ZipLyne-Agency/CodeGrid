import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

type Row = { label: string; cg: boolean; them: boolean };
type Comparison = {
  name: string;
  title: string;
  intro: string;
  rows: Row[];
  closing: string;
};

const DATA: Record<string, Comparison> = {
  "codegrid-vs-tmux": {
    name: "tmux",
    title: "CodeGrid vs. tmux",
    intro:
      "tmux is a battle-tested terminal multiplexer: persistent sessions, splits, and full keyboard control, scriptable to the hilt. CodeGrid is a native macOS app built specifically for running many AI coding agents at once — a visual 2D canvas instead of stacked splits, with awareness of what each agent is doing. Both run your real CLIs; they solve different halves of the problem.",
    rows: [
      { label: "Persistent sessions", cg: true, them: true },
      { label: "Runs your real CLIs (no lock-in)", cg: true, them: true },
      { label: "Broadcast input to every pane", cg: true, them: true }, // tmux: synchronize-panes
      { label: "Visual 2D canvas — drag & resize with a mouse", cg: true, them: false },
      { label: "Zoom out to see every session at once", cg: true, them: false },
      { label: "Detects which agent is waiting on you", cg: true, them: false },
      { label: "Built-in Git + GitHub UI", cg: true, them: false },
      { label: "Native macOS app (no terminal emulator needed)", cg: true, them: false },
    ],
    closing:
      "If you live in the terminal and love scripting, tmux is hard to beat. If you're orchestrating a dozen AI agents and want to see and steer all of them at a glance, that's exactly what CodeGrid is for — and you can still run tmux inside a CodeGrid pane.",
  },
  "codegrid-vs-iterm2": {
    name: "iTerm2",
    title: "CodeGrid vs. iTerm2",
    intro:
      "iTerm2 is the gold-standard macOS terminal emulator — tabs, split panes, profiles, search, and GPU rendering. CodeGrid isn't a terminal emulator; it's an agent workspace. Instead of tabs and splits, every session gets a pane on a free-form 2D canvas, and CodeGrid tracks what each agent is doing so you never miss a prompt.",
    rows: [
      { label: "Tabs & split panes", cg: true, them: true },
      { label: "Broadcast input to all panes", cg: true, them: true }, // iTerm: send input to all
      { label: "Runs your real CLIs", cg: true, them: true },
      { label: "Free-form 2D canvas (not just tabs/splits)", cg: true, them: false },
      { label: "Zoom-out overview of all sessions", cg: true, them: false },
      { label: "Per-agent activity & attention detection", cg: true, them: false },
      { label: "Built-in Git + GitHub UI", cg: true, them: false },
      { label: "Per-project workspaces with saved layouts", cg: true, them: false },
    ],
    closing:
      "iTerm2 is a fantastic general-purpose terminal. CodeGrid is purpose-built for multi-agent AI coding: a canvas, session awareness, and Git tooling in one app. Many people use both — iTerm2 for everyday shell work, CodeGrid when they're running a fleet of agents.",
  },
  "codegrid-vs-vscode-terminals": {
    name: "VS Code terminals",
    title: "CodeGrid vs. VS Code terminals",
    intro:
      "VS Code's integrated terminals are convenient when you're already in the editor — split a couple, run a dev server, done. But they're tab-based, bound to one editor window, and weren't designed for running many AI agents in parallel. CodeGrid is a dedicated canvas for exactly that.",
    rows: [
      { label: "Terminals alongside your code", cg: false, them: true },
      { label: "Built-in Git", cg: true, them: true },
      { label: "Runs your real CLIs", cg: true, them: true },
      { label: "Dozens of sessions visible on one canvas", cg: true, them: false },
      { label: "Drag-and-resize 2D layout", cg: true, them: false },
      { label: "Detects which agent needs you", cg: true, them: false },
      { label: "Broadcast one prompt to every agent", cg: true, them: false },
      { label: "Dedicated app, not tied to one editor window", cg: true, them: false },
    ],
    closing:
      "If your work lives inside the editor, VS Code terminals are right there. When you're running many agents across many repos at once, CodeGrid gives you a canvas built for it — and it launches the same CLIs, so there's nothing to migrate.",
  },
};

export function generateStaticParams() {
  return Object.keys(DATA).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = DATA[slug];
  if (!d) return {};
  // Trim the intro on a word boundary (no mid-word cuts in the meta description).
  const snippet =
    d.intro.length <= 110
      ? d.intro
      : `${d.intro.slice(0, d.intro.lastIndexOf(" ", 110))}…`;
  return {
    title: d.title,
    description: `${d.title}: an honest comparison for running AI coding agents. ${snippet}`,
    alternates: { canonical: `https://www.codegrid.app/compare/${slug}` },
  };
}

function Mark({ on }: { on: boolean }) {
  return (
    <div className="p-2 sm:p-4 flex items-center justify-center">
      {on ? (
        <span aria-hidden className="font-mono text-sm font-bold text-accent">✓</span>
      ) : (
        <span aria-hidden className="font-mono text-sm text-text-secondary/70">—</span>
      )}
    </div>
  );
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = DATA[slug];
  if (!d) notFound();

  const cols = "grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] sm:grid-cols-[minmax(0,1fr)_8rem_8rem]";

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main className="pt-28 pb-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-5">{d.title}</h1>
          <p className="text-text-secondary text-sm leading-relaxed mb-12">{d.intro}</p>

          <div className="border border-border overflow-hidden mb-10">
            <div className={`grid ${cols} bg-bg-tertiary border-b border-border font-mono text-[9px] sm:text-xs font-bold tracking-wide`}>
              <div className="p-2 sm:p-4" />
              <div className="p-2 sm:p-4 text-center text-accent">CodeGrid</div>
              <div className="p-2 sm:p-4 text-center text-text-secondary">{d.name}</div>
            </div>
            {d.rows.map((r, i) => (
              <div key={r.label} className={`grid ${cols} ${i % 2 ? "bg-bg-primary" : "bg-bg-secondary"}`}>
                <div className="p-2.5 sm:p-4 font-mono text-[11px] sm:text-xs text-text-primary self-center leading-snug">{r.label}</div>
                <Mark on={r.cg} />
                <Mark on={r.them} />
              </div>
            ))}
          </div>

          <p className="text-text-secondary text-sm leading-relaxed mb-10">{d.closing}</p>

          <div className="flex flex-wrap gap-3">
            <a href="/download" className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-6 py-3 transition-colors">
              Download for Mac
            </a>
            <a href="/#features" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary font-mono text-sm px-6 py-3 transition-colors">
              See all features
            </a>
          </div>

          <div className="mt-12 pt-6 border-t border-border font-mono text-[11px] text-text-secondary">
            Compare more:{" "}
            {Object.entries(DATA)
              .filter(([s]) => s !== slug)
              .map(([s, c], i, arr) => (
                <span key={s}>
                  <a href={`/compare/${s}`} className="hover:text-accent transition-colors">CodeGrid vs. {c.name}</a>
                  {i < arr.length - 1 ? " · " : ""}
                </span>
              ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
