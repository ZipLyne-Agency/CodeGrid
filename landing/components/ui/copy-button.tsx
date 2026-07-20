"use client";

import { useState } from "react";

/** Small copy-to-clipboard button for code blocks. Falls back gracefully. */
export function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code is still selectable */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy code"}
      className={`font-mono text-[10px] uppercase tracking-widest text-text-secondary hover:text-accent transition-colors ${className}`}
    >
      {copied ? "Copied ✓" : "Copy ⧉"}
    </button>
  );
}
