"use client";

/**
 * Desktop wallet link. The CodeGrid desktop app opens this page
 * (`codegrid.app/link?state=…`); the user connects + signs a SIWE message; we
 * exchange it for an entitlement at the verifier, which stashes it under `state`
 * so the app picks it up hands-free (no deep-link, no manual switch-back). A
 * "Return to CodeGrid" button remains as a manual fallback.
 */
import {useEffect, useMemo, useState} from "react";
import {motion, AnimatePresence} from "framer-motion";
import {useAccount, useConnect, useDisconnect, useSignMessage} from "wagmi";
import {createSiweMessage} from "viem/siwe";
import {formatUnits} from "viem";
import {VERIFIER_URL, GRID_VIEM_CHAIN, TIERS} from "@/lib/vegrid";

const PRO = TIERS.find((t) => t.tier === 1) ?? TIERS[0];
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fmt = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, {maximumFractionDigits: 0}) : n.toLocaleString(undefined, {maximumFractionDigits: 2}));
function abbrev(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return fmt(n);
}
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

type Phase = "idle" | "signing" | "verifying" | "done" | "error";
interface Result {
  token: string;
  address: string;
  tier: number;
  power: string;
}

const ERR_COPY: Record<string, string> = {
  nonce_expired_or_unknown: "That session expired. Try again.",
  bad_signature: "The signature didn't match. Try again.",
  malformed_siwe: "Something went wrong building the request. Try again.",
  tier_read_failed: "Couldn't read your stake on-chain just now. Try again in a moment.",
};

export function LinkClient() {
  const {address, isConnected} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {signMessageAsync} = useSignMessage();
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [state, setState] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setState(p.get("state") ?? "");
  }, []);

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

  function returnToApp(r: Result) {
    window.location.href = `codegrid://link?token=${encodeURIComponent(r.token)}&tier=${r.tier}${
      state ? `&state=${encodeURIComponent(state)}` : ""
    }`;
  }

  async function authorize() {
    if (!address) return;
    try {
      setErr("");
      setPhase("signing");
      const {nonce} = await fetch(`${VERIFIER_URL}/nonce`).then((r) => r.json());
      const message = createSiweMessage({
        address,
        chainId: GRID_VIEM_CHAIN.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        statement: "Link your CodeGrid desktop app to this wallet to unlock Pro.",
      });
      const signature = await signMessageAsync({message});

      setPhase("verifying");
      const res = await fetch(`${VERIFIER_URL}/verify`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({message, signature, state}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "verification_failed");
      const data = (await res.json()) as Result;
      setResult(data);
      setPhase("done");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied|cancel/i.test(raw) ? "Signature cancelled." : ERR_COPY[raw] ?? "Couldn't link. Try again.");
      setPhase("error");
    }
  }

  const stepActive = !isConnected ? 0 : phase === "done" ? 2 : 1;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-grid grid-fade opacity-60" />
        <div className="absolute inset-0 accent-bloom" />
      </div>

      <motion.div
        initial={{opacity: 0, y: 16}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: 0.5, ease: EASE}}
        className="relative w-full max-w-md border border-border bg-bg-secondary/40 backdrop-blur-sm"
      >
        <div className="rule-accent absolute inset-x-0 top-0 h-px opacity-60" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-secondary">
            CodeGrid <span className="text-text-secondary/50">·</span> <span className="text-accent">desktop link</span>
          </div>
          {isConnected ? (
            <button onClick={() => disconnect()} className="font-mono text-[10px] text-text-secondary hover:text-accent">
              {short(address)} · disconnect
            </button>
          ) : null}
        </div>

        {/* Steps */}
        <div className="flex items-center gap-2 px-5 pt-4 font-mono text-[10px] uppercase tracking-widest">
          {["connect", "sign", "done"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={i <= stepActive ? "text-accent" : "text-text-secondary/50"}>
                {i + 1} {s}
              </span>
              {i < 2 ? <span className="text-text-secondary/30">→</span> : null}
            </div>
          ))}
        </div>

        <div className="px-5 pb-6 pt-3">
          <h1 className="font-display text-xl text-text-primary">Link your wallet</h1>
          <p className="mt-1.5 font-sans text-[12.5px] leading-relaxed text-text-secondary">
            Prove you control your staked wallet to unlock Pro in the desktop app. One signature — no transaction,
            no gas.
          </p>

          <div className="mt-5">
            <AnimatePresence mode="wait">
              {/* CONNECT */}
              {!isConnected ? (
                <motion.div key="connect" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="flex flex-col gap-2">
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
                          <span className="flex h-5 w-5 items-center justify-center border border-accent/40 text-[11px] text-accent">{c.name.charAt(0)}</span>
                        )}
                        <span className="text-text-primary group-hover:text-accent">{c.name}</span>
                      </span>
                      <span className="text-text-secondary/50 group-hover:text-accent">→</span>
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
                          <span className="flex h-6 w-6 items-center justify-center border border-border text-accent">▦</span>
                          <span className="flex flex-col text-left">
                            <span className="text-text-primary group-hover:text-accent">All wallets</span>
                            <span className="font-mono text-[9.5px] text-text-secondary">Uniswap · Rainbow · Trust · phone</span>
                          </span>
                        </span>
                        <span className="text-text-secondary/50 group-hover:text-accent">→</span>
                      </button>
                    </>
                  ) : null}
                </motion.div>
              ) : phase === "done" && result ? (
                /* DONE — show the real result */
                <motion.div key="done" initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}>
                  {result.tier >= 1 ? (
                    <div className="border border-status-running/50 bg-status-running/[0.07] p-4 text-center">
                      <div className="font-display text-2xl text-status-running">✓ Linked as Pro</div>
                      <div className="mt-1 font-mono text-[11px] text-text-secondary">
                        {abbrev(Number(formatUnits(BigInt(result.power), 18)))} power · AI review + analytics are unlocking in the app.
                      </div>
                    </div>
                  ) : (
                    <div className="border border-status-waiting/40 bg-status-waiting/[0.06] p-4 text-center">
                      <div className="font-display text-xl text-text-primary">Wallet linked ✓</div>
                      <div className="mt-1 font-mono text-[11px] text-text-secondary leading-relaxed">
                        …but this wallet is <b className="text-text-primary">Free</b> — power{" "}
                        {abbrev(Number(formatUnits(BigInt(result.power), 18)))}, below Pro&apos;s {abbrev(PRO.threshold)}.
                        Pro stays locked until you stake more.
                      </div>
                      <a
                        href="/token/stake"
                        className="btn-sheen mt-3 inline-block border border-accent/50 bg-accent/[0.06] px-4 py-2 font-mono text-[12px] text-accent hover:bg-accent/10"
                      >
                        Stake $GRID →
                      </a>
                    </div>
                  )}
                  <div className="mt-4 text-center">
                    <p className="font-mono text-[11px] text-text-secondary">
                      The app unlocks automatically — you can close this tab.
                    </p>
                    <button
                      onClick={() => returnToApp(result)}
                      className="mt-2 font-mono text-[11px] text-text-secondary underline-offset-2 hover:text-accent hover:underline"
                    >
                      Didn&apos;t reopen? Return to CodeGrid →
                    </button>
                  </div>
                </motion.div>
              ) : phase === "error" ? (
                <motion.div key="error" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} className="text-center">
                  <p className="mb-3 font-mono text-[12px] text-status-error">{err}</p>
                  <button onClick={() => setPhase("idle")} className="border border-border px-4 py-2 font-mono text-[12px] text-text-secondary hover:border-accent/40 hover:text-text-primary">
                    Try again
                  </button>
                </motion.div>
              ) : (
                /* CONNECTED — ready to sign */
                <motion.div key="sign" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}>
                  <button
                    onClick={authorize}
                    disabled={phase === "signing" || phase === "verifying"}
                    className="btn-sheen flex w-full items-center justify-center gap-2 border border-accent bg-accent/10 py-3 font-mono text-[13px] text-accent transition-all hover:bg-accent/15 disabled:opacity-50"
                  >
                    {phase === "signing" ? "Check your wallet…" : phase === "verifying" ? "Verifying on-chain…" : "Sign to link →"}
                  </button>
                  <p className="mt-2 text-center font-mono text-[10px] text-text-secondary">
                    Signed in as {short(address)} · message only, never a transaction
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
