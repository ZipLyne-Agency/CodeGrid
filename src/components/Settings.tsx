import React, { memo, useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useToastStore } from "../stores/toastStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { checkForUpdates } from "../lib/updater";
import { getSetting, setSetting, getClaudePath, getEnvAllowStatus, toggleEnvAllow, getProjectSearchRoots, setProjectSearchRoots, rescanProjectRoots, listRecentProjects } from "../lib/ipc";
import { useAppStore } from "../stores/appStore";
import { UI_ICON, type Icon } from "../lib/icons";
import { PremiumPanel } from "./PremiumPanel";

const ACCENT = "#ff8c00";
const MAGENTA = "#d500f9";

type SectionId = "general" | "terminal" | "tools" | "shortcuts" | "premium";

// --- small presentational helpers -------------------------------------------

/** Uppercase subsection header with breathing room. */
function SubHeader({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        color: "var(--text-faint)",
        fontSize: 10,
        fontWeight: "bold",
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        marginTop: first ? 0 : "22px",
        marginBottom: "10px",
        paddingBottom: "5px",
        borderBottom: "1px solid #1f1f1f",
      }}
    >
      {children}
    </div>
  );
}

/** A labelled row: title + one-line helper on the left, control on the right. */
function Row({
  label,
  help,
  control,
  onClick,
  cursor,
}: {
  label: string;
  help?: string;
  control?: React.ReactNode;
  onClick?: () => void;
  cursor?: string;
}) {
  return (
    <div
      data-setting-label={label.toLowerCase()}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "11px 0",
        cursor: cursor ?? (onClick ? "pointer" : "default"),
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>{label}</div>
        {help && (
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", lineHeight: 1.4 }}>
            {help}
          </div>
        )}
      </div>
      {control != null && <div style={{ flexShrink: 0 }}>{control}</div>}
    </div>
  );
}

/** A toggle switch matching the app's pill style. */
function Toggle({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <div
      style={{
        width: "36px",
        height: "18px",
        borderRadius: "9px",
        background: on ? ACCENT : "#333333",
        position: "relative",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.2s ease",
      }}
    >
      <div
        style={{
          width: "14px",
          height: "14px",
          borderRadius: "50%",
          background: on ? "#0a0a0a" : "#888888",
          position: "absolute",
          top: "2px",
          left: on ? "20px" : "2px",
          transition: "left 0.2s ease, background 0.2s ease",
        }}
      />
    </div>
  );
}

export const Settings = memo(function Settings() {
  const { settingsOpen, setSettingsOpen } = useWorkspaceStore();
  const terminalListPlacement = useWorkspaceStore((s) => s.terminalListPlacement);
  const setTerminalListPlacement = useWorkspaceStore((s) => s.setTerminalListPlacement);
  const addToast = useToastStore((s) => s.addToast);
  const [claudePath, setClaudePath] = useState("");
  const [section, setSection] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [envAllow, setEnvAllow] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const setRecentProjects = useAppStore((s) => s.setRecentProjects);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);
  const terminalCursorStyle = useAppStore((s) => s.terminalCursorStyle);
  const setTerminalCursorStyle = useAppStore((s) => s.setTerminalCursorStyle);
  const terminalCursorBlink = useAppStore((s) => s.terminalCursorBlink);
  const setTerminalCursorBlink = useAppStore((s) => s.setTerminalCursorBlink);
  const setMcpManagerOpen = useAppStore((s) => s.setMcpManagerOpen);
  const setSkillsPanelOpen = useAppStore((s) => s.setSkillsPanelOpen);
  const setClaudeMdEditorOpen = useAppStore((s) => s.setClaudeMdEditorOpen);
  const [searchRoots, setSearchRoots] = useState<string[]>([]);
  const [rescanning, setRescanning] = useState(false);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateVersion = useUpdaterStore((s) => s.version);
  const updateError = useUpdaterStore((s) => s.error);

  useEffect(() => {
    if (!settingsOpen) return;
    const load = async () => {
      try {
        getVersion().then(setAppVersion).catch(() => {});
        const cp = await getClaudePath();
        setClaudePath(cp);
        try { setSearchRoots(await getProjectSearchRoots()); } catch {}
        // Load env allow status
        const ws = useWorkspaceStore.getState().workspaces.find(w => w.id === useWorkspaceStore.getState().activeWorkspaceId);
        if (ws?.repo_path) {
          try {
            const status = await getEnvAllowStatus(ws.repo_path);
            setEnvAllow(status);
          } catch {}
        }
      } catch (e) { console.warn("Failed to load settings:", e); }
    };
    load();
  }, [settingsOpen]);

  // Esc closes (preserve / establish keyboard accessibility).
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settingsOpen, setSettingsOpen]);

  const handleEnvAllowToggle = useCallback(async () => {
    const ws = useWorkspaceStore.getState().workspaces.find(w => w.id === useWorkspaceStore.getState().activeWorkspaceId);
    if (!ws?.repo_path) return;
    const newVal = !envAllow;
    setEnvAllow(newVal);
    try {
      await toggleEnvAllow(ws.repo_path, newVal);
    } catch {
      setEnvAllow(!newVal);
    }
  }, [envAllow]);

  const adjustFont = useCallback((delta: number) => {
    setTerminalFontSize(delta === 0 ? 13 : (prev) => prev + delta);
    setSetting("terminal_font_size", String(useAppStore.getState().terminalFontSize)).catch(() => {});
  }, [setTerminalFontSize]);

  const chooseCursorStyle = useCallback((style: "bar" | "block" | "underline") => {
    setTerminalCursorStyle(style);
    setSetting("terminal_cursor_style", style).catch(() => {});
  }, [setTerminalCursorStyle]);

  const toggleCursorBlink = useCallback(() => {
    const next = !useAppStore.getState().terminalCursorBlink;
    setTerminalCursorBlink(next);
    setSetting("terminal_cursor_blink", String(next)).catch(() => {});
  }, [setTerminalCursorBlink]);

  const chooseTerminalPlacement = useCallback((placement: "topbar" | "sidebar") => {
    setTerminalListPlacement(placement);
    setSetting("terminal_list_placement", placement).catch(() => {});
  }, [setTerminalListPlacement]);

  const persistRoots = useCallback(async (roots: string[]) => {
    setSearchRoots(roots);
    try { await setProjectSearchRoots(roots); } catch (e) { addToast(`Failed to save project folders: ${e}`, "error"); }
  }, [addToast]);

  const handleAddRoot = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Add a project folder" });
      if (selected && !searchRoots.includes(selected as string)) {
        await persistRoots([...searchRoots, selected as string]);
      }
    } catch (e) {
      addToast(`Could not open folder picker: ${e}`, "error");
    }
  }, [searchRoots, persistRoots, addToast]);

  const handleRemoveRoot = useCallback(async (root: string) => {
    await persistRoots(searchRoots.filter((r) => r !== root));
  }, [searchRoots, persistRoots]);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      const projects = await rescanProjectRoots();
      setRecentProjects(projects);
      addToast(`Found ${projects.length} project${projects.length === 1 ? "" : "s"}`, "success");
    } catch (e) {
      addToast(`Rescan failed: ${e}`, "error");
    } finally {
      setRescanning(false);
    }
  }, [setRecentProjects, addToast]);

  if (!settingsOpen) return null;

  // Derive the current project dir for the AGENTS.md editor (gracefully undefined).
  const activeRepoPath = (() => {
    const st = useWorkspaceStore.getState();
    return st.workspaces.find((w) => w.id === st.activeWorkspaceId)?.repo_path || undefined;
  })();

  const activeWs = useWorkspaceStore.getState().workspaces.find(
    (w) => w.id === useWorkspaceStore.getState().activeWorkspaceId,
  );
  const hasRepo = !!activeWs?.repo_path;

  const nav: { id: SectionId; label: string; icon: Icon }[] = [
    { id: "general", label: "General", icon: UI_ICON.settings },
    { id: "terminal", label: "Terminal", icon: UI_ICON.terminals },
    { id: "tools", label: "Tools", icon: UI_ICON.mcp },
    { id: "shortcuts", label: "Shortcuts", icon: UI_ICON.command },
    { id: "premium", label: "Premium", icon: UI_ICON.crown },
  ];

  // Simple search filter — matches setting rows by their label text.
  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const filtering = q.length > 0;

  // Shared input focus styling.
  const focusBorder = (e: React.FocusEvent<HTMLElement>) => (e.currentTarget.style.borderColor = ACCENT);
  const blurBorder = (e: React.FocusEvent<HTMLElement>) => (e.currentTarget.style.borderColor = "#2a2a2a");

  const linkBtn: React.CSSProperties = {
    background: "transparent", border: "1px solid #2a2a2a", color: "#aaaaaa",
    fontSize: 11, fontFamily: "var(--font-ui)", padding: "5px 12px", cursor: "pointer",
  };

  // ---- section renderers ----------------------------------------------------

  const renderGeneral = () => (
    <>
      <SubHeader first>Workspace</SubHeader>

      {matches(".env editing") && (
        <Row
          label=".env editing"
          help={hasRepo
            ? "Let Claude Code read and modify .env files in this workspace."
            : "Set a repo path on this workspace to enable."}
          onClick={hasRepo ? handleEnvAllowToggle : undefined}
          cursor={hasRepo ? "pointer" : "not-allowed"}
          control={<Toggle on={envAllow} disabled={!hasRepo} />}
        />
      )}

      {matches("sessions") && (
        <Row
          label="Sessions"
          help="Unlimited — run as many as your machine can handle."
        />
      )}

      <SubHeader>Projects</SubHeader>

      {matches("project folders") && (
        <div style={{ padding: "11px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>Project folders</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", lineHeight: 1.4 }}>
                Folders scanned to suggest recent projects on first launch. Recents otherwise update automatically as you open projects.
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
              <button onClick={handleRescan} disabled={rescanning}
                style={{ ...linkBtn, padding: "5px 10px", cursor: rescanning ? "default" : "pointer", opacity: rescanning ? 0.5 : 1 }}>
                {rescanning ? "SCANNING…" : "RESCAN"}
              </button>
              <button onClick={handleAddRoot}
                style={{ ...linkBtn, border: `1px solid ${ACCENT}`, color: ACCENT, padding: "5px 10px" }}>
                + ADD
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginTop: "10px" }}>
            {searchRoots.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>No folders configured.</div>
            )}
            {searchRoots.map((root) => (
              <div key={root} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "6px 10px" }}>
                <span style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {root.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
                </span>
                <button
                  onClick={() => handleRemoveRoot(root)}
                  title="Remove folder"
                  style={{ background: "none", border: "none", color: "#666666", fontSize: 13, cursor: "pointer", flexShrink: 0, padding: "0 2px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#e06c75")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#666666")}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <SubHeader>About</SubHeader>

      {matches("claude binary") && (
        <div style={{ padding: "11px 0" }}>
          <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>Claude binary</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", marginBottom: "8px", lineHeight: 1.4 }}>
            Path CodeGrid uses to launch Claude Code sessions.
          </div>
          <div style={{ background: "#0a0a0a", border: "1px solid #2a2a2a", color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-ui)", padding: "7px 9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {claudePath || "Not found — install with: npm i -g @anthropic-ai/claude-code"}
          </div>
        </div>
      )}

      {matches("version") && (
        <div style={{ padding: "11px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>Version</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", lineHeight: 1.4 }}>
                Code Grid v{appVersion || "—"}
                <span style={{ marginLeft: "8px", color: updateStatus === "error" ? "#e06c75" : "#666666" }}>
                  {updateStatus === "checking" && "· Checking…"}
                  {updateStatus === "downloading" && "· Downloading update…"}
                  {(updateStatus === "available") && "· Update found…"}
                  {updateStatus === "ready" && `· v${updateVersion} ready — restart to update`}
                  {updateStatus === "uptodate" && "· You're up to date"}
                  {updateStatus === "error" && `· Check failed${updateError ? `: ${updateError}` : ""}`}
                </span>
              </div>
            </div>
            <button
              onClick={() => void checkForUpdates({ silent: false })}
              disabled={updateStatus === "checking" || updateStatus === "downloading"}
              style={{
                flexShrink: 0,
                background: "transparent",
                border: `1px solid ${ACCENT}`,
                color: ACCENT,
                fontSize: 11,
                fontFamily: "var(--font-ui)",
                letterSpacing: "0.5px",
                padding: "5px 10px",
                cursor: (updateStatus === "checking" || updateStatus === "downloading") ? "default" : "pointer",
                opacity: (updateStatus === "checking" || updateStatus === "downloading") ? 0.5 : 1,
              }}
            >
              {updateStatus === "checking" ? "CHECKING…" : "CHECK FOR UPDATES"}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const renderTerminal = () => (
    <>
      <SubHeader first>Layout</SubHeader>

      {matches("terminal list") && (
        <div style={{ padding: "11px 0" }}>
          <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>Terminal list</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", marginBottom: "10px", lineHeight: 1.4 }}>
            Where the list of open terminals lives.
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {([
              { id: "topbar" as const, label: "Top bar", desc: "Tabs across the top" },
              { id: "sidebar" as const, label: "Side panel", desc: "Pop-out drawer on the right" },
            ]).map((opt) => {
              const active = terminalListPlacement === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => chooseTerminalPlacement(opt.id)}
                  style={{
                    flex: 1, textAlign: "left", padding: "10px 12px",
                    background: active ? "rgba(255,140,0,0.10)" : "#0a0a0a",
                    border: `1px solid ${active ? ACCENT : "#2a2a2a"}`,
                    color: active ? ACCENT : "#aaaaaa",
                    fontFamily: "var(--font-ui)", cursor: "pointer", borderRadius: 6,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 3 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? "#ff8c0099" : "#666666", lineHeight: 1.3 }}>{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <SubHeader>Appearance</SubHeader>

      {matches("theme") && (
        <Row label="Theme" help="Code Grid Dark (default)." control={
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Code Grid Dark</span>
        } />
      )}

      {matches("terminal font") && (
        <Row
          label="Terminal font"
          help={`JetBrains Mono, ${terminalFontSize}px · ⌘+ / ⌘– to zoom, ⌘0 to reset.`}
          control={
            <div style={{ display: "flex", gap: "4px" }}>
              {([["–", -1], ["Reset", 0], ["+", 1]] as const).map(([label, delta]) => (
                <button
                  key={label}
                  onClick={() => adjustFont(delta)}
                  style={{
                    background: "transparent", border: "1px solid #2a2a2a", color: "#aaaaaa",
                    fontSize: 12, fontFamily: "var(--font-ui)", padding: "4px 10px", cursor: "pointer", minWidth: label === "Reset" ? undefined : "32px",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
      )}

      <SubHeader>Cursor</SubHeader>

      {matches("cursor shape") && (
        <Row
          label="Cursor shape"
          help="The caret style inside terminal panes."
          control={
            <div style={{ display: "flex", gap: "4px" }}>
              {(["bar", "block", "underline"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => chooseCursorStyle(style)}
                  style={{
                    background: terminalCursorStyle === style ? "rgba(255,140,0,0.12)" : "transparent",
                    border: `1px solid ${terminalCursorStyle === style ? ACCENT : "#2a2a2a"}`,
                    color: terminalCursorStyle === style ? ACCENT : "#aaaaaa",
                    fontSize: 12, fontFamily: "var(--font-ui)", padding: "4px 12px", cursor: "pointer", textTransform: "capitalize",
                  }}
                >
                  {style}
                </button>
              ))}
            </div>
          }
        />
      )}

      {matches("cursor blink") && (
        <Row
          label="Cursor blink"
          help="Animate the caret on and off."
          onClick={toggleCursorBlink}
          control={<Toggle on={terminalCursorBlink} />}
        />
      )}
    </>
  );

  const renderTools = () => {
    const tools: { label: string; help: string; icon: Icon; onClick: () => void }[] = [
      {
        label: "MCP Servers",
        help: "Manage Model Context Protocol servers, aggregated across every agent (Claude, Codex, Cursor, Gemini, Grok).",
        icon: UI_ICON.mcp,
        onClick: () => { setSettingsOpen(false); setMcpManagerOpen(true); },
      },
      {
        label: "Skills",
        help: "Browse and manage Skills available to all agents.",
        icon: UI_ICON.skills,
        onClick: () => { setSettingsOpen(false); setSkillsPanelOpen(true); },
      },
      {
        label: "Agent Instructions",
        help: hasRepo
          ? "Edit AGENTS.md / CLAUDE.md instructions for the current project."
          : "Edit global AGENTS.md / CLAUDE.md agent instructions.",
        icon: UI_ICON.note,
        onClick: () => { setSettingsOpen(false); setClaudeMdEditorOpen(true, activeRepoPath); },
      },
    ].filter((t) => matches(t.label));

    return (
      <>
        <SubHeader first>Managers</SubHeader>
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: "12px", lineHeight: 1.4, marginTop: "-4px" }}>
          Quick-launch the configuration managers. Each opens its own panel.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {tools.map((t) => (
            <button
              key={t.label}
              onClick={t.onClick}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px",
                textAlign: "left", padding: "12px 14px", background: "#0a0a0a",
                border: "1px solid #2a2a2a", borderRadius: 6, cursor: "pointer",
                fontFamily: "var(--font-ui)", transition: "border-color 0.15s ease, background 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = MAGENTA; e.currentTarget.style.background = "rgba(213,0,249,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#0a0a0a"; }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 11, minWidth: 0 }}>
                <span style={{ color: MAGENTA, display: "inline-flex", flexShrink: 0, marginTop: 1 }}><t.icon size={16} weight="regular" /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: "3px", lineHeight: 1.4 }}>{t.help}</div>
                </div>
              </div>
              <span style={{ color: MAGENTA, fontSize: 16, flexShrink: 0 }}>→</span>
            </button>
          ))}
          {tools.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>No tools match your search.</div>
          )}
        </div>
      </>
    );
  };

  const renderShortcuts = () => {
    const groups = ([
      ["Panes & sessions", [
        ["⌘N", "New session"],
        ["⌘W", "Close pane"],
        ["⌘P", "Switch pane (quick switcher)"],
        ["⌘1–9", "Jump to pane by number"],
        ["⌘← ↑ → ↓", "Focus adjacent pane"],
        ["⌘⇧← ↑ → ↓", "Swap pane"],
        ["⌘↵", "Maximize / restore pane"],
      ]],
      ["Workspaces & layout", [
        ["⌘⇧N", "New workspace"],
        ["⌘⇥ / ⌘⇧⇥", "Next / previous workspace"],
        ["⌘S", "Toggle sidebar"],
      ]],
      ["Tools", [
        ["⌘K", "Command palette"],
        ["⌘G", "Open Git manager"],
        ["⌘⇧F", "Search in files"],
        ["⌘B", "Toggle broadcast"],
        ["⌘,", "Settings"],
      ]],
      ["Terminal", [
        ["⌘F", "Find in terminal"],
        ["⌘+ / ⌘–", "Zoom terminal in / out"],
        ["⌘0", "Reset terminal zoom"],
      ]],
    ] as [string, [string, string][]][])
      .map(([title, rows]) => [title, rows.filter(([, desc]) => matches(desc) || matches(title))] as [string, [string, string][]])
      .filter(([, rows]) => rows.length > 0);

    return (
      <>
        {groups.map(([sectionTitle, rows], i) => (
          <div key={sectionTitle}>
            <SubHeader first={i === 0}>{sectionTitle}</SubHeader>
            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 16px" }}>
              {rows.map(([key, desc]) => (
                <React.Fragment key={key}>
                  <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{key}</span>
                  <span>{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>No shortcuts match your search.</div>
        ) : (
          <div style={{ color: "#555", fontSize: 11, lineHeight: 1.5, borderTop: "1px solid #2a2a2a", paddingTop: "12px", marginTop: "20px" }}>
            ⌘ is Control on Windows/Linux. These shortcuts work globally, including while a terminal is focused.
          </div>
        )}
      </>
    );
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "70px" }}
      onClick={() => setSettingsOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0, 0, 0, 0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          position: "relative", width: "720px", maxHeight: "600px", background: "#141414",
          border: `1px solid ${ACCENT}`, fontFamily: "var(--font-ui)", zIndex: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a2a", color: ACCENT, fontSize: "12px", fontWeight: "bold", letterSpacing: "1px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          SETTINGS
          <button onClick={() => setSettingsOpen(false)} aria-label="Close settings" style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "14px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>x</button>
        </div>

        {/* Body: left rail + content */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Left rail nav */}
          <div style={{ width: "176px", flexShrink: 0, borderRight: "1px solid #2a2a2a", background: "#0e0e0e", padding: "10px 8px", display: "flex", flexDirection: "column", gap: "2px" }}>
            {nav.map((n) => {
              const active = section === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setSection(n.id)}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "9px 12px", textAlign: "left",
                    background: active ? "rgba(255,140,0,0.10)" : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
                    color: active ? ACCENT : "#888888",
                    fontSize: 12, fontFamily: "var(--font-ui)", cursor: "pointer", letterSpacing: "0.3px",
                    transition: "background 0.12s ease, color 0.12s ease",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#cccccc"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#888888"; }}
                >
                  <span style={{ width: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: active ? 1 : 0.7 }}><n.icon size={16} weight={active ? "fill" : "regular"} /></span>
                  {n.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Search / filter */}
            <div style={{ padding: "12px 20px 4px" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter settings…"
                aria-label="Filter settings"
                style={{
                  width: "100%", boxSizing: "border-box", background: "#0a0a0a", border: "1px solid #2a2a2a",
                  color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-ui)", padding: "7px 10px", outline: "none",
                }}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "8px 20px 20px" }}>
              {filtering && section === "premium" ? (
                <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic", padding: "11px 0" }}>
                  Clear the filter to view Premium.
                </div>
              ) : (
                <>
                  {section === "general" && renderGeneral()}
                  {section === "terminal" && renderTerminal()}
                  {section === "tools" && renderTools()}
                  {section === "shortcuts" && renderShortcuts()}
                  {section === "premium" && <PremiumPanel />}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
