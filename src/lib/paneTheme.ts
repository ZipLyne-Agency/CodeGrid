/**
 * Shared visual tokens for pane chrome — agent identity + status.
 * Color is paired with a glyph everywhere so the UI is legible without color.
 */

import { AGENT_ICON, type Icon } from "./icons";

export type AgentKind = "claude" | "codex" | "gemini" | "cursor" | "grok" | "shell" | "browser" | "note";

export interface AgentTheme {
  kind: AgentKind;
  /** Short, mixed-case label shown in the pane chrome. */
  label: string;
  /** ≤6 char tag pill (uppercase ok). */
  tag: string;
  /** Solid color (matches a CSS var). */
  color: string;
  /** Phosphor icon component for this agent/kind (use weight="fill" when active). */
  icon: Icon;
  /** Legacy unicode glyph — kept as a fallback; prefer `icon`. */
  glyph: string;
}

const AGENTS: Record<AgentKind, AgentTheme> = {
  claude:  { kind: "claude",  label: "Claude",  tag: "CLAUDE",  color: "#ff8c00", icon: AGENT_ICON.claude,  glyph: "◆" },
  codex:   { kind: "codex",   label: "Codex",   tag: "CODEX",   color: "#5cb185", icon: AGENT_ICON.codex,   glyph: "▶" },
  gemini:  { kind: "gemini",  label: "Gemini",  tag: "GEMINI",  color: "#6f9bcc", icon: AGENT_ICON.gemini,  glyph: "✦" },
  cursor:  { kind: "cursor",  label: "Cursor",  tag: "CURSOR",  color: "#a98bd6", icon: AGENT_ICON.cursor,  glyph: "⌖" },
  grok:    { kind: "grok",    label: "Grok",    tag: "GROK",    color: "#cfcfcf", icon: AGENT_ICON.grok,    glyph: "⌬" },
  shell:   { kind: "shell",   label: "Shell",   tag: "SHELL",   color: "#6f9bcc", icon: AGENT_ICON.shell,   glyph: "›_" },
  browser: { kind: "browser", label: "Browser", tag: "WEB",     color: "#6f9bcc", icon: AGENT_ICON.browser, glyph: "◧" },
  note:    { kind: "note",    label: "Note",    tag: "NOTE",    color: "#d6a94e", icon: AGENT_ICON.note,    glyph: "✎" },
};

/** Detect the agent from a stored command string (binary path). */
export function detectAgent(command: string | null | undefined): AgentTheme {
  const cmd = (command ?? "").toLowerCase();
  if (cmd.includes("claude")) return AGENTS.claude;
  if (cmd.includes("codex")) return AGENTS.codex;
  if (cmd.includes("gemini")) return AGENTS.gemini;
  // Cursor's CLI binary is "cursor-agent"
  if (cmd.includes("cursor") || /\bagent\b/.test(cmd)) return AGENTS.cursor;
  if (cmd.includes("grok")) return AGENTS.grok;
  return AGENTS.shell;
}

export function agentTheme(kind: AgentKind): AgentTheme {
  return AGENTS[kind];
}

export interface StatusTheme {
  /** Mixed-case label. */
  label: string;
  glyph: string;
  color: string;
}

export const STATUS: Record<string, StatusTheme> = {
  idle:    { label: "idle",    glyph: "○", color: "var(--status-idle)" },
  running: { label: "running", glyph: "●", color: "var(--status-running)" },
  waiting: { label: "needs you", glyph: "▲", color: "var(--status-waiting)" },
  error:   { label: "error",   glyph: "✕", color: "var(--status-error)" },
  dead:    { label: "stopped", glyph: "◌", color: "var(--status-dead)" },
};

export function statusTheme(status: string | null | undefined): StatusTheme {
  return STATUS[status ?? "idle"] ?? STATUS.idle;
}

/** Convert hex to "r,g,b" for use in rgba(). */
export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "255, 140, 0";
  return `${parseInt(h.substring(0, 2), 16)}, ${parseInt(h.substring(2, 4), 16)}, ${parseInt(h.substring(4, 6), 16)}`;
}
