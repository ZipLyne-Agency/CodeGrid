import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Agent Skills — teach any AI agent to use CodeGrid | CodeGrid",
  description:
    "Drop-in SKILL.md packages that teach Claude, Codex, Gemini, Cursor, and Grok how to operate CodeGrid and collaborate with each other. Install in Claude Code, any AGENTS.md agent, or via Bankr / OpenClaw.",
  alternates: { canonical: "https://www.codegrid.app/skills" },
};

const REPO = "https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal";
const SKILLS_DIR = `${REPO}/tree/main/skills`;

const skills = [
  {
    name: "using-codegrid",
    tagline: "The operating manual",
    desc: "Teaches an agent to drive CodeGrid — discover what's running, read and message sibling panes, open projects, and control the workspace over the local socket or codegrid:// deep links.",
    does: [
      "Discover, spawn, and address panes by stable session_id",
      "The full control-socket JSON-RPC reference (agent_list / read / send, open_folder, new_session)",
      "The codegrid:// deep-link scheme for \"Open in CodeGrid\" buttons",
      "The canvas / pane / workspace mental model + operating playbook",
    ],
    trigger: "Use when an agent is running inside a CodeGrid pane, or the user asks to spawn/list/control agents or drive the workspace.",
    href: `${SKILLS_DIR}/using-codegrid`,
  },
  {
    name: "codegrid-agent-bus",
    tagline: "The collaboration protocol",
    desc: "Teaches an agent to work with other agents through the Agent Bus — delegate, review, run a pipeline, fan out work, or get a second opinion, without talking over a busy agent.",
    does: [
      "The read → message → read protocol and agent etiquette",
      "Orchestration patterns: delegate, review, pipeline, parallel fan-out, monitor, debate",
      "Loop & runaway prevention, scope safety, failure recovery",
      "Worked end-to-end examples across Claude, Codex, Gemini, Cursor, Grok",
    ],
    trigger: "Use when the user says \"ask Codex to…\", \"have Gemini review…\", \"split this between the agents\", or any cross-agent coordination.",
    href: `${SKILLS_DIR}/codegrid-agent-bus`,
  },
];

const installs: { k: string; t: string; d: string; code?: string; note?: string }[] = [
  {
    k: "01",
    t: "Claude Code",
    d: "Clone the repo and copy the skill folders into your skills directory — Claude loads them automatically.",
    code: "git clone --depth 1 https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal\ncp -r CodeGrid-Claude-Code-Terminal/skills/* ~/.claude/skills/",
  },
  {
    k: "02",
    t: "Any agent (AGENTS.md)",
    d: "Open a SKILL.md and paste its body into your agent's instruction file — Codex, Gemini, Cursor, Grok, and more.",
    code: "open skills/using-codegrid/SKILL.md",
  },
  {
    k: "03",
    t: "Bankr · OpenClaw",
    // Prose instruction (not a shell command) — rendered as a callout, not code.
    d: "Point OpenClaw at the CodeGrid repo and pick the skill you want — your Bankr agent learns CodeGrid without any local setup.",
    note: "In OpenClaw, install the CodeGrid skill from the skills/ directory of the ZipLyne-Agency/CodeGrid-Claude-Code-Terminal repo.",
  },
];

export default function SkillsPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pt-32 pb-20">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold px-3 py-1 border border-border text-text-secondary bg-bg-secondary/60">
              <span className="w-1.5 h-1.5 round-full inline-block bg-accent" /> Drop-in · Agent Skills
            </span>
            <h1 className="mt-6 font-display text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              Teach any agent to <span className="text-accent">use CodeGrid.</span>
            </h1>
            <p className="mt-6 text-text-secondary text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
              Skills are small, self-contained <code className="text-text-primary">SKILL.md</code> packages that give an AI
              agent new abilities. Ours teach Claude, Codex, Gemini, Cursor, and Grok how to <b className="text-text-primary">drive
              CodeGrid</b> and <b className="text-text-primary">collaborate with each other</b> — drop them into Claude Code,
              any <code className="text-text-primary">AGENTS.md</code> agent, or a Bankr agent via OpenClaw.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href={SKILLS_DIR} target="_blank" rel="noopener noreferrer" className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors">
                Get the skills on GitHub ↓
              </a>
              <Link href="/docs/agent-bus" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors">
                Read the docs →
              </Link>
            </div>
          </div>
        </section>

        {/* Skill cards */}
        <section className="pb-4">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border border border-border">
              {skills.map((s) => (
                <div key={s.name} className="bg-bg-secondary p-6 sm:p-7 flex flex-col">
                  <div className="font-mono text-[11px] font-semibold text-accent uppercase tracking-widest">{s.tagline}</div>
                  <code className="mt-2 font-mono text-base sm:text-lg text-text-primary font-bold">{s.name}</code>
                  <p className="mt-3 text-text-secondary text-xs sm:text-[13px] leading-relaxed">{s.desc}</p>
                  <ul className="mt-4 space-y-1.5">
                    {s.does.map((d) => (
                      <li key={d} className="flex gap-2 text-text-secondary text-xs leading-relaxed">
                        <span className="text-accent select-none">›</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-text-secondary/80 text-[11px] leading-relaxed italic">{s.trigger}</p>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 self-start border border-border hover:border-text-secondary text-text-primary font-mono text-xs px-4 py-2 transition-colors"
                  >
                    View SKILL.md →
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What is a skill */}
        <section className="py-16 border-t border-border mt-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight mb-6">What&apos;s a skill, exactly?</h2>
            <div className="space-y-4 text-text-secondary text-sm leading-relaxed">
              <p>
                A skill is a single Markdown file — YAML frontmatter plus a body — that an agent reads to learn a
                capability. No install step, no dependency, no runtime: just context, written for agents.
              </p>
              <p>
                Because the format is shared across Claude Code, <code className="text-text-primary">AGENTS.md</code>-style
                agents, and Bankr&apos;s OpenClaw registry, <b className="text-text-primary">one skill works everywhere</b>.
                Write it once; every agent that reads it gets smarter about CodeGrid.
              </p>
            </div>
          </div>
        </section>

        {/* Install */}
        <section className="py-16 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-center mb-10">Install in three ways</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
              {installs.map((i) => (
                <div key={i.t} className="bg-bg-secondary p-6 flex flex-col">
                  <div className="font-mono text-accent text-sm font-bold mb-2">{i.k}</div>
                  <div className="font-mono text-sm font-semibold mb-1">{i.t}</div>
                  <p className="text-text-secondary text-xs leading-relaxed mb-4">{i.d}</p>
                  {i.code ? (
                    <pre className="mt-auto bg-bg-primary border border-border p-3 font-mono text-xs leading-relaxed text-text-secondary overflow-x-auto whitespace-pre">{i.code}</pre>
                  ) : (
                    <p className="mt-auto bg-bg-primary border-l-2 border-accent px-3 py-3 text-text-secondary text-xs leading-relaxed">{i.note}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-text-secondary/70 text-[11px] mt-5">
              Both skills assume the CodeGrid app is running — the Agent Bus and control socket are local, same-machine IPC.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 border-t border-border">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight mb-4">Run the agents. Then let them run together.</h2>
            <p className="text-text-secondary text-sm leading-relaxed max-w-xl mx-auto mb-8">
              Install CodeGrid, drop in the skills, and your agents stop working in isolation — they discover, delegate to,
              and review each other on one canvas.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href="/download" className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors">
                Download for Mac ↓
              </a>
              <Link href="/agent-bus" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors">
                How the Agent Bus works →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
