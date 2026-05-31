import type { Metadata } from "next";
import { DocTitle, Section, ShortcutGrid, P, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Keyboard shortcuts — CodeGrid Docs",
  description: "The complete CodeGrid keyboard reference — sessions, panes, navigation, workspaces, and views.",
  alternates: { canonical: "https://www.codegrid.app/docs/shortcuts" },
};

const sessions: [string, string][] = [
  ["⌘ N", "New session"],
  ["⌘ W", "Close focused session"],
  ["⌘ B", "Toggle broadcast mode"],
  ["⌘ ⏎", "Maximize / restore pane"],
];
const nav: [string, string][] = [
  ["⌘ ← → ↑ ↓", "Move focus between panes"],
  ["⌘ ⇧ ← → ↑ ↓", "Swap pane positions"],
  ["⌘ 1 – 9", "Jump to pane by number"],
  ["⌘ ⇧ A", "Go to next agent needing attention"],
];
const workspace: [string, string][] = [
  ["⌘ ⇧ N", "New workspace"],
  ["⌘ Tab", "Next workspace"],
  ["⌘ ⇧ Tab", "Previous workspace"],
];
const views: [string, string][] = [
  ["⌘ K", "Command palette"],
  ["⌘ S", "Toggle sidebar"],
  ["⌘ ⇧ F", "Search in files"],
  ["⌘ ,", "Settings"],
];

export default function Page() {
  return (
    <>
      <DocTitle title="Keyboard shortcuts" intro="CodeGrid is keyboard-first. Here's everything." />
      <Section title="Sessions & panes"><ShortcutGrid rows={sessions} /></Section>
      <Section title="Navigation"><ShortcutGrid rows={nav} /></Section>
      <Section title="Workspaces"><ShortcutGrid rows={workspace} /></Section>
      <Section title="Views & tools"><ShortcutGrid rows={views} /></Section>
      <Section title="In the terminal">
        <P>Inside a focused pane, keys go to the agent/shell as normal. Standard editing — copy, paste, select-all — works via the native Edit menu and its shortcuts.</P>
      </Section>
      <PrevNext current="/docs/shortcuts" />
    </>
  );
}
