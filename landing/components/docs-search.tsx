"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DOCS_NAV } from "@/lib/docs-nav";

type Item = { title: string; href: string; section: string };

const ITEMS: Item[] = DOCS_NAV.flatMap((s) =>
  s.links.map((l) => ({ title: l.title, href: l.href, section: s.label })),
);

function rank(items: Item[], q: string): Item[] {
  const query = q.trim().toLowerCase();
  if (!query) return items;
  return items
    .map((it) => {
      const hay = `${it.title} ${it.section}`.toLowerCase();
      const t = it.title.toLowerCase();
      let score = -1;
      if (t.startsWith(query)) score = 0;
      else if (t.includes(query)) score = 1;
      else if (hay.includes(query)) score = 2;
      return { it, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((r) => r.it);
}

/** Only one mounted instance owns the global ⌘K hotkey (the sidebar renders
 *  a desktop + a mobile trigger; both shouldn't toggle at once). */
let hotkeyClaimed = false;

/** ⌘K command-palette search over the docs nav — mirrors the product's own palette. */
export function DocsSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ownsHotkey = useRef(false);

  const results = useMemo(() => rank(ITEMS, q), [q]);

  // Global ⌘K / Ctrl+K to open (single owner); Escape closes any instance.
  useEffect(() => {
    if (!hotkeyClaimed) {
      hotkeyClaimed = true;
      ownsHotkey.current = true;
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!ownsHotkey.current) return;
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (ownsHotkey.current) {
        ownsHotkey.current = false;
        hotkeyClaimed = false;
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit.href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 border border-border bg-bg-secondary px-3 py-2 text-text-secondary hover:border-text-secondary transition-colors"
        aria-label="Search docs"
      >
        <span className="font-mono text-xs">Search docs…</span>
        <kbd className="font-mono text-[10px] border border-border px-1.5 py-0.5">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh] bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Search documentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg border border-border bg-bg-primary ring-1 ring-black/40 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <span className="font-mono text-accent text-sm">›</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search the docs…"
                className="flex-1 bg-transparent py-3 font-mono text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
              />
              <kbd className="font-mono text-[10px] text-text-secondary border border-border px-1.5 py-0.5">esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {results.length === 0 ? (
                <li className="px-4 py-6 text-center font-mono text-xs text-text-secondary">
                  No matches for “{q}”
                </li>
              ) : (
                results.map((it, i) => (
                  <li key={it.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it.href)}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors ${
                        i === active ? "bg-accent/10" : "hover:bg-bg-secondary"
                      }`}
                    >
                      <span className={`font-mono text-[13px] ${i === active ? "text-accent" : "text-text-primary"}`}>
                        {it.title}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
                        {it.section}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
