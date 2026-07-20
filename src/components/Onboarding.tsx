import React, { memo, useCallback, useEffect, useState } from "react";
import { checkAgentClis, setupAgentBus, clipboardWrite, voiceSetApiKey, voiceKeyStatus, type AgentClis } from "../lib/ipc";
import { UI_ICON } from "../lib/icons";

const MONO = "var(--font-ui)";
const ACCENT = "#ff8c00";

/** What the user chose on the final step. */
export type OnboardingAction = "none" | "project" | "tour";

interface OnboardingProps {
  /** Called when the user finishes or skips. App persists the "onboarded" flag. */
  onClose: (action: OnboardingAction) => void;
}

/** Agent CLIs that have both an install step and a sign-in step. */
type AgentKey = "claude" | "codex" | "gemini" | "cursor" | "grok";

const AGENTS: {
  key: AgentKey;
  label: string;
  install: string;
  login: string;
  requires: string;
}[] = [
  {
    key: "claude",
    label: "Claude Code",
    install: "npm i -g @anthropic-ai/claude-code",
    login: "claude  →  sign in (or claude auth login)",
    requires: "Claude Pro/Max/Team/Enterprise, or an Anthropic API key",
  },
  {
    key: "codex",
    label: "OpenAI Codex",
    install: "npm i -g @openai/codex",
    login: "codex login  (--device-auth if no browser)",
    requires: "ChatGPT Plus/Pro/Team/Edu/Enterprise, or OPENAI_API_KEY",
  },
  {
    key: "gemini",
    label: "Gemini CLI",
    install: "npm i -g @google/gemini-cli",
    login: "gemini  →  Login with Google",
    requires: "Google account (free), or GEMINI_API_KEY from AI Studio",
  },
  {
    key: "cursor",
    label: "Cursor CLI",
    install: "curl https://cursor.com/install -fsS | bash",
    login: "cursor-agent login",
    requires: "Cursor account, or CURSOR_API_KEY",
  },
  {
    key: "grok",
    label: "Grok Build",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
    login: "grok  →  sign in (or export XAI_API_KEY)",
    requires: "SuperGrok / X Premium Plus, or XAI_API_KEY",
  },
];

/** Miniature canvas mock for the mental-model step — pure divs, no assets. */
function CanvasDiagram() {
  const pane = (label: string, color: string, x: number, y: number, w: number, h: number) => (
    <div
      key={label}
      style={{
        position: "absolute", left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`,
        background: "#0d0d0d", border: `1px solid ${color}`, borderRadius: 5,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 8, fontWeight: 700, color, padding: "3px 6px", borderBottom: "1px solid #222", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ flex: 1, padding: "4px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
        {[0.9, 0.65, 0.8].map((wf, i) => (
          <div key={i} style={{ height: 3, width: `${wf * 100}%`, background: "#262626", borderRadius: 2 }} />
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ marginTop: 16 }}>
      {/* Workspace pills */}
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT, background: "rgba(255,140,0,0.14)", border: "1px solid rgba(255,140,0,0.5)", borderRadius: 5, padding: "2px 8px" }}>my-app</span>
        <span style={{ fontSize: 9, color: "#888", border: "1px solid transparent", padding: "2px 8px" }}>api-server</span>
        <span style={{ fontSize: 9, color: "#666", padding: "2px 4px" }}>+</span>
        <span style={{ marginLeft: "auto", fontSize: 8.5, color: "#666", alignSelf: "center" }}>← workspaces, one canvas per project</span>
      </div>
      {/* Canvas with panes */}
      <div style={{ position: "relative", height: 130, background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 7, overflow: "hidden" }}>
        {pane("CLAUDE · pane 1", ACCENT, 3, 6, 38, 56)}
        {pane("CODEX · pane 2", "#00e5ff", 44, 6, 38, 56)}
        {pane("NOTE", "#ffab00", 25, 68, 38, 27)}
        <span style={{ position: "absolute", right: 8, bottom: 6, fontSize: 8.5, color: "#666" }}>drag · resize · zoom</span>
      </div>
    </div>
  );
}

export const Onboarding = memo(function Onboarding({ onClose }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [clis, setClis] = useState<AgentClis | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busState, setBusState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [busMsg, setBusMsg] = useState("");
  // Max (voice) key capture — optional, skippable.
  const [maxKey, setMaxKey] = useState("");
  const [maxKeySet, setMaxKeySet] = useState(false);
  const [maxState, setMaxState] = useState<"idle" | "saving" | "error">("idle");

  const TOTAL = 6;

  const runCheck = useCallback(() => {
    setChecking(true);
    checkAgentClis()
      .then(setClis)
      .catch(() => setClis(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (step === 1 && !clis && !checking) runCheck();
    if (step === 3) voiceKeyStatus().then(setMaxKeySet).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const copy = (text: string) => {
    clipboardWrite(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
  };

  const enableBus = async () => {
    setBusState("running");
    try {
      const out = await setupAgentBus();
      setBusMsg(out.trim());
      setBusState("done");
    } catch (e) {
      setBusMsg(String(e));
      setBusState("error");
    }
  };

  const next = () => setStep((s) => Math.min(TOTAL - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const btn = (primary: boolean): React.CSSProperties => ({
    background: primary ? ACCENT : "transparent",
    color: primary ? "#0a0a0a" : "#888",
    border: `1px solid ${primary ? ACCENT : "#2a2a2a"}`,
    padding: "8px 18px",
    fontFamily: MONO,
    fontSize: "12px",
    fontWeight: primary ? "bold" : "normal",
    letterSpacing: "0.5px",
    cursor: "pointer",
    borderRadius: 6,
  });

  const anyAgent = clis ? AGENTS.some((a) => clis[a.key].installed) : false;
  const anyReady = clis ? AGENTS.some((a) => clis[a.key].installed && clis[a.key].logged_in) : false;

  const STEP_TITLES = ["Welcome", "Agents", "Collaboration", "Max", "Power tools", "Ready"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(3px)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to CodeGrid"
        style={{
          position: "relative",
          width: "620px",
          maxWidth: "92vw",
          maxHeight: "88vh",
          background: "#121212",
          border: `1px solid ${ACCENT}`,
          borderRadius: 10,
          fontFamily: MONO,
          color: "#e0e0e0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
      >
        {/* Progress: labelled segments instead of anonymous dots. */}
        <div style={{ display: "flex", gap: "6px", padding: "14px 20px 10px", borderBottom: "1px solid #2a2a2a" }}>
          {STEP_TITLES.map((t, i) => (
            <div key={t} style={{ flex: 1 }}>
              <div style={{ height: "3px", background: i <= step ? ACCENT : "#2a2a2a", transition: "background 0.2s", borderRadius: 2 }} />
              <div style={{ fontSize: 8.5, marginTop: 4, letterSpacing: "0.08em", textTransform: "uppercase", color: i === step ? ACCENT : "#555", fontWeight: i === step ? 700 : 400 }}>
                {t}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "24px 28px 8px", overflow: "auto", flex: 1 }}>
          {/* Step 0 — Welcome + the mental model */}
          {step === 0 && (
            <div>
              <div style={{ fontSize: "22px", fontWeight: "bold", color: "#fff", marginBottom: "10px" }}>
                Welcome to <span style={{ color: ACCENT }}>CodeGrid</span>
              </div>
              <p style={{ fontSize: "13px", lineHeight: 1.7, color: "#aaa", margin: 0 }}>
                Run an army of coding agents — Claude, Codex, Gemini, Cursor, Grok — side by side
                and watch them work. Three ideas are all you need:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12, fontSize: 12, lineHeight: 1.55, color: "#bbb" }}>
                <div><b style={{ color: ACCENT }}>Workspace</b> — one canvas per project. Switch with the pills in the top bar.</div>
                <div><b style={{ color: "#00e5ff" }}>Pane</b> — a live agent terminal (or a shell, browser preview, or note) you drag and resize freely.</div>
                <div><b style={{ color: "#00c853" }}>You</b> — the orchestrator. Hand out tasks, peek at progress, let agents hand work to each other.</div>
              </div>
              <CanvasDiagram />
            </div>
          )}

          {/* Step 1 — Agents (status + copy + re-check) */}
          {step === 1 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff" }}>Your coding agents</div>
                <button
                  onClick={runCheck}
                  disabled={checking}
                  style={{ ...btn(false), padding: "4px 12px", fontSize: 11, opacity: checking ? 0.6 : 1 }}
                >
                  {checking ? "Checking…" : "↻ Re-check"}
                </button>
              </div>
              <p style={{ fontSize: "12px", color: "#888", marginBottom: "14px", lineHeight: 1.6 }}>
                Each agent needs to be <b style={{ color: "#ddd" }}>installed</b> and <b style={{ color: "#ddd" }}>signed in</b>.
                Copy a command, run it in any terminal, then hit Re-check. One ready agent is enough to start —
                you can add the rest anytime.
              </p>
              {!clis && <div style={{ color: "#888", fontSize: "12px" }}>Checking…</div>}
              {clis && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {AGENTS.map((a) => {
                    const s = clis[a.key];
                    const ready = s.installed && s.logged_in;
                    const dot = ready ? "✓" : s.installed ? "◐" : "○";
                    const dotColor = ready ? "#00c853" : s.installed ? "#ffab00" : "#555";
                    const cmd = s.installed ? a.login : a.install;
                    return (
                      <div key={a.key} style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ color: dotColor, fontWeight: "bold", width: "14px" }}>{dot}</span>
                          <span style={{ width: "120px", fontSize: "12px", color: s.installed ? "#e0e0e0" : "#777" }}>{a.label}</span>
                          {ready ? (
                            <span style={{ fontSize: "11px", color: "#00c853" }}>ready</span>
                          ) : s.installed ? (
                            <span style={{ fontSize: "11px", color: "#ffab00" }}>installed · not signed in</span>
                          ) : (
                            <span style={{ fontSize: "11px", color: "#888" }}>not installed</span>
                          )}
                        </div>
                        {!ready && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: "24px" }}>
                            <span style={{ fontSize: "10px", color: "#666", minWidth: "44px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {s.installed ? "sign in" : "install"}
                            </span>
                            <code style={{ flex: 1, fontSize: "10px", color: "#9bbcff", fontFamily: MONO, wordBreak: "break-all" }}>{cmd}</code>
                            <button
                              onClick={() => copy(cmd)}
                              title="Copy command"
                              style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4, color: copied === cmd ? "#00c853" : "#888", fontSize: 9.5, padding: "2px 7px", cursor: "pointer", fontFamily: MONO, flexShrink: 0 }}
                            >
                              {copied === cmd ? "copied" : "copy"}
                            </button>
                          </div>
                        )}
                        {!ready && (
                          <div style={{ paddingLeft: "24px", fontSize: "10px", color: "#555" }}>
                            needs: {a.requires}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!clis.node && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      <UI_ICON.warning size={13} weight="fill" style={{ flexShrink: 0 }} /> Node.js not found — needed for agent collaboration. Install from nodejs.org.
                    </div>
                  )}
                  {!anyAgent && (
                    <div style={{ fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      Install at least one agent above — copy the command into any terminal, then Re-check.
                    </div>
                  )}
                  {anyAgent && !anyReady && (
                    <div style={{ fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      Almost there — run the sign-in command in a terminal, then Re-check.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Collaboration */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "6px" }}>Let your agents collaborate</div>
              <p style={{ fontSize: "12px", color: "#888", lineHeight: 1.7, marginBottom: "14px" }}>
                The <b style={{ color: "#ddd" }}>Agent Bus</b> lets one agent message and read another's pane — Claude can hand a task
                to Codex, read its reply, and keep going, all scoped to the workspace they share. One click configures it
                for every agent you have.
              </p>
              {busState === "idle" && (
                <button onClick={enableBus} style={btn(true)}>Enable collaboration</button>
              )}
              {busState === "running" && <div style={{ fontSize: "12px", color: ACCENT }}>Configuring your agents…</div>}
              {busState === "done" && (
                <div>
                  <div style={{ fontSize: "12px", color: "#00c853", fontWeight: "bold", marginBottom: "8px" }}>✓ Collaboration enabled</div>
                  <pre style={{ fontSize: "10px", color: "#888", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "10px", whiteSpace: "pre-wrap", maxHeight: "120px", overflow: "auto", margin: 0, borderRadius: 6 }}>{busMsg}</pre>
                  <p style={{ fontSize: "11px", color: "#777", marginTop: "10px", lineHeight: 1.6 }}>
                    Try it later — tell one agent: <i style={{ color: "#aaa" }}>"Use codegrid-agent-bus to ask the Codex pane to review this, then read its reply."</i>
                  </p>
                </div>
              )}
              {busState === "error" && (
                <div>
                  <div style={{ fontSize: "12px", color: "#ff3d00", marginBottom: "6px" }}>Couldn't auto-configure:</div>
                  <pre style={{ fontSize: "10px", color: "#aaa", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "10px", whiteSpace: "pre-wrap", margin: 0, borderRadius: 6 }}>{busMsg}</pre>
                  <p style={{ fontSize: "11px", color: "#777", marginTop: "8px" }}>You can do this later — see the codegrid-agent-bus skill. Feel free to continue.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Max (voice control, BYOK, optional) */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "6px" }}>
                Meet <span style={{ color: ACCENT }}>Max</span> — talk to your canvas
              </div>
              <p style={{ fontSize: "12px", color: "#888", lineHeight: 1.7, marginBottom: "12px" }}>
                The glowing mic in the top bar is Max, your voice operator. Click it and just say what you want:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12, lineHeight: 1.6, color: "#bbb", marginBottom: 14 }}>
                <div>🗣️ <i style={{ color: "#ddd" }}>"Spin up a Codex agent and have it fix the failing login test"</i></div>
                <div>📋 <i style={{ color: "#ddd" }}>"What's Claude working on?"</i> — Max reads the pane and answers aloud.</div>
                <div>🤝 <i style={{ color: "#ddd" }}>"Get three agents collaborating on this refactor"</i></div>
              </div>
              <p style={{ fontSize: "11.5px", color: "#888", lineHeight: 1.6, marginBottom: 12 }}>
                Max uses OpenAI&apos;s Realtime API with <b style={{ color: "#ddd" }}>your own key</b> (≈$0.10/min of
                conversation, billed to your OpenAI account; stored in the macOS Keychain). Paste it now, or skip —
                the mic button will walk you through it later.
              </p>
              {maxKeySet ? (
                <div style={{ fontSize: 12, color: "#00c853", fontWeight: "bold" }}>✓ Key saved — click the mic anytime and start talking</div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    value={maxKey}
                    onChange={(e) => setMaxKey(e.target.value)}
                    placeholder="Paste your OpenAI API key (sk-…) — optional"
                    aria-label="OpenAI API key for voice"
                    style={{
                      flex: 1, boxSizing: "border-box", background: "#0a0a0a", border: "1px solid #2a2a2a",
                      color: "#e0e0e0", fontSize: 12, fontFamily: "var(--font-mono)", padding: "8px 10px",
                      outline: "none", borderRadius: 6,
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = ACCENT)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                  <button
                    onClick={async () => {
                      if (!maxKey.trim()) return;
                      setMaxState("saving");
                      try {
                        await voiceSetApiKey(maxKey.trim());
                        setMaxKeySet(true);
                        setMaxKey("");
                        setMaxState("idle");
                      } catch {
                        setMaxState("error");
                      }
                    }}
                    disabled={!maxKey.trim() || maxState === "saving"}
                    style={{ ...btn(!!maxKey.trim()), padding: "8px 14px" }}
                  >
                    {maxState === "saving" ? "Saving…" : "Save key"}
                  </button>
                </div>
              )}
              {maxState === "error" && (
                <div style={{ fontSize: 11, color: "#ff3d00", marginTop: 8 }}>Couldn&apos;t save to the Keychain — you can retry from Settings → Voice.</div>
              )}
            </div>
          )}

          {/* Step 4 — Power tools */}
          {step === 4 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "12px" }}>The power tools</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "11px", fontSize: 12, color: "#bbb", lineHeight: 1.55 }}>
                <Tool k="⌘K" name="Command palette" v="Jump to any pane, workspace, or action from one box." />
                <Tool k="⌘N" name="New pane" v="Agents, throwaway shells, live localhost previews, and markdown notes — all live on the canvas." />
                <Tool k="⌘B" name="Broadcast" v="Type once, send to every agent in the workspace at the same time." />
                <Tool k="⌘G" name="Git manager" v="Stage, commit, branch, and review your agents' diffs without leaving the canvas." />
                <Tool k="🎙" name="Max" v="Your voice operator — spawn agents, send tasks, hear summaries, hands-free." />
              </div>
              <p style={{ fontSize: "11px", color: "#666", marginTop: "16px" }}>
                No need to memorize anything — the tour at the end points at each of these in the real UI.
              </p>
            </div>
          )}

          {/* Step 5 — Ready */}
          {step === 5 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "10px" }}>You're all set 🎉</div>
              <p style={{ fontSize: "12.5px", color: "#aaa", lineHeight: 1.7, marginBottom: "6px" }}>
                Two ways to start:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: "#bbb", lineHeight: 1.6 }}>
                <div><b style={{ color: ACCENT }}>Take the 60-second tour</b> — we'll point at every control in the real UI, then open your first project for you.</div>
                <div><b style={{ color: "#ddd" }}>Or jump straight in</b> — open a project folder and your first agent spins up in a pane.</div>
              </div>
              <p style={{ fontSize: "11px", color: "#666", marginTop: "16px" }}>
                Reopen this anytime from <b style={{ color: "#999" }}>Help → Getting Started</b>.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderTop: "1px solid #2a2a2a" }}>
          <button onClick={() => onClose("none")} style={{ ...btn(false), border: "none", color: "#666" }}>Skip setup</button>
          <div style={{ display: "flex", gap: "8px" }}>
            {step > 0 && <button onClick={back} style={btn(false)}>Back</button>}
            {step < TOTAL - 1 ? (
              <button onClick={next} style={btn(true)}>Continue</button>
            ) : (
              <>
                <button onClick={() => onClose("project")} style={btn(false)}>Open a project</button>
                <button onClick={() => onClose("tour")} style={btn(true)}>Start the tour →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function Tool({ k, name, v }: { k: string; name: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
      <span style={{ color: ACCENT, fontWeight: "bold", minWidth: "30px", fontSize: "11px", fontFamily: "var(--font-mono)" }}>{k}</span>
      <span style={{ minWidth: 120, color: "#e0e0e0", fontWeight: 600 }}>{name}</span>
      <span style={{ flex: 1 }}>{v}</span>
    </div>
  );
}
