"use client";

import { useRef, useState } from "react";
import { GRID_TOKEN_ADDRESS, GRID_CHAIN } from "@/lib/token";

/** Copyable $GRID contract address — one line, never wraps. */
export function CopyAddress() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const addrRef = useRef<HTMLSpanElement>(null);

  /** Visibly select the address so the user can copy it manually. */
  const selectAddress = () => {
    const node = addrRef.current;
    if (!node || typeof window === "undefined") return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(GRID_TOKEN_ADDRESS);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked/unavailable — fall back to selecting the text
      // and surfacing a visible "copy manually" hint instead of silently
      // doing nothing.
      selectAddress();
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <div className="w-full max-w-xl border border-accent/40 bg-accent/[0.06]">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-accent/30">
        <span className="font-mono text-xs font-bold text-accent tracking-wide">$GRID</span>
        <span className="font-mono text-[10px] text-text-secondary uppercase tracking-widest">
          Contract · {GRID_CHAIN}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copy contract address"
        aria-label={copied ? "Contract address copied" : "Copy $GRID contract address"}
        className="group flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/[0.04] transition-colors"
      >
        <span
          ref={addrRef}
          className="flex-1 min-w-0 font-mono text-[11px] sm:text-xs leading-none text-text-primary select-all overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {GRID_TOKEN_ADDRESS}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-accent group-hover:text-accent-hover transition-colors">
          {copied ? "Copied ✓" : failed ? "Select & copy" : "Copy ⧉"}
        </span>
      </button>
      {failed && (
        <p
          role="status"
          className="px-3 py-1.5 border-t border-accent/30 font-mono text-[10px] text-text-secondary"
        >
          Couldn&apos;t access the clipboard — the address is selected, press{" "}
          <span className="text-text-primary">⌘/Ctrl+C</span> to copy it manually.
        </p>
      )}
    </div>
  );
}
