import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Code, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Writing a collaboration skill — CodeGrid Docs",
  description: "Give your agents a skill so they know how to use the Agent Bus to collaborate well — the read→message→read protocol and etiquette.",
  alternates: { canonical: "https://www.codegrid.app/docs/agent-bus-skill" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Writing a collaboration skill" intro="Tools let agents talk; a skill teaches them how to collaborate well." />

      <Section title="Why a skill">
        <P>
          The Agent Bus gives agents the <i>ability</i> to message each other. A short skill — a markdown file
          dropped into your agent&apos;s instructions (e.g. <C>CLAUDE.md</C>, <C>AGENTS.md</C>, or a Claude Code skill) —
          teaches the <i>protocol</i>: read before you write, address by <C>session_id</C>, one message then wait,
          and don&apos;t loop forever.
        </P>
      </Section>

      <Section title="The protocol">
        <UL items={[
          <><b className="text-text-primary">List</b> — <C>list_agents</C> to find the target by role and grab its <C>session_id</C>.</>,
          <><b className="text-text-primary">Read first</b> — <C>read_pane</C> the target so you don&apos;t talk over it.</>,
          <><b className="text-text-primary">Message</b> — one clear, self-contained request; identify yourself and say what you want back.</>,
          <><b className="text-text-primary">Read again</b> — wait, then <C>read_pane</C> for the reply. Re-read rather than spamming.</>,
        ]} />
      </Section>

      <Section title="Etiquette & safety">
        <UL items={[
          <><b className="text-text-primary">One message, then wait</b> — multiple messages before a reply garble the other agent&apos;s input.</>,
          <><b className="text-text-primary">Be explicit about scope</b> — other agents may be in autonomous/YOLO mode and will act on what you send. Say &quot;propose only&quot; when you just want analysis.</>,
          <><b className="text-text-primary">Don&apos;t loop</b> — converge on a result and report to the user instead of infinite ping-pong.</>,
          <><b className="text-text-primary">Read-only when unsure</b> — <C>read_pane</C> is always safe for observing a long-running agent.</>,
        ]} />
      </Section>

      <Section title="Drop-in skill">
        <P>CodeGrid ships a ready-made one at <C>guides/agent-bus-skill.md</C> in the repo. Add it to your agent&apos;s context, or paste this frontmatter-style header to make it a Claude Code skill:</P>
        <Code label="agent-bus-skill.md (header)">{`---
name: codegrid-agent-bus
description: How to collaborate with other agents in CodeGrid via the
  codegrid-agent-bus tools (list_agents, read_pane, message_agent).
  Use when asked to delegate to, consult, or coordinate with another agent.
---`}</Code>
        <Callout kind="tip">Keep the skill short and imperative. Agents follow a tight &quot;list → read → message → read&quot; loop far more reliably than a wall of prose.</Callout>
      </Section>

      <PrevNext current="/docs/agent-bus-skill" />
    </>
  );
}
