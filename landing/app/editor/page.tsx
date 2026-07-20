import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Files & editor — browse, search, and edit without leaving | CodeGrid",
  description:
    "A file tree with Git status, a syntax-highlighting code editor and diff viewer, project-wide search, an interactive dependency graph, and a CLAUDE.md editor — all in the CodeGrid sidebar.",
  alternates: { canonical: "https://www.codegrid.app/editor" },
};

export default function EditorPage() {
  return (
    <FeaturePage
      eyebrow="Files & editor"
      title={<>Browse, search, and edit — <span className="text-accent">in place.</span></>}
      intro={
        <>
          You don't need to open a separate editor to glance at a file or search your codebase.
          CodeGrid puts a file tree, a code editor, search, and a dependency graph in the sidebar.
        </>
      }
      docsHref="/docs/editor"
      sections={[
        {
          title: "Your project, in the sidebar",
          items: [
            { name: "File tree", desc: "Browse your project with file-type icons and per-file Git status — modified, added, deleted, staged." },
            { name: "Context menu", desc: "Right-click to create, rename, delete, move, or copy files and folders." },
            { name: "Drag & drop", desc: "Reorder files and folders, or drag a file straight onto a pane." },
            { name: "Project search", desc: "Search across the whole codebase with ⌘⇧F — no second editor required." },
          ],
        },
        {
          title: "Read and edit code in a pane",
          items: [
            { name: "Code editor", desc: "Click any file to open it in a CodeMirror editor with syntax highlighting for TypeScript/JavaScript, Python, Rust, JSON, Markdown, CSS, and HTML." },
            { name: "Live editable", desc: "Files are editable in place and stay in sync with what your agents are doing." },
            { name: "Diff viewer", desc: "Review staged and unstaged changes in a syntax-highlighted diff." },
            { name: "Dependency graph", desc: "Explore an interactive, force-directed graph of your file dependencies (TypeScript, JavaScript, Python, Rust). Click a node to jump to the file; zoom, pan, and drag to navigate." },
            { name: "CLAUDE.md editor", desc: "Read and write your project's CLAUDE.md instructions — as Markdown or structured JSON." },
          ],
        },
      ]}
      closingTitle={<>One app for the whole loop.</>}
      closingBlurb="Agents, Git, files, and preview — without leaving the canvas."
    />
  );
}
