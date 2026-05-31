import { memo, useEffect, useState } from "react";
import { checkAgentClis, setupAgentBus, type AgentClis } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspaceStore";

const MONO = "var(--font-ui)";
const ACCENT = "#ff8c00";

interface OnboardingProps {
  /** Called when the user finishes or skips. App persists the "onboarded" flag. */
  onClose: (openNewSession: boolean) => void;
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
    login: "Run: claude  →  sign in (or claude auth login)",
    requires: "Claude Pro/Max/Team/Enterprise, or an Anthropic API key",
  },
  {
    key: "codex",
    label: "OpenAI Codex",
    install: "npm i -g @openai/codex",
    login: "Run: codex login  (--device-auth if no browser)",
    requires: "ChatGPT Plus/Pro/Team/Edu/Enterprise, or OPENAI_API_KEY",
  },
  {
    key: "gemini",
    label: "Gemini CLI",
    install: "npm i -g @google/gemini-cli",
    login: "Run: gemini  →  Login with Google",
    requires: "Google account (free), or GEMINI_API_KEY from AI Studio",
  },
  {
    key: "cursor",
    label: "Cursor CLI",
    install: "curl https://cursor.com/install -fsS | bash",
    login: "Run: cursor-agent login",
    requires: "Cursor account, or CURSOR_API_KEY",
  },
  {
    key: "grok",
    label: "Grok Build",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
    login: "Run: grok  →  sign in (or export XAI_API_KEY)",
    requires: "SuperGrok / X Premium Plus, or XAI_API_KEY",
  },
];

export const Onboarding = memo(function Onboarding({ onClose }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [clis, setClis] = useState<AgentClis | null>(null);
  const [busState, setBusState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [busMsg, setBusMsg] = useState("");

  const TOTAL = 4;

  useEffect(() => {
    if (step === 1 && !clis) {
      checkAgentClis().then(setClis).catch(() => setClis(null));
    }
  }, [step, clis]);

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
  });

  const anyAgent = clis ? AGENTS.some((a) => clis[a.key].installed) : false;
  const anyReady = clis ? AGENTS.some((a) => clis[a.key].installed && clis[a.key].logged_in) : false;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(3px)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to CodeGrid"
        style={{
          position: "relative",
          width: "600px",
          maxWidth: "92vw",
          maxHeight: "88vh",
          background: "#121212",
          border: `1px solid ${ACCENT}`,
          fontFamily: MONO,
          color: "#e0e0e0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* Progress dots */}
        <div style={{ display: "flex", gap: "6px", padding: "14px 20px", borderBottom: "1px solid #2a2a2a" }}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: "3px", background: i <= step ? ACCENT : "#2a2a2a", transition: "background 0.2s" }} />
          ))}
        </div>

        <div style={{ padding: "28px 28px 8px", overflow: "auto", flex: 1 }}>
          {/* Step 0 — Welcome */}
          {step === 0 && (
            <div>
              <div style={{ fontSize: "22px", fontWeight: "bold", color: "#fff", marginBottom: "10px" }}>
                Welcome to <span style={{ color: ACCENT }}>CodeGrid</span>
              </div>
              <p style={{ fontSize: "13px", lineHeight: 1.7, color: "#aaa" }}>
                Run an army of coding agents — Claude, Codex, Gemini, Cursor, Grok — side by side on one canvas.
                Drag, resize, broadcast, and have your agents <b style={{ color: "#ddd" }}>talk to each other</b> to get work done together.
              </p>
              <p style={{ fontSize: "12px", lineHeight: 1.7, color: "#777", marginTop: "12px" }}>
                This quick setup takes about 30 seconds. You can skip it anytime.
              </p>
            </div>
          )}

          {/* Step 1 — Tools */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "6px" }}>Your coding agents</div>
              <p style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
                Each agent needs to be <b style={{ color: "#ddd" }}>installed</b> and <b style={{ color: "#ddd" }}>signed in</b> before you can spin up its terminal. Here's where each one stands:
              </p>
              {!clis && <div style={{ color: "#888", fontSize: "12px" }}>Checking…</div>}
              {clis && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {AGENTS.map((a) => {
                    const s = clis[a.key];
                    const ready = s.installed && s.logged_in;
                    // Pick the next action the user needs to take.
                    const dot = ready ? "✓" : s.installed ? "◐" : "○";
                    const dotColor = ready ? "#00c853" : s.installed ? "#ffab00" : "#555";
                    return (
                      <div key={a.key} style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", background: "#0a0a0a", border: "1px solid #2a2a2a" }}>
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
                          <div style={{ display: "flex", gap: "8px", paddingLeft: "24px" }}>
                            <span style={{ fontSize: "10px", color: "#666", minWidth: "44px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {s.installed ? "sign in" : "install"}
                            </span>
                            <code style={{ fontSize: "10px", color: "#9bbcff", fontFamily: MONO, wordBreak: "break-all" }}>
                              {s.installed ? a.login : a.install}
                            </code>
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
                    <div style={{ fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      ⚠ Node.js not found — needed for agent collaboration. Install from nodejs.org.
                    </div>
                  )}
                  {!anyAgent && (
                    <div style={{ fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      Install at least one agent above, then reopen this from Help → Getting Started.
                    </div>
                  )}
                  {anyAgent && !anyReady && (
                    <div style={{ fontSize: "11px", color: "#ffab00", marginTop: "4px" }}>
                      You've installed an agent but aren't signed in yet — run its sign-in command in a shell pane, then reopen this from Help → Getting Started.
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
                The <b style={{ color: "#ddd" }}>Agent Bus</b> lets one agent message and read another's pane — so Claude can hand a task to Codex,
                read its reply, and keep going. One click sets it up for every agent you have.
              </p>
              {busState === "idle" && (
                <button onClick={enableBus} style={btn(true)}>Enable collaboration</button>
              )}
              {busState === "running" && <div style={{ fontSize: "12px", color: ACCENT }}>Configuring your agents…</div>}
              {busState === "done" && (
                <div>
                  <div style={{ fontSize: "12px", color: "#00c853", fontWeight: "bold", marginBottom: "8px" }}>✓ Collaboration enabled</div>
                  <pre style={{ fontSize: "10px", color: "#888", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "10px", whiteSpace: "pre-wrap", maxHeight: "140px", overflow: "auto", margin: 0 }}>{busMsg}</pre>
                </div>
              )}
              {busState === "error" && (
                <div>
                  <div style={{ fontSize: "12px", color: "#ff3d00", marginBottom: "6px" }}>Couldn't auto-configure:</div>
                  <pre style={{ fontSize: "10px", color: "#aaa", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "10px", whiteSpace: "pre-wrap", margin: 0 }}>{busMsg}</pre>
                  <p style={{ fontSize: "11px", color: "#777", marginTop: "8px" }}>You can do this later — see the codegrid-agent-bus skill. Feel free to continue.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Done */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: "#fff", marginBottom: "10px" }}>You're all set 🎉</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "#bbb", lineHeight: 1.6 }}>
                <Tip k="⌘N" v="New agent — pick Claude, Codex, Gemini, Cursor, Grok, or a shell" />
                <Tip k="AUTO" v="Tile every pane side by side (top-right of the canvas). FIT zooms to show them all." />
                <Tip k="⌘K" v="Command palette — jump to anything" />
                <Tip k="Ask" v={`In one agent: "Use codegrid-agent-bus to ask the Codex pane to … then read its reply."`} />
              </div>
              <p style={{ fontSize: "11px", color: "#777", marginTop: "16px" }}>
                Tip: open a project to spin up your first agent.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderTop: "1px solid #2a2a2a" }}>
          <button onClick={() => onClose(false)} style={{ ...btn(false), border: "none", color: "#666" }}>Skip setup</button>
          <div style={{ display: "flex", gap: "8px" }}>
            {step > 0 && <button onClick={back} style={btn(false)}>Back</button>}
            {step < TOTAL - 1 ? (
              <button onClick={next} style={btn(true)}>Continue</button>
            ) : (
              <>
                <button onClick={() => onClose(false)} style={btn(false)}>Done</button>
                <button onClick={() => onClose(true)} style={btn(true)}>Open a project →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function Tip({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
      <span style={{ color: ACCENT, fontWeight: "bold", minWidth: "44px", fontSize: "11px" }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
