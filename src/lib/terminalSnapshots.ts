import type { Terminal } from "@xterm/xterm";

/**
 * Lightweight per-session registry so the pane chrome (Pane.tsx) can grab a
 * terminal's recent on-screen text without prop-drilling through Terminal.tsx.
 * Used by the "✨ name this terminal" action — only the last N lines are read,
 * and nothing is sent anywhere until the user explicitly clicks the button.
 */
const registry = new Map<string, { current: Terminal | null }>();

export function registerTerminalSnapshot(id: string, termRef: { current: Terminal | null }): void {
  registry.set(id, termRef);
}

export function unregisterTerminalSnapshot(id: string): void {
  registry.delete(id);
}

/** Last ~`maxLines` of the terminal's buffer as plain text, or "" if unavailable. */
export function getTerminalSnapshot(id: string, maxLines = 160): string {
  const term = registry.get(id)?.current;
  if (!term) return "";
  const buf = term.buffer.active;
  const start = Math.max(0, buf.length - maxLines);
  const out: string[] = [];
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) out.push(line.translateToString(true).replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
