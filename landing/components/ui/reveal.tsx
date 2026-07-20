"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";

const base: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0 },
};

const containerV: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

/**
 * Scroll-triggered reveal container. Children using <RevealItem> animate in a
 * stagger. Honors prefers-reduced-motion (renders static, no transforms).
 */
export function Reveal({
  children,
  className = "",
  id,
  as = "section",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div";
}) {
  const reduce = useReducedMotion();
  const MotionTag = as === "section" ? motion.section : motion.div;
  return (
    <MotionTag
      id={id}
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={containerV}
    >
      {children}
    </MotionTag>
  );
}

export function RevealItem({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div className={className} style={style} variants={base}>
      {children}
    </motion.div>
  );
}
