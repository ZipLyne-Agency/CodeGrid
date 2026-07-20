import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, ShortcutGrid, Kbd, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Command palette — CodeGrid Docs",
  description: "Press ⌘K to search and run any action — switch workspaces, create sessions, launch agents, run git, jump to panes.",
  alternates: { canonical: "https://www.codegrid.app/docs/command-palette" },
};

const nav: [string, string][] = [
  ["⌘ K", "Open the palette"],
  ["↑ ↓", "Move through results"],
  ["⏎", "Run the highlighted action"],
  ["Esc", "Dismiss the palette"],
];

export default function Page() {
  return (
    <>
      <DocTitle title="Command palette" intro="One keystroke to do anything — no menu hunting." />

      <Section title="Opening it">
        <P>
          Press <Kbd>⌘K</Kbd> from anywhere in CodeGrid to open the palette, then type to filter. Results rank
          as you type, so a few characters are usually enough. The palette is keyboard-first: you never need the
          mouse to find or run an action.
        </P>
        <Callout kind="tip">Don&apos;t remember the exact name? Type what you want to <em>do</em> — &ldquo;new claude&rdquo;, &ldquo;grid&rdquo;, &ldquo;commit&rdquo; — and the closest matches surface first.</Callout>
      </Section>

      <Section title="What you can do">
        <P>The palette covers every command in the app. The main categories:</P>
        <UL items={[
          <><b className="text-text-primary">Launch agents</b> — start a new session running Claude, Codex, Gemini, Grok, Cursor, or a plain shell.</>,
          <><b className="text-text-primary">Sessions &amp; panes</b> — create, close, or maximize a session, and jump focus to a specific pane.</>,
          <><b className="text-text-primary">Switch workspaces</b> — hop to any workspace by name, or create a new one.</>,
          <><b className="text-text-primary">Open panels</b> — Files, Search, Git, Settings, and the MCP manager.</>,
          <><b className="text-text-primary">Layout presets</b> — re-tile the canvas with AUTO, FOCUS, COLS, ROWS, GRID, or FIT.</>,
          <><b className="text-text-primary">Run commands</b> — toggle broadcast mode, the sidebar, and other app actions.</>,
        ]} />
        <P>
          If an action has a keyboard shortcut, the palette shows it next to the result — a quick way to learn the
          bindings on the <a href="/docs/shortcuts" className="text-accent hover:underline">shortcuts</a> page over time.
        </P>
      </Section>

      <Section title="Example queries">
        <P>A few things you might type:</P>
        <UL items={[
          <><C>new codex</C> — spin up a Codex session.</>,
          <><C>grid</C> — re-tile every pane into a strict grid.</>,
          <><C>git</C> — open the Git panel for the focused session.</>,
          <><C>broadcast</C> — toggle typing to every pane at once.</>,
          <><C>settings</C> — jump straight to preferences.</>,
        ]} />
      </Section>

      <Section title="Navigating the palette">
        <P>Once it&apos;s open, everything is one hand on the keyboard:</P>
        <ShortcutGrid rows={nav} />
        <P>Run an action and the palette closes automatically, dropping you back into your workspace.</P>
      </Section>

      <PrevNext current="/docs/command-palette" />
    </>
  );
}
