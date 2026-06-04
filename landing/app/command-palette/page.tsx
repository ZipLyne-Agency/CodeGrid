import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Command palette & shortcuts — drive everything from the keyboard | CodeGrid",
  description:
    "Press Cmd+K to search workspaces, projects, sessions, and actions. Plus a full set of macOS keyboard shortcuts for panes, layouts, broadcast, Git, workspaces, and terminal zoom.",
  alternates: { canonical: "https://www.codegrid.app/command-palette" },
};

export default function CommandPalettePage() {
  return (
    <FeaturePage
      eyebrow="Command palette"
      title={<>Drive everything <span className="text-accent">from the keyboard.</span></>}
      intro={
        <>
          Press <span className="font-mono text-text-primary">⌘K</span> to reach any action instantly —
          search workspaces, open folders, launch sessions, and run commands without touching the mouse.
        </>
      }
      docsHref="/docs/command-palette"
      sections={[
        {
          title: "Everything, one search away",
          blurb: "The palette groups actions by category so you can type a few letters and go.",
          items: [
            { name: "Workspaces", desc: "Switch to any workspace, or create a new one." },
            { name: "Projects", desc: "Open a folder or start a new project." },
            { name: "Sessions", desc: "New session, new localhost preview pane, new note, or a detached scratch terminal." },
            { name: "View", desc: "Toggle the sidebar, toggle broadcast, or fit all panes to view." },
            { name: "Tools", desc: "Run an AI code review on uncommitted changes, or generate an AI commit message." },
            { name: "App", desc: "Jump to Getting Started and other app actions." },
          ],
        },
        {
          title: "Keyboard shortcuts",
          blurb: "macOS bindings (⌘ is Cmd).",
          items: [
            { name: "⌘N", desc: "New pane" },
            { name: "⌘W", desc: "Close pane" },
            { name: "⌘K", desc: "Command palette" },
            { name: "⌘P", desc: "Switch pane" },
            { name: "⌘1–9", desc: "Focus pane 1–9" },
            { name: "⌘ ← ↑ ↓ →", desc: "Focus pane in a direction" },
            { name: "⌘⇧ ← ↑ ↓ →", desc: "Swap pane positions" },
            { name: "⌘⏎", desc: "Maximize / restore pane" },
            { name: "⌘⇧⏎", desc: "Fit all panes to view" },
            { name: "⌘B", desc: "Toggle broadcast (type to every pane)" },
            { name: "⌘⇧J", desc: "New scratch terminal" },
            { name: "⌘⇧F", desc: "Search in files" },
            { name: "⌘S", desc: "Toggle sidebar" },
            { name: "⌘G", desc: "Open Git Manager" },
            { name: "⌘Tab", desc: "Next workspace" },
            { name: "⌘⇧Tab", desc: "Previous workspace" },
            { name: "⌘⇧N", desc: "New workspace" },
            { name: "⌘,", desc: "Settings" },
            { name: "⌘= / ⌘+", desc: "Zoom terminal in" },
            { name: "⌘-", desc: "Zoom terminal out" },
            { name: "⌘0", desc: "Reset terminal zoom" },
          ],
        },
      ]}
      closingTitle={<>Keep your hands on the keyboard.</>}
      closingBlurb="Search, switch, and launch — without breaking flow."
    />
  );
}
