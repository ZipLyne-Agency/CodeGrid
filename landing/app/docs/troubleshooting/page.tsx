import type { Metadata } from "next";
import { DocTitle, Section, P, C, Kbd, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Troubleshooting — CodeGrid Docs",
  description: "Fixes for common CodeGrid issues — agents not launching, sessions ending, missing panes, and the agent bus.",
  alternates: { canonical: "https://www.codegrid.app/docs/troubleshooting" },
};

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="font-mono text-text-primary font-semibold mb-1">{q}</p>
      <div className="text-text-secondary text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export default function Page() {
  return (
    <>
      <DocTitle title="Troubleshooting" intro="The usual suspects, and how to fix them." />

      <Section>
        <QA q="An agent won't launch">
          <P>Make sure its CLI is installed and on your <C>PATH</C> — run <C>which claude</C>, <C>which codex</C>, etc. in a terminal. Cursor&apos;s binary is <C>cursor-agent</C>. CodeGrid also checks <C>/opt/homebrew/bin</C> and <C>~/.local/bin</C>.</P>
        </QA>
        <QA q="A session ended unexpectedly">
          <P>Closing a pane terminates that session&apos;s whole process group. Use <b className="text-text-primary">Restart</b> on the pane, or reopen with <Kbd>⌘N</Kbd>.</P>
        </QA>
        <QA q="I can only see one pane / panes look missing">
          <P>The canvas may be zoomed or panned. Click <b className="text-text-primary">FIT</b> (top-right of the canvas) to bring everything into view, or <b className="text-text-primary">AUTO</b> to re-tile every pane.</P>
        </QA>
        <QA q="My agents don't have the collaboration tools">
          <P>Run <C>/mcp</C> in the pane and look for <C>codegrid-agent-bus</C>. If it&apos;s missing, enable collaboration (onboarding, or the bus <C>setup</C> command), then open a fresh pane with <Kbd>⌘N</Kbd> — new panes pick the tools up automatically. See <a href="/docs/agent-bus" className="text-accent hover:underline">The Agent Bus</a>.</P>
        </QA>
        <QA q="“Can't reach CodeGrid” from an agent">
          <P>The CodeGrid app must be running — the agent bus talks to it over a local socket (<C>~/.codegrid/socket</C>).</P>
        </QA>
        <QA q="The editor or code viewer looks broken">
          <P>Make sure you&apos;re on the latest version (<b className="text-text-primary">Settings → Check for Updates</b>). If it persists, report it below.</P>
        </QA>
        <QA q="Still stuck?">
          <P>Open an issue on <a href="https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a> or email <a href="mailto:admin@codegrid.dev" className="text-accent hover:underline">admin@codegrid.dev</a>.</P>
        </QA>
      </Section>

      <PrevNext current="/docs/troubleshooting" />
    </>
  );
}
