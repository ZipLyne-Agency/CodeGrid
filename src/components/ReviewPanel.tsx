import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { useSessionStore } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";
import {
  useReviewStore, REVIEW_DIMENSIONS, reviewToPrompt,
  type ReviewDimension, type ReviewRecord,
} from "../stores/reviewStore";
import { UI_ICON } from "../lib/icons";
import { sendToSession, type ReviewItem, type ReviewFinding, type ReviewSeverity } from "../lib/ipc";

const MONO_FONT = "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace";

const SEVERITY: Record<ReviewSeverity, { label: string; color: string }> = {
  critical: { label: "CRIT", color: "var(--status-error)" },
  high: { label: "HIGH", color: "var(--text-accent)" },
  medium: { label: "MED", color: "var(--status-waiting)" },
  low: { label: "LOW", color: "var(--status-idle)" },
  nit: { label: "NIT", color: "var(--text-muted)" },
};
const SEVERITY_RANK: ReviewSeverity[] = ["critical", "high", "medium", "low", "nit"];

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function findingCount(r: ReviewRecord): number {
  return r.data?.reviews.reduce((n, d) => n + d.findings.length, 0) ?? 0;
}

/**
 * AI code-review overlay (BYOK OpenAI). Reviews run in the background (state
 * lives in reviewStore), so you can start one, close the panel, run another, and
 * revisit any of them from the history rail. Each result can be copied as a
 * prompt or sent to the focused agent.
 */
export function ReviewPanel() {
  const reviewPanelOpen = useAppStore((s) => s.reviewPanelOpen);
  const reviewDir = useAppStore((s) => s.reviewDir);
  const setReviewPanelOpen = useAppStore((s) => s.setReviewPanelOpen);
  const addToast = useToastStore((s) => s.addToast);

  const reviews = useReviewStore((s) => s.reviews);
  const activeId = useReviewStore((s) => s.activeId);
  const dimensions = useReviewStore((s) => s.dimensions);
  const toggleDimension = useReviewStore((s) => s.toggleDimension);
  const selectReview = useReviewStore((s) => s.selectReview);
  const removeReview = useReviewStore((s) => s.removeReview);
  const startReview = useReviewStore((s) => s.startReview);

  const active = reviews.find((r) => r.id === activeId) ?? null;

  const close = useCallback(() => setReviewPanelOpen(false), [setReviewPanelOpen]);
  const run = useCallback(() => {
    if (reviewDir) startReview(reviewDir);
  }, [reviewDir, startReview]);

  // When the panel opens (or the target repo changes), show the most recent
  // review for that repo if there is one, otherwise the "new review" picker.
  useEffect(() => {
    if (!reviewPanelOpen) return;
    const s = useReviewStore.getState();
    const cur = s.reviews.find((r) => r.id === s.activeId);
    if (cur && cur.dir === reviewDir) return; // keep the current selection
    const latest = s.reviews.find((r) => r.dir === reviewDir);
    selectReview(latest ? latest.id : null);
  }, [reviewPanelOpen, reviewDir, selectReview]);

  // Esc closes the panel (the review keeps running in the background).
  useEffect(() => {
    if (!reviewPanelOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewPanelOpen, close]);

  const data = active?.status === "done" ? active.data : null;
  const totalFindings = data?.reviews.reduce((n, r) => n + r.findings.length, 0) ?? 0;

  const copyAsPrompt = useCallback(() => {
    if (!data) return;
    invoke("clipboard_write", { text: reviewToPrompt(data) })
      .then(() => addToast("Review copied as a prompt — paste it to an agent.", "success"))
      .catch(() => addToast("Could not copy the review.", "error"));
  }, [data, addToast]);

  const sendToAgent = useCallback(() => {
    if (!data) return;
    const focusedId = useSessionStore.getState().focusedSessionId;
    if (!focusedId) { addToast("Open a terminal session to send the review to.", "error"); return; }
    sendToSession(focusedId, reviewToPrompt(data))
      .then(() => { addToast("Review sent to the focused agent.", "success"); close(); })
      .catch(() => addToast("Could not send to the session.", "error"));
  }, [data, addToast, close]);

  if (!reviewPanelOpen) return null;

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(900px, 94vw)", height: "min(640px, 86vh)",
          display: "flex", flexDirection: "column",
          background: "var(--bg-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.5)", overflow: "hidden",
          fontFamily: "var(--font-ui)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border-default)",
          background: "rgba(10,10,10,0.5)", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UI_ICON.ai size={15} weight="fill" style={{ color: "var(--text-accent)" }} />
            <span style={{ color: "var(--text-accent)", fontSize: 13, fontWeight: 700, letterSpacing: 0.3 }}>
              AI CODE REVIEW
            </span>
            {active?.status === "running" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 11 }}>
                <span className="cg-spinner" style={{ width: 11, height: 11 }} /> running…
              </span>
            )}
            {data?.model && <span style={{ color: "var(--text-muted)", fontSize: 11 }}>· {data.model}</span>}
            {data?.usage && (
              <span
                style={{ color: data.usage.remaining <= 3 ? "var(--status-waiting)" : "var(--text-muted)", fontSize: 11 }}
                title="AI reviews remaining this month (resets on the 1st)"
              >· {data.usage.remaining}/{data.usage.limit} left</span>
            )}
          </div>
          <button
            onClick={close} title="Close (reviews keep running)" aria-label="Close review"
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: "0 4px" }}
          >×</button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* History rail */}
            <div style={{
              width: 200, flexShrink: 0, borderRight: "1px solid var(--border-default)",
              display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.18)",
            }}>
              <button
                onClick={() => selectReview(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, margin: "8px 8px 4px",
                  padding: "7px 9px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                  background: active === null ? "var(--accent-soft)" : "transparent",
                  border: `1px solid ${active === null ? "var(--accent-border)" : "var(--border-default)"}`,
                  color: "var(--text-accent)", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)",
                }}
              ><UI_ICON.plus size={13} weight="bold" /> New review</button>

              <div className="cg-caps" style={{ color: "var(--text-faint)", fontSize: 9, padding: "8px 12px 4px" }}>History</div>
              <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "0 6px 8px" }}>
                {reviews.length === 0 ? (
                  <div style={{ color: "var(--text-faint)", fontSize: 11, padding: "6px 6px" }}>No reviews yet.</div>
                ) : reviews.map((r) => (
                  <HistoryItem
                    key={r.id}
                    record={r}
                    selected={r.id === activeId}
                    onSelect={() => selectReview(r.id)}
                    onDelete={() => removeReview(r.id)}
                  />
                ))}
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <DimensionPicker
                selected={dimensions}
                onToggle={toggleDimension}
                onRun={run}
                running={active?.status === "running"}
                runLabel={active ? "Run again" : "Run review"}
                dir={reviewDir}
              />

              <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "12px 16px" }}>
                {!active && (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                    Pick the reviewers you want, then hit <strong style={{ color: "var(--text-secondary)" }}>Run review</strong>.
                    It reviews all your uncommitted changes (including brand-new files), runs in the background,
                    and lands in the history on the left.
                  </div>
                )}

                {active?.status === "running" && (
                  <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "24px 4px", textAlign: "center" }}>
                    Reviewing your changes…
                    <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
                      Runs in the background — close this panel and you'll get a toast when it's done.
                    </div>
                  </div>
                )}

                {active?.status === "error" && (
                  <div style={{ color: "var(--status-error)", fontSize: 13, padding: "16px 4px" }}>{active.error}</div>
                )}

                {active?.status === "done" && data && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                        {totalFindings === 0
                          ? "No issues found across the selected reviewers."
                          : `${totalFindings} finding${totalFindings === 1 ? "" : "s"} across ${data.reviews.length} reviewer${data.reviews.length === 1 ? "" : "s"}.`}
                        {data.truncated && <span style={{ color: "var(--status-waiting)", marginLeft: 8 }}>(large diff — reviewed the first part)</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <ActionButton label="Copy as prompt" onClick={copyAsPrompt} />
                        {totalFindings > 0 && <ActionButton label="Send to agent →" onClick={sendToAgent} subtle />}
                      </div>
                    </div>
                    {data.reviews.map((r) => <DimensionBlock key={r.dimension} item={r} />)}
                  </>
                )}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

function HistoryItem({ record, selected, onSelect, onDelete }: {
  record: ReviewRecord; selected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const n = findingCount(record);
  const meta = record.status === "running" ? "running…"
    : record.status === "error" ? "failed"
    : n === 0 ? "clean" : `${n} issue${n === 1 ? "" : "s"}`;
  const metaColor = record.status === "error" ? "var(--status-error)"
    : record.status === "running" ? "var(--text-muted)"
    : n > 0 ? "var(--status-waiting)" : "var(--status-idle)";
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 7px", borderRadius: 6,
        cursor: "pointer", marginBottom: 2,
        background: selected ? "var(--bg-tertiary)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--text-accent)" : "none",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text-secondary)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.label}</div>
        <div style={{ display: "flex", gap: 6, fontSize: 10, marginTop: 1 }}>
          <span style={{ color: metaColor }}>{record.status === "running" ? <span className="cg-spinner" style={{ width: 8, height: 8, marginRight: 4 }} /> : null}{meta}</span>
          <span style={{ color: "var(--text-faint)" }}>· {ago(record.createdAt)}</span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete this review"
        aria-label="Delete review"
        style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--status-error)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-faint)")}
      ><UI_ICON.trash size={13} /></button>
    </div>
  );
}

function DimensionPicker({ selected, onToggle, onRun, running, runLabel, dir }: {
  selected: ReviewDimension[]; onToggle: (d: ReviewDimension) => void;
  onRun: () => void; running: boolean; runLabel: string; dir: string | null;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "10px 16px", borderBottom: "1px solid var(--border-default)", flexShrink: 0,
    }}>
      {REVIEW_DIMENSIONS.map((d) => {
        const on = selected.includes(d.key);
        return (
          <button
            key={d.key}
            onClick={() => onToggle(d.key)}
            title={d.blurb}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: on ? "var(--accent-soft)" : "transparent",
              border: `1px solid ${on ? "var(--accent-border)" : "var(--border-default)"}`,
              color: on ? "var(--text-accent)" : "var(--text-muted)",
              fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-ui)",
              padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            }}
          >
            <span style={{
              width: 12, height: 12, borderRadius: 3, flexShrink: 0,
              border: `1px solid ${on ? "var(--text-accent)" : "var(--border-strong)"}`,
              background: on ? "var(--text-accent)" : "transparent",
              color: "var(--bg-primary)", fontSize: 10, fontWeight: 900, lineHeight: "10px", textAlign: "center",
            }}>{on ? "✓" : ""}</span>
            {d.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        onClick={onRun}
        disabled={running || selected.length === 0 || !dir}
        title={!dir ? "Open a project to review" : undefined}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: selected.length === 0 || !dir ? "var(--bg-tertiary)" : "var(--text-accent)",
          border: "none", borderRadius: 6,
          color: selected.length === 0 || !dir ? "var(--text-faint)" : "var(--bg-primary)",
          fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-ui)",
          padding: "5px 12px", cursor: running || selected.length === 0 || !dir ? "default" : "pointer",
        }}
      >
        {running ? <span className="cg-spinner" style={{ width: 11, height: 11 }} /> : <UI_ICON.ai size={13} weight="fill" />}
        {running ? "Reviewing…" : runLabel}
      </button>
    </div>
  );
}

function DimensionBlock({ item }: { item: ReviewItem }) {
  const sorted = [...item.findings].sort(
    (a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity),
  );
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, borderBottom: "1px solid var(--border-default)", paddingBottom: 4 }}>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>{item.label.toUpperCase()}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{item.error ? "" : `${item.findings.length} finding${item.findings.length === 1 ? "" : "s"}`}</span>
      </div>
      {item.error ? (
        <div style={{ color: "var(--status-error)", fontSize: 12 }}>{item.error}</div>
      ) : (
        <>
          {item.summary && <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 8 }}>{item.summary}</div>}
          {sorted.map((f, i) => <FindingRow key={i} finding={f} />)}
        </>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
  const sev = SEVERITY[finding.severity] ?? SEVERITY.low;
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 6, padding: "8px 10px", marginBottom: 6, background: "rgba(255,255,255,0.015)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ color: "var(--bg-primary)", background: sev.color, fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 3, letterSpacing: 0.4 }}>{sev.label}</span>
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
    >{label}</button>
  );
}
