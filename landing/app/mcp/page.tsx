import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "MCP server manager — configure tools per agent | CodeGrid",
  description:
    "Manage Model Context Protocol servers from a UI inside CodeGrid. Add, edit, toggle, and remove MCP servers per agent — Claude, Codex, Cursor, Gemini, and Grok — with one-click presets for popular servers.",
  alternates: { canonical: "https://www.codegrid.app/mcp" },
};

export default function McpPage() {
  return (
    <FeaturePage
      eyebrow="MCP"
      title={<>MCP servers, <span className="text-accent">managed for you.</span></>}
      intro={
        <>
          Configure Model Context Protocol servers from a UI inside CodeGrid — no hand-editing
          JSON config files. Add, edit, toggle, and remove servers, scoped per agent.
        </>
      }
      docsHref="/docs/mcp"
      sections={[
        {
          title: "A real UI for your MCP config",
          items: [
            { name: "See every server", desc: "View all your configured MCP servers, grouped by the agent they belong to." },
            { name: "Add a server", desc: "Add a server by command and arguments or by URL — or pick from the preset list." },
            { name: "Edit inline", desc: "Edit a server's command, args, environment variables, URL, and headers without leaving the app." },
            { name: "Toggle on & off", desc: "Enable or disable a server without deleting it, so you can flip tools on per project." },
            { name: "Remove cleanly", desc: "Delete a server's config when you no longer need it." },
            { name: "Per-agent scoping", desc: "Claude, Codex, Cursor, Gemini, and Grok each keep their own independent MCP configuration." },
          ],
        },
        {
          title: "One-click presets",
          blurb: "Install popular MCP servers without looking up the command.",
          items: [
            { name: "filesystem", desc: "File system access for your agents." },
            { name: "github", desc: "The GitHub API as a tool." },
            { name: "postgres", desc: "Query a PostgreSQL database." },
            { name: "sqlite", desc: "Query a SQLite database." },
            { name: "puppeteer", desc: "Browser automation." },
            { name: "brave-search", desc: "Web search via the Brave Search API." },
            { name: "memory", desc: "A persistent memory store." },
            { name: "sequential-thinking", desc: "Step-by-step reasoning." },
          ],
        },
      ]}
      closingTitle={<>Give every agent the right tools.</>}
      closingBlurb="Configure once, in a UI — then let your agents use them on the canvas."
    />
  );
}
