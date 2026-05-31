import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Code, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Menu bar, tray & deep links — CodeGrid Docs",
  description: "CodeGrid's native macOS integration: full menu bar, menu-bar (tray) extra with live status, and codegrid:// deep links.",
  alternates: { canonical: "https://www.codegrid.app/docs/native" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Menu bar, tray & deep links" intro="CodeGrid is a real Mac app — it behaves like one." />

      <Section title="Application menu">
        <P>A full menu bar: <b className="text-text-primary">App</b> (About, Settings, Check for Updates), <b className="text-text-primary">File</b>, native <b className="text-text-primary">Edit</b> (cut/copy/paste/undo), <b className="text-text-primary">View</b> (command palette, sidebar, full screen), <b className="text-text-primary">Agents</b> (new agent, broadcast, go to next needing attention), <b className="text-text-primary">Window</b>, and <b className="text-text-primary">Help</b> (Getting Started, docs, report an issue).</P>
        <Callout kind="note">Context-sensitive shortcuts like <C>⌘S</C> (sidebar vs. save in the editor) stay handled in-app, so the menu never hijacks them.</Callout>
      </Section>

      <Section title="Menu-bar extra (tray)">
        <P>A tray icon shows live fleet status — <C>● N</C> agents needing you or <C>▶ N</C> running — with quick actions (Show CodeGrid, New Session, New Workspace). Left-click brings the window forward.</P>
      </Section>

      <Section title="Deep links">
        <P>CodeGrid registers the <C>codegrid://</C> URL scheme so you can open it from anywhere — scripts, the browser, or an &quot;Open in CodeGrid&quot; button:</P>
        <Code label="examples">{`codegrid://open?path=/abs/path/to/repo&type=codex   # open a folder as a session
codegrid://new                                       # open the new-session dialog`}</Code>
        <Callout kind="warn">Deep links work in the installed app (the scheme is registered at install). They won&apos;t route in a dev build.</Callout>
      </Section>

      <PrevNext current="/docs/native" />
    </>
  );
}
