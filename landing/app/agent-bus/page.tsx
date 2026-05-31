import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { WindowFrame } from "@/components/ui/window-frame";

export const metadata: Metadata = {
  title: "Agent Bus — agents that work together | CodeGrid",
  description:
    "The CodeGrid Agent Bus lets your AI coding agents collaborate — one agent can message and read another's pane. Claude hands a task to Codex, reads its reply, and keeps going. Native, local, no tmux.",
  alternates: { canonical: "https://www.codegrid.app/agent-bus" },
};

const tools = [
  { name: "list_agents", desc: "See every agent CodeGrid is running — who to talk to." },
  { name: "read_pane", desc: "Read another agent's recent output, cleanly." },
  { name: "message_agent", desc: "Type a request into another agent's pane and get its reply." },
];

const steps = [
  { n: "01", t: "Open your agents", d: "Spawn Claude, Codex, Gemini — each in its own pane on the canvas." },
  { n: "02", t: "Enable collaboration", d: "One click in onboarding (or one command) wires the bus into every agent." },
  { n: "03", t: "Let them coordinate", d: "Ask one agent to delegate to, review, or coordinate with another — in plain English." },
];

export default function AgentBusPage() {
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
              <span className="w-1.5 h-1.5 round-full inline-block bg-accent" /> New · Agent Bus
            </span>
            <h1 className="mt-6 font-display text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              Your agents, <span className="text-accent">working together.</span>
            </h1>
            <p className="mt-6 text-text-secondary text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
              Most tools run agents in isolation. CodeGrid&apos;s <b className="text-text-primary">Agent Bus</b> lets one agent
              message and read another&apos;s pane — so Claude can hand a task to Codex, read its reply, and keep going.
              All on one canvas. Native. Local. No tmux.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href="/download" className="btn-sheen inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors">
                Download for Mac ↓
              </a>
              <Link href="/docs/agent-bus" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors">
                Read the docs →
              </Link>
            </div>
          </div>
        </section>

        {/* Conversation mockup */}
        <section className="pb-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <WindowFrame title="claude · pane 1">
              <div className="p-4 sm:p-6 space-y-3 leading-relaxed font-mono text-xs sm:text-[13px]">
                <p><span className="text-accent">you ›</span> Ask Codex to add an export button, then review its work.</p>
                <p className="text-text-secondary">→ <span className="text-text-primary">list_agents</span> — found <span className="text-accent">codex</span> on pane 2</p>
                <p className="text-text-secondary">→ <span className="text-text-primary">message_agent</span>(codex, &quot;Implement an Export button…&quot;)</p>
                <p className="text-text-secondary opacity-80">… Codex works in its own pane …</p>
                <p className="text-text-secondary">→ <span className="text-text-primary">read_pane</span>(codex) — &quot;Done. Added ExportButton.tsx + wired the handler.&quot;</p>
                <p><span className="text-accent">claude ›</span> Codex finished. I reviewed the diff — looks good, with one tweak I applied.</p>
              </div>
            </WindowFrame>
          </div>
        </section>

        {/* Tools */}
        <section className="py-16 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-center mb-10">Three tools. Endless workflows.</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border border border-border">
              {tools.map((t) => (
                <div key={t.name} className="bg-bg-secondary p-6">
                  <code className="font-mono text-sm text-accent font-semibold">{t.name}</code>
                  <p className="text-text-secondary text-xs leading-relaxed mt-2">{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight text-center mb-10">Set up in minutes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {steps.map((s) => (
                <div key={s.n}>
                  <div className="font-mono text-accent text-sm font-bold mb-2">{s.n}</div>
                  <div className="font-mono text-sm font-semibold mb-1">{s.t}</div>
                  <p className="text-text-secondary text-xs leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Why native */}
        <section className="py-16 border-t border-border">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <h2 className="font-display text-2xl font-bold tracking-tight mb-6">Why it&apos;s built in, not bolted on</h2>
            <div className="space-y-4 text-text-secondary text-sm leading-relaxed">
              <p>CodeGrid already owns every pane&apos;s terminal — so the Agent Bus talks to your agents directly over a local socket. No tmux to wrap your agents in, no second multiplexer leaking its own keybindings, no daemon.</p>
              <p>Your agents stay <b className="text-text-primary">visible side by side</b> while they collaborate, and everything stays <b className="text-text-primary">on your machine</b>. It works with Claude, Codex, Gemini, and Cursor — mix and match.</p>
            </div>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href="/download" className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors">Download for Mac ↓</a>
              <Link href="/docs/agent-bus" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors">Read the docs →</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
