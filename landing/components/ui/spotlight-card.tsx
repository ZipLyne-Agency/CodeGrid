"use client";

import { useRef } from "react";

/**
 * Card with a cursor-tracked accent glow (Aceternity-style, but CSS-only —
 * no per-frame React state). The element rect is cached on pointer enter and
 * CSS-var writes are batched into a single rAF, so moving the cursor never
 * forces a synchronous layout (getBoundingClientRect per move is the usual
 * jank source). Falls back to a static surface on touch.
 */
export function SpotlightCard({
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: {
  as?: React.ElementType;
  className?: string;
  children: React.ReactNode;
} & React.AllHTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const frame = useRef(0);

  function cacheRect() {
    rect.current = ref.current?.getBoundingClientRect() ?? null;
  }

  function onMove(e: React.PointerEvent) {
    if (frame.current) return; // already scheduled this frame
    const x = e.clientX;
    const y = e.clientY;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      const r = rect.current;
      if (!el || !r) return;
      el.style.setProperty("--mx", `${x - r.left}px`);
      el.style.setProperty("--my", `${y - r.top}px`);
    });
  }

  return (
    <Tag
      ref={ref}
      onPointerEnter={cacheRect}
      onPointerMove={onMove}
      className={`spotlight ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
