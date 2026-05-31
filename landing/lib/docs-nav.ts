/** Documentation navigation — single source of truth for the sidebar + ordering. */
export interface DocLink {
  title: string;
  href: string;
}
export interface DocSection {
  label: string;
  links: DocLink[];
}

export const DOCS_NAV: DocSection[] = [
  {
    label: "Start here",
    links: [
      { title: "Introduction", href: "/docs" },
      { title: "Getting started", href: "/docs/getting-started" },
      { title: "Concepts", href: "/docs/concepts" },
    ],
  },
  {
    label: "Core",
    links: [
      { title: "The canvas", href: "/docs/canvas" },
      { title: "Sessions & agents", href: "/docs/sessions" },
      { title: "Workspaces", href: "/docs/workspaces" },
      { title: "Broadcast mode", href: "/docs/broadcast" },
    ],
  },
  {
    label: "Agent collaboration",
    links: [
      { title: "The Agent Bus", href: "/docs/agent-bus" },
      { title: "Writing a collaboration skill", href: "/docs/agent-bus-skill" },
    ],
  },
  {
    label: "Working with code",
    links: [
      { title: "Files & search", href: "/docs/files" },
      { title: "Code viewer & editor", href: "/docs/editor" },
      { title: "Git", href: "/docs/git" },
      { title: "MCP servers", href: "/docs/mcp" },
    ],
  },
  {
    label: "Productivity",
    links: [
      { title: "Command palette", href: "/docs/command-palette" },
      { title: "Keyboard shortcuts", href: "/docs/shortcuts" },
      { title: "Notifications & attention", href: "/docs/notifications" },
      { title: "Menu bar, tray & deep links", href: "/docs/native" },
      { title: "Sticky notes, run & more", href: "/docs/extras" },
    ],
  },
  {
    label: "Platform",
    links: [
      { title: "Updates", href: "/docs/updates" },
      { title: "$GRID token", href: "/docs/token" },
      { title: "Privacy & security", href: "/docs/security" },
      { title: "Troubleshooting", href: "/docs/troubleshooting" },
    ],
  },
];

/** Flattened, ordered list — used for prev/next navigation. */
export const DOCS_FLAT: DocLink[] = DOCS_NAV.flatMap((s) => s.links);
