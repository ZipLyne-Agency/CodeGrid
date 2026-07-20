"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export type Faq = { q: string; a: string };

/**
 * Accordion for the "Why CodeGrid?" objections. Keeps the FAQ JSON-LD in the
 * page (separate) for AEO; this is the interactive presentation layer.
 */
export function FaqAccordion({ items }: { items: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const reduce = useReducedMotion();

  return (
    <div className="bg-border border border-border grid gap-px">
      {items.map((item, i) => {
        const isOpen = open === i;
        const panelId = `faq-panel-${i}`;
        const btnId = `faq-btn-${i}`;
        return (
          <div key={item.q} className="bg-bg-secondary">
            <button
              id={btnId}
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="group w-full flex items-center gap-4 text-left px-5 sm:px-8 py-5 hover:bg-bg-tertiary transition-colors"
            >
              <span
                className={`font-mono text-xs shrink-0 transition-colors ${isOpen ? "text-accent" : "text-text-secondary"}`}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-sm sm:text-[15px] font-semibold flex-1 text-text-primary">
                {item.q}
              </span>
              <span
                className={`font-mono text-lg shrink-0 leading-none transition-transform duration-300 ${
                  isOpen ? "rotate-45 text-accent" : "text-text-secondary group-hover:text-text-primary"
                }`}
              >
                +
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="body"
                  id={panelId}
                  role="region"
                  aria-labelledby={btnId}
                  initial={reduce ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduce ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="px-5 sm:px-8 pb-6 pl-[3.25rem] sm:pl-[4.25rem] text-text-secondary text-sm leading-relaxed max-w-3xl">
                    {item.a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
