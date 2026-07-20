import type { Metadata } from "next";
import { DocTitle, Section, P, UL, Kbd, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Broadcast mode — CodeGrid Docs",
  description: "Type once, send to every pane. Drive multiple agents or hosts with a single prompt.",
  alternates: { canonical: "https://www.codegrid.app/docs/broadcast" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Broadcast mode" intro="Type once, send to every pane at the same time." />

      <Section>
        <P>
          Toggle broadcast with <Kbd>⌘B</Kbd>. While it&apos;s on, your keystrokes go to <b className="text-text-primary">every</b> pane
          in the active workspace at once — so you can give the same instruction to Claude, Codex, and Gemini
          simultaneously, or run the same command across several shells.
        </P>
      </Section>

      <Section title="Good for">
        <UL items={[
          "Asking several agents the same question to compare answers.",
          "Kicking off the same task across multiple repos/worktrees.",
          "Running an identical command on a set of shell panes.",
        ]} />
        <Callout kind="warn">Broadcast sends to all panes — toggle it back off (<b className="text-text-primary">⌘B</b>) before typing something meant for just one agent. The broadcast state is clearly indicated in the UI.</Callout>
      </Section>

      <Section title="vs. the Agent Bus">
        <P>
          Broadcast is <b className="text-text-primary">one-to-many, from you</b>. The{" "}
          <a href="/docs/agent-bus" className="text-accent hover:underline">Agent Bus</a> is{" "}
          <b className="text-text-primary">agent-to-agent</b> — one agent messaging another and reading its reply.
          Use broadcast to fan out; use the bus to let agents collaborate.
        </P>
      </Section>

      <PrevNext current="/docs/broadcast" />
    </>
  );
}
