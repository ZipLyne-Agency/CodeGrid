"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid";

// Top-level links are deliberately lean — the high-trust, high-intent items
// only. Everything else lives in a labeled dropdown so the bar reads as
// "real product, documented, transparent" rather than a wall of marketing tabs.
const primary: { label: string; href: string }[] = [
  { label: "Features", href: "/features" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
];

// Secondary product + marketing surfaces — one click away, out of the way.
const resources: { label: string; href: string }[] = [
  { label: "Agent Bus", href: "/agent-bus" },
  { label: "Skills", href: "/skills" },
  { label: "Blog", href: "/blog" },
  { label: "Changelog", href: "/changelog" },
];

const company: { label: string; href: string }[] = [
  { label: "About ZipLyne", href: "/about" },
  { label: "Founder", href: "/founder" },
  { label: "Careers", href: "/careers" },
  { label: "Security", href: "/security" },
  { label: "Responsible AI", href: "/responsible-ai" },
  { label: "Press & Brand", href: "/press" },
];

type MenuId = "resources" | "company" | null;

export function SiteNav() {
  const [open, setOpen] = useState(false);          // mobile menu
  const [menu, setMenu] = useState<MenuId>(null);   // which desktop dropdown is open
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname() || "/";
  const navRef = useRef<HTMLDivElement>(null);

  // Subtle solidify-on-scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenu(null); setOpen(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Close menus on navigation
  useEffect(() => { setOpen(false); setMenu(null); }, [pathname]);

  const isActive = (href: string) =>
    !href.startsWith("/#") && (pathname === href || pathname.startsWith(href + "/"));
  const groupActive = (group: { href: string }[]) => group.some((l) => isActive(l.href));

  const pill = "px-3 py-1.5 rounded-full font-mono text-xs transition-colors";
  const inactive = "text-text-secondary hover:text-text-primary hover:bg-white/[0.06]";
  const active = "text-accent bg-accent/10";

  const Dropdown = ({
    id,
    label,
    items,
  }: {
    id: Exclude<MenuId, null>;
    label: string;
    items: { label: string; href: string; hint?: string }[];
  }) => {
    const isOpen = menu === id;
    return (
      <div className="relative">
        <button
          onClick={() => setMenu(isOpen ? null : id)}
          className={`${pill} inline-flex items-center gap-1 ${isOpen || groupActive(items) ? active : inactive}`}
          aria-expanded={isOpen}
        >
          {label}
          <span className={`text-[8px] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {isOpen && (
          <div className="absolute right-0 mt-3 w-60 rounded-xl border border-white/10 bg-bg-secondary/95 backdrop-blur-xl ring-1 ring-black/40 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.8)] overflow-hidden p-1.5">
            {items.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className={`block px-3 py-2 rounded-lg font-mono text-xs transition-colors ${
                  isActive(l.href) ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-white/[0.06]"
                }`}
              >
                {l.label}
                {l.hint && (
                  <span className="block mt-0.5 text-[10px] text-text-secondary/70 font-normal normal-case">
                    {l.hint}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed top-3 sm:top-4 inset-x-0 z-50 px-3 sm:px-4">
      <nav
        ref={navRef}
        className={[
          "mx-auto max-w-5xl flex items-center justify-between gap-2 rounded-2xl",
          "border border-white/10 ring-1 ring-black/40 backdrop-blur-xl pl-3 pr-2 sm:pl-4",
          "transition-[background-color,padding,box-shadow] duration-300",
          scrolled
            ? "bg-bg-primary/85 py-1.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.8)]"
            : "bg-bg-primary/55 py-2 shadow-[0_8px_28px_-14px_rgba(0,0,0,0.6)]",
        ].join(" ")}
      >
        <BrandLogo priority size="sm" />

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-0.5">
          {primary.map((l) => (
            <Link key={l.label} href={l.href} className={`${pill} ${isActive(l.href) ? active : inactive}`}>
              {l.label}
            </Link>
          ))}

          <Dropdown id="resources" label="Resources" items={resources} />
          <Dropdown id="company" label="Company" items={company} />

          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className={`${pill} ${inactive}`}>GitHub</a>
          <a
            href="/download"
            className="ml-1 inline-flex items-center rounded-full bg-accent hover:bg-accent-hover text-black font-mono text-xs font-semibold px-4 py-1.5 transition-colors"
          >
            Download
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="md:hidden flex flex-col items-center justify-center gap-[5px] w-9 h-9 rounded-full border border-white/10 hover:bg-white/[0.06] transition-colors"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <span className={`block h-px w-4 bg-text-primary transition-transform duration-200 ${open ? "translate-y-[6px] rotate-45" : ""}`} />
          <span className={`block h-px w-4 bg-text-primary transition-opacity duration-200 ${open ? "opacity-0" : ""}`} />
          <span className={`block h-px w-4 bg-text-primary transition-transform duration-200 ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
        </button>
      </nav>

      {/* Mobile floating panel */}
      {open && (
        <div className="md:hidden mx-auto max-w-5xl mt-2 rounded-2xl border border-white/10 ring-1 ring-black/40 bg-bg-primary/95 backdrop-blur-xl shadow-[0_24px_56px_-16px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="p-2 max-h-[calc(100vh-6rem)] overflow-auto">
            {primary.map((l) => (
              <Link key={l.label} href={l.href} className={`block px-4 py-3 rounded-xl font-mono text-sm transition-colors ${isActive(l.href) ? "text-accent bg-accent/10" : "text-text-primary hover:bg-white/[0.06]"}`}>
                {l.label}
              </Link>
            ))}

            <div className="px-4 pt-3 pb-1 font-mono text-[10px] font-bold tracking-widest text-text-secondary uppercase">Resources</div>
            {resources.map((l) => (
              <Link key={l.label} href={l.href} className={`block px-4 py-2.5 rounded-xl font-mono text-sm transition-colors ${isActive(l.href) ? "text-accent bg-accent/10" : "text-text-secondary hover:bg-white/[0.06]"}`}>
                {l.label}
              </Link>
            ))}

            <div className="px-4 pt-3 pb-1 font-mono text-[10px] font-bold tracking-widest text-text-secondary uppercase">Company</div>
            {company.map((l) => (
              <Link key={l.label} href={l.href} className={`block px-4 py-2.5 rounded-xl font-mono text-sm transition-colors ${isActive(l.href) ? "text-accent bg-accent/10" : "text-text-secondary hover:bg-white/[0.06]"}`}>
                {l.label}
              </Link>
            ))}
            <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 rounded-xl font-mono text-sm text-text-secondary hover:bg-white/[0.06] transition-colors">
              GitHub
            </a>
            <a href="/download" className="mt-2 mb-1 mx-1 flex items-center justify-center rounded-xl bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-4 py-3 transition-colors">
              Download for Mac
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
