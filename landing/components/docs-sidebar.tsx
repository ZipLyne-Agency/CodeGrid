"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOCS_NAV } from "@/lib/docs-nav";
import { DocsSearch } from "@/components/docs-search";

export function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-6">
      {DOCS_NAV.map((section) => (
        <div key={section.label}>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-2">{section.label}</div>
          <ul className="flex flex-col gap-0.5">
            {section.links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={`block font-mono text-[13px] px-2 py-1.5 border-l-2 transition-colors ${
                      active
                        ? "border-accent text-accent bg-accent/5"
                        : "border-transparent text-text-secondary hover:text-text-primary hover:border-border"
                    }`}
                  >
                    {link.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="docs-mobile-nav"
        aria-label={open ? "Close docs menu" : "Open docs menu"}
        className="lg:hidden font-mono text-xs text-accent border border-border px-3 py-2 mb-4"
      >
        {open ? "✕ Close" : "☰ Docs menu"}
      </button>

      {/* Mobile drawer */}
      {open && (
        <div
          id="docs-mobile-nav"
          className="lg:hidden mb-6 pb-6 border-b border-border overflow-y-auto"
          style={{ maxHeight: "70vh", overscrollBehavior: "contain" }}
        >
          <div className="mb-4">
            <DocsSearch />
          </div>
          {nav}
        </div>
      )}

      {/* Desktop sidebar — its own independent scroll region */}
      <aside className="docs-sidebar hidden lg:block pr-2 pb-6">
        <div className="mb-5">
          <DocsSearch />
        </div>
        {nav}
      </aside>
    </>
  );
}
