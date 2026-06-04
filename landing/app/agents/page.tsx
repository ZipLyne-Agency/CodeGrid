import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Supported agents — Claude, Codex, Gemini, Grok, Cursor, Venice | CodeGrid",
  description:
    "CodeGrid runs Claude, Codex, Gemini, Grok, Cursor, Venice, and plain shells side by side — the real CLIs in real PTYs, no wrappers. Mix agents in one workspace and use the best model for each task.",
  alternates: { canonical: "https://www.codegrid.app/agents" },
};

export default function AgentsPage() {
  return (
    <FeaturePage
      eyebrow="The agents"
      title={<>Every agent. <span className="text-accent">One canvas.</span></>}
      intro={
        <>
          CodeGrid launches the same coding-agent CLIs you already use — inside real PTYs, with no
          wrappers and no lock-in. Run them side by side and pick the best model for each task.
        </>
      }
      docsHref="/docs/sessions"
      sections={[
        {
          title: "Six coding agents, plus your shell",
          blurb: "Each pane runs the real CLI in its own PTY, connected to its own project directory.",
          items: [
            { name: "Claude — Anthropic", desc: "Claude Code (claude)." },
            { name: "Codex — OpenAI", desc: "Codex (codex)." },
            { name: "Gemini — Google", desc: "Gemini (gemini)." },
            { name: "Grok — xAI", desc: "Grok (grok)." },
            { name: "Cursor — Cursor", desc: "Cursor's agent (cursor-agent)." },
            { name: "Venice — aider · all models", desc: "Venice runs through aider. On first launch CodeGrid installs aider for you and asks for your Venice API key, which it saves locally with restricted permissions." },
            { name: "Shell — your terminal", desc: "Any shell on your PATH, for the commands you'd run by hand." },
          ],
        },
        {
          title: "No migration. No wrappers.",
          cols: 2,
          items: [
            { name: "Your existing setup, as-is", desc: "CodeGrid doesn't replace your tools — it launches the same workflows you already use in real PTYs." },
            { name: "Mix agents per workspace", desc: "Claude on the API layer, Codex on the frontend, Gemini reviewing the tests — all on one canvas, all in parallel." },
            { name: "Resume where you left off", desc: "Sessions can continue your most recent conversation, or open a picker to resume a specific one, when you reopen the app." },
            { name: "They can collaborate", desc: <>The Agent Bus lets one agent message and read another's pane — <a href="/agent-bus" className="text-accent hover:underline">see the Agent Bus →</a></> },
          ],
        },
      ]}
      closingTitle={<>Use the best model for every job.</>}
      closingBlurb="Free, open source, and local-first — bring the agents you already have."
    />
  );
}
