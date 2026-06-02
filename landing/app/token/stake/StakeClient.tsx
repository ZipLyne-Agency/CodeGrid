"use client";

import Link from "next/link";
import {useEffect, useMemo, useRef, useState} from "react";
import {motion, animate, useMotionValue, useReducedMotion} from "framer-motion";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import {formatUnits, parseUnits, maxUint256} from "viem";
import {
  VEGRID_ADDRESS,
  GRID_ADDRESS,
  VEGRID_ABI,
  ERC20_ABI,
  TIERS,
  COOLDOWN_OPTIONS,
  GRID_CHAIN_ID,
  previewPower,
  usd,
} from "@/lib/vegrid";

/* ================================================================== */
/*  Constants + helpers                                                */
/* ================================================================== */

/** The one tier that means anything: Pro (tier 1). Team/Founder unlock the
 *  same features today, so the page is Pro-only and honest about it. */
const PRO = TIERS.find((t) => t.tier === 1) ?? TIERS[0];

/** What staking to Pro actually switches on — verified against the desktop
 *  (`ReviewPanel`/`AnalyticsPanel`, both `<Gated tier={1}>`). Nothing else. */
const PRO_FEATURES: {name: string; blurb: string}[] = [
  {name: "AI code review", blurb: "Review your git changes — bugs, security & UX — from the Git panel, before you push."},
  {name: "Coding analytics", blurb: "A local dashboard built from your agent-CLI logs. Nothing leaves your machine."},
  {name: "AI commit messages", blurb: "One click writes a clear commit message from your staged diff."},
  {name: "AI terminal naming", blurb: "Name any terminal from what it's actually doing — a real tab title, not just zsh."},
];

/** Honest fair-use caps shown on the page (analytics is local + uncapped). */
const PRO_LIMITS = "Fair-use limits: 30 AI reviews + 300 AI assists (commit & terminal names) per month. Coding analytics is local and uncapped.";

const BASESCAN = GRID_CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fmt = (n: number) =>
  n >= 1000 ? n.toLocaleString(undefined, {maximumFractionDigits: 0}) : n.toLocaleString(undefined, {maximumFractionDigits: 2});

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return fmt(n);
}

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const multiplierFor = (s: number) => COOLDOWN_OPTIONS.find((o) => o.seconds === s)?.multiplierBps ?? 10_000;
const cooldownLabel = (s: number) => COOLDOWN_OPTIONS.find((o) => o.seconds === s)?.label ?? `${s / 86_400}-day`;

type ViewId = "status" | "stake" | "position" | "unlock" | "verify" | "help";

interface ViewDef {
  id: ViewId;
  cmd: string;
  label: string;
  desc: string;
}
const VIEWS: ViewDef[] = [
  {id: "status", cmd: "status", label: "Overview", desc: "Your power, Pro status & position"},
  {id: "stake", cmd: "stake $GRID", label: "Stake", desc: "Stake to build access power"},
  {id: "position", cmd: "position", label: "Position", desc: "Your stake & unlock countdown"},
  {id: "unlock", cmd: "cat PRO.md", label: "What you unlock", desc: "What reaching Pro switches on"},
  {id: "verify", cmd: "verify", label: "Verify", desc: "Contract, safety & how it works"},
  {id: "help", cmd: "help", label: "Help", desc: "Commands & shortcuts"},
];

/* ================================================================== */
/*  Animated primitives                                                */
/* ================================================================== */

function CountUp({value, format = fmt, className}: {value: number; format?: (n: number) => string; className?: string}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const c = animate(mv, value, {duration: 0.9, ease: EASE, onUpdate: (v) => setDisplay(v)});
    return () => c.stop();
  }, [value, reduce, mv]);
  return (
    <span className={className} suppressHydrationWarning>
      {format(display)}
    </span>
  );
}

/** Epoch seconds, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Spinner() {
  return (
    <motion.span
      aria-hidden
      className="inline-block h-3 w-3 border border-current border-t-transparent round-full"
      animate={{rotate: 360}}
      transition={{repeat: Infinity, ease: "linear", duration: 0.7}}
    />
  );
}

/** ASCII progress bar, terminal-native: [████░░░░] 41% */
function AsciiBar({pct, cells = 28, color = "var(--accent)"}: {pct: number; cells?: number; color?: string}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * cells);
  return (
    <span className="font-mono text-[12px] leading-none">
      <span style={{color}}>[</span>
      <span style={{color}}>{"█".repeat(filled)}</span>
      <span className="text-text-secondary opacity-30">{"░".repeat(cells - filled)}</span>
      <span style={{color}}>]</span>{" "}
      <span className="text-text-primary tabular-nums">{clamped < 10 ? clamped.toFixed(1) : clamped.toFixed(0)}%</span>
    </span>
  );
}

/* ================================================================== */
/*  Shared on-chain data                                               */
/* ================================================================== */

interface ChainData {
  connected: boolean;
  address?: `0x${string}`;
  loading: boolean;
  gridBal?: bigint;
  allowance?: bigint;
  gridBalNum: number;
  powerNum: number;
  isPro: boolean;
  progress: number; // 0-100 toward Pro
  staked: bigint;
  unbonding: bigint;
  stakedNum: number;
  /** Protocol-wide total staked across all users (GRID), or null until loaded. */
  totalStakedNum: number | null;
  cooldownPeriod: number;
  unbondingEnd: number;
  wrongNetwork: boolean;
  switching: boolean;
  switchToBase: () => void;
  refetch: () => void;
}

/* ================================================================== */
/*  Shell                                                              */
/* ================================================================== */

export function StakeClient() {
  const [view, setView] = useState<ViewId>("status");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setTick] = useState(0);
  const paneRef = useRef<HTMLDivElement>(null);

  const {address, isConnected} = useAccount();
  const chainId = useChainId();
  const {switchChain, isPending: switching} = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== GRID_CHAIN_ID;

  const {data: core, refetch} = useReadContracts({
    contracts: address
      ? [
          {address: GRID_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [address]},
          {address: GRID_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, VEGRID_ADDRESS]},
          {address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "votingPower", args: [address]},
          {address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "tierOf", args: [address]},
          {address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "positions", args: [address]},
        ]
      : [],
    query: {enabled: !!address, refetchInterval: 20_000},
  });

  // Protocol-wide total staked — read globally (no wallet needed) so it shows
  // to every visitor, connected or not. Auto-refreshes after any stake/unstake.
  const {data: globalData} = useReadContracts({
    contracts: [
      {address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "totalStaked"},
    ],
    query: {refetchInterval: 20_000},
  });
  const totalStaked = globalData?.[0]?.result as bigint | undefined;

  // Live "last sync" / status-bar timer.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // Lock the document — this page never body-scrolls.
  useEffect(() => {
    document.documentElement.classList.add("page-locked");
    return () => document.documentElement.classList.remove("page-locked");
  }, []);

  // Reset pane scroll + close mobile sidebar on view change.
  useEffect(() => {
    paneRef.current?.scrollTo({top: 0, behavior: "instant"});
    setSidebarOpen(false);
  }, [view]);

  // Number-key view switching (1-6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA"].includes(t.tagName)) return;
      const idx = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      if (idx >= 0 && VIEWS[idx]) {
        e.preventDefault();
        setView(VIEWS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const gridBal = core?.[0]?.result as bigint | undefined;
  const allowance = core?.[1]?.result as bigint | undefined;
  const power = core?.[2]?.result as bigint | undefined;
  const tier = core?.[3]?.result as number | undefined;
  const pos = core?.[4]?.result as readonly [bigint, bigint, bigint, bigint] | undefined;

  const staked = pos?.[0] ?? 0n;
  const unbonding = pos?.[1] ?? 0n;
  const powerNum = power != null ? Number(formatUnits(power, 18)) : 0;

  const d: ChainData = {
    connected: isConnected,
    address,
    loading: isConnected && core == null,
    gridBal,
    allowance,
    gridBalNum: gridBal != null ? Number(formatUnits(gridBal, 18)) : 0,
    powerNum,
    isPro: Number(tier ?? 0) >= 1,
    progress: Math.min(100, (powerNum / PRO.threshold) * 100),
    staked,
    unbonding,
    stakedNum: Number(formatUnits(staked, 18)),
    totalStakedNum: totalStaked != null ? Number(formatUnits(totalStaked, 18)) : null,
    cooldownPeriod: Number(pos?.[2] ?? 0n),
    unbondingEnd: Number(pos?.[3] ?? 0n),
    wrongNetwork,
    switching,
    switchToBase: () => switchChain({chainId: GRID_CHAIN_ID}),
    refetch: () => refetch(),
  };

  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="terminal-shell">
      <div className="terminal-window">
        {/* Title bar */}
        <header className="terminal-titlebar">
          <div className="flex items-center gap-2">
            <span className="traffic" style={{background: "#ff5f57"}} />
            <span className="traffic" style={{background: "#febc2e"}} />
            <span className="traffic" style={{background: "#28c840"}} />
          </div>
          <div className="terminal-title">
            <span className="text-text-secondary">stake@grid</span>
            <span className="text-text-secondary opacity-60">:~/</span>
            <span className="text-accent">{view}</span>
            <span className="cursor-blink text-accent">▍</span>
          </div>
          <div className="flex items-center gap-2">
            <ConnectChip d={d} />
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
              aria-expanded={sidebarOpen}
              className="lg:hidden font-mono text-[11px] text-text-secondary border border-border px-2 py-1 hover:text-accent hover:border-text-secondary"
            >
              {sidebarOpen ? "✕" : "☰"}
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="terminal-body">
          <aside className={`terminal-sidebar ${sidebarOpen ? "terminal-sidebar-open" : ""}`}>
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary mb-1">$GRID staking</div>
              <div className="font-mono text-[11px] text-text-primary leading-relaxed">
                Stake → unlock Pro.
                <br />
                <span className="text-text-secondary">You keep your principal.</span>
              </div>
            </div>
            <nav className="flex flex-col gap-0.5 px-2 pt-2">
              {VIEWS.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={`group flex items-baseline gap-2 px-2 py-1.5 border-l-2 text-left transition-colors ${
                    view === v.id
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-transparent text-text-secondary hover:text-text-primary hover:border-border"
                  }`}
                >
                  <span className="font-mono text-[10px] text-text-secondary opacity-60 w-3">{i + 1}</span>
                  <span className="font-mono text-accent">$</span>
                  <span className="font-mono text-[13px] truncate flex-1">{v.cmd}</span>
                </button>
              ))}
            </nav>
            <div className="mt-auto px-4 py-3 border-t border-border space-y-1.5">
              <Link href="/token" className="block font-mono text-[11px] text-text-secondary hover:text-accent">
                ← $GRID token page
              </Link>
              <a
                href={`${BASESCAN}/address/${VEGRID_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-[11px] text-text-secondary hover:text-accent"
              >
                BaseScan ↗
              </a>
            </div>
          </aside>

          {/* Pane */}
          <main className="terminal-pane" ref={paneRef} aria-live="polite">
            <div className="cmd-header px-4 sm:px-6 pt-5 pb-3 border-b border-border bg-bg-secondary/30">
              <div className="flex items-baseline gap-2 font-mono text-sm">
                <span className="text-status-running">grid@stake</span>
                <span className="text-text-secondary">:</span>
                <span className="text-status-idle">~</span>
                <span className="text-text-secondary">$</span>
                <span className="text-text-primary">{active.cmd}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-text-secondary">{active.desc}</div>
            </div>

            <div className="pane-body px-4 sm:px-6 pb-10">
              {view === "status" && <StatusView d={d} go={setView} />}
              {view === "stake" && <StakeView d={d} />}
              {view === "position" && <PositionView d={d} go={setView} />}
              {view === "unlock" && <UnlockView />}
              {view === "verify" && <VerifyView />}
              {view === "help" && <HelpView />}
            </div>
          </main>
        </div>

        {/* Status bar */}
        <footer className="terminal-statusbar">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`round-full w-1.5 h-1.5 inline-block ${d.connected ? "bg-status-running pulse-glow" : "bg-status-waiting"}`}
              aria-hidden
            />
            <span className="text-text-primary">{d.connected ? short(d.address) : "not connected"}</span>
            <span className="text-text-secondary opacity-60">·</span>
            <span className={`truncate ${d.wrongNetwork ? "text-status-error" : "text-text-secondary"}`}>
              {d.wrongNetwork ? "wrong network" : "base · mainnet"}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-text-secondary">
            <span>power:</span>
            <span className="text-accent tabular-nums">{d.connected ? fmt(d.powerNum) : "—"}</span>
            <span className="opacity-40">|</span>
            <span>pro:</span>
            <span className={d.isPro ? "text-status-running" : "text-text-secondary"}>{d.isPro ? "unlocked" : "locked"}</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary shrink-0">
            <span className="hidden md:inline opacity-60">press</span>
            <kbd className="terminal-kbd">1</kbd>
            <kbd className="terminal-kbd">…</kbd>
            <kbd className="terminal-kbd">6</kbd>
          </div>
        </footer>
      </div>

      <TerminalStyles />
    </div>
  );
}

/* ================================================================== */
/*  Title-bar connect chip                                             */
/* ================================================================== */

function ConnectChip({d}: {d: ChainData}) {
  const {disconnect} = useDisconnect();
  if (!d.connected) {
    return <span className="hidden sm:inline font-mono text-[11px] text-status-waiting">○ connect to stake</span>;
  }
  return (
    <button
      onClick={() => disconnect()}
      className="hidden sm:inline font-mono text-[11px] text-text-secondary hover:text-accent"
      title="Disconnect"
    >
      {short(d.address)} · disconnect
    </button>
  );
}

/* ================================================================== */
/*  Connect gate                                                       */
/* ================================================================== */

function ConnectGate() {
  const {connect, connectors, isPending} = useConnect();

  const {direct, wc} = useMemo(() => {
    const map = new Map<string, (typeof connectors)[number]>();
    for (const c of connectors) {
      if (c.name.trim().toLowerCase() === "injected") continue;
      const key = c.name.trim().toLowerCase().replace(/\s+/g, "");
      const cur = map.get(key);
      if (!cur || (!cur.icon && c.icon)) map.set(key, c);
    }
    const all = [...map.values()];
    const wc = all.find((c) => c.id === "walletConnect" || c.type === "walletConnect") ?? null;
    return {direct: all.filter((c) => c !== wc), wc};
  }, [connectors]);

  return (
    <div className="pt-6">
      <AsciiBox title="$ connect --wallet">
        <p className="font-mono text-[12px] text-text-secondary mb-4">
          Connect on <span className="text-text-primary">Base</span> to stake. Non-custodial — the contract can only
          ever return your tokens to you.
        </p>
        <div className="flex flex-col gap-2">
          {direct.map((c) => (
            <button
              key={c.uid}
              onClick={() => connect({connector: c})}
              disabled={isPending}
              className="btn-sheen group flex items-center justify-between border border-accent/40 bg-accent/[0.06] px-4 py-3 font-mono text-[13px] transition-all hover:border-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <span className="flex items-center gap-3">
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" aria-hidden className="h-5 w-5" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center border border-accent/40 text-[11px] text-accent">
                    {c.name.charAt(0)}
                  </span>
                )}
                <span className="text-text-primary group-hover:text-accent">{c.name}</span>
              </span>
              <span className="text-text-secondary/50 group-hover:text-accent">{isPending ? <Spinner /> : "→"}</span>
            </button>
          ))}

          {wc ? (
            <>
              {direct.length > 0 ? (
                <div className="my-0.5 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-text-secondary/70">
                  <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <button
                onClick={() => connect({connector: wc})}
                disabled={isPending}
                className="btn-sheen group flex items-center justify-between border border-border bg-bg-primary/40 px-4 py-3 font-mono text-[13px] transition-all hover:border-accent/60 disabled:opacity-50"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center border border-border text-accent text-[13px]">▦</span>
                  <span className="flex flex-col text-left">
                    <span className="text-text-primary group-hover:text-accent">All wallets</span>
                    <span className="font-mono text-[9.5px] text-text-secondary">Uniswap · Rainbow · Trust · scan with phone</span>
                  </span>
                </span>
                <span className="text-text-secondary/50 group-hover:text-accent">{isPending ? <Spinner /> : "→"}</span>
              </button>
            </>
          ) : null}
        </div>
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block font-mono text-[10px] text-text-secondary hover:text-accent"
        >
          Don&apos;t have a wallet? Get one →
        </a>
      </AsciiBox>
    </div>
  );
}

function NetworkBanner({d}: {d: ChainData}) {
  if (!d.wrongNetwork) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-status-waiting/50 bg-status-waiting/10 px-4 py-2.5 font-mono text-[12px] text-status-waiting">
      <span>● wrong network — $GRID & staking live on Base</span>
      <button
        onClick={d.switchToBase}
        disabled={d.switching}
        className="btn-sheen border border-status-waiting/60 px-3 py-1 hover:bg-status-waiting/15 disabled:opacity-50"
      >
        {d.switching ? "switching…" : "switch to Base →"}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Views                                                              */
/* ================================================================== */

/** Protocol-wide total staked — shown to everyone, connected or not. */
function TotalStakedBox({d}: {d: ChainData}) {
  return (
    <AsciiBox title="network">
      <div className="flex items-baseline justify-between font-mono text-[13px]">
        <span className="text-text-secondary">total $GRID staked</span>
        <span className="text-accent tabular-nums">
          {d.totalStakedNum != null ? <CountUp value={d.totalStakedNum} /> : "…"}{" "}
          <span className="text-text-secondary">GRID</span>
        </span>
      </div>
    </AsciiBox>
  );
}

function StatusView({d, go}: {d: ChainData; go: (v: ViewId) => void}) {
  if (!d.connected) {
    return (
      <div className="space-y-5 pt-6">
        <TotalStakedBox d={d} />
        <ConnectGate />
      </div>
    );
  }
  const remaining = Math.max(0, PRO.threshold - d.powerNum);
  return (
    <div className="space-y-5 pt-6">
      <NetworkBanner d={d} />
      <TotalStakedBox d={d} />

      <AsciiBox title="access status">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-8 font-mono text-[13px]">
          <Line k="wallet" v={short(d.address)} />
          <Line k="chain" v="Base mainnet" />
          <Line k="power" v={<CountUp value={d.powerNum} className="text-accent" />} />
          <Line
            k="pro"
            v={d.isPro ? <span className="text-status-running">● unlocked</span> : <span className="text-text-secondary">○ locked</span>}
          />
          <Line k="staked" v={`${fmt(d.stakedNum)} GRID`} />
          <Line k="cooldown" v={d.staked > 0n ? cooldownLabel(d.cooldownPeriod) : "—"} />
        </div>
      </AsciiBox>

      <AsciiBox title="progress to Pro">
        <div className="flex items-baseline justify-between font-mono text-[13px] mb-2">
          <span className="text-text-primary tabular-nums">
            <CountUp value={d.powerNum} /> <span className="text-text-secondary">/ {abbrev(PRO.threshold)} power</span>
          </span>
          <span className="text-text-secondary text-[11px]">{fmt(d.stakedNum)} GRID staked</span>
        </div>
        <AsciiBar pct={d.progress} />
        <div className="mt-2 font-mono text-[11px]">
          {d.isPro ? (
            <span className="text-status-running">✓ Pro unlocked — features are live in the desktop app</span>
          ) : (
            <span className="text-text-secondary">
              <span className="text-accent">{abbrev(remaining)}</span> more power to reach Pro
            </span>
          )}
        </div>
      </AsciiBox>

      <AsciiBox title="reaching Pro unlocks">
        <ul className="space-y-1.5">
          {PRO_FEATURES.map((f) => (
            <li key={f.name} className="font-mono text-[12px] flex gap-2">
              <span className="text-accent">›</span>
              <span>
                <span className="text-text-primary">{f.name}</span>{" "}
                <span className="text-text-secondary">— {f.blurb}</span>
              </span>
            </li>
          ))}
        </ul>
      </AsciiBox>

      <AsciiBox title="next">
        <ul className="font-mono text-[13px] space-y-1.5">
          <ActionLine>
            Press <Kbd>2</Kbd> to stake $GRID and build power
          </ActionLine>
          <ActionLine>
            Press <Kbd>3</Kbd> to manage your position {d.unbonding > 0n ? "· cooldown is running" : ""}
          </ActionLine>
          <ActionLine>
            Press <Kbd>4</Kbd> to see exactly what Pro unlocks
          </ActionLine>
        </ul>
        <div className="mt-3 flex gap-2">
          <PaneButton onClick={() => go("stake")}>$ stake →</PaneButton>
          <PaneButton onClick={() => go("unlock")} ghost>
            what you get
          </PaneButton>
        </div>
      </AsciiBox>
    </div>
  );
}

function StakeView({d}: {d: ChainData}) {
  const [amount, setAmount] = useState("");
  const [cooldown, setCooldown] = useState<number>(COOLDOWN_OPTIONS[0].seconds);
  const amt = Number(amount) || 0;

  // Can't lower cooldown while holding a position.
  const currentCooldown = d.staked > 0n || d.unbonding > 0n ? d.cooldownPeriod : 0;
  useEffect(() => {
    if (currentCooldown > 0 && cooldown < currentCooldown) setCooldown(currentCooldown);
  }, [currentCooldown, cooldown]);

  const pow = previewPower(amt, multiplierFor(cooldown));
  const resultingPower = d.powerNum + pow;
  const reachesPro = resultingPower >= PRO.threshold;

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const needsApproval = d.allowance != null && amountWei > 0n && d.allowance < amountWei;
  const insufficient = d.gridBal != null && amountWei > d.gridBal;

  const {writeContract, data: txHash, isPending, reset, error} = useWriteContract();
  const {isLoading: confirming, isSuccess} = useWaitForTransactionReceipt({hash: txHash});
  const [pendingAction, setPendingAction] = useState<"approve" | "stake" | null>(null);
  const [justStaked, setJustStaked] = useState(false);

  useEffect(() => {
    if (!isSuccess) return;
    if (pendingAction === "stake") {
      setAmount("");
      setJustStaked(true);
      setTimeout(() => setJustStaked(false), 4000);
    }
    setPendingAction(null);
    reset();
    d.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  if (!d.connected) return <ConnectGate />;

  const busy = isPending || confirming;
  const rejected = !!error && /reject|denied|cancel/i.test(error.message);

  function approve() {
    setPendingAction("approve");
    writeContract({address: GRID_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [VEGRID_ADDRESS, maxUint256], chainId: GRID_CHAIN_ID});
  }
  function stake() {
    setPendingAction("stake");
    writeContract({address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "stake", args: [amountWei, BigInt(cooldown)], chainId: GRID_CHAIN_ID});
  }

  return (
    <div className="space-y-5 pt-6 max-w-2xl">
      <NetworkBanner d={d} />

      {justStaked ? (
        <div className="flex items-center gap-2 border border-status-running/50 bg-status-running/10 px-4 py-2.5 font-mono text-[12.5px] text-status-running">
          <span>✓</span> Staked — power updated. Press <Kbd>3</Kbd> for your position.
        </div>
      ) : null}

      <AsciiBox title="amount">
        <div className="flex items-center justify-between font-mono text-[11px] text-text-secondary mb-1.5">
          <span>$GRID to stake</span>
          <span>
            balance: <span className="text-text-primary">{fmt(d.gridBalNum)}</span>
          </span>
        </div>
        <div className="flex items-stretch border border-border bg-bg-primary focus-within:border-accent/60">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-lg text-text-primary outline-none placeholder:text-text-secondary/50"
          />
          <button
            onClick={() => d.gridBal != null && setAmount(formatUnits(d.gridBal, 18))}
            className="border-l border-border px-4 font-mono text-[11px] text-text-secondary hover:bg-accent/10 hover:text-accent"
          >
            MAX
          </button>
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] text-text-secondary">≈ {usd(amt)}</div>
      </AsciiBox>

      <AsciiBox title="unstake notice">
        <div className="font-mono text-[11px] text-text-secondary mb-2">
          {currentCooldown > 0 ? "Can raise, not lower while staked." : "Longer notice earns more power."}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {COOLDOWN_OPTIONS.map((o) => {
            const locked = currentCooldown > 0 && o.seconds < currentCooldown;
            const activeSel = cooldown === o.seconds;
            const mult = o.multiplierBps / 10_000;
            return (
              <button
                key={o.seconds}
                onClick={() => !locked && setCooldown(o.seconds)}
                disabled={locked}
                className={`border px-3 py-2.5 text-left transition-all ${
                  activeSel ? "border-accent/60 bg-accent/[0.08]" : "border-border hover:border-accent/30"
                } disabled:opacity-30`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-[13px] ${activeSel ? "text-accent" : "text-text-primary"}`}>{o.days}-day</span>
                  <span className={`font-mono text-[10px] ${mult > 1 ? "text-status-running" : "text-text-secondary"}`}>{mult.toFixed(2)}×</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-text-secondary">{mult > 1 ? `+${Math.round((mult - 1) * 100)}% power` : "base power"}</div>
              </button>
            );
          })}
        </div>
      </AsciiBox>

      <AsciiBox title="preview">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">power after</div>
            <div className="font-mono text-xl text-text-primary tabular-nums">
              <CountUp value={resultingPower} />
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">Pro</div>
            <div className={`font-mono text-xl ${reachesPro ? "text-status-running" : "text-text-secondary"}`}>
              {reachesPro ? "✓ unlocked" : "○ not yet"}
            </div>
          </div>
        </div>
        {!reachesPro && amt > 0 ? (
          <div className="mt-3 border-t border-border pt-2 font-mono text-[10.5px] text-text-secondary">
            {abbrev(Math.max(0, PRO.threshold - resultingPower))} more power needed for Pro
          </div>
        ) : null}
      </AsciiBox>

      {insufficient ? (
        <p className="font-mono text-[11px] text-status-error">Amount exceeds your wallet balance.</p>
      ) : rejected ? (
        <p className="font-mono text-[11px] text-text-secondary">Signature cancelled — no funds moved.</p>
      ) : error ? (
        <p className="font-mono text-[11px] text-status-error">Transaction failed. Please try again.</p>
      ) : null}

      {needsApproval ? (
        <button
          onClick={approve}
          disabled={busy || amt <= 0}
          className="btn-sheen flex w-full items-center justify-center gap-2 border border-accent/50 bg-accent/[0.06] py-3 font-mono text-[13px] text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Spinner /> approving…
            </>
          ) : (
            <>
              <span className="border border-accent/40 px-1.5 text-[10px]">1/2</span> approve $GRID
            </>
          )}
        </button>
      ) : (
        <button
          onClick={stake}
          disabled={busy || amt <= 0 || insufficient}
          className="btn-sheen flex w-full items-center justify-center gap-2 border border-accent bg-accent/10 py-3 font-mono text-[13px] text-accent hover:bg-accent/15 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Spinner /> staking…
            </>
          ) : (
            <>
              {d.allowance != null && amt > 0 ? <span className="border border-accent/40 px-1.5 text-[10px]">2/2</span> : null}
              stake $GRID →
            </>
          )}
        </button>
      )}
      <p className="text-center font-mono text-[10px] text-text-secondary">
        Principal is always yours · withdraw after the cooldown · no yield, no custody
      </p>
    </div>
  );
}

function PositionView({d, go}: {d: ChainData; go: (v: ViewId) => void}) {
  const [unstakeAmt, setUnstakeAmt] = useState("");
  const {writeContract, data: txHash, isPending, reset} = useWriteContract();
  const {isLoading: confirming, isSuccess} = useWaitForTransactionReceipt({hash: txHash});
  const lastAction = useRef<"unstake" | "withdraw" | "cancel" | null>(null);

  useEffect(() => {
    if (!isSuccess) return;
    reset();
    setUnstakeAmt("");
    d.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const hasCooldown = d.unbonding > 0n;
  const now = useNow(hasCooldown && d.unbondingEnd > 0);

  if (!d.connected) return <ConnectGate />;

  const busy = isPending || confirming;

  if (d.staked === 0n && d.unbonding === 0n) {
    return (
      <div className="pt-6 max-w-2xl">
        <AsciiBox title="your position">
          <p className="font-mono text-[12px] text-text-secondary mb-4">No active stake yet. Here&apos;s the flow:</p>
          <ol className="space-y-3">
            {[
              ["stake", "Lock $GRID to build access power."],
              ["unlock", "Cross 50M power → Pro switches on in the desktop app."],
              ["exit", "Start a 7 or 30-day cooldown anytime. Principal returns in full."],
            ].map(([t, dsc], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-border font-mono text-[11px] text-accent">{i + 1}</span>
                <div>
                  <div className="font-mono text-[12px] text-text-primary">{t}</div>
                  <div className="font-mono text-[11px] text-text-secondary">{dsc}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <PaneButton onClick={() => go("stake")}>$ stake $GRID →</PaneButton>
          </div>
        </AsciiBox>
      </div>
    );
  }

  const ready = hasCooldown && now >= d.unbondingEnd;
  const secsLeft = Math.max(0, d.unbondingEnd - now);
  const dLeft = Math.floor(secsLeft / 86400);
  const hLeft = Math.floor((secsLeft % 86400) / 3600);
  const mLeft = Math.floor((secsLeft % 3600) / 60);
  const sLeft = secsLeft % 60;
  const unlockAt = d.unbondingEnd > 0 ? new Date(d.unbondingEnd * 1000).toLocaleString() : "";
  const cdStart = d.unbondingEnd - d.cooldownPeriod;
  const elapsed = d.cooldownPeriod > 0 ? Math.min(100, Math.max(0, ((now - cdStart) / d.cooldownPeriod) * 100)) : 0;

  const unstakeWei = (() => {
    try {
      return unstakeAmt ? parseUnits(unstakeAmt, 18) : 0n;
    } catch {
      return 0n;
    }
  })();
  const unstakeTooMuch = unstakeWei > d.staked;

  function requestUnstake() {
    lastAction.current = "unstake";
    const a = unstakeWei > 0n ? unstakeWei : d.staked;
    writeContract({address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "requestUnstake", args: [a], chainId: GRID_CHAIN_ID});
  }
  function withdraw() {
    lastAction.current = "withdraw";
    writeContract({address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "withdraw", args: [], chainId: GRID_CHAIN_ID});
  }
  function cancelUnstake() {
    lastAction.current = "cancel";
    writeContract({address: VEGRID_ADDRESS, abi: VEGRID_ABI, functionName: "cancelUnstake", args: [], chainId: GRID_CHAIN_ID});
  }

  return (
    <div className="space-y-5 pt-6 max-w-2xl">
      <NetworkBanner d={d} />

      {d.staked > 0n ? (
        <AsciiBox title="active stake">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-8 font-mono text-[13px]">
            <Line k="staked" v={`${fmt(d.stakedNum)} GRID`} />
            <Line k="≈ value" v={usd(d.stakedNum)} />
            <Line k="power" v={<span className="text-accent">{fmt(d.powerNum)}</span>} />
            <Line k="cooldown" v={cooldownLabel(d.cooldownPeriod)} />
            <Line k="pro" v={d.isPro ? <span className="text-status-running">● unlocked</span> : <span className="text-text-secondary">○ locked</span>} />
          </div>

          {!hasCooldown ? (
            <div className="mt-4 border-t border-border pt-4">
              <div className="font-mono text-[11px] text-text-secondary mb-1.5">
                Unstake amount <span className="opacity-60">(blank = all)</span>
              </div>
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={unstakeAmt}
                  onChange={(e) => setUnstakeAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={fmt(d.stakedNum)}
                  className="min-w-0 flex-1 border border-border bg-bg-primary px-3 py-2 font-mono text-[13px] text-text-primary outline-none focus:border-accent/50"
                />
                <button
                  onClick={requestUnstake}
                  disabled={busy || unstakeTooMuch}
                  className="btn-sheen shrink-0 border border-border px-3 py-2 font-mono text-[12px] text-text-secondary hover:border-accent/50 hover:text-accent disabled:opacity-40"
                >
                  {busy ? <Spinner /> : "start cooldown"}
                </button>
              </div>
              <p className={`mt-1.5 font-mono text-[10.5px] ${unstakeTooMuch ? "text-status-error" : "text-text-secondary"}`}>
                {unstakeTooMuch ? "More than your active stake." : "Access ends when the cooldown starts; principal returns after."}
              </p>
            </div>
          ) : null}
        </AsciiBox>
      ) : null}

      {/* Live unlock countdown — the centerpiece */}
      {hasCooldown ? (
        <section className={`border ${ready ? "border-status-running/50 bg-status-running/[0.06]" : "border-accent/40 bg-accent/[0.04]"}`}>
          <header className="flex items-baseline gap-2 px-4 py-2 border-b border-border bg-bg-secondary/40">
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">┌─</span>
            <span className="font-mono text-[11px] uppercase tracking-widest" style={{color: ready ? "var(--status-running)" : "var(--accent)"}}>
              {ready ? "ready to withdraw" : "unlocking"}
            </span>
          </header>
          <div className="px-4 py-5 text-center">
            <div className="font-mono text-[11px] text-text-secondary mb-1">{fmt(Number(formatUnits(d.unbonding, 18)))} GRID cooling down</div>
            {ready ? (
              <div className="font-mono text-3xl text-status-running py-2">✓ unlocked</div>
            ) : (
              <div className="font-mono text-4xl sm:text-5xl text-accent tabular-nums py-1 leading-none">
                {dLeft > 0 ? `${dLeft}d ` : ""}
                {String(hLeft).padStart(2, "0")}:{String(mLeft).padStart(2, "0")}:{String(sLeft).padStart(2, "0")}
              </div>
            )}
            <div className="mt-3 mb-1">
              <AsciiBar pct={ready ? 100 : elapsed} color={ready ? "var(--status-running)" : "var(--accent)"} />
            </div>
            {!ready ? <div className="font-mono text-[10px] text-text-secondary">unlocks {unlockAt}</div> : null}
          </div>
          <div className="flex gap-2 px-4 pb-4">
            <button
              onClick={withdraw}
              disabled={busy || !ready}
              className={`btn-sheen flex-1 border py-2.5 font-mono text-[12px] ${
                ready ? "border-status-running/50 bg-status-running/10 text-status-running hover:bg-status-running/15" : "border-border text-text-secondary"
              } disabled:opacity-40`}
            >
              {busy && lastAction.current === "withdraw" ? <Spinner /> : "withdraw principal"}
            </button>
            <button
              onClick={cancelUnstake}
              disabled={busy}
              className="border border-border px-3 py-2.5 font-mono text-[12px] text-text-secondary hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              {busy && lastAction.current === "cancel" ? <Spinner /> : "cancel"}
            </button>
          </div>
          <p className="px-4 pb-4 font-mono text-[10px] text-text-secondary">Cancel restores your stake & access instantly — no penalty.</p>
        </section>
      ) : null}
    </div>
  );
}

function UnlockView() {
  return (
    <div className="space-y-5 pt-6 max-w-2xl">
      <AsciiBox title="what staking to Pro unlocks">
        <div className="space-y-3">
          {PRO_FEATURES.map((f) => (
            <div key={f.name} className="border border-border bg-bg-primary/40 p-3">
              <div className="font-mono text-[13px] text-accent">› {f.name}</div>
              <div className="mt-1 font-mono text-[11px] text-text-secondary leading-relaxed">{f.blurb}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10.5px] text-text-secondary">
          That&apos;s the full list — same for every Pro staker. No tiers above Pro change what you get.
        </p>
        <p className="mt-2 border-t border-border pt-2 font-mono text-[10px] text-text-secondary/80">
          {PRO_LIMITS}
        </p>
      </AsciiBox>

      <AsciiBox title="how access works">
        <ol className="space-y-2.5">
          {[
            ["Stake $GRID", `power = staked × cooldown multiplier (7-day 1.0×, 30-day 1.25×). Reach ${abbrev(PRO.threshold)} power for Pro.`],
            ["Sign in the desktop app", "Connect the same wallet (a signature — no transaction). CodeGrid issues an entitlement."],
            ["Pro switches on", "All four Pro features unlock automatically. Free users get no AI runs."],
          ].map(([t, dsc], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-border font-mono text-[11px] text-accent">{i + 1}</span>
              <div>
                <div className="font-mono text-[12px] text-text-primary">{t}</div>
                <div className="font-mono text-[11px] text-text-secondary leading-relaxed">{dsc}</div>
              </div>
            </li>
          ))}
        </ol>
      </AsciiBox>
    </div>
  );
}

function VerifyView() {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(VEGRID_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  const safety = [
    ["Principal protected", "Your $GRID is always returned. The owner can never withdraw user funds."],
    ["No yield, no custody", "Not an investment — no rewards, no revenue share. Staking only grants feature access."],
    ["Exit anytime", "Start a 7 or 30-day cooldown whenever you want. Cancel to restore your stake instantly."],
  ];
  return (
    <div className="space-y-5 pt-6 max-w-2xl">
      <AsciiBox title="safety">
        <div className="space-y-2.5">
          {safety.map(([t, dsc]) => (
            <div key={t} className="font-mono text-[12px]">
              <span className="text-accent">› {t}</span>
              <div className="mt-0.5 text-[11px] text-text-secondary leading-relaxed">{dsc}</div>
            </div>
          ))}
        </div>
      </AsciiBox>

      <AsciiBox title="contract">
        <div className="font-mono text-[12px] space-y-2">
          <Line
            k="staking"
            v={
              <a href={`${BASESCAN}/address/${VEGRID_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">
                {VEGRID_ADDRESS}
              </a>
            }
          />
          <Line k="chain" v="Base mainnet (chainId 8453)" />
          <Line k="standard" v="cooldown access staking · principal-only escrow" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={copy} className="border border-border px-2 py-1 font-mono text-[11px] text-text-secondary hover:border-accent/50 hover:text-accent">
            {copied ? "copied ✓" : `copy ${short(VEGRID_ADDRESS)} ⧉`}
          </button>
          <a href={`${BASESCAN}/address/${VEGRID_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="border border-border px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/10">
            BaseScan →
          </a>
        </div>
      </AsciiBox>
    </div>
  );
}

function HelpView() {
  return (
    <div className="pt-6 space-y-5 max-w-2xl">
      <AsciiBox title="commands">
        <div className="font-mono text-[13px] space-y-1.5">
          {VIEWS.map((v, i) => (
            <div key={v.id} className="grid grid-cols-[2rem_1fr_1.4fr] gap-3">
              <Kbd>{i + 1}</Kbd>
              <span className="text-accent">$ {v.cmd}</span>
              <span className="text-text-secondary">{v.desc}</span>
            </div>
          ))}
        </div>
      </AsciiBox>
      <AsciiBox title="notes">
        <div className="font-mono text-[12px] text-text-secondary leading-relaxed space-y-1">
          <div>· number keys 1–6 switch views · no page scroll</div>
          <div>· data is read live from Base via public RPC</div>
          <div>· staking is non-custodial — every action needs your signature</div>
        </div>
      </AsciiBox>
    </div>
  );
}

/* ================================================================== */
/*  Primitives                                                         */
/* ================================================================== */

function AsciiBox({title, children, accent}: {title: string; children: React.ReactNode; accent?: string}) {
  return (
    <section className="border border-border bg-bg-secondary/30">
      <header className="flex items-baseline gap-2 px-4 py-2 border-b border-border bg-bg-secondary/60" style={accent ? {boxShadow: `inset 3px 0 0 ${accent}`} : undefined}>
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">┌─</span>
        <span className="font-mono text-[11px] uppercase tracking-widest" style={{color: accent ?? "var(--text-primary)"}}>
          {title}
        </span>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Line({k, v}: {k: string; v: React.ReactNode}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-text-secondary min-w-[6rem]">{k}</span>
      <span className="text-text-primary truncate">{v}</span>
    </div>
  );
}

function Kbd({children}: {children: React.ReactNode}) {
  return <kbd className="terminal-kbd">{children}</kbd>;
}

function ActionLine({children}: {children: React.ReactNode}) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="text-accent">›</span>
      <span className="text-text-primary">{children}</span>
    </li>
  );
}

function PaneButton({children, onClick, ghost}: {children: React.ReactNode; onClick: () => void; ghost?: boolean}) {
  return (
    <button
      onClick={onClick}
      className={`btn-sheen font-mono text-[12px] px-3 py-2 transition-all ${
        ghost ? "border border-border text-text-secondary hover:text-accent hover:border-accent/40" : "border border-accent/50 bg-accent/[0.06] text-accent hover:bg-accent/10"
      }`}
    >
      {children}
    </button>
  );
}

/* ================================================================== */
/*  Terminal shell styles (mirrors the treasury terminal)              */
/* ================================================================== */

function TerminalStyles() {
  return (
    <style>{`
      .terminal-shell {
        height: 100dvh;
        width: 100%;
        padding: 16px;
        background: var(--bg-primary);
        display: flex;
      }
      @media (max-width: 640px) { .terminal-shell { padding: 0; } }

      .terminal-window {
        flex: 1 1 0%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        background: var(--bg-primary);
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.02),
          0 30px 80px -20px rgba(0,0,0,0.6),
          0 0 60px -20px rgba(255,140,0,0.08);
        overflow: hidden;
      }

      .terminal-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: linear-gradient(180deg, #181818 0%, #121212 100%);
        border-bottom: 1px solid var(--border);
      }
      .traffic { display: inline-block; width: 10px; height: 10px; border-radius: 9999px; box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.4); }
      .terminal-title {
        font-family: var(--font-mono);
        font-size: 12px; letter-spacing: 0.02em; opacity: 0.9;
        text-align: center; flex: 1 1 auto; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .terminal-body { flex: 1 1 0%; min-height: 0; display: flex; flex-direction: row; }
      .terminal-sidebar {
        display: none; flex-direction: column; width: 15rem; flex-shrink: 0;
        border-right: 1px solid var(--border);
        background: linear-gradient(180deg, #0e0e0e 0%, #0a0a0a 100%);
        overflow-y: auto; overscroll-behavior: contain;
      }
      @media (min-width: 1024px) { .terminal-sidebar { display: flex; } }
      .terminal-sidebar-open {
        display: flex !important; position: absolute; inset: 49px 0 28px 0;
        z-index: 20; width: 100%; max-width: 18rem;
      }

      .terminal-pane {
        flex: 1 1 0%; min-width: 0; min-height: 0;
        display: flex; flex-direction: column; overflow: hidden;
      }
      .terminal-pane > .cmd-header { flex-shrink: 0; }
      .pane-body { flex: 1 1 0%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

      .terminal-statusbar {
        display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
        padding: 0.4rem 0.75rem; font-family: var(--font-mono); font-size: 11px;
        border-top: 1px solid var(--border);
        background: linear-gradient(180deg, #121212 0%, #0c0c0c 100%);
      }

      .terminal-kbd {
        font-family: var(--font-mono); font-size: 10px; padding: 1px 5px;
        border: 1px solid var(--border); background: var(--bg-tertiary);
        color: var(--text-secondary); border-radius: 2px; line-height: 1.2;
      }
    `}</style>
  );
}
