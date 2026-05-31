import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_FLAT } from "@/lib/docs-nav";
import { CopyButton } from "@/components/ui/copy-button";

const REPO_EDIT_BASE =
  "https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal/edit/main/landing/app";

/** Page title + one-line description. */
export function DocTitle({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="mb-10">
      <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-3">{title}</h1>
      <p className="text-text-secondary text-sm sm:text-base leading-relaxed">{intro}</p>
    </header>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-12 scroll-mt-24" id={title ? slug(title) : undefined}>
      {title && <h2 className="font-display text-xl font-bold mb-3 tracking-tight">{title}</h2>}
      <div className="text-text-secondary text-sm sm:text-[15px] leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-inside space-y-1.5 marker:text-accent">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function OL({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal list-inside space-y-2 marker:text-text-secondary">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

/** Inline code. */
export function C({ children }: { children: string }) {
  return <code className="font-mono text-[0.85em] text-accent bg-bg-secondary px-1.5 py-0.5 border border-border">{children}</code>;
}

/** Keyboard chip. */
export function Kbd({ children }: { children: string }) {
  return <kbd className="font-mono text-[11px] text-accent font-semibold bg-bg-secondary border border-border px-1.5 py-0.5">{children}</kbd>;
}

/** Block code with optional label + copy button. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="my-3 border border-border bg-[#0a0a0a]">
      <div className="flex items-center justify-between gap-4 px-4 py-1.5 border-b border-border bg-bg-secondary">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
          {label ?? "shell"}
        </span>
        <CopyButton value={children} />
      </div>
      <pre className="font-mono text-xs sm:text-[13px] text-[#ccc] px-4 py-3 overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

type CalloutKind = "tip" | "note" | "warn";
const CALLOUT: Record<CalloutKind, { c: string; label: string }> = {
  tip: { c: "#00c853", label: "TIP" },
  note: { c: "#4a9eff", label: "NOTE" },
  warn: { c: "#ffab00", label: "HEADS UP" },
};
export function Callout({ kind = "note", children }: { kind?: CalloutKind; children: ReactNode }) {
  const { c, label } = CALLOUT[kind];
  return (
    <div className="my-4 border-l-2 pl-4 py-1" style={{ borderColor: c }}>
      <span className="font-mono text-[10px] font-bold tracking-widest" style={{ color: c }}>{label}</span>
      <div className="text-text-secondary text-sm leading-relaxed mt-1">{children}</div>
    </div>
  );
}

/** Two-column keyboard reference. */
export function ShortcutGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border my-4">
      {rows.map(([k, label]) => (
        <div key={k + label} className="bg-bg-secondary px-4 py-2.5 flex items-center justify-between gap-4">
          <kbd className="font-mono text-xs text-accent font-semibold whitespace-nowrap">{k}</kbd>
          <span className="font-mono text-[11px] text-text-secondary text-right">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Prev / next pager derived from the flat nav order. */
export function PrevNext({ current }: { current: string }) {
  const idx = DOCS_FLAT.findIndex((l) => l.href === current);
  const prev = idx > 0 ? DOCS_FLAT[idx - 1] : null;
  const next = idx >= 0 && idx < DOCS_FLAT.length - 1 ? DOCS_FLAT[idx + 1] : null;
  const editHref = `${REPO_EDIT_BASE}${current === "/docs" ? "/docs" : current}/page.tsx`;
  return (
    <>
      <div className="mt-16 pt-6 border-t border-border flex items-center justify-between gap-4">
        {prev ? (
          <Link href={prev.href} className="group font-mono text-sm text-text-secondary hover:text-accent transition-colors">
            <span className="block text-[10px] uppercase tracking-widest opacity-60">Previous</span>
            ← {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={next.href} className="group font-mono text-sm text-text-secondary hover:text-accent transition-colors text-right">
            <span className="block text-[10px] uppercase tracking-widest opacity-60">Next</span>
            {next.title} →
          </Link>
        ) : <span />}
      </div>
      <div className="mt-6 pb-2">
        <a
          href={editHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-text-secondary/70 hover:text-accent transition-colors"
        >
          Edit this page on GitHub →
        </a>
      </div>
    </>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
