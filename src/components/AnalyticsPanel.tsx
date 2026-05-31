import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Gated } from "./Gated";
import { getCodingAnalytics, type CodingAnalytics } from "../lib/ipc";

const MONO_FONT = "'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace";

const RANGES: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: 0 },
];

const TOOL_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
const TOOL_COLOR: Record<string, string> = { claude: "var(--text-accent)", codex: "var(--status-idle)" };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

function fmtCost(n: number): string {
  if (n <= 0) return "$0";
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Pro coding-analytics dashboard (sidebar). All data is derived locally from the
 * agent CLIs' own logs — nothing leaves the machine.
 */
export function AnalyticsPanel() {
  return (
    <Gated
      tier={1}
      loadingFallback={
        <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "20px 12px", textAlign: "center" }}>
          Checking entitlement…
        </div>
      }
    >
      <AnalyticsBody />
    </Gated>
  );
}

function AnalyticsBody() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CodingAnalytics | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await getCodingAnalytics(d);
      setData(res);
      setStatus("done");
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error)?.message ?? "Could not load analytics.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const t = data?.totals;
  // Render the last 30 active days; scale bars against the max WITHIN that slice
  // (not the whole range) so the visible bars encode relative magnitude.
  const recentDays = data ? data.by_day.slice(-30) : [];
  const maxDay = recentDays.length ? Math.max(1, ...recentDays.map((d) => d.total_tokens)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", borderBottom: "1px solid var(--border-default)", flexShrink: 0,
      }}>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
          Coding Stats
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              style={{
                background: days === r.days ? "rgba(255,140,0,0.14)" : "transparent",
                border: "none", borderRadius: 4, cursor: "pointer",
                color: days === r.days ? "var(--text-accent)" : "var(--text-faint)",
                fontSize: 10, fontWeight: 600, padding: "2px 6px",
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 12px" }}>
        {status === "loading" && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
            Reading your CLI logs…
          </div>
        )}

        {status === "error" && (
          <div style={{ color: "var(--status-error)", fontSize: 12, padding: "12px 0" }}>{error}</div>
        )}

        {status === "done" && t && (
          <>
            {t.sessions === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
                No coding activity found in this range.
              </div>
            ) : (
              <>
                {/* Stat cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                  <Stat label="Tokens" value={fmtTokens(t.total_tokens)} accent />
                  <Stat label="API value" value={fmtCost(t.est_cost_usd)} />
                  <Stat label="Sessions" value={`${t.sessions}`} />
                  <Stat label="Active days" value={`${t.active_days}`} />
                </div>

                {/* Daily bar chart */}
                {recentDays.length > 0 && (
                  <Section title="Tokens / day">
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, marginTop: 4 }}>
                      {recentDays.map((d) => (
                        <div
                          key={d.date}
                          title={`${d.date}: ${fmtTokens(d.total_tokens)} tokens · ${fmtCost(d.est_cost_usd)}`}
                          style={{
                            flex: 1,
                            height: `${Math.max(2, (d.total_tokens / maxDay) * 100)}%`,
                            background: "var(--text-accent)",
                            opacity: 0.55,
                            borderRadius: 1,
                            minWidth: 2,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-faint)", fontSize: 9, marginTop: 3 }}>
                      <span>{recentDays[0]?.date.slice(5)}</span>
                      <span>{recentDays[recentDays.length - 1]?.date.slice(5)}</span>
                    </div>
                  </Section>
                )}

                {/* Token breakdown */}
                <Section title="Token mix">
                  <MiniRow label="Input" value={fmtTokens(t.input_tokens)} />
                  <MiniRow label="Output" value={fmtTokens(t.output_tokens)} />
                  <MiniRow label="Cache read" value={fmtTokens(t.cache_read_tokens)} />
                  <MiniRow label="Cache write" value={fmtTokens(t.cache_creation_tokens)} />
                  <MiniRow label="Turns" value={`${t.assistant_turns}`} />
                </Section>

                {/* By tool */}
                {data.by_tool.length > 0 && (
                  <Section title="By tool">
                    {data.by_tool.map((tool) => (
                      <MiniRow
                        key={tool.tool}
                        label={TOOL_LABEL[tool.tool] ?? tool.tool}
                        value={fmtTokens(tool.total_tokens)}
                        color={TOOL_COLOR[tool.tool]}
                      />
                    ))}
                  </Section>
                )}

                {/* By model */}
                {data.by_model.length > 0 && (
                  <Section title="By model">
                    {data.by_model.slice(0, 6).map((m) => (
                      <MiniRow key={m.model} label={m.model} value={fmtTokens(m.total_tokens)} mono />
                    ))}
                  </Section>
                )}

                {/* By project */}
                {data.by_project.length > 0 && (
                  <Section title="By project">
                    {data.by_project.slice(0, 8).map((p) => (
                      <MiniRow key={p.project} label={p.name} value={fmtTokens(p.total_tokens)} title={p.project} />
                    ))}
                  </Section>
                )}

                <div style={{ color: "var(--text-faint)", fontSize: 10, marginTop: 12, lineHeight: 1.4 }}>
                  {data.cost_note}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      border: "1px solid var(--border-default)", borderRadius: 6, padding: "7px 9px",
      background: "rgba(255,255,255,0.015)",
    }}>
      <div style={{ color: accent ? "var(--text-accent)" : "var(--text-primary)", fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 10, letterSpacing: 0.3, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MiniRow({ label, value, color, mono, title }: { label: string; value: string; color?: string; mono?: boolean; title?: string }) {
  return (
    <div title={title} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", fontSize: 11 }}>
      <span style={{
        color: color ?? "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontFamily: mono ? MONO_FONT : "var(--font-ui)",
      }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{value}</span>
    </div>
  );
}
