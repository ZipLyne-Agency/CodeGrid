import type { Metadata } from "next";
import { DocTitle, Section, P, OL, UL, C, Kbd, Code, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Getting started — CodeGrid Docs",
  description: "Install CodeGrid on macOS, connect your AI coding agents, and run your first parallel session.",
  alternates: { canonical: "https://www.codegrid.app/docs/getting-started" },
};

const agents = [
  { name: "Claude Code", cmd: "npm i -g @anthropic-ai/claude-code", url: "https://code.claude.com/docs" },
  { name: "OpenAI Codex", cmd: "npm i -g @openai/codex", url: "https://developers.openai.com/codex/cli" },
  { name: "Gemini CLI", cmd: "npm i -g @google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" },
  { name: "Cursor", cmd: "curl https://cursor.com/install -fsS | bash", url: "https://cursor.com/docs/cli" },
];

export default function Page() {
  return (
    <>
      <DocTitle title="Getting started" intro="From download to your first multi-agent session in a few minutes." />

      <Section title="1. Install CodeGrid">
        <P>
          Download the latest release, open the <C>.dmg</C>, and drag CodeGrid into Applications. The app is
          signed with an Apple Developer ID and notarized, so it opens with no Gatekeeper warnings.
        </P>
        <a href="/download" className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-6 py-3 transition-colors mt-1">
          Download for Mac ↓
        </a>
      </Section>

      <Section title="2. Install your agents">
        <P>
          CodeGrid launches the agent CLIs you already use and auto-detects them on your <C>PATH</C>
          {" "}(it also checks <C>/opt/homebrew/bin</C> and <C>~/.local/bin</C>). Install any you want:
        </P>
        {agents.map((a) => (
          <div key={a.name} className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm font-semibold text-text-primary">{a.name}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-text-secondary hover:text-accent">docs →</a>
            </div>
            <Code>{a.cmd}</Code>
          </div>
        ))}
        <Callout kind="note">
          Each agent authenticates with its own account — CodeGrid stores no keys. A plain shell needs nothing; it uses your <C>$SHELL</C>.
        </Callout>
      </Section>

      <Section title="3. First run & onboarding">
        <P>
          On first launch, a short onboarding walks you through detecting your agents and enabling
          collaboration with one click. You can reopen it anytime from <b className="text-text-primary">Help → Getting Started</b>.
        </P>
      </Section>

      <Section title="4. Your first session">
        <OL
          items={[
            <>Press <Kbd>⌘N</Kbd>, pick an agent (or shell), and choose a project folder.</>,
            <>Open a second agent the same way — say Codex alongside Claude.</>,
            <>Click <b className="text-text-primary">AUTO</b> (top-right of the canvas) to tile them side by side; <b className="text-text-primary">FIT</b> zooms to show everything.</>,
            <>Press <Kbd>⌘B</Kbd> to broadcast one prompt to every pane, or <Kbd>⌘K</Kbd> for the command palette.</>,
            <>Ask one agent to collaborate with another via the <a href="/docs/agent-bus" className="text-accent hover:underline">Agent Bus</a>.</>,
          ]}
        />
      </Section>

      <Section title="Next steps">
        <UL
          items={[
            <><a href="/docs/concepts" className="text-accent hover:underline">Concepts</a> — the mental model in 2 minutes.</>,
            <><a href="/docs/agent-bus" className="text-accent hover:underline">The Agent Bus</a> — make your agents work together.</>,
            <><a href="/docs/shortcuts" className="text-accent hover:underline">Keyboard shortcuts</a> — the full reference.</>,
          ]}
        />
      </Section>

      <PrevNext current="/docs/getting-started" />
    </>
  );
}
