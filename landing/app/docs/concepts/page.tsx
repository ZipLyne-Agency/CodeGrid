import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Concepts — CodeGrid Docs",
  description: "The CodeGrid mental model: canvas, panes, sessions, agents, workspaces, and the agent bus.",
  alternates: { canonical: "https://www.codegrid.app/docs/concepts" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Concepts" intro="Five ideas and you know CodeGrid." />

      <Section title="Canvas">
        <P>An infinite 2D surface where your work lives. Pan, zoom, and arrange panes freely — like a whiteboard for terminals. Each <b className="text-text-primary">workspace</b> has its own canvas with its own saved layout.</P>
      </Section>
      <Section title="Pane / Session">
        <P>A <b className="text-text-primary">session</b> is one running process — an agent or a shell — with its own working directory, git branch, and live terminal. Each session is shown as a <b className="text-text-primary">pane</b> on the canvas. They&apos;re the same thing from two angles: the process, and its window.</P>
      </Section>
      <Section title="Agent">
        <P>The CLI running inside a session. CodeGrid supports <C>claude</C>, <C>codex</C>, <C>gemini</C>, <C>cursor-agent</C>, and any shell. CodeGrid launches them — it doesn&apos;t replace or wrap them, so they behave exactly as they do in a normal terminal.</P>
      </Section>
      <Section title="Workspace">
        <P>A named project context — its own set of sessions, layout, and (optionally) a bound repo. Switch workspaces with <C>⌘Tab</C>; each restores its panes and arrangement.</P>
      </Section>
      <Section title="Agent Bus">
        <P>A built-in channel that lets one agent <b className="text-text-primary">see and message another agent&apos;s pane</b>. This is what turns a grid of independent agents into a team that can reason together. See <a href="/docs/agent-bus" className="text-accent hover:underline">The Agent Bus</a>.</P>
      </Section>

      <Section title="Where state lives">
        <UL items={[
          <>Sessions, workspaces, and layouts persist in a local database (<C>~/.config/codegrid</C>) and restore on launch.</>,
          <>A local control socket (<C>~/.codegrid/socket</C>) powers the agent bus and external automation.</>,
          <>No accounts, no cloud sync — everything is on your machine.</>,
        ]} />
      </Section>

      <PrevNext current="/docs/concepts" />
    </>
  );
}
