import { memo, useState, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import type { SessionWithModel } from "../stores/sessionStore";
import { statusTheme } from "../lib/paneTheme";

interface StatusBarProps {
  session: SessionWithModel;
}

function shortenPath(path: string): string {
  const home = "~";
  const shortened = path.replace(/^\/Users\/[^/]+/, home).replace(/^\/home\/[^/]+/, home);
  const parts = shortened.split("/");
  if (parts.length > 3) {
    return parts[0] + "/…/" + parts.slice(-2).join("/");
  }
  return shortened;
}

function formatUptime(createdAt: string): string {
  const start = new Date(createdAt).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

export const StatusBar = memo(function StatusBar({ session }: StatusBarProps) {
  const [uptime, setUptime] = useState(formatUptime(session.created_at));
  const setGitManagerOpen = useAppStore((s) => s.setGitManagerOpen);

  useEffect(() => {
    const interval = setInterval(() => {
      setUptime(formatUptime(session.created_at));
    }, 30000);
    return () => clearInterval(interval);
  }, [session.created_at]);

  const status = statusTheme(session.status);

  return (
    <div
      style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 10px",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        color: "var(--text-muted)",
        background: "var(--bg-secondary)",
        borderTop: "1px solid var(--border-default)",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <span
        className="cg-num"
        style={{
          color: "var(--text-primary)",
          fontWeight: 700,
          minWidth: 18,
          textAlign: "center",
        }}
      >
        {session.pane_number}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: status.color,
          fontWeight: 600,
        }}
        title={`Status: ${status.label}`}
      >
        <span aria-hidden>{status.glyph}</span>
        <span>{status.label}</span>
      </span>
      {session.activityName && (
        <span
          style={{
            color: "var(--text-accent)",
            fontSize: 11,
            fontWeight: 600,
            padding: "0 5px",
            border: "1px solid rgba(255,140,0,0.4)",
            background: "rgba(255,140,0,0.1)",
          }}
        >
          {session.activityName}
        </span>
      )}
      <span
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-code)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={session.working_dir}
      >
        {shortenPath(session.working_dir)}
      </span>
      {session.git_branch && (
        <span
          style={{
            color: "#d57bff",
            cursor: "pointer",
            fontFamily: "var(--font-code)",
          }}
          onClick={(e) => { e.stopPropagation(); setGitManagerOpen(true, session.working_dir); }}
          title="Open Git Manager"
        >
          ⎇ {session.git_branch}
        </span>
      )}
      <span className="cg-num" style={{ marginLeft: "auto", color: "var(--text-secondary)" }} title="Uptime">
        {uptime}
      </span>
    </div>
  );
});
