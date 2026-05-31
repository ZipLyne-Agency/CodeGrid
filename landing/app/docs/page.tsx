import type { Metadata } from "next";
import Link from "next/link";
import { DocTitle, Section, P, UL, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "CodeGrid Docs — Introduction",
  description:
    "CodeGrid is a macOS canvas for running and orchestrating multiple AI coding agents — Claude, Codex, Gemini, Cursor — side by side, with native agent-to-agent collaboration.",
  alternates: { canonical: "https://www.codegrid.app/docs" },
};

const map: { title: string; href: string; desc: string }[] = [
  { title: "Getting started", href: "/docs/getting-started", desc: "Install the app, connect your agents, open your first session." },
  { title: "The canvas", href: "/docs/canvas", desc: "Panes, drag/resize/zoom, and the AUTO/GRID/FIT layouts." },
  { title: "Sessions & agents", href: "/docs/sessions", desc: "Spawn Claude/Codex/Gemini/shells, worktrees, resume, rename." },
  { title: "The Agent Bus", href: "/docs/agent-bus", desc: "Let one agent message and read another — collaboration, no tmux." },
  { title: "Git", href: "/docs/git", desc: "Status, diffs, hunk staging, branches, commit/push, one-click publish." },
  { title: "Keyboard shortcuts", href: "/docs/shortcuts", desc: "Everything, in one reference." },
];

export default function DocsIndex() {
  return (
    <>
      <DocTitle
        title="CodeGrid documentation"
        intro="CodeGrid is a native macOS workspace that runs your AI coding agents — Claude Code, Codex, Gemini, Cursor, and shells — side by side on one infinite canvas, and lets them collaborate with each other."
      />

      <Section title="What CodeGrid is">
        <P>
          Instead of juggling a dozen terminal tabs and editor windows, you run each agent in its own
          pane on a 2D canvas. Drag them around, tile them, broadcast one prompt to all of them, and —
          with the <Link href="/docs/agent-bus" className="text-accent hover:underline">Agent Bus</Link> —
          have one agent hand work to another and read its reply.
        </P>
        <P>
          It&apos;s <C>local-first</C>: CodeGrid launches the agent CLIs you already have, stores no API keys,
          and your code never leaves your machine except through the agents&apos; own providers.
        </P>
      </Section>

      <Section title="Start here">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border not-prose">
          {map.map((m) => (
            <Link key={m.href} href={m.href} className="bg-bg-secondary hover:bg-bg-primary transition-colors p-4 block">
              <div className="font-mono text-sm font-semibold text-text-primary mb-1">{m.title}</div>
              <div className="text-text-secondary text-xs leading-relaxed">{m.desc}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Requirements">
        <UL
          items={[
            "macOS 13 Ventura or later, Apple Silicon (M1–M4).",
            <>The agent CLIs you want to use — CodeGrid runs them, it doesn&apos;t bundle them.</>,
            <>Node.js 18+ (only needed for <Link href="/docs/agent-bus" className="text-accent hover:underline">agent collaboration</Link>).</>,
          ]}
        />
      </Section>

      <PrevNext current="/docs" />
    </>
  );
}
