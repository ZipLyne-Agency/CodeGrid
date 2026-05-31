"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
}

const SCROLLER_ID = "docs-scroll";
/** Distance below the pane top at which a section counts as "current". */
const ACTIVE_OFFSET = 120;

/**
 * "On this page" table of contents — the right rail of a standard API-docs
 * layout. It reads the section anchors out of the current page and highlights
 * the one in view as the content pane (#docs-scroll) scrolls.
 *
 * The scroll region is the inner pane, not the window, so both the active-state
 * tracking and the click-to-scroll are computed against the pane rather than
 * relying on window scroll or default anchor behaviour.
 */
export function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const scroller = document.getElementById(SCROLLER_ID);
    if (!scroller) return;

    // <Section> renders the anchor id on the <section>; its heading text is the
    // child <h2>. Build the TOC from those.
    const hs: Heading[] = Array.from(
      scroller.querySelectorAll<HTMLElement>("article section[id]"),
    )
      .map((el) => ({ id: el.id, text: el.querySelector("h2")?.textContent ?? "" }))
      .filter((h) => h.id && h.text);

    setHeadings(hs);
    if (hs.length === 0) {
      setActive("");
      return;
    }

    const onScroll = () => {
      const paneTop = scroller.getBoundingClientRect().top;
      // Bottom of the pane reached → last section is current.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        setActive(hs[hs.length - 1].id);
        return;
      }
      let current = hs[0].id;
      for (const h of hs) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - paneTop <= ACTIVE_OFFSET) current = h.id;
        else break;
      }
      setActive(current);
    };

    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [pathname]);

  if (headings.length === 0) return null;

  const scrollTo = (id: string) => {
    const scroller = document.getElementById(SCROLLER_ID);
    const el = document.getElementById(id);
    if (!scroller || !el) return;
    const target =
      scroller.scrollTop +
      (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) -
      16;
    scroller.scrollTo({ top: target, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <aside className="docs-toc">
      <nav className="sticky top-0 pt-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-3">
          On this page
        </div>
        <ul className="flex flex-col">
          {headings.map((h) => {
            const isActive = active === h.id;
            return (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollTo(h.id);
                  }}
                  className={`block font-mono text-[12px] leading-snug border-l pl-3 py-1.5 transition-colors ${
                    isActive
                      ? "border-accent text-accent"
                      : "border-border text-text-secondary hover:text-text-primary hover:border-text-secondary"
                  }`}
                >
                  {h.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
