import React, { memo, useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useToastStore } from "../stores/toastStore";
import { useUpdaterStore } from "../stores/updaterStore";
import { checkForUpdates } from "../lib/updater";
import { getSetting, setSetting, getClaudePath, getEnvAllowStatus, toggleEnvAllow, getProjectSearchRoots, setProjectSearchRoots, rescanProjectRoots, listRecentProjects } from "../lib/ipc";
import { useAppStore } from "../stores/appStore";
import { PremiumPanel } from "./PremiumPanel";

export const Settings = memo(function Settings() {
  const { settingsOpen, setSettingsOpen } = useWorkspaceStore();
  const terminalListPlacement = useWorkspaceStore((s) => s.terminalListPlacement);
  const setTerminalListPlacement = useWorkspaceStore((s) => s.setTerminalListPlacement);
  const addToast = useToastStore((s) => s.addToast);
  const [claudePath, setClaudePath] = useState("");
  const [tab, setTab] = useState<"general" | "terminal" | "shortcuts" | "premium">("general");
  const [envAllow, setEnvAllow] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const setRecentProjects = useAppStore((s) => s.setRecentProjects);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);
  const terminalCursorStyle = useAppStore((s) => s.terminalCursorStyle);
  const setTerminalCursorStyle = useAppStore((s) => s.setTerminalCursorStyle);
  const terminalCursorBlink = useAppStore((s) => s.terminalCursorBlink);
  const setTerminalCursorBlink = useAppStore((s) => s.setTerminalCursorBlink);
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

  const tabs = [
    { id: "general" as const, label: "General" },
    { id: "terminal" as const, label: "Terminal" },
    { id: "shortcuts" as const, label: "Shortcuts" },
    { id: "premium" as const, label: "Premium" },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "80px" }}
      onClick={() => setSettingsOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0, 0, 0, 0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          position: "relative", width: "500px", maxHeight: "550px", background: "#141414",
          border: "1px solid #ff8c00", fontFamily: "var(--font-ui)", zIndex: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a2a", color: "#ff8c00", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          SETTINGS
          <button onClick={() => setSettingsOpen(false)} aria-label="Close settings" style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "14px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>x</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px", background: tab === t.id ? "#1e1e1e" : "transparent",
              border: "none", borderBottom: tab === t.id ? "2px solid #ff8c00" : "2px solid transparent",
              color: tab === t.id ? "#ff8c00" : "#555555", fontSize: 12, fontFamily: "var(--font-ui)",
              cursor: "pointer", letterSpacing: "0.5px",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {tab === "general" && (
            <>
              {/* .env Editing Toggle */}
              {(() => {
                const ws = useWorkspaceStore.getState().workspaces.find(w => w.id === useWorkspaceStore.getState().activeWorkspaceId);
                const hasRepo = !!ws?.repo_path;
                return (
                  <div
                    onClick={hasRepo ? handleEnvAllowToggle : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      background: envAllow ? "rgba(255, 140, 0, 0.1)" : "#0a0a0a",
                      border: envAllow ? "1px solid #ff8c00" : "1px solid #2a2a2a",
                      cursor: hasRepo ? "pointer" : "not-allowed",
                      transition: "all 0.2s ease",
                      opacity: hasRepo ? 1 : 0.4,
                    }}
                  >
                    <div>
                      <div style={{
                        color: envAllow ? "#ff8c00" : "#e0e0e0",
                        fontSize: 12,
                        fontWeight: "bold",
                        letterSpacing: "1.5px",
                        fontFamily: "var(--font-ui)",
                      }}>
                        .ENV EDITING
                      </div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: "3px", lineHeight: "1.4" }}>
                        {hasRepo
                          ? "Let Claude Code read and modify .env files in this workspace"
                          : "Set a repo path on this workspace to enable"}
                      </div>
                    </div>
                    <div style={{
                      width: "36px",
                      height: "18px",
                      borderRadius: "9px",
                      background: envAllow ? "#ff8c00" : "#333333",
                      position: "relative",
                      flexShrink: 0,
                      marginLeft: "12px",
                      transition: "background 0.2s ease",
                    }}>
                      <div style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        background: envAllow ? "#0a0a0a" : "#888888",
                        position: "absolute",
                        top: "2px",
                        left: envAllow ? "20px" : "2px",
                        transition: "left 0.2s ease, background 0.2s ease",
                      }} />
                    </div>
                  </div>
                );
              })()}

              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "4px", letterSpacing: "0.5px" }}>SESSIONS</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Unlimited — run as many as your machine can handle</div>
              </div>

              {/* Project folders — where CodeGrid looks for projects to suggest */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, letterSpacing: "0.5px" }}>PROJECT FOLDERS</div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={handleRescan}
                      disabled={rescanning}
                      style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#aaaaaa", fontSize: 11, fontFamily: "var(--font-ui)", padding: "3px 8px", cursor: rescanning ? "default" : "pointer", opacity: rescanning ? 0.5 : 1 }}
                    >
                      {rescanning ? "SCANNING…" : "RESCAN"}
                    </button>
                    <button
                      onClick={handleAddRoot}
                      style={{ background: "transparent", border: "1px solid #ff8c00", color: "#ff8c00", fontSize: 11, fontFamily: "var(--font-ui)", padding: "3px 8px", cursor: "pointer" }}
                    >
                      + ADD
                    </button>
                  </div>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: "8px", lineHeight: 1.4 }}>
                  Folders scanned to suggest recent projects on first launch. Recents otherwise update automatically as you open projects.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {searchRoots.length === 0 && (
                    <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>No folders configured.</div>
                  )}
                  {searchRoots.map((root) => (
                    <div key={root} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", background: "#0a0a0a", border: "1px solid #2a2a2a", padding: "5px 8px" }}>
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
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "4px", letterSpacing: "0.5px" }}>CLAUDE BINARY</div>
                <div style={{ background: "#0a0a0a", border: "1px solid #2a2a2a", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)", padding: "6px 8px" }}>
                  {claudePath || "Not found — install with: npm i -g @anthropic-ai/claude-code"}
                </div>
              </div>
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "4px", letterSpacing: "0.5px" }}>VERSION</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
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
                  <button
                    onClick={() => void checkForUpdates({ silent: false })}
                    disabled={updateStatus === "checking" || updateStatus === "downloading"}
                    style={{
                      flexShrink: 0,
                      background: "transparent",
                      border: "1px solid #ff8c00",
                      color: "#ff8c00",
                      fontSize: 12,
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
            </>
          )}

          {tab === "terminal" && (
            <>
              {/* Where the list of open terminals lives */}
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "8px", letterSpacing: "0.5px" }}>TERMINAL LIST</div>
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
                          border: `1px solid ${active ? "#ff8c00" : "#2a2a2a"}`,
                          color: active ? "#ff8c00" : "#aaaaaa",
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

              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "8px", letterSpacing: "0.5px" }}>THEME</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Code Grid Dark (default)</div>
              </div>
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "8px", letterSpacing: "0.5px" }}>TERMINAL FONT</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    JetBrains Mono, {terminalFontSize}px
                    <span style={{ marginLeft: "8px", color: "#666666" }}>· ⌘+ / ⌘– to zoom, ⌘0 to reset</span>
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
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
                </div>
              </div>

              {/* Cursor style */}
              <div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: "8px", letterSpacing: "0.5px" }}>CURSOR</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Shape</div>
                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    {(["bar", "block", "underline"] as const).map((style) => (
                      <button
                        key={style}
                        onClick={() => chooseCursorStyle(style)}
                        style={{
                          background: terminalCursorStyle === style ? "rgba(255,140,0,0.12)" : "transparent",
                          border: `1px solid ${terminalCursorStyle === style ? "#ff8c00" : "#2a2a2a"}`,
                          color: terminalCursorStyle === style ? "#ff8c00" : "#aaaaaa",
                          fontSize: 12, fontFamily: "var(--font-ui)", padding: "4px 12px", cursor: "pointer", textTransform: "capitalize",
                        }}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  onClick={toggleCursorBlink}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "10px", cursor: "pointer" }}
                >
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Blink</div>
                  <div style={{ width: "36px", height: "18px", borderRadius: "9px", background: terminalCursorBlink ? "#ff8c00" : "#333333", position: "relative", flexShrink: 0, transition: "background 0.2s ease" }}>
                    <div style={{ width: "14px", height: "14px", borderRadius: "50%", background: terminalCursorBlink ? "#0a0a0a" : "#888888", position: "absolute", top: "2px", left: terminalCursorBlink ? "20px" : "2px", transition: "left 0.2s ease, background 0.2s ease" }} />
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "shortcuts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {([
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
              ] as [string, [string, string][]][]).map(([section, rows]) => (
                <div key={section}>
                  <div style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: "bold", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "6px" }}>
                    {section}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 16px" }}>
                    {rows.map(([key, desc]) => (
                      <React.Fragment key={key}>
                        <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{key}</span>
                        <span>{desc}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ color: "#555", fontSize: 11, lineHeight: 1.5, borderTop: "1px solid #2a2a2a", paddingTop: "10px" }}>
                ⌘ is Control on Windows/Linux. These shortcuts work globally, including while a terminal is focused.
              </div>
            </div>
          )}

          {tab === "premium" && (
            <div style={{ padding: "4px 2px" }}>
              <PremiumPanel />
            </div>
          )}

        </div>
      </div>
    </div>
  );
});
