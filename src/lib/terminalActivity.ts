/**
 * Terminal activity detection.
 *
 * Parses PTY output to determine what process is running in a terminal session.
 * Uses two strategies:
 *   1. OSC escape sequences (title sequences emitted by shells/programs)
 *   2. Content pattern matching (keywords in the terminal output)
 */

// Matches OSC 0, 1, or 2 title-setting sequences:
//   \x1b]0;title\x07   or   \x1b]0;title\x1b\\
//   \x1b]1;title\x07   or   \x1b]1;title\x1b\\
//   \x1b]2;title\x07   or   \x1b]2;title\x1b\\
const OSC_TITLE_RE = /\x1b\](?:0|1|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

/** Activity patterns: ordered by priority (first match wins). */
const ACTIVITY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bclaude\b/i, label: "Claude" },
  { pattern: /\bgit\s+(?:push|pull|commit|merge|rebase|log|diff|status|clone|fetch|checkout|branch|stash)\b/i, label: "Git" },
  { pattern: /\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b|\bbun\b/i, label: "Node" },
  { pattern: /\bnode\b/i, label: "Node" },
  { pattern: /\bpython[23]?\b|\bpip[23]?\b|\bconda\b|\bpytest\b/i, label: "Python" },
  { pattern: /\bcargo\b|\brustc\b|\brustup\b/i, label: "Rust" },
  { pattern: /\bgo\s+(?:build|run|test|mod|get|install|vet|fmt)\b/i, label: "Go" },
  { pattern: /\bjava\b|\bjavac\b|\bmaven\b|\bmvn\b|\bgradle\b/i, label: "Java" },
  { pattern: /\bdocker\b|\bdocker-compose\b|\bpodman\b/i, label: "Docker" },
  { pattern: /\bkubectl\b|\bhelm\b/i, label: "K8s" },
  { pattern: /\bssh\b/i, label: "SSH" },
  { pattern: /\bvim\b|\bnvim\b|\bneovim\b/i, label: "Vim" },
  { pattern: /\bemacs\b/i, label: "Emacs" },
  { pattern: /\bmake\b|\bcmake\b/i, label: "Make" },
  { pattern: /\bsudo\b/i, label: "sudo" },
  { pattern: /\btop\b|\bhtop\b|\bbtop\b/i, label: "Monitor" },
];

/** Shell name patterns for fallback detection from OSC titles. */
const SHELL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bzsh\b/i, label: "zsh" },
  { pattern: /\bbash\b/i, label: "bash" },
  { pattern: /\bfish\b/i, label: "fish" },
  { pattern: /\bsh\b/i, label: "sh" },
];

/**
 * Extracts the latest OSC title from raw PTY output bytes.
 * Returns null if no title sequence was found.
 */
export function extractOscTitle(text: string): string | null {
  let lastTitle: string | null = null;
  let match: RegExpExecArray | null;
  // Reset lastIndex before iterating
  OSC_TITLE_RE.lastIndex = 0;
  while ((match = OSC_TITLE_RE.exec(text)) !== null) {
    if (match[1]) {
      lastTitle = match[1];
    }
  }
  return lastTitle;
}

/**
 * Detect activity name from raw PTY output text.
 *
 * Strategy:
 *  1. Extract OSC title sequence and match against activity + shell patterns
 *  2. Match the raw text content against activity patterns
 *  3. Fall back to null (caller should keep the previous activity name)
 */
export function detectActivity(text: string): string | null {
  // 1. Check OSC title
  const oscTitle = extractOscTitle(text);
  if (oscTitle) {
    // Check activity patterns against the title
    for (const { pattern, label } of ACTIVITY_PATTERNS) {
      if (pattern.test(oscTitle)) {
        return label;
      }
    }
    // Check shell patterns in title
    for (const { pattern, label } of SHELL_PATTERNS) {
      if (pattern.test(oscTitle)) {
        return label;
      }
    }
  }

  // 2. Check content patterns (only look at the last ~500 chars to avoid
  //    matching stale output from scrollback)
  const tail = text.length > 500 ? text.slice(-500) : text;

  for (const { pattern, label } of ACTIVITY_PATTERNS) {
    if (pattern.test(tail)) {
      return label;
    }
  }

  return null;
}

// Spinner glyphs agent CLIs animate while generating (Claude/Codex/Gemini),
// including the braille set. Paired below with a trailing "…" or a live counter.
const SPINNER_CHARS = "·✳✽✶✻✢⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒";
const BUSY_SPINNER_RE = new RegExp(`(?:^|\\n)\\s*[${SPINNER_CHARS}]\\s*\\S.*…`);
const BUSY_COUNTER_RE = /\([^)]*\d+s[^)]*(?:tokens|↑|↓|interrupt)[^)]*\)/i;
const BUSY_TOOLROW_RE = /⎿\s*(?:Running|Waiting)…/i;

/**
 * Is an AGENT terminal actively generating right now? This is the authoritative
 * "busy" signal per PTY-parse research: a spinner line ending in "…", the live
 * "(… · Ns · ↑/↓ tokens)" counter, the literal "esc to interrupt", or a
 * "⎿ Running…/Waiting…" tool row. Far more reliable than "bytes arrived".
 */
export function detectAgentBusy(text: string): boolean {
  const tail = text.length > 1500 ? text.slice(-1500) : text;
  if (/esc to interrupt/i.test(tail)) return true;
  if (BUSY_COUNTER_RE.test(tail)) return true;
  if (BUSY_TOOLROW_RE.test(tail)) return true;
  if (BUSY_SPINNER_RE.test(tail)) return true;
  return false;
}

/**
 * Detect if terminal output indicates explicit user attention is required.
 * Returns a concise reason string if detected, otherwise null.
 */
export function detectAttentionNeeded(text: string): string | null {
  const tail = text.length > 1200 ? text.slice(-1200) : text;

  // Agent approval menus (Claude Code / Codex / Gemini): a selectable list whose
  // top option is Yes / Allow / Approve / Proceed, often marked with ❯ or "1.".
  if (/(?:❯|›|>|\b1\s*[.)])\s*(?:yes\b|allow\b|approve\b|proceed\b)/i.test(tail)) {
    return "Approve?";
  }
  // Explicit permission / approval requests. Tight on purpose: an agent merely
  // *narrating* ("I'll approve the design and document the permission model")
  // must NOT trigger. We require a real prompt — a question mark, or the
  // unambiguous "do you want to" phrasing.
  if (
    /\bdo you want to\b/i.test(tail) ||
    /\b(?:allow|approve|grant|authorize|run|execute)\b[^?\n]{0,60}\?\s*$/im.test(tail) ||
    /\b(?:approval|permission)\s+(?:required|needed)\b/i.test(tail)
  ) {
    return "Approve?";
  }
  // Yes/No prompts, including bracketed forms: (y/n) [Y/n] [y/N] y/N.
  if (/[([]\s*y(?:es)?\s*\/\s*n(?:o)?\s*[)\]]/i.test(tail) || /\b(?:yes\/no|y\/n)\b/i.test(tail)) {
    return "Y/N?";
  }
  // Waiting on the user explicitly.
  if (/\b(?:waiting for|awaiting)\s+(?:your|user)\s+(?:input|approval|response|confirmation)\b/i.test(tail)) {
    return "Input needed";
  }
  if (/\bpress\s+(?:enter|return)\s+to\s+continue\b/i.test(tail)) {
    return "Press Enter";
  }
  // A trailing question that asks to proceed / apply / continue.
  if (/\b(?:proceed|continue|apply|overwrite|replace|run this)\b.{0,40}\?\s*$/im.test(tail)) {
    return "Confirm?";
  }

  return null;
}
