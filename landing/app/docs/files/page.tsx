import type { Metadata } from "next";
import { DocTitle, Section, P, UL, Kbd, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Files & search — CodeGrid Docs",
  description: "Browse the file tree, run project-wide search, and manage files without leaving CodeGrid.",
  alternates: { canonical: "https://www.codegrid.app/docs/files" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Files & search" intro="A file tree and project search built into the sidebar." />

      <Section title="File tree">
        <P>The <b className="text-text-primary">Files</b> panel (sidebar) shows the active workspace&apos;s directory with native file-type icons. From it you can:</P>
        <UL items={[
          "Open files in the built-in code viewer/editor.",
          "Create folders, rename, move, copy, and delete files.",
          <>Right-click for actions like <b className="text-text-primary">Reveal in Finder</b> and <b className="text-text-primary">Open in default app</b>.</>,
        ]} />
      </Section>

      <Section title="Project search">
        <P>Press <Kbd>⌘⇧F</Kbd> to search across the project. Jump to any match — it opens the file in the viewer at the right line.</P>
      </Section>

      <Section title="Toggle the sidebar">
        <P><Kbd>⌘S</Kbd> shows/hides the sidebar; the activity icons switch between Files, Search, Git, and Settings.</P>
      </Section>

      <PrevNext current="/docs/files" />
    </>
  );
}
