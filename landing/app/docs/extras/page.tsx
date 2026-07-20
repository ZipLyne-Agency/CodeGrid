import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Sticky notes, run & more — CodeGrid Docs",
  description: "The extras that round out CodeGrid: sticky notes, the Run App button, browser panes, dependency graph, skills, and resource monitoring.",
  alternates: { canonical: "https://www.codegrid.app/docs/extras" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Sticky notes, run & more" intro="The small things that make a workspace feel complete." />

      <Section title="Sticky notes">
        <P>Drop a <b className="text-text-primary">NOTE</b> anywhere on the canvas to jot reminders, prompts, or plans next to your agents. Notes persist per workspace.</P>
      </Section>

      <Section title="Run App">
        <P>The <b className="text-text-primary">RUN APP</b> button launches your project (web, desktop, or mobile) and surfaces the dev URL/port — so you can start what your agents are building without a separate command.</P>
      </Section>

      <Section title="Browser panes">
        <P>Open a live browser pane on the canvas to preview a running app right beside the agent working on it.</P>
      </Section>

      <Section title="Dependency graph">
        <P>Visualize how your project&apos;s modules import each other — a quick map of the codebase your agents are touching.</P>
      </Section>

      <Section title="Skills panel">
        <P>Browse and manage the Claude Code skills detected for your project, so you know what capabilities your agents can reach for.</P>
      </Section>

      <Section title="Resource monitoring">
        <P>The top bar shows live memory use across your sessions (e.g. <C>800M / 38.8G</C>), and CodeGrid warns before you spin up more sessions than your machine can comfortably handle.</P>
      </Section>

      <PrevNext current="/docs/extras" />
    </>
  );
}
