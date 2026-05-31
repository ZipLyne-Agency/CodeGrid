import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Code, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "MCP servers — CodeGrid Docs",
  description: "Manage Model Context Protocol servers for your agents from inside CodeGrid — add, toggle, and remove.",
  alternates: { canonical: "https://www.codegrid.app/docs/mcp" },
};

const EXAMPLE_CONFIG = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
    }
  }
}`;

export default function Page() {
  return (
    <>
      <DocTitle title="MCP servers" intro="Manage the Model Context Protocol servers your agents can use." />

      <Section title="What MCP gives your agents">
        <P>
          The <b className="text-text-primary">Model Context Protocol</b> lets an agent like Claude Code or Codex
          connect to external tools and data sources — filesystems, databases, issue trackers, your own services —
          through a standard interface. CodeGrid doesn&apos;t replace that protocol; it gives you one place to manage
          the servers each agent can reach.
        </P>
      </Section>

      <Section title="The MCP Manager">
        <P>
          Open the MCP Manager from the command palette (<C>⌘K</C> → &ldquo;MCP&rdquo;) or Settings. It lists the MCP
          servers configured for your agents and lets you:
        </P>
        <UL items={[
          "Add a server (command + args, or paste a JSON config block).",
          "Toggle servers on/off per agent.",
          "Remove servers you no longer need.",
        ]} />
        <P>Edits are written back to each agent&apos;s own MCP config, so the agents pick them up the same way they would from the CLI.</P>
      </Section>

      <Section title="Adding a server">
        <P>
          Most servers are a command CodeGrid launches plus its arguments. You can fill those fields directly, or
          paste a Claude-Code-style JSON block — the manager merges it into the agent&apos;s config. For example, to
          add the filesystem server scoped to a project directory:
        </P>
        <Code label="mcp config">{EXAMPLE_CONFIG}</Code>
        <P>
          Each entry under <C>mcpServers</C> is keyed by a name you choose (here <C>filesystem</C>), with a{" "}
          <C>command</C> and an <C>args</C> array. Servers that need secrets can also take an <C>env</C> object.
        </P>
        <Callout kind="tip">After adding a server, confirm the agent picked it up by running <C>/mcp</C> in its pane.</Callout>
      </Section>

      <Section title="The Agent Bus is an MCP server">
        <P>
          CodeGrid&apos;s own <a href="/docs/agent-bus" className="text-accent hover:underline">Agent Bus</a> is delivered as an
          MCP server (<C>codegrid-agent-bus</C>). Enabling collaboration in onboarding — or running its{" "}
          <C>setup</C> — registers it into each agent&apos;s MCP config for you.
        </P>
        <Callout kind="note">Confirm what an agent has loaded by running <C>/mcp</C> in its pane (Claude Code / Codex).</Callout>
      </Section>

      <PrevNext current="/docs/mcp" />
    </>
  );
}
