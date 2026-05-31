import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Responsible AI",
  description:
    "How CodeGrid approaches AI: it orchestrates third-party coding agents (Claude, Codex, Gemini, Cursor) that you authenticate yourself. CodeGrid trains no models, stores no prompts, and keeps you in control. By ZipLyne LLC.",
  alternates: { canonical: "https://www.codegrid.app/responsible-ai" },
};

const principles: { h: string; body: React.ReactNode }[] = [
  {
    h: "We don't build or train AI models",
    body: (
      <>
        CodeGrid is an <strong className="text-text-primary">orchestration layer</strong>, not an AI
        provider. It launches the coding agents you already use — Claude Code (Anthropic), Codex
        (OpenAI), Gemini CLI (Google), and Cursor — each running as its own process. ZipLyne does not
        train models, fine-tune on your data, or operate any inference of its own.
      </>
    ),
  },
  {
    h: "You bring your own accounts",
    body: (
      <>
        You install and authenticate each agent with your own subscription or API credentials. CodeGrid
        stores none of those credentials and adds no model access of its own. You choose which agent and
        which model runs in each pane.
      </>
    ),
  },
  {
    h: "Your code and prompts go straight to the provider",
    body: (
      <>
        Requests flow directly from each agent&apos;s CLI to its provider — CodeGrid never proxies,
        logs, or stores them, and nothing is sent to ZipLyne. Our{" "}
        <a href="/security" className="text-accent hover:underline">Security</a> page covers the
        underlying data handling in more detail.
      </>
    ),
  },
  {
    h: "You stay in the loop",
    body: (
      <>
        CodeGrid is designed for human oversight of many agents at once. Its attention detection
        surfaces panes that are waiting on you — approvals, confirmations, and yes/no prompts — so an
        agent doesn&apos;t act unattended just because you were looking at another pane. Approvals
        remain yours to give.
      </>
    ),
  },
  {
    h: "Transparency over trust",
    body: (
      <>
        Because CodeGrid is open source under MIT, you can audit exactly what it does with agent output
        and the filesystem. We&apos;d rather you verify than take our word for it.
      </>
    ),
  },
  {
    h: "Know each provider's policies",
    body: (
      <>
        Your use of each agent is governed by that provider&apos;s terms and data policies:{" "}
        <a href="https://www.anthropic.com/legal" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Anthropic</a>,{" "}
        <a href="https://openai.com/policies" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">OpenAI</a>,{" "}
        <a href="https://policies.google.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google</a>, and{" "}
        <a href="https://cursor.com/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Cursor</a>.
        Review them to understand how your code is handled by the models you choose to run.
      </>
    ),
  },
];

export default function ResponsibleAiPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Responsible AI</h1>
        <p className="font-mono text-xs text-text-secondary mb-10">Last updated: May 25, 2026</p>

        <p className="text-sm leading-relaxed text-text-primary mb-12">
          CodeGrid helps you run many AI coding agents at once. It is deliberately a thin, transparent
          layer between you and the agents you choose — never a model, a proxy, or a place your code
          goes to be stored. Here is how we think about AI.
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          {principles.map((s) => (
            <section key={s.h}>
              <h2 className="font-mono text-base font-semibold text-text-primary mb-3">{s.h}</h2>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
