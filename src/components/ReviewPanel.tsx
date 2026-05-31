import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { useSessionStore } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";
import { Gated } from "./Gated";
import { runReview, sendToSession, type ReviewResponse, type ReviewItem, type ReviewFinding, type ReviewSeverity } from "../lib/ipc";

const MONO_FONT = "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace";

const SEVERITY: Record<ReviewSeverity, { label: string; color: string }> = {
  critical: { label: "CRIT", color: "var(--status-error)" },
  high: { label: "HIGH", color: "var(--text-accent)" },
  medium: { label: "MED", color: "var(--status-waiting)" },
  low: { label: "LOW", color: "var(--status-idle)" },
  nit: { label: "NIT", color: "var(--text-muted)" },
};

const SEVERITY_RANK: ReviewSeverity[] = ["critical", "high", "medium", "low", "nit"];

type Status = "idle" | "running" | "done" | "error";

/**
 * Pro code review overlay. Runs an AI review ("CodeGrid Review") on the active
 * diff via the grid-review Worker and shows a structured, per-dimension report.
 * The report can be sent straight to the focused agent session to fix.
 */
export function ReviewPanel() {
  const reviewPanelOpen = useAppStore((s) => s.reviewPanelOpen);
  const reviewDir = useAppStore((s) => s.reviewDir);
  const setReviewPanelOpen = useAppStore((s) => s.setReviewPanelOpen);
  const addToast = useToastStore((s) => s.addToast);

  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const runId = useRef(0);

  const close = useCallback(() => setReviewPanelOpen(false), [setReviewPanelOpen]);

  const run = useCallback(async () => {
    if (!reviewDir) {
      setStatus("error");
      setErrorMsg("No workspace selected to review.");
      return;
    }
    const id = ++runId.current;
    setStatus("running");
    setData(null);
    setErrorMsg(null);
    try {
      const res = await runReview(reviewDir);
      if (id !== runId.current) return; // superseded by a newer run / close
      setData(res);
      setStatus("done");
    } catch (e) {
      if (id !== runId.current) return;
      setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "Review failed.");
      setStatus("error");
    }
  }, [reviewDir]);

  // Auto-run once each time the panel opens for a dir.
  useEffect(() => {
    if (reviewPanelOpen) run();
    else {
      runId.current++; // cancel any in-flight result
      setStatus("idle");
      setData(null);
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPanelOpen, reviewDir]);

  // Esc to close.
  useEffect(() => {
    if (!reviewPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewPanelOpen, close]);

  const totalFindings = data?.reviews.reduce((n, r) => n + r.findings.length, 0) ?? 0;

  const sendToAgent = useCallback(() => {
    if (!data) return;
    const focusedId = useSessionStore.getState().focusedSessionId;
    if (!focusedId) {
      addToast("Open a terminal session to send the review to.", "error");
      return;
    }
    const text = formatForAgent(data);
    sendToSession(focusedId, text)
      .then(() => {
        addToast("Review sent to the focused agent.", "success");
        close();
      })
      .catch(() => addToast("Could not send to the session.", "error"));
  }, [data, addToast, close]);

  if (!reviewPanelOpen) return null;

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 92vw)", maxHeight: "86vh",
          display: "flex", flexDirection: "column",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-default)", borderRadius: 12,
          boxShadow: "0 18px 50px rgba(0,0,0,0.5)", overflow: "hidden",
          fontFamily: "var(--font-ui)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border-default)",
          background: "rgba(10,10,10,0.5)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--text-accent)", fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>
              ★ CodeGrid Review
            </span>
            {data?.model && (
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>· {data.model}</span>
            )}
            {data?.usage && (
              <span
                style={{ color: data.usage.remaining <= 3 ? "var(--status-waiting)" : "var(--text-muted)", fontSize: 11 }}
                title="AI reviews remaining this month (resets on the 1st)"
              >
                · {data.usage.remaining}/{data.usage.limit} left
              </span>
            )}
            {reviewDir && (
              <span style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: MONO_FONT }}>
                {reviewDir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
              </span>
            )}
          </div>
          <button
            onClick={close} title="Close (Esc)" aria-label="Close review"
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 4px" }}
          >×</button>
        </div>

        <Gated tier={1}>
          <div style={{ overflowY: "auto", padding: "14px 16px", flex: 1, minHeight: 0 }}>
            {status === "running" && (
              <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "28px 4px", textAlign: "center" }}>
                Reviewing your changes for security, correctness, and UX…
                <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
                  This runs three reviewers in parallel and may take a few seconds.
                </div>
              </div>
            )}

            {status === "error" && (
              <div style={{ padding: "20px 4px" }}>
                <div style={{ color: "var(--status-error)", fontSize: 13, marginBottom: 12 }}>{errorMsg}</div>
                <ActionButton label="Try again" onClick={run} />
              </div>
            )}

            {status === "done" && data && (
              <>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 12, gap: 12, flexWrap: "wrap",
                }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    {totalFindings === 0
                      ? "No issues found across all reviewers."
                      : `${totalFindings} finding${totalFindings === 1 ? "" : "s"} across ${data.reviews.length} reviewers.`}
                    {data.truncated && (
                      <span style={{ color: "var(--status-waiting)", marginLeft: 8 }}>
                        (large diff — reviewed the first part)
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <ActionButton label="Re-run" onClick={run} subtle />
                    {totalFindings > 0 && <ActionButton label="Send to agent →" onClick={sendToAgent} />}
                  </div>
                </div>

                {data.reviews.map((r) => (
                  <DimensionBlock key={r.dimension} item={r} />
                ))}
              </>
            )}

            <div style={{
              marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-default)",
              fontSize: 10, color: "var(--text-faint)", lineHeight: 1.5,
            }}>
              Reviews send the selected diff to CodeGrid's review service for analysis. Nothing else leaves your machine.
            </div>
          </div>
        </Gated>
      </div>
    </div>
  );
}

function DimensionBlock({ item }: { item: ReviewItem }) {
  const sorted = [...item.findings].sort(
    (a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity),
  );
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
        borderBottom: "1px solid var(--border-default)", paddingBottom: 4,
      }}>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
          {item.label.toUpperCase()}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
          {item.error ? "" : `${item.findings.length} finding${item.findings.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {item.error ? (
        <div style={{ color: "var(--status-error)", fontSize: 12 }}>{item.error}</div>
      ) : (
        <>
          {item.summary && (
            <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>{item.summary}</div>
          )}
          {sorted.map((f, i) => (
            <FindingRow key={i} finding={f} />
          ))}
        </>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
  const sev = SEVERITY[finding.severity] ?? SEVERITY.low;
  return (
    <div style={{
      border: "1px solid var(--border-default)", borderRadius: 6,
      padding: "8px 10px", marginBottom: 6, background: "rgba(255,255,255,0.015)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{
          color: "var(--bg-primary)", background: sev.color, fontSize: 9, fontWeight: 800,
          padding: "1px 5px", borderRadius: 3, letterSpacing: 0.4,
        }}>{sev.label}</span>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>{finding.title}</span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: MONO_FONT, marginBottom: 4 }}>
        {finding.file}{finding.line != null ? `:${finding.line}` : ""}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 4 }}>{finding.why}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
        <span style={{ color: "var(--status-running)", fontWeight: 600 }}>Fix: </span>{finding.fix}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, subtle }: { label: string; onClick: () => void; subtle?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: subtle ? "transparent" : "rgba(255,140,0,0.12)",
        border: `1px solid ${subtle ? "var(--border-default)" : "var(--text-accent)"}`,
        color: subtle ? "var(--text-secondary)" : "var(--text-accent)",
        fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/** Format findings as a task the focused agent can act on. */
function formatForAgent(data: ReviewResponse): string {
  const lines: string[] = [
    "Please address these CodeGrid Review findings on the current diff:",
    "",
  ];
  for (const r of data.reviews) {
    if (!r.findings.length) continue;
    lines.push(`## ${r.label}`);
    for (const f of r.findings) {
      const loc = `${f.file}${f.line != null ? `:${f.line}` : ""}`;
      lines.push(`- [${f.severity.toUpperCase()}] ${loc} — ${f.title}`);
      lines.push(`  Why: ${f.why}`);
      lines.push(`  Fix: ${f.fix}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}
