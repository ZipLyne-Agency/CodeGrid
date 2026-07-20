import type { Metadata } from "next";
import { DocTitle, Section, P, UL, Kbd, C, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Code viewer & editor — CodeGrid Docs",
  description: "Read and edit files inline with a CodeMirror-powered viewer, syntax highlighting, diff view, and hunk staging.",
  alternates: { canonical: "https://www.codegrid.app/docs/editor" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Code viewer & editor" intro="Open, read, and edit files inline — without leaving the canvas." />

      <Section title="Viewing & editing">
        <P>Open a file from the tree, search, or git panel. The viewer is powered by CodeMirror with syntax highlighting for TypeScript, JS, Python, Rust, JSON, CSS, HTML, Markdown, and more.</P>
        <UL items={[
          <>Edit inline; <Kbd>⌘S</Kbd> saves. The header shows <b className="text-text-primary">modified</b> when you have unsaved changes, with Save / Discard.</>,
          "Jump to a specific line (e.g. from a search result or git diff).",
          "Resize the panel by dragging its top edge.",
        ]} />
      </Section>

      <Section title="Diff mode">
        <P>Toggle <b className="text-text-primary">CODE / DIFF</b> in the header to see the file&apos;s git changes — additions and deletions with old/new line numbers, plus a per-hunk <b className="text-text-primary">Stage Hunk</b> button to stage exactly the changes you want.</P>
      </Section>

      <Section title="CLAUDE.md editor">
        <P>CodeGrid includes a dedicated editor for your project&apos;s <C>CLAUDE.md</C> (and agent instruction files), so you can tune how your agents behave without digging through the tree.</P>
        <Callout kind="tip">Press <Kbd>Esc</Kbd> to close the viewer.</Callout>
      </Section>

      <PrevNext current="/docs/editor" />
    </>
  );
}
