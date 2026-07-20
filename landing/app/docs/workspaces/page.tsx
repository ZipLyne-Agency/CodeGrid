import type { Metadata } from "next";
import { DocTitle, Section, P, UL, Kbd, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Workspaces — CodeGrid Docs",
  description: "Organize work into named workspaces, each with its own canvas, sessions, layout, and bound repo.",
  alternates: { canonical: "https://www.codegrid.app/docs/workspaces" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Workspaces" intro="A workspace is a project context — its own canvas, sessions, layout, and optional repo." />

      <Section title="Managing workspaces">
        <UL items={[
          <><b className="text-text-primary">New</b> — the <C>+</C> next to the workspace tabs, or <Kbd>⌘⇧N</Kbd>.</>,
          <><b className="text-text-primary">Switch</b> — click a tab, or <Kbd>⌘Tab</Kbd> / <Kbd>⌘⇧Tab</Kbd> to cycle. Each restores its own panes and arrangement.</>,
          <><b className="text-text-primary">Rename</b> — double-click a workspace tab.</>,
          <><b className="text-text-primary">Delete</b> — right-click a tab → Delete. Deleting your last workspace resets to a fresh empty one (CodeGrid always keeps at least one).</>,
        ]} />
      </Section>

      <Section title="Bound repositories">
        <P>
          A workspace can be bound to a repo path. New sessions default to that directory, and git actions
          (status, branch, publish) target it. Open a folder as a new workspace and CodeGrid auto-names the
          workspace after it.
        </P>
      </Section>

      <Section title="Layouts are per-workspace">
        <P>
          Your pane positions, zoom, and pan are saved against each workspace, so switching contexts feels
          like switching desks — everything is exactly where you left it.
        </P>
      </Section>

      <PrevNext current="/docs/workspaces" />
    </>
  );
}
