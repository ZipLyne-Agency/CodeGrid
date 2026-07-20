import { memo, useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import {
  checkGitSetup, setGitConfig, runGhAuthLogin, getGhInstallInstructions,
  runGhSetupGit, startGithubDeviceFlow, pollGithubToken, saveGithubToken,
  type GitSetupStatus,
} from "../lib/ipc";

type WizardStep = "status" | "identity" | "auth" | "done";
type AuthPath = "gh" | "oauth" | "pat";

const FONT = "var(--font-ui)";

function CopyBox({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ position: "relative", marginBottom: "8px" }}>
      {label && <div style={{ color: "#555555", fontSize: "10px", letterSpacing: "1px", marginBottom: "4px" }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #2a2a2a" }}>
        <div style={{
          flex: 1, background: "#0a0a0a", padding: "10px 12px",
          fontFamily: FONT, fontSize: "12px", color: "#00c853",
          userSelect: "all", wordBreak: "break-all",
        }}>
          {text}
        </div>
        <button
          onClick={copy}
          style={{
            background: copied ? "#00c85333" : "#1e1e1e", border: "none", borderLeft: "1px solid #2a2a2a",
            color: copied ? "#00c853" : "#888888", fontFamily: FONT, fontSize: "10px",
            padding: "0 10px", cursor: "pointer", flexShrink: 0, letterSpacing: "0.5px",
          }}
        >{copied ? "COPIED!" : "COPY"}</button>
      </div>
    </div>
  );
}

function CheckItem({ ok, label, detail, warn }: { ok: boolean; label: string; detail?: string; warn?: boolean }) {
  const color = ok ? "#00c853" : warn ? "#ffab00" : "#ff3d00";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 0", borderBottom: "1px solid #1a1a1a" }}>
      <span style={{
        width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}22`, color, fontSize: "12px", fontWeight: "bold", fontFamily: FONT, flexShrink: 0,
      }}>
        {ok ? "✓" : warn ? "~" : "✗"}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ color: ok ? "#e0e0e0" : warn ? "#ffab00" : "#ff8c00", fontSize: "12px", fontFamily: FONT }}>{label}</div>
        {detail && <div style={{ color: "#555555", fontSize: "10px", fontFamily: FONT, marginTop: "2px" }}>{detail}</div>}
      </div>
    </div>
  );
}

function Btn({ label, onClick, color = "#ff8c00", disabled = false, secondary = false, small = false }: {
  label: string; onClick: () => void; color?: string; disabled?: boolean; secondary?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: secondary ? "transparent" : disabled ? "#2a2a2a" : color,
        border: secondary ? `1px solid ${disabled ? "#444" : color}` : "none",
        color: secondary ? (disabled ? "#444" : color) : disabled ? "#555555" : "#0a0a0a",
        fontSize: small ? "10px" : "12px", fontFamily: FONT, fontWeight: "bold",
        letterSpacing: "0.5px", padding: small ? "6px 14px" : "10px 22px",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >{label}</button>
  );
}

export const GitSetupWizard = memo(function GitSetupWizard() {
  const { gitSetupWizardOpen, setGitSetupWizardOpen } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);

  const [step, setStep] = useState<WizardStep>("status");
  const [status, setStatus] = useState<GitSetupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identity
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // Auth path selection
  const [authPath, setAuthPath] = useState<AuthPath>("gh");
  const [ghInstructions, setGhInstructions] = useState<string>("brew install gh");

  // GH path state
  const [ghAuthRunning, setGhAuthRunning] = useState(false);

  // OAuth Device Flow state
  const [deviceFlow, setDeviceFlow] = useState<{ device_code: string; user_code: string; verification_uri: string; interval: number } | null>(null);
  const [oauthPolling, setOauthPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PAT state
  const [pat, setPat] = useState("");
  const [patSaving, setPatSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await checkGitSetup();
      setStatus(s);
      if (s.git_user_name) setName(s.git_user_name);
      if (s.git_user_email) setEmail(s.git_user_email);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (gitSetupWizardOpen) { setStep("status"); refresh(); }
  }, [gitSetupWizardOpen, refresh]);

  useEffect(() => {
    getGhInstallInstructions().then(setGhInstructions).catch(() => {});
  }, []);

  // Clean up polling on unmount or close
  useEffect(() => {
    if (!gitSetupWizardOpen && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      if (pollStopRef.current) {
        clearTimeout(pollStopRef.current);
        pollStopRef.current = null;
      }
      setOauthPolling(false);
    }
  }, [gitSetupWizardOpen]);

  const allGood = status
    ? status.git_installed
      && !!status.git_user_name
      && !!status.git_user_email
      && status.credential_helper_configured
      && status.gh_authenticated
    : false;

  const handleSaveIdentity = useCallback(async () => {
    if (!name.trim() || !email.trim()) return;
    setLoading(true); setError(null);
    try {
      await setGitConfig(name.trim(), email.trim());
      addToast("Git identity saved", "success");
      await refresh();
      if (!status?.credential_helper_configured) setStep("auth");
      else setStep("done");
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, [name, email, addToast, refresh, status]);

  const handleNext = useCallback(() => {
    if (!status) return;
    if (!status.git_installed) { setError("Install git first: xcode-select --install"); return; }
    if (!status.git_user_name || !status.git_user_email) { setStep("identity"); return; }
    if (!status.credential_helper_configured) { setStep("auth"); return; }
    setStep("done");
  }, [status]);

  // GH CLI auth
  const handleGhAuth = useCallback(async () => {
    setGhAuthRunning(true); setError(null);
    try {
      await runGhAuthLogin(); // now also runs gh auth setup-git internally
      addToast("GitHub connected!", "success");
      await refresh();
      setStep("done");
    } catch (e) { setError(String(e)); }
    setGhAuthRunning(false);
  }, [addToast, refresh]);

  // OAuth Device Flow
  const startDeviceFlow = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      const flow = await startGithubDeviceFlow();
      setDeviceFlow(flow);
      setOauthPolling(true);
      // Open verification URL in browser
      window.open(flow.verification_uri, "_blank");
      // Start polling
      const interval = Math.max(flow.interval, 5) * 1000;
      pollStopRef.current = setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setOauthPolling(false);
        setDeviceFlow(null);
        setError("OAuth device flow expired. Please start again.");
      }, Math.max(60, flow.expires_in) * 1000);
      pollRef.current = setInterval(async () => {
        try {
          const result = await pollGithubToken(flow.device_code);
          if (result.token) {
            clearInterval(pollRef.current!); pollRef.current = null;
            if (pollStopRef.current) { clearTimeout(pollStopRef.current); pollStopRef.current = null; }
            setOauthPolling(false);
            await saveGithubToken(result.token);
            addToast("GitHub connected via OAuth!", "success");
            await refresh();
            setStep("done");
          } else if (result.error) {
            clearInterval(pollRef.current!); pollRef.current = null;
            if (pollStopRef.current) { clearTimeout(pollStopRef.current); pollStopRef.current = null; }
            setOauthPolling(false);
            setError(result.error);
            setDeviceFlow(null);
          }
        } catch (e) {
          clearInterval(pollRef.current!); pollRef.current = null;
          if (pollStopRef.current) { clearTimeout(pollStopRef.current); pollStopRef.current = null; }
          setOauthPolling(false);
          setError(`Token polling failed: ${e}`);
          setDeviceFlow(null);
        }
      }, interval);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, [addToast, refresh]);

  const cancelDeviceFlow = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (pollStopRef.current) { clearTimeout(pollStopRef.current); pollStopRef.current = null; }
    setOauthPolling(false); setDeviceFlow(null); setError(null);
  }, []);

  // PAT save
  const handleSavePat = useCallback(async () => {
    if (!pat.trim()) return;
    setPatSaving(true); setError(null);
    try {
      await saveGithubToken(pat.trim());
      addToast("Token saved! GitHub push/pull enabled.", "success");
      await refresh();
      setStep("done");
    } catch (e) { setError(String(e)); }
    setPatSaving(false);
  }, [pat, addToast, refresh]);

  if (!gitSetupWizardOpen) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, fontFamily: FONT }}
      onClick={() => setGitSetupWizardOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#141414", border: "1px solid #2a2a2a", width: "560px", maxHeight: "85vh", overflow: "auto", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#ff8c00", fontSize: "13px", fontWeight: "bold", letterSpacing: "1px" }}>GITHUB SETUP</div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              {step === "status" && "Environment check"}
              {step === "identity" && "Set your Git identity"}
              {step === "auth" && "Connect to GitHub"}
              {step === "done" && "Ready to push and pull"}
            </div>
          </div>
          <button onClick={() => setGitSetupWizardOpen(false)} style={{ background: "none", border: "none", color: "#555555", fontSize: "16px", cursor: "pointer", fontFamily: FONT, padding: "4px 8px" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff3d00")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#555555")}>x</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", flex: 1 }}>
          {error && (
            <div style={{ background: "#ff3d0022", border: "1px solid #ff3d0066", padding: "10px 14px", marginBottom: "16px", color: "#ff8c00", fontSize: "11px", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
              {error}
            </div>
          )}

          {/* STATUS STEP */}
          {step === "status" && (
            <div>
              {loading && !status ? (
                <div style={{ color: "#555555", fontSize: "12px", padding: "20px 0", textAlign: "center" }}>Checking environment...</div>
              ) : status ? (
                <div>
                  <CheckItem ok={status.git_installed} label="Git installed" detail={status.git_installed ? undefined : "Run: xcode-select --install"} />
                  <CheckItem
                    ok={!!status.git_user_name && !!status.git_user_email}
                    label="Git identity"
                    detail={status.git_user_name && status.git_user_email
                      ? `${status.git_user_name} <${status.git_user_email}>`
                      : "Name and email not configured"}
                  />
                  <CheckItem
                    ok={status.credential_helper_configured}
                    label="GitHub credentials configured"
                    detail={status.credential_helper_configured
                      ? status.gh_authenticated && status.gh_username
                        ? `Connected as @${status.gh_username}`
                        : "Credential helper active"
                      : "Not configured — can't push to GitHub yet"}
                  />
                  <CheckItem ok={status.gh_installed} warn={!status.gh_installed} label="GitHub CLI (gh)" detail={status.gh_installed ? "Available" : "Optional — needed for gh auth path"} />
                  <CheckItem ok={status.ssh_key_exists} warn={!status.ssh_key_exists} label="SSH key" detail={status.ssh_key_exists ? "Found in ~/.ssh/" : "Optional — only needed for SSH remotes"} />

                  {allGood && (
                    <div style={{ marginTop: "16px", padding: "12px", background: "#00c85315", border: "1px solid #00c85344", color: "#00c853", fontSize: "12px", textAlign: "center", fontWeight: "bold" }}>
                      ✓ All set — you can push and pull from GitHub
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* IDENTITY STEP */}
          {step === "identity" && (
            <div>
              <div style={{ color: "#888888", fontSize: "11px", marginBottom: "16px", lineHeight: "1.6" }}>
                This shows up on your commits. Use the email from your GitHub account.
              </div>
              {[
                { label: "NAME", value: name, set: setName, placeholder: "Your Name", type: "text" },
                { label: "EMAIL", value: email, set: setEmail, placeholder: "you@example.com", type: "email" },
              ].map(({ label, value, set, placeholder, type }) => (
                <div key={label} style={{ marginBottom: "12px" }}>
                  <div style={{ color: "#555555", fontSize: "10px", letterSpacing: "1px", marginBottom: "4px" }}>{label}</div>
                  <input type={type} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                    style={{ width: "100%", background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#e0e0e0", fontSize: "13px", fontFamily: FONT, padding: "10px 12px", outline: "none", boxSizing: "border-box" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")} />
                </div>
              ))}
              <div style={{ color: "#444444", fontSize: "10px", marginTop: "4px" }}>
                Runs: git config --global user.name / user.email
              </div>
            </div>
          )}

          {/* AUTH STEP */}
          {step === "auth" && (
            <div>
              <div style={{ color: "#888888", fontSize: "11px", marginBottom: "16px", lineHeight: "1.6" }}>
                Choose how to authenticate with GitHub. Any of these will enable push and pull.
              </div>

              {/* Path selector */}
              <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
                {([
                  { id: "gh" as AuthPath, label: "GitHub CLI", desc: "Easiest" },
                  { id: "oauth" as AuthPath, label: "OAuth App", desc: "Your app" },
                  { id: "pat" as AuthPath, label: "Access Token", desc: "Manual" },
                ] as const).map(({ id, label, desc }) => (
                  <button
                    key={id}
                    onClick={() => { setAuthPath(id); setError(null); setDeviceFlow(null); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; setOauthPolling(false); } }}
                    style={{
                      flex: 1, padding: "8px 4px", background: authPath === id ? "#1e1e1e" : "transparent",
                      border: `1px solid ${authPath === id ? "#ff8c00" : "#2a2a2a"}`,
                      color: authPath === id ? "#ff8c00" : "#555555", cursor: "pointer", fontFamily: FONT,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: "bold" }}>{label}</span>
                    <span style={{ fontSize: "10px", color: authPath === id ? "#ff8c0088" : "#444444" }}>{desc}</span>
                  </button>
                ))}
              </div>

              {/* GH CLI path */}
              {authPath === "gh" && (
                <div>
                  {!status?.gh_installed ? (
                    <div>
                      <div style={{ color: "#ffab00", fontSize: "11px", marginBottom: "12px", fontWeight: "bold" }}>Step 1: Install GitHub CLI</div>
                      <CopyBox text={ghInstructions} label="RUN IN TERMINAL" />
                      <div style={{ color: "#555555", fontSize: "10px", marginBottom: "16px" }}>
                        After installing, click Refresh below to continue.
                      </div>
                      <div style={{ color: "#ff8c00", fontSize: "11px", marginBottom: "8px", fontWeight: "bold" }}>Or do everything at once:</div>
                      <CopyBox text={`${ghInstructions} && gh auth login && gh auth setup-git`} label="ONE-LINER (COPY → PASTE IN TERMINAL)" />
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: "#e0e0e0", fontSize: "11px", marginBottom: "12px" }}>
                        GitHub CLI is installed. Click below to open GitHub in your browser and authorize Code Grid.
                      </div>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                        <Btn
                          label={ghAuthRunning ? "CONNECTING..." : "CONNECT TO GITHUB"}
                          onClick={handleGhAuth}
                          disabled={ghAuthRunning}
                          color="#00c853"
                        />
                      </div>
                      <div style={{ color: "#444444", fontSize: "10px", marginBottom: "8px" }}>Or run manually in a terminal:</div>
                      <CopyBox text="gh auth login && gh auth setup-git" />
                      <div style={{ color: "#555555", fontSize: "10px", lineHeight: "1.5" }}>
                        Both commands are required. <code style={{ color: "#ffab00" }}>gh auth login</code> authenticates, <code style={{ color: "#ffab00" }}>gh auth setup-git</code> wires up git push.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* OAuth Device Flow path */}
              {authPath === "oauth" && (
                <div>
                  {!deviceFlow ? (
                    <div>
                      <div style={{ color: "#888888", fontSize: "11px", marginBottom: "16px", lineHeight: "1.6" }}>
                        Connect your GitHub account securely via OAuth. You'll be shown a code to enter on GitHub — no password required.
                      </div>
                      <Btn label={loading ? "STARTING..." : "CONNECT TO GITHUB"} onClick={startDeviceFlow} disabled={loading} color="#4a9eff" />
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: "#00c853", fontSize: "11px", fontWeight: "bold", marginBottom: "12px" }}>
                        {oauthPolling ? "⟳ Waiting for authorization..." : "Authorization received!"}
                      </div>
                      <div style={{ color: "#888888", fontSize: "11px", marginBottom: "12px" }}>
                        Go to <span style={{ color: "#4a9eff" }}>{deviceFlow.verification_uri}</span> and enter this code:
                      </div>
                      <div style={{
                        fontSize: "28px", fontWeight: "bold", letterSpacing: "6px", color: "#ff8c00",
                        textAlign: "center", padding: "16px", background: "#1e1e1e", border: "1px solid #ff8c0044",
                        marginBottom: "12px",
                      }}>
                        {deviceFlow.user_code}
                      </div>
                      <CopyBox text={deviceFlow.user_code} />
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        <Btn label="OPEN BROWSER" onClick={() => window.open(deviceFlow.verification_uri, "_blank")} color="#4a9eff" small />
                        <Btn label="CANCEL" onClick={cancelDeviceFlow} secondary color="#ff3d00" small />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PAT path */}
              {authPath === "pat" && (
                <div>
                  <div style={{ color: "#888888", fontSize: "11px", marginBottom: "12px", lineHeight: "1.6" }}>
                    Go to <span style={{ color: "#4a9eff" }}>github.com/settings/tokens</span> → "Generate new token (classic)".
                    Select the <strong style={{ color: "#e0e0e0" }}>repo</strong> scope. Paste the token below.
                  </div>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ color: "#555555", fontSize: "10px", letterSpacing: "1px", marginBottom: "4px" }}>PERSONAL ACCESS TOKEN</div>
                    <input
                      type="password"
                      value={pat}
                      onChange={(e) => setPat(e.target.value)}
                      placeholder="ghp_..."
                      style={{ width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a", color: "#e0e0e0", fontSize: "13px", fontFamily: FONT, padding: "10px 12px", outline: "none", boxSizing: "border-box" }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSavePat(); }}
                    />
                  </div>
                  <div style={{ color: "#444444", fontSize: "10px", marginBottom: "12px" }}>
                    Saved using your configured Git credential helper (keychain preferred)
                  </div>
                  <Btn label={patSaving ? "SAVING..." : "SAVE TOKEN"} onClick={handleSavePat} disabled={patSaving || !pat.trim()} color="#ff8c00" />
                </div>
              )}
            </div>
          )}

          {/* DONE STEP */}
          {step === "done" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: "64px", height: "64px", margin: "0 auto 16px", background: "#00c85322", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", color: "#00c853" }}>✓</div>
              <div style={{ color: "#00c853", fontSize: "16px", fontWeight: "bold", marginBottom: "8px" }}>YOU'RE ALL SET</div>
              {status?.gh_username && (
                <div style={{ color: "#888888", fontSize: "12px", marginBottom: "4px" }}>Connected as @{status.gh_username}</div>
              )}
              <div style={{ color: "#555555", fontSize: "11px", marginBottom: "20px" }}>
                {status?.git_user_name} &lt;{status?.git_user_email}&gt;
              </div>
              <div style={{ color: "#444444", fontSize: "11px", lineHeight: "1.7", textAlign: "left", background: "#1a1a1a", padding: "12px 16px", border: "1px solid #2a2a2a" }}>
                You can now push and pull from GitHub using the source control panel in the sidebar.
                If you ever need to re-authenticate, open Git Setup from Settings.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {step !== "status" && step !== "done" && (
              <Btn label="← BACK" onClick={() => { setError(null); setStep(step === "auth" ? (status?.git_user_name ? "status" : "identity") : "status"); }} secondary color="#888888" small />
            )}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {step === "status" && (
              <>
                <Btn label="REFRESH" onClick={refresh} secondary color="#888888" small />
                {allGood
                  ? <Btn label="DONE ✓" onClick={() => setStep("done")} color="#00c853" />
                  : <Btn label="FIX ISSUES →" onClick={handleNext} disabled={loading || !status} />
                }
              </>
            )}
            {step === "identity" && (
              <Btn label={loading ? "SAVING..." : "SAVE & CONTINUE"} onClick={handleSaveIdentity} disabled={loading || !name.trim() || !email.trim()} />
            )}
            {step === "auth" && (
              <Btn label="REFRESH STATUS" onClick={async () => { await refresh(); setStep("status"); }} secondary color="#4a9eff" small />
            )}
            {step === "done" && (
              <Btn label="START CODING →" onClick={() => setGitSetupWizardOpen(false)} color="#00c853" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
