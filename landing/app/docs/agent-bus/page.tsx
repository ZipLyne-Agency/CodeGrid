import type { Metadata } from "next";
import { DocTitle, Section, P, UL, OL, C, Kbd, Code, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "The Agent Bus — CodeGrid Docs",
  description:
    "Let one AI agent message and read another's pane — native agent-to-agent collaboration in CodeGrid, no tmux required. Install, tools, and usage.",
  alternates: { canonical: "https://www.codegrid.app/docs/agent-bus" },
};

export default function Page() {
  return (
    <>
      <DocTitle
        title="The Agent Bus"
        intro="Let your agents work together — one agent can message and read another agent's pane, natively, with no tmux."
      />

      <Section title="What it is">
        <P>
          The Agent Bus is a tiny MCP server that ships with CodeGrid (<C>agent-bus-mcp.cjs</C>). It gives your
          agents three tools so they can collaborate: Claude can hand a task to Codex, read its reply, and keep
          going — all while both stay visible side by side on the canvas.
        </P>
        <Callout kind="note">It talks to CodeGrid over a local socket — no tmux, no extra terminal multiplexer, no daemons. CodeGrid already owns the panes, so the bus just exposes them.</Callout>
      </Section>

      <Section title="The tools">
        <UL items={[
          <><C>list_agents</C> — every pane CodeGrid is running: <C>session_id</C>, pane #, command, status, directory.</>,
          <><C>read_pane(session_id)</C> — recent output of a pane (ANSI-stripped).</>,
          <><C>message_agent(session_id, text)</C> — types a message into another agent&apos;s pane and presses Enter.</>,
        ]} />
      </Section>

      <Section title="Install (one click)">
        <P>The fastest path: the onboarding&apos;s <b className="text-text-primary">&quot;Enable collaboration&quot;</b> button configures every agent for you. To do it manually, run the bundled installer — it auto-detects Claude, Codex, Gemini, and Cursor:</P>
        <Code label="terminal">{`node "/Applications/CodeGrid.app/Contents/Resources/resources/agent-bus-mcp.cjs" setup`}</Code>
        <P>Prefer to paste the config yourself? Print ready-to-use snippets:</P>
        <Code label="terminal">{`node "<path>/agent-bus-mcp.cjs" print-config`}</Code>
        <P>Manual config (replace the path with your own):</P>
        <Code label="Claude (~/.claude.json) · Gemini (~/.gemini/settings.json) · Cursor (~/.cursor/mcp.json)">{`{
  "mcpServers": {
    "codegrid-agent-bus": {
      "command": "node",
      "args": ["/path/to/agent-bus-mcp.cjs"]
    }
  }
}`}</Code>
        <Code label="Codex (~/.codex/config.toml)">{`[mcp_servers.codegrid-agent-bus]
command = "node"
args = ["/path/to/agent-bus-mcp.cjs"]`}</Code>
      </Section>

      <Section title="Verify">
        <P>In an agent pane, run <C>/mcp</C> and look for <C>codegrid-agent-bus</C> with the three tools. Missing? That pane started before install — close it (<Kbd>⌘W</Kbd>) and open a fresh one (<Kbd>⌘N</Kbd>).</P>
      </Section>

      <Section title="Use it">
        <OL items={[
          <>Open the agents you want as panes, then click <b className="text-text-primary">AUTO</b> to see them side by side.</>,
          <>In one agent, ask in plain English — it calls the tools for you:</>,
        ]} />
        <Code label="paste into the Claude pane">{`Use codegrid-agent-bus: list_agents, find the Codex pane, ask it to
implement <feature>, then read_pane its reply and review what it did.`}</Code>
        <P>You&apos;ll watch the message get typed into the Codex pane and the reply read back — two agents reasoning together.</P>
        <Callout kind="tip">You never call <C>list_agents</C> yourself — it&apos;s a tool the agent invokes. You talk to the agent in English; it does the tool calls. Address agents by the <C>session_id</C> from <C>list_agents</C>, never by guessing.</Callout>
      </Section>

      <Section title="Patterns">
        <UL items={[
          <><b className="text-text-primary">Delegate</b> — Claude → message Codex to implement → poll until done → summarize.</>,
          <><b className="text-text-primary">Review</b> — finish a change, ask another agent to review the diff, apply the feedback.</>,
          <><b className="text-text-primary">Pipeline</b> — Gemini researches → you implement → Codex reviews. Each hand-off is read → message → read.</>,
          <><b className="text-text-primary">Monitor</b> — read a build/test/shell pane to react to its output.</>,
        ]} />
        <P>Teach your agents to do this well with a <a href="/docs/agent-bus-skill" className="text-accent hover:underline">collaboration skill</a>.</P>
      </Section>

      <Section title="Troubleshooting">
        <UL items={[
          <><b className="text-text-primary">&quot;Can&apos;t reach CodeGrid&quot;</b> — the app must be running (the bus uses <C>~/.codegrid/socket</C>).</>,
          <><b className="text-text-primary">Tools missing</b> — install (above), then open a fresh pane.</>,
          <><b className="text-text-primary">Typed into the wrong pane</b> — give the agent the exact <C>session_id</C> from <C>list_agents</C>.</>,
        ]} />
      </Section>

      <PrevNext current="/docs/agent-bus" />
    </>
  );
}
