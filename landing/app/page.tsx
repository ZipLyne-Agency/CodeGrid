"use client";

import { useRef } from "react";
import Link from "next/link";
import MuxPlayer from "@mux/mux-player-react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealItem } from "@/components/ui/reveal";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { WindowFrame } from "@/components/ui/window-frame";
import { Marquee } from "@/components/ui/marquee";
import { FaqAccordion } from "@/components/ui/faq-accordion";

/** Mux asset playback ID — hero demo (autoplay requires muted in browsers). */
const HERO_MUX_PLAYBACK_ID = "oPu7h015GHVMppz025Q6peZxUOAu69LrkMMfdRkz00gm6Q";
const HERO_MUX_POSTER = `https://image.mux.com/${HERO_MUX_PLAYBACK_ID}/thumbnail.webp?width=1600&time=0`;
const HERO_PLAYBACK_RATE = 1.3;
const GITHUB = "https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal";

/* ------------------------------------------------------------------ */
/*  Agent colors                                                       */
/* ------------------------------------------------------------------ */

const AGENT_COLORS: Record<string, string> = {
  CLAUDE: "#ff8c00",
  CODEX: "#10a37f",
  GEMINI: "#4285f4",
  GROK: "#cbd5e1",
  CURSOR: "#a855f7",
  VENICE: "#14b8a6",
  SHELL: "#4a9eff",
};

/* ------------------------------------------------------------------ */
/*  Mock terminal pane data                                            */
/* ------------------------------------------------------------------ */

const panes = [
  {
    title: "api-server",
    agent: "CLAUDE",
    status: "running" as const,
    lines: [
      "$ claude --model opus",
      "> Refactoring auth middleware...",
      "",
      "  Updated src/middleware/auth.ts",
      "  Added JWT refresh token logic",
      "  Running tests... ✓ 23 passed",
    ],
  },
  {
    title: "frontend",
    agent: "CODEX",
    status: "running" as const,
    lines: [
      "$ codex",
      "> Fix the dashboard layout bug",
      "",
      "  Reading src/components/Dashboard.tsx",
      "  Found issue: flex-wrap missing",
      "  Applying fix...",
    ],
  },
  {
    title: "database",
    agent: "GEMINI",
    status: "waiting" as const,
    lines: [
      "$ gemini",
      "> Add migration for user_roles",
      "",
      "  Created migration 004_user_roles.sql",
      "  ⏳ Waiting for confirmation...",
      "",
    ],
  },
  {
    title: "refactor",
    agent: "CURSOR",
    status: "running" as const,
    lines: [
      "$ cursor",
      "> Modernize legacy payment module",
      "",
      "  Scanning src/payments/...",
      "  Replacing deprecated Stripe API calls",
      "  ✓ 8 files updated",
    ],
  },
  {
    title: "deploy",
    agent: "SHELL",
    status: "idle" as const,
    lines: [
      "$ git log --oneline -5",
      "a3f1c2d feat: add user roles",
      "b7e4a1f fix: auth middleware",
      "c9d2e3a refactor: dashboard",
      "d1f5b6c chore: update deps",
      "",
    ],
  },
  {
    title: "tests",
    agent: "SHELL",
    status: "running" as const,
    lines: [
      "$ npm run test:watch",
      "",
      "  PASS src/auth.test.ts",
      "  PASS src/api.test.ts",
      "  FAIL src/db.test.ts",
      "  Tests: 2 passed, 1 failed",
    ],
  },
];

const statusColor: Record<string, string> = {
  idle: "bg-status-idle",
  running: "bg-status-running",
  error: "bg-status-error",
  waiting: "bg-status-waiting",
};

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

const stats: { value: string; label: string }[] = [
  { value: "6", label: "Coding agents supported" },
  { value: "∞", label: "Canvases · sessions" },
  { value: "0", label: "Telemetry · accounts" },
  { value: "MIT", label: "Open source" },
];

/* ------------------------------------------------------------------ */
/*  Features                                                           */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: "⊕",
    title: "5 AI Agents, One Workspace",
    desc: "Run Claude, Codex, Gemini, Grok, Cursor, Venice, and plain shells side by side. Mix and match — use the best model for each task without switching apps.",
    wide: true,
  },
  {
    icon: "⇄",
    title: "Agents That Talk to Each Other",
    desc: "The Agent Bus lets one agent message and read another's pane — Claude hands a task to Codex, reads its reply, and keeps going. Native collaboration, no tmux.",
    wide: true,
  },
  {
    icon: "⊞",
    title: "2D Canvas",
    desc: "Drag and resize terminal panes freely on an infinite canvas. No tabs, no splits — just space. Zoom out to see everything at once.",
    wide: false,
  },
  {
    icon: "»",
    title: "Layout Presets",
    desc: "Switch between Auto, Focus, Columns, Rows, and Grid layouts to reorganize active panes instantly as your workflow changes.",
    wide: false,
  },
  {
    icon: "◉",
    title: "Attention Detection",
    desc: "CodeGrid watches every session and highlights the ones that need you — Y/N prompts, approvals, confirmations — across any agent.",
    wide: false,
  },
  {
    icon: "⎇",
    title: "Git Integration",
    desc: "Stage, commit, push, pull, branch, and stash without leaving the app. See diffs inline. A full Git UI lives in the sidebar.",
    wide: false,
  },
  {
    icon: "⊟",
    title: "Browser Panes",
    desc: "Open a browser pane right on the canvas alongside your terminals. Preview your app, check docs, or review a PR — without leaving CodeGrid.",
    wide: false,
  },
  {
    icon: "⌕",
    title: "File Tree & Project Search",
    desc: "Browse your project files and search across the entire codebase from the sidebar — no need to open another editor.",
    wide: false,
  },
  {
    icon: "⊚",
    title: "GitHub Integration",
    desc: "Browse, search, and clone any of your GitHub repos (including org repos) directly from the new session dialog. No terminal needed.",
    wide: false,
  },
  {
    icon: "↻",
    title: "Multiple Workspaces",
    desc: "Organize projects into separate workspaces, each with its own canvas layout. Switch instantly — positions, sizes, and directories are all saved.",
    wide: false,
  },
  {
    icon: "⌘",
    title: "Command Palette",
    desc: "Cmd+K to access any action instantly — search panes, switch workspaces, launch agents, run commands.",
    wide: true,
  },
];

/* ------------------------------------------------------------------ */
/*  Shortcuts                                                          */
/* ------------------------------------------------------------------ */

const shortcuts = [
  { keys: ["⌘", "N"], label: "New pane" },
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "⇧", "←→"], label: "Swap pane positions" },
  { keys: ["⌘", "⏎"], label: "Maximize pane" },
  { keys: ["⌘", "1–9"], label: "Jump to pane" },
  { keys: ["⌘", "←→"], label: "Navigate panes" },
];

/* ------------------------------------------------------------------ */
/*  Objections / Why CodeGrid                                          */
/* ------------------------------------------------------------------ */

const objections = [
  {
    q: "Does it work with my existing CLI tools?",
    a: "Yes — CodeGrid doesn’t replace anything. It launches the same Claude, Codex, Gemini, Grok, Cursor, Venice, and shell workflows you already use inside real PTYs. No wrappers, no lock-in, no migration.",
  },
  {
    q: "How do I know when an agent needs my input?",
    a: "Attention detection reads every terminal and highlights panes that are waiting — Y/N prompts, approval requests, confirmations — across all agents at once. You’ll never sit blocked on pane 6 because you were looking at pane 2.",
  },
  {
    q: "Can I run different agents in the same workspace?",
    a: "That’s the whole point. Claude on the API layer, Codex on the frontend, Gemini reviewing the tests — all on one canvas, all running in parallel. Use the best model for each job without leaving the app.",
  },
  {
    q: "How many sessions can I run at once?",
    a: "CodeGrid is built for dense multi-session workflows. Run as many sessions as your machine supports — there are no artificial limits. Each pane runs in its own PTY with an isolated working directory.",
  },
  {
    q: "Why not tmux, iTerm2, or VS Code terminals?",
    a: "None of them provide a canvas-first workspace with session awareness. CodeGrid tracks pane activity, surfaces sessions that need attention, and combines layout control, Git tools, and workspace switching in one native app.",
  },
];

/* ------------------------------------------------------------------ */
/*  Social proof strip items                                           */
/* ------------------------------------------------------------------ */

const proofItems = [
  "Free & open source",
  "MIT licensed",
  "Signed & notarized",
  "Local-first · no telemetry",
  "macOS · Apple Silicon",
  "Built with Tauri",
  "No account required",
];

/* ------------------------------------------------------------------ */
/*  Comparison: CodeGrid vs the alternatives                           */
/* ------------------------------------------------------------------ */

const compareRows: { label: string; codegrid: boolean; tabs: boolean; tmux: boolean }[] = [
  { label: "Every session visible at once", codegrid: true, tabs: false, tmux: false },
  { label: "Drag-and-resize 2D canvas", codegrid: true, tabs: false, tmux: false },
  { label: "Knows which agent needs you", codegrid: true, tabs: false, tmux: false },
  { label: "Broadcast one prompt to all", codegrid: true, tabs: false, tmux: false },
  { label: "Built-in Git + GitHub UI", codegrid: true, tabs: false, tmux: false },
  { label: "Per-project workspaces, saved", codegrid: true, tabs: false, tmux: true },
  { label: "Runs your real CLIs (no lock-in)", codegrid: true, tabs: true, tmux: true },
];

/* ------------------------------------------------------------------ */
/*  Agents                                                             */
/* ------------------------------------------------------------------ */

const agents: { name: string; cli: string; color: string; key: string }[] = [
  { name: "Claude Code", cli: "claude", color: AGENT_COLORS.CLAUDE, key: "CLAUDE" },
  { name: "Codex", cli: "codex", color: AGENT_COLORS.CODEX, key: "CODEX" },
  { name: "Gemini", cli: "gemini", color: AGENT_COLORS.GEMINI, key: "GEMINI" },
  { name: "Grok", cli: "grok", color: AGENT_COLORS.GROK, key: "GROK" },
  { name: "Cursor", cli: "cursor-agent", color: AGENT_COLORS.CURSOR, key: "CURSOR" },
  { name: "Venice", cli: "venice", color: AGENT_COLORS.VENICE, key: "VENICE" },
  { name: "Shell", cli: "$SHELL", color: AGENT_COLORS.SHELL, key: "SHELL" },
];

/* ------------------------------------------------------------------ */
/*  Trust pillars                                                      */
/* ------------------------------------------------------------------ */

const trustPillars: { h: string; d: string; href: string; icon: string }[] = [
  { h: "Open source", d: "MIT-licensed. The full source is on GitHub — audit anything you like.", href: GITHUB, icon: "⌂" },
  { h: "Local-first", d: "Runs entirely on your machine. No account, no telemetry, no servers.", href: "/security", icon: "◍" },
  { h: "Signed & notarized", d: "Apple Developer ID, hardened runtime, notarized by Apple.", href: "/security", icon: "✓" },
  { h: "Bring your own AI", d: "Your code goes straight to each agent's provider. We store nothing.", href: "/responsible-ai", icon: "⊹" },
];

const steps = [
  { step: "01", title: "Launch CodeGrid", desc: "Open the app and start from a clean workspace designed for fast multi-session terminal workflows." },
  { step: "02", title: "Pick your agents", desc: "Add panes for Claude, Codex, Gemini, Grok, Cursor, Venice, or a plain shell. Each pane connects to its own project directory." },
  { step: "03", title: "Arrange and ship", desc: "Organize your canvas layout, use Git tools from the sidebar, and move changes forward without leaving the app." },
];

/* ------------------------------------------------------------------ */
/*  FAQ JSON-LD for AEO / answer engines                               */
/* ------------------------------------------------------------------ */

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: objections.map((o) => ({
    "@type": "Question",
    name: o.q,
    acceptedAnswer: { "@type": "Answer", text: o.a },
  })),
};

/* ------------------------------------------------------------------ */
/*  Reusable bits                                                      */
/* ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.2em] text-text-secondary uppercase">
      <span className="round-full w-1.5 h-1.5 bg-accent" />
      {children}
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="text-center mb-12 sm:mb-14">
      {eyebrow && (
        <RevealItem className="mb-4">
          <Eyebrow>{eyebrow}</Eyebrow>
        </RevealItem>
      )}
      <RevealItem>
        <h2 className="font-display text-3xl sm:text-[2.5rem] font-bold tracking-tight leading-tight">
          {title}
        </h2>
      </RevealItem>
      {sub && (
        <RevealItem>
          <p className="text-text-secondary text-sm sm:text-[15px] max-w-xl mx-auto mt-4 leading-relaxed">
            {sub}
          </p>
        </RevealItem>
      )}
    </div>
  );
}

const WRAP = "w-full max-w-6xl mx-auto px-4 sm:px-6";

/* ------------------------------------------------------------------ */
/*  $GRID strip — understated, product-first. The app is free and works  */
/*  without crypto; the token is optional and lives well below the fold. */
/* ------------------------------------------------------------------ */

function TokenStrip() {
  return (
    <div className="cv-auto border-t border-border">
      <Reveal className={`${WRAP} py-14 sm:py-20`}>
        <RevealItem>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-border bg-bg-secondary/30 px-6 py-7 sm:px-8">
            <div className="max-w-xl">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-2">
                Optional · on Base
              </div>
              <h3 className="font-display text-lg sm:text-xl font-semibold text-text-primary mb-2">
                There&apos;s a token. The app comes first.
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                CodeGrid is free, open source, and fully usable without ever touching crypto.
                $GRID is optional — stake it to unlock Pro features, or browse the public,
                on-chain treasury. You never need a token to run a single agent.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/token"
                className="font-mono text-xs px-4 py-2.5 border border-border text-text-primary hover:border-text-secondary transition-colors"
              >
                Token page →
              </Link>
              <Link
                href="/token/stake"
                className="font-mono text-xs px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
              >
                Staking
              </Link>
              <Link
                href="/token/treasury"
                className="font-mono text-xs px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
              >
                Treasury
              </Link>
            </div>
          </div>
        </RevealItem>
      </Reveal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function Home() {
  const reduce = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  // Parallax: translate + fade only. Both are GPU-composited; we deliberately
  // avoid `scale` on the video, which would re-rasterize the layer every frame.
  const vY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const vOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.55]);

  return (
    <div className="min-h-screen bg-bg-primary overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SiteNav />

      <main>
        {/* ===== Hero ============================================== */}
        <section ref={heroRef} className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
          {/* Layered background: animated grid + accent bloom */}
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>

          <Reveal className={`${WRAP} text-center`}>
            <RevealItem>
              <h1 className="font-display text-[2.25rem] leading-[1.05] sm:text-5xl md:text-6xl font-bold tracking-tight">
                An army of coding agents.{" "}
                <span className="relative inline-block text-accent">
                  A canvas per project.
                  <span className="cursor-blink ml-0.5 inline-block w-[0.5ch] -mb-1 bg-accent align-baseline" style={{ height: "0.95em" }} />
                </span>
              </h1>
            </RevealItem>

            <RevealItem>
              <p className="mt-6 max-w-2xl mx-auto text-text-secondary text-sm sm:text-base leading-relaxed">
                Give every project its own infinite canvas, then fill it with Claude, Codex,
                Gemini, Grok, Cursor, Venice, and shells running side by side. Drag, resize, and zoom
                to see all your agents at once and switch between project canvases with a
                keystroke. No more juggling a dozen windows, tabs, and desktops.
              </p>
            </RevealItem>

            {/* Agent badge strip */}
            <RevealItem>
              <div className="mt-7 flex items-center justify-center gap-2.5 flex-wrap">
                {agents.map((a) => (
                  <span
                    key={a.key}
                    className="font-mono text-[11px] font-semibold px-2.5 py-1 border transition-transform hover:-translate-y-0.5"
                    style={{ color: a.color, borderColor: a.color + "55", background: a.color + "11" }}
                  >
                    {a.name.replace(" Code", "")}
                  </span>
                ))}
              </div>
            </RevealItem>

            <RevealItem>
              <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href="/download"
                  className="btn-sheen group inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-7 py-3.5 transition-colors"
                >
                  Download for Mac
                  <span className="transition-transform group-hover:translate-x-0.5">↓</span>
                </a>
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-7 py-3.5 transition-colors"
                >
                  <span className="text-accent">★</span> Star on GitHub
                  <span className="opacity-50 transition-transform group-hover:translate-x-0.5">→</span>
                </a>
              </div>
            </RevealItem>

            <RevealItem>
              <p className="mt-7 text-xs font-mono text-text-secondary">
                macOS · Apple Silicon · Signed with Apple Developer ID
              </p>
            </RevealItem>
          </Reveal>

          {/* Hero video — macOS window, parallax on scroll */}
          <motion.div
            style={reduce ? undefined : { y: vY, opacity: vOpacity, willChange: "transform, opacity" }}
            className="mt-14 sm:mt-16 max-w-5xl mx-auto px-4 sm:px-6"
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <WindowFrame title="CodeGrid — workspace">
                <div className="relative w-full aspect-video bg-bg-primary scanlines">
                  <MuxPlayer
                    playbackId={HERO_MUX_PLAYBACK_ID}
                    streamType="on-demand"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    playbackRate={HERO_PLAYBACK_RATE}
                    preferPlayback="mse"
                    poster={HERO_MUX_POSTER}
                    accentColor="#ff8c00"
                    proudlyDisplayMuxBadge={false}
                    nohotkeys
                    minResolution="720p"
                    maxResolution="1080p"
                    metadata={{ video_title: "CodeGrid in action" }}
                    className="absolute inset-0 w-full h-full [--controls:none] [--dialog:none] [--loading-indicator:none]"
                  />
                </div>
              </WindowFrame>
            </motion.div>
          </motion.div>
        </section>

          {/* ===== Social proof marquee =========================== */}
        <div className="w-full border-y border-border bg-bg-secondary py-4">
          <Marquee>
            {proofItems.map((item) => (
              <span key={item} className="flex items-center gap-3 px-6">
                <span className="round-full w-1.5 h-1.5 bg-accent shrink-0" />
                <span className="font-mono text-xs sm:text-sm text-text-secondary whitespace-nowrap">
                  {item}
                </span>
              </span>
            ))}
          </Marquee>
        </div>

        {/* ===== Stats band ===================================== */}
        <Reveal as="div" className="border-b border-border bg-bg-primary">
          <div className={`${WRAP} grid grid-cols-2 lg:grid-cols-4 gap-px bg-border [&>*]:bg-bg-primary`}>
            {stats.map((s) => (
              <RevealItem key={s.label} className="bg-bg-primary px-6 py-8 sm:py-10 text-center">
                <div className="font-mono text-4xl sm:text-5xl font-bold text-accent tracking-tight">
                  {s.value}
                </div>
                <div className="mt-2 font-mono text-[11px] sm:text-xs text-text-secondary uppercase tracking-wide">
                  {s.label}
                </div>
              </RevealItem>
            ))}
          </div>
        </Reveal>

        {/* ===== Features (bento) =============================== */}
        <div id="features" className="cv-auto py-20 sm:py-28 bg-bg-secondary">
          <Reveal className={WRAP}>
            <SectionHead
              eyebrow="Features"
              title="Built for multi-agent, parallel workflows"
              sub="Everything you need to run Claude, Codex, Gemini, Grok, Cursor, and Venice from a single workspace — without terminal sprawl."
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
              {features.map((f) => (
                <RevealItem
                  key={f.title}
                  className={f.wide ? "sm:col-span-2 lg:col-span-3" : ""}
                >
                  <SpotlightCard className="h-full bg-bg-secondary p-6 sm:p-7 hover:bg-bg-tertiary transition-colors group border-t-2 border-t-transparent hover:border-t-accent">
                    <span className="font-mono text-2xl text-accent block mb-3 transition-transform group-hover:scale-110 origin-left">
                      {f.icon}
                    </span>
                    <h3 className="font-mono text-sm font-semibold mb-2 group-hover:text-accent transition-colors">
                      {f.title}
                    </h3>
                    <p className="text-text-secondary text-xs leading-relaxed max-w-prose">
                      {f.desc}
                    </p>
                  </SpotlightCard>
                </RevealItem>
              ))}
            </div>
          </Reveal>
        </div>

        {/* ===== Living agent canvas =========================== */}
        <div className="cv-auto py-20 sm:py-28">
          <Reveal className={WRAP}>
            <SectionHead
              eyebrow="The canvas"
              title="Every agent. Every project. At a glance."
              sub="Claude, Codex, Gemini, Grok, Cursor, Venice, and shells — all visible on one canvas, all running in parallel."
            />
            <div className="relative">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
                {panes.map((pane, i) => (
                  <motion.div
                    key={pane.title}
                    initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className={`relative bg-bg-primary flex flex-col scanlines ${pane.status === "waiting" ? "attention z-10" : ""}`}
                  >
                    {/* Pane header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border">
                      <span className={`w-2 h-2 shrink-0 ${statusColor[pane.status]}`} />
                      <span className="font-mono text-[11px] text-text-secondary truncate flex-1">
                        {pane.title}
                      </span>
                      <span
                        className="font-mono text-[9px] font-semibold px-1.5 py-0.5 shrink-0"
                        style={{ color: AGENT_COLORS[pane.agent], background: AGENT_COLORS[pane.agent] + "18" }}
                      >
                        {pane.agent}
                      </span>
                    </div>
                    {/* Pane content */}
                    <motion.div
                      className="p-3 flex-1 min-h-[140px] sm:min-h-[160px] overflow-hidden"
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true }}
                      variants={{ visible: { transition: { staggerChildren: 0.05, delayChildren: i * 0.08 + 0.2 } } }}
                    >
                      {pane.lines.map((line, j) => (
                        <motion.div
                          key={j}
                          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
                          className={`font-mono text-[10px] sm:text-xs leading-relaxed whitespace-pre-wrap break-words ${
                            line.startsWith("$")
                              ? "text-status-running"
                              : line.startsWith(">")
                                ? "text-accent"
                                : line.includes("FAIL") || line.includes("failed")
                                  ? "text-status-error"
                                  : line.includes("✓") || line.includes("PASS")
                                    ? "text-status-running"
                                    : line.includes("⏳")
                                      ? "text-status-waiting"
                                      : "text-text-secondary"
                          }`}
                        >
                          {line || " "}
                          {pane.status === "waiting" && j === pane.lines.length - 1 && (
                            <span className="cursor-blink text-status-waiting">_</span>
                          )}
                        </motion.div>
                      ))}
                    </motion.div>
                  </motion.div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        {/* ===== Agents ========================================= */}
        <div className="cv-auto py-20 sm:py-28 bg-bg-secondary">
          <Reveal className={WRAP}>
            <SectionHead
              eyebrow="The agents"
              title="Run the CLIs you already use"
              sub="CodeGrid launches your real agent CLIs in real PTYs — no wrappers, no lock-in. Use the best model for each job, side by side."
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-border border border-border">
              {agents.map((a) => (
                <RevealItem key={a.name}>
                  <SpotlightCard
                    className="h-full bg-bg-secondary p-6 flex flex-col gap-3 hover:bg-bg-tertiary transition-colors group"
                    style={{ ["--spot" as string]: a.color }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="round-full w-2.5 h-2.5 transition-transform group-hover:scale-125" style={{ background: a.color, boxShadow: `0 0 12px ${a.color}88` }} />
                      <span className="font-mono text-sm font-semibold">{a.name}</span>
                    </span>
                    <span
                      className="font-mono text-[11px] px-2 py-1 border w-fit"
                      style={{ color: a.color, borderColor: a.color + "44", background: a.color + "0d" }}
                    >
                      $ {a.cli}
                    </span>
                  </SpotlightCard>
                </RevealItem>
              ))}
            </div>
          </Reveal>
        </div>

        {/* ===== How it works =================================== */}
        <div className="cv-auto py-20 sm:py-28">
          <Reveal className={WRAP}>
            <SectionHead eyebrow="How it works" title="From zero to a full fleet in three steps" />
            <div className="relative grid md:grid-cols-3 gap-px bg-border border border-border">
              {steps.map((s) => (
                <RevealItem key={s.step}>
                  <div className="bg-bg-primary p-7 sm:p-8 h-full">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="font-mono text-5xl font-bold text-accent/20 leading-none">{s.step}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <h3 className="font-mono text-sm font-semibold mb-2">{s.title}</h3>
                    <p className="text-text-secondary text-xs leading-relaxed">{s.desc}</p>
                  </div>
                </RevealItem>
              ))}
            </div>
          </Reveal>
        </div>

        {/* ===== Comparison ===================================== */}
        <div className="cv-auto py-20 sm:py-28 bg-bg-secondary">
          <Reveal className={WRAP}>
            <SectionHead
              title="CodeGrid vs. the usual setup"
              sub="Terminal tabs and tmux were never built for a dozen AI agents working at once."
            />
            <RevealItem>
              <div className="max-w-3xl mx-auto border border-border overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] bg-bg-tertiary border-b border-border font-mono text-[9px] sm:text-xs font-bold tracking-wide">
                  <div className="p-2 sm:p-4" />
                  <div className="p-2 sm:p-4 text-center text-accent bg-accent/5">CodeGrid</div>
                  <div className="p-2 sm:p-4 text-center text-text-secondary">Tabs</div>
                  <div className="p-2 sm:p-4 text-center text-text-secondary">tmux</div>
                </div>
                {compareRows.map((r, i) => (
                  <div
                    key={r.label}
                    className={`grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem] ${i % 2 ? "bg-bg-primary" : "bg-bg-secondary"}`}
                  >
                    <div className="p-2.5 sm:p-4 font-mono text-[11px] sm:text-xs text-text-primary self-center leading-snug">
                      {r.label}
                    </div>
                    <div className="p-2 sm:p-4 flex items-center justify-center bg-accent/5">
                      {r.codegrid ? <span className="font-mono text-sm font-bold text-accent">✓</span> : <span className="font-mono text-sm text-text-secondary/40">—</span>}
                    </div>
                    <div className="p-2 sm:p-4 flex items-center justify-center">
                      {r.tabs ? <span className="font-mono text-sm font-bold text-status-running">✓</span> : <span className="font-mono text-sm text-text-secondary/40">—</span>}
                    </div>
                    <div className="p-2 sm:p-4 flex items-center justify-center">
                      {r.tmux ? <span className="font-mono text-sm font-bold text-status-running">✓</span> : <span className="font-mono text-sm text-text-secondary/40">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </RevealItem>
          </Reveal>
        </div>

        {/* ===== FAQ / objections =============================== */}
        <div className="cv-auto py-20 sm:py-28">
          <Reveal className={`${WRAP} max-w-3xl`}>
            <SectionHead eyebrow="Why CodeGrid" title="The questions everyone asks" />
            <RevealItem>
              <FaqAccordion items={objections} />
            </RevealItem>
          </Reveal>
        </div>

        {/* ===== Shortcuts ===================================== */}
        <div id="shortcuts" className="cv-auto py-20 sm:py-28 bg-bg-secondary">
          <Reveal className={WRAP}>
            <SectionHead eyebrow="Keyboard-first" title="Your hands never leave home row" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border border border-border max-w-2xl mx-auto">
              {shortcuts.map((s) => (
                <RevealItem key={s.label}>
                  <div className="bg-bg-secondary p-5 flex flex-col items-center gap-3 h-full justify-center hover:bg-bg-tertiary transition-colors">
                    <span className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="font-mono text-xs text-accent font-semibold px-2 py-1 bg-bg-primary border border-border shadow-[0_2px_0_0_var(--border)]"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="font-mono text-[11px] text-text-secondary text-center">{s.label}</span>
                  </div>
                </RevealItem>
              ))}
            </div>
          </Reveal>
        </div>

        {/* ===== Trust ========================================= */}
        <div className="cv-auto py-20 sm:py-28">
          <Reveal className={WRAP}>
            <SectionHead
              eyebrow="Trust"
              title="Open source. Local-first. Yours."
              sub="No account, no telemetry, no servers. Everything we claim is verifiable in the code."
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
              {trustPillars.map((p) => (
                <RevealItem key={p.h}>
                  <SpotlightCard
                    as="a"
                    href={p.href}
                    {...(p.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="block h-full bg-bg-primary p-6 hover:bg-bg-secondary transition-colors group border-t-2 border-t-transparent hover:border-t-accent"
                  >
                    <span className="font-mono text-2xl text-accent block mb-3">{p.icon}</span>
                    <h3 className="font-mono text-sm font-semibold mb-2 group-hover:text-accent transition-colors flex items-center gap-1">
                      {p.h}
                      <span className="opacity-0 -translate-x-1 group-hover:opacity-50 group-hover:translate-x-0 transition-all">→</span>
                    </h3>
                    <p className="text-text-secondary text-xs leading-relaxed">{p.d}</p>
                  </SpotlightCard>
                </RevealItem>
              ))}
            </div>
          </Reveal>
        </div>

        {/* ===== $GRID (optional) ============================== */}
        <TokenStrip />

        {/* ===== Final CTA ===================================== */}
        <section className="cv-auto relative overflow-hidden py-24 sm:py-36 border-t border-border">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid grid-fade" />
            <div className="absolute inset-0 accent-bloom" />
          </div>
          <Reveal className={`${WRAP} text-center`}>
            <RevealItem className="mb-5">
              <Eyebrow>Free &amp; open source</Eyebrow>
            </RevealItem>
            <RevealItem>
              <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight">
                Your agents are <span className="text-accent">waiting.</span>
              </h2>
            </RevealItem>
            <RevealItem>
              <p className="text-text-secondary text-sm sm:text-base max-w-xl mx-auto mt-5 mb-9">
                Run your whole fleet of coding agents on one canvas. Open source, local-first, and free to download.
              </p>
            </RevealItem>
            <RevealItem>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href="/download"
                  className="btn-sheen group inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-black font-mono text-sm font-semibold px-8 py-4 transition-colors"
                >
                  Download for Mac
                  <span className="transition-transform group-hover:translate-x-0.5">↓</span>
                </a>
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-border hover:border-text-secondary text-text-primary font-mono text-sm px-8 py-4 transition-colors"
                >
                  <span className="text-accent">★</span> Star on GitHub
                </a>
              </div>
            </RevealItem>
            <RevealItem>
              <p className="mt-5 text-xs font-mono text-text-secondary">
                macOS · Apple Silicon · Signed &amp; notarized
              </p>
            </RevealItem>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
