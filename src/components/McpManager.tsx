import { memo, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useToastStore } from "../stores/toastStore";
import {
  listMcps, addMcpServer, removeMcpServer, toggleMcpServer,
  getHomeDir, type McpServerConfig,
} from "../lib/ipc";
import { agentTheme, type AgentKind } from "../lib/paneTheme";
import { UI_ICON } from "../lib/icons";

// Display order for the per-agent groups.
const AGENT_ORDER: AgentKind[] = ["claude", "codex", "cursor", "gemini", "grok"];

function agentKindOf(agent: string): AgentKind {
  return (AGENT_ORDER as string[]).includes(agent) ? (agent as AgentKind) : "shell";
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

interface McpPreset {
  name: string;
  command: string;
  args: string[];
  description: string;
}

const MCP_PRESETS: McpPreset[] = [
  { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], description: "File system access" },
  { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], description: "GitHub API integration" },
  { name: "postgres", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], description: "PostgreSQL database" },
  { name: "sqlite", command: "npx", args: ["-y", "@modelcontextprotocol/server-sqlite"], description: "SQLite database" },
  { name: "puppeteer", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"], description: "Browser automation" },
  { name: "brave-search", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], description: "Brave Search API" },
  { name: "memory", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], description: "Persistent memory store" },
  { name: "sequential-thinking", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], description: "Step-by-step reasoning" },
];

interface ParsedServer {
  name: string;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url?: string | null;
  serverType?: string | null;
  headers?: Record<string, string> | null;
}

function stripJsonComments(str: string): string {
  // Remove single-line // comments and multi-line /* */ comments outside of strings
  let result = "";
  let inString = false;
  let escape = false;
  let i = 0;
  while (i < str.length) {
    if (escape) {
      result += str[i];
      escape = false;
      i++;
      continue;
    }
    if (inString) {
      if (str[i] === "\\") escape = true;
      else if (str[i] === '"') inString = false;
      result += str[i];
      i++;
      continue;
    }
    if (str[i] === '"') {
      inString = true;
      result += str[i];
      i++;
    } else if (str[i] === "/" && str[i + 1] === "/") {
      // Skip until end of line
      while (i < str.length && str[i] !== "\n") i++;
    } else if (str[i] === "/" && str[i + 1] === "*") {
      // Skip until */
      i += 2;
      while (i < str.length - 1 && !(str[i] === "*" && str[i + 1] === "/")) i++;
      i += 2; // skip the closing */
    } else {
      result += str[i];
      i++;
    }
  }
  return result;
}

function parseMcpJson(raw: string): { servers: ParsedServer[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { servers: [], error: null };

  // Strip // and /* */ comments, then remove trailing commas before ] or }
  const stripped = stripJsonComments(trimmed);
  const noTrailing = stripped.replace(/,\s*([}\]])/g, "$1");

  // Try to fix Format C: "server-name": { ... } by wrapping in braces
  let jsonStr = noTrailing.trim();
  if (/^"[^"]+"\s*:/.test(jsonStr) && !jsonStr.startsWith("{")) {
    jsonStr = `{${jsonStr}}`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { servers: [], error: "Invalid JSON. Paste a valid MCP server configuration." };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { servers: [], error: "Expected a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;

  // Format A: { "mcpServers": { "name": { command, args, env } } }
  if ("mcpServers" in obj && typeof obj.mcpServers === "object" && obj.mcpServers !== null) {
    const serversObj = obj.mcpServers as Record<string, unknown>;
    return extractServers(serversObj);
  }

  // Format B: { "command": "...", "args": [...], "env": {...} } or { "url": "...", "type": "http" }
  if (("command" in obj && typeof obj.command === "string") || ("url" in obj && typeof obj.url === "string")) {
    const srv = extractSingleServer("server", obj);
    if (srv) return { servers: [srv], error: null };
    return { servers: [], error: "Invalid server config: needs 'command' or 'url' field." };
  }

  // Format C (after wrapping) or multiple servers: { "name": { command, args, env }, ... }
  return extractServers(obj);
}

function extractServers(obj: Record<string, unknown>): { servers: ParsedServer[]; error: string | null } {
  const servers: ParsedServer[] = [];
  for (const [name, val] of Object.entries(obj)) {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const srv = extractSingleServer(name, val as Record<string, unknown>);
      if (srv) servers.push(srv);
    }
  }
  if (servers.length === 0) {
    return { servers: [], error: "No valid MCP server entries found. Each entry needs a 'command' or 'url' field." };
  }
  return { servers, error: null };
}

function extractSingleServer(name: string, obj: Record<string, unknown>): ParsedServer | null {
  const hasCommand = typeof obj.command === "string";
  const hasUrl = typeof obj.url === "string";
  // Must have either command (stdio) or url (http)
  if (!hasCommand && !hasUrl) return null;
  const args: string[] = Array.isArray(obj.args) ? obj.args.filter((a): a is string => typeof a === "string") : [];
  const env: Record<string, string> = {};
  if (typeof obj.env === "object" && obj.env !== null && !Array.isArray(obj.env)) {
    for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
  }
  const headers: Record<string, string> = {};
  if (typeof obj.headers === "object" && obj.headers !== null && !Array.isArray(obj.headers)) {
    for (const [k, v] of Object.entries(obj.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  return {
    name,
    command: hasCommand ? (obj.command as string) : null,
    args,
    env,
    url: hasUrl ? (obj.url as string) : null,
    serverType: typeof obj.type === "string" ? obj.type : null,
    headers: Object.keys(headers).length > 0 ? headers : null,
  };
}

export const McpManager = memo(function McpManager() {
  const { mcpManagerOpen, setMcpManagerOpen, mcpManagerDir } = useAppStore();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [filter, setFilter] = useState<"all" | "global" | "project">("all");
  const [agentFilter, setAgentFilter] = useState<"all" | AgentKind>("all");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addTab, setAddTab] = useState<"paste" | "manual">("paste");
  const [pasteJson, setPasteJson] = useState("");
  const [parsedServers, setParsedServers] = useState<ParsedServer[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newScope, setNewScope] = useState<"global" | "project">("global");

  const addToast = useToastStore((s) => s.addToast);
  const [showPresets, setShowPresets] = useState(false);
  const dir = mcpManagerDir ?? undefined;
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await listMcps(dir);
      setServers(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [dir]);

  useEffect(() => {
    if (mcpManagerOpen) refresh();
  }, [mcpManagerOpen, refresh]);

  const flash = (msg: string) => {
    setSuccess(msg);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSuccess(null), 2000);
  };

  // Strip any annotation suffix the backend adds to source_file (e.g.
  // "~/.claude.json (projects./Users/isaac)") so writes target a real path.
  const writePath = (srv: McpServerConfig) => srv.source_file.replace(/\s+\(projects\..*\)$/, "");

  const handleToggle = useCallback(async (srv: McpServerConfig) => {
    if (!srv.writable) {
      setError(`${srv.name} is view-only (${srv.agent} stores MCP servers in TOML).`);
      return;
    }
    try {
      await toggleMcpServer(writePath(srv), srv.name, !srv.enabled);
      flash(`${srv.name} ${srv.enabled ? "disabled" : "enabled"}`);
      await refresh();
    } catch (e) { setError(String(e)); }
  }, [refresh]);

  const handleRemove = useCallback(async (srv: McpServerConfig) => {
    if (!srv.writable) {
      setError(`${srv.name} is view-only (${srv.agent} stores MCP servers in TOML).`);
      return;
    }
    try {
      await removeMcpServer(writePath(srv), srv.name);
      flash(`Removed ${srv.name}`);
      await refresh();
    } catch (e) { setError(String(e)); }
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    let homePath = "~";
    try { homePath = await getHomeDir(); } catch (e) { console.warn("Failed to get home dir:", e); }
    const configPath = newScope === "project" && dir
      ? `${dir}/.claude/mcp.json`
      : `${homePath}/.claude/mcp.json`;
    try {
      const args = newArgs.trim() ? newArgs.trim().split(/\s+/) : [];
      await addMcpServer(configPath, newName.trim(), newCommand.trim(), args, {});
      flash(`Added ${newName.trim()}`);
      setNewName(""); setNewCommand(""); setNewArgs(""); setAdding(false);
      await refresh();
    } catch (e) { setError(String(e)); }
  }, [newName, newCommand, newArgs, newScope, dir, refresh]);

  const handlePasteChange = useCallback((value: string) => {
    setPasteJson(value);
    if (!value.trim()) {
      setParsedServers([]);
      setParseError(null);
      return;
    }
    const { servers, error } = parseMcpJson(value);
    setParsedServers(servers);
    setParseError(error);
  }, []);

  const handleAddParsed = useCallback(async (scope: "global" | "project") => {
    if (parsedServers.length === 0) return;
    let homePath = "~";
    try { homePath = await getHomeDir(); } catch (e) { console.warn("Failed to get home dir:", e); }
    const configPath = scope === "project" && dir
      ? `${dir}/.claude/mcp.json`
      : `${homePath}/.claude/mcp.json`;
    try {
      for (const srv of parsedServers) {
        await addMcpServer(configPath, srv.name, srv.command, srv.args, srv.env, srv.url, srv.serverType, srv.headers);
      }
      const names = parsedServers.map((s) => s.name).join(", ");
      flash(`Added ${names} (${scope})`);
      setPasteJson("");
      setParsedServers([]);
      setParseError(null);
      setAdding(false);
      await refresh();
    } catch (e) { setError(String(e)); }
  }, [parsedServers, dir, refresh]);

  const filtered = useMemo(() => servers.filter((s) => {
    if (filter !== "all" && s.scope !== filter) return false;
    if (agentFilter !== "all" && s.agent !== agentFilter) return false;
    return true;
  }), [servers, filter, agentFilter]);

  // Group the (scope/agent-filtered) list by agent, ordered.
  const grouped = useMemo(() => {
    const byAgent: Record<string, McpServerConfig[]> = {};
    for (const s of filtered) {
      (byAgent[s.agent] ??= []).push(s);
    }
    const orderedAgents = [
      ...AGENT_ORDER.filter((a) => byAgent[a]),
      ...Object.keys(byAgent).filter((a) => !(AGENT_ORDER as string[]).includes(a)),
    ];
    return { byAgent, orderedAgents };
  }, [filtered]);

  const agentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of servers) counts[s.agent] = (counts[s.agent] ?? 0) + 1;
    return counts;
  }, [servers]);

  if (!mcpManagerOpen) return null;

  const globalCount = servers.filter((s) => s.scope === "global").length;
  const projectCount = servers.filter((s) => s.scope === "project").length;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", paddingTop: "40px" }}
      onClick={() => setMcpManagerOpen(false)}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="MCP Server Manager"
        style={{
          position: "relative", width: "620px", maxHeight: "600px", background: "var(--bg-secondary)",
          border: "1px solid var(--text-accent)", fontFamily: "var(--font-ui)", zIndex: 1,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#d500f9", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px" }}>
              MCP SERVERS
            </div>
            <div style={{ color: "var(--text-faint)", fontSize: "10px", marginTop: "2px" }}>
              {servers.length} server{servers.length !== 1 ? "s" : ""} configured
              {dir && (
                <span style={{ marginLeft: "8px" }}>
                  — {dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <button onClick={() => setShowPresets(!showPresets)} style={{
              background: showPresets ? "#d500f922" : "var(--bg-tertiary)", border: "1px solid var(--border-default)",
              color: showPresets ? "#d500f9" : "var(--text-muted)", fontSize: "10px", fontFamily: "var(--font-ui)",
              cursor: "pointer", padding: "4px 10px", fontWeight: "bold",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#d500f9"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
            >
              PRESETS
            </button>
            <button onClick={() => setAdding(!adding)} style={{
              background: adding ? "#d500f9" : "var(--bg-tertiary)", border: "1px solid #d500f9",
              color: adding ? "var(--bg-primary)" : "#d500f9", fontSize: "10px", fontFamily: "var(--font-ui)",
              cursor: "pointer", padding: "4px 10px", fontWeight: "bold",
            }}>
              {adding ? "CANCEL" : "+ ADD"}
            </button>
            <button onClick={() => setMcpManagerOpen(false)} style={{
              background: "none", border: "none", color: "var(--text-faint)", fontSize: "14px", cursor: "pointer",
              fontFamily: "var(--font-ui)", marginLeft: "8px",
            }}>x</button>
          </div>
        </div>

        {/* Feedback */}
        {error && <div style={{ padding: "6px 16px", background: "#ff3d0022", color: "var(--status-error)", fontSize: "10px" }}>{error}</div>}
        {success && <div style={{ padding: "6px 16px", background: "#00c85322", color: "var(--status-running)", fontSize: "10px" }}>{success}</div>}

        {/* Add form - tabbed: Paste JSON / Manual */}
        {adding && (
          <div style={{ borderBottom: "1px solid var(--border-default)" }}>
            {/* Tab switcher */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)" }}>
              <button onClick={() => setAddTab("paste")} style={{
                flex: 1, padding: "6px", background: addTab === "paste" ? "var(--bg-tertiary)" : "transparent",
                border: "none", borderBottom: addTab === "paste" ? "2px solid #d500f9" : "2px solid transparent",
                color: addTab === "paste" ? "#d500f9" : "var(--text-faint)", fontSize: "10px", fontFamily: "var(--font-ui)",
                cursor: "pointer", letterSpacing: "0.5px", fontWeight: "bold",
              }}>PASTE FROM DOCS</button>
              <button onClick={() => setAddTab("manual")} style={{
                flex: 1, padding: "6px", background: addTab === "manual" ? "var(--bg-tertiary)" : "transparent",
                border: "none", borderBottom: addTab === "manual" ? "2px solid #d500f9" : "2px solid transparent",
                color: addTab === "manual" ? "#d500f9" : "var(--text-faint)", fontSize: "10px", fontFamily: "var(--font-ui)",
                cursor: "pointer", letterSpacing: "0.5px", fontWeight: "bold",
              }}>MANUAL</button>
            </div>

            {addTab === "paste" ? (
              <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <textarea
                  value={pasteJson}
                  onChange={(e) => handlePasteChange(e.target.value)}
                  placeholder="Paste MCP server configuration JSON here..."
                  spellCheck={false}
                  style={{
                    background: "var(--bg-primary)",
                    border: `1px solid ${parseError ? "var(--status-error)" : parsedServers.length > 0 ? "var(--status-running)" : "var(--border-default)"}`,
                    color: "var(--text-primary)",
                    fontSize: "11px",
                    fontFamily: "var(--font-ui)",
                    padding: "8px",
                    outline: "none",
                    resize: "vertical",
                    minHeight: "80px",
                    maxHeight: "160px",
                  }}
                />
                {parseError && (
                  <div style={{ color: "var(--status-error)", fontSize: "10px" }}>{parseError}</div>
                )}
                {parsedServers.length > 0 && (
                  <div style={{
                    background: "#1a1a1a", border: "1px solid var(--status-running)", padding: "8px",
                    display: "flex", flexDirection: "column", gap: "4px",
                  }}>
                    <div style={{ color: "var(--status-running)", fontSize: "10px", fontWeight: "bold", letterSpacing: "0.5px" }}>
                      FOUND {parsedServers.length} SERVER{parsedServers.length > 1 ? "S" : ""}
                    </div>
                    {parsedServers.map((srv) => (
                      <div key={srv.name} style={{ color: "var(--text-primary)", fontSize: "10px" }}>
                        <span style={{ color: "#d500f9", fontWeight: "bold" }}>{srv.name}</span>
                        <span style={{ color: "var(--text-faint)" }}> — </span>
                        <span style={{ color: "var(--text-muted)" }}>{srv.url ? `HTTP: ${srv.url}` : `${srv.command} ${srv.args.join(" ")}`}</span>
                        {Object.keys(srv.env).length > 0 && (
                          <span style={{ color: "var(--status-waiting)", marginLeft: "6px", fontSize: "10px" }}>
                            [{Object.keys(srv.env).length} env var{Object.keys(srv.env).length > 1 ? "s" : ""}]
                          </span>
                        )}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                      <button onClick={() => handleAddParsed("global")} style={{
                        background: "#d500f9", border: "none", color: "var(--bg-primary)", fontSize: "10px",
                        fontFamily: "var(--font-ui)", cursor: "pointer", padding: "6px 12px", fontWeight: "bold",
                      }}>ADD TO GLOBAL</button>
                      {dir && (
                        <button onClick={() => handleAddParsed("project")} style={{
                          background: "var(--bg-tertiary)", border: "1px solid #d500f9", color: "#d500f9", fontSize: "10px",
                          fontFamily: "var(--font-ui)", cursor: "pointer", padding: "6px 12px", fontWeight: "bold",
                        }}>ADD TO PROJECT</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", gap: "4px" }}>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Server name"
                    style={{ flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 8px", outline: "none" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#d500f9")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                  />
                  <select value={newScope} onChange={(e) => setNewScope(e.target.value as "global" | "project")}
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "4px 8px" }}>
                    <option value="global">Global</option>
                    {dir && <option value="project">Project</option>}
                  </select>
                </div>
                <input value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="Command (e.g. npx, uvx, docker)"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 8px", outline: "none" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#d500f9")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                />
                <input value={newArgs} onChange={(e) => setNewArgs(e.target.value)} placeholder="Arguments (space-separated)"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)", fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 8px", outline: "none" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#d500f9")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                <button onClick={handleAdd} disabled={!newName.trim() || !newCommand.trim()} style={{
                  background: newName.trim() && newCommand.trim() ? "#d500f9" : "var(--border-default)", border: "none",
                  color: newName.trim() && newCommand.trim() ? "var(--bg-primary)" : "var(--text-faint)", fontSize: "10px",
                  fontFamily: "var(--font-ui)", cursor: newName.trim() && newCommand.trim() ? "pointer" : "default",
                  padding: "6px 12px", fontWeight: "bold", alignSelf: "flex-end",
                }}>ADD SERVER</button>
              </div>
            )}
          </div>
        )}

        {/* Popular presets */}
        {showPresets && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-default)" }}>
            <div style={{ color: "#d500f9", fontSize: "10px", letterSpacing: "1px", fontWeight: "bold", marginBottom: "6px" }}>
              POPULAR MCP SERVERS — CLICK TO INSTALL
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px" }}>
              {MCP_PRESETS.filter(p => !servers.some(s => s.name === p.name)).map((preset) => (
                <button
                  key={preset.name}
                  onClick={async () => {
                    let homePath = "~";
                    try { homePath = await getHomeDir(); } catch (e) { console.warn("Failed to get home dir:", e); }
                    const configPath = `${homePath}/.claude/mcp.json`;
                    try {
                      await addMcpServer(configPath, preset.name, preset.command, preset.args, {});
                      addToast(`Added ${preset.name}`, "success");
                      await refresh();
                    } catch (e) { addToast(`Failed: ${e}`, "error"); }
                  }}
                  style={{
                    background: "var(--bg-primary)", border: "1px solid var(--border-default)", color: "var(--text-primary)",
                    fontSize: "10px", fontFamily: "var(--font-ui)", cursor: "pointer",
                    padding: "6px 8px", textAlign: "left",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#d500f9"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
                >
                  <div style={{ fontWeight: "bold", color: "#d500f9" }}>{preset.name}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>{preset.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scope filter tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)" }}>
          {([
            { id: "all" as const, label: "All", count: servers.length },
            { id: "global" as const, label: "Global", count: globalCount },
            { id: "project" as const, label: "Project", count: projectCount },
          ]).map((t) => (
            <button key={t.id} onClick={() => setFilter(t.id)} style={{
              flex: 1, padding: "8px", background: filter === t.id ? "var(--bg-tertiary)" : "transparent",
              border: "none", borderBottom: filter === t.id ? "2px solid #d500f9" : "2px solid transparent",
              color: filter === t.id ? "#d500f9" : "var(--text-faint)", fontSize: "10px", fontFamily: "var(--font-ui)",
              cursor: "pointer", letterSpacing: "0.5px",
            }}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {/* Agent filter — only when servers span more than one agent */}
        {Object.keys(agentCounts).length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "8px 16px", borderBottom: "1px solid var(--border-default)" }}>
            <button onClick={() => setAgentFilter("all")} style={{
              background: agentFilter === "all" ? "#d500f922" : "var(--bg-tertiary)",
              border: `1px solid ${agentFilter === "all" ? "#d500f9" : "var(--border-default)"}`,
              color: agentFilter === "all" ? "#d500f9" : "var(--text-muted)", fontSize: "10px",
              fontFamily: "var(--font-ui)", cursor: "pointer", padding: "3px 9px", fontWeight: "bold",
            }}>All ({servers.length})</button>
            {[
              ...AGENT_ORDER.filter((a) => agentCounts[a]),
              ...Object.keys(agentCounts).filter((a) => !(AGENT_ORDER as string[]).includes(a)) as AgentKind[],
            ].map((a) => {
              const th = agentTheme(agentKindOf(a));
              const active = agentFilter === a;
              return (
                <button key={a} onClick={() => setAgentFilter(a)} style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  background: active ? `${th.color}22` : "var(--bg-tertiary)",
                  border: `1px solid ${active ? th.color : "var(--border-default)"}`,
                  color: active ? th.color : "var(--text-muted)", fontSize: "10px",
                  fontFamily: "var(--font-ui)", cursor: "pointer", padding: "3px 9px", fontWeight: "bold",
                }}>
                  {(() => { const Glyph = th.icon; return <Glyph size={14} weight={active ? "fill" : "regular"} color={th.color} style={{ flexShrink: 0 }} />; })()}
                  {th.label} ({agentCounts[a]})
                </button>
              );
            })}
          </div>
        )}

        {/* Server list — grouped by agent */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-faint)", fontSize: "11px" }}>
              No MCP servers configured
              {(filter !== "all" || agentFilter !== "all") && " in this view"}
            </div>
          ) : (
            grouped.orderedAgents.map((agent) => {
              const th = agentTheme(agentKindOf(agent));
              const list = grouped.byAgent[agent];
              return (
                <div key={agent}>
                  {/* Agent header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "7px", padding: "6px 16px",
                    background: "var(--bg-tertiary)", borderBottom: "1px solid var(--border-default)",
                    position: "sticky", top: 0, zIndex: 1,
                  }}>
                    {(() => { const Glyph = th.icon; return <Glyph size={14} weight="fill" color={th.color} style={{ flexShrink: 0 }} />; })()}
                    <span style={{ color: th.color, fontSize: "10px", fontWeight: "bold", letterSpacing: "1px" }}>{th.label.toUpperCase()}</span>
                    <span style={{ color: "var(--text-faint)", fontSize: "10px" }}>{list.length} server{list.length !== 1 ? "s" : ""}</span>
                    {!list[0].writable && (
                      <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: "9px", letterSpacing: "0.5px", border: "1px solid var(--border-default)", padding: "1px 5px" }}>
                        VIEW-ONLY (TOML)
                      </span>
                    )}
                  </div>

                  {list.map((srv) => (
                    <div
                      key={`${srv.agent}-${srv.scope}-${srv.name}`}
                      style={{
                        display: "flex", alignItems: "center", padding: "8px 16px", gap: "10px",
                        borderBottom: "1px solid var(--bg-tertiary)", opacity: srv.enabled ? 1 : 0.5,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a1a")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Toggle (or lock for view-only) */}
                      {srv.writable ? (
                        <button onClick={() => handleToggle(srv)} role="switch" aria-checked={srv.enabled}
                          aria-label={`Toggle ${srv.name}`} style={{
                          width: "28px", height: "14px", borderRadius: "7px", border: "none", cursor: "pointer",
                          background: srv.enabled ? "#d500f9" : "var(--border-default)", position: "relative", flexShrink: 0,
                        }}>
                          <div style={{
                            width: "10px", height: "10px", borderRadius: "50%", background: "var(--text-primary)",
                            position: "absolute", top: "2px", transition: "left 0.15s",
                            left: srv.enabled ? "16px" : "2px",
                          }} />
                        </button>
                      ) : (
                        <span title="View-only — this agent stores MCP servers in a TOML config" style={{
                          width: "28px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexShrink: 0,
                        }}><UI_ICON.lock size={13} weight="regular" /></span>
                      )}

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ color: "var(--text-primary)", fontSize: "11px", fontWeight: "bold" }}>{srv.name}</span>
                          <span style={{
                            fontSize: "10px", fontWeight: "bold", letterSpacing: "0.5px", padding: "1px 4px",
                            border: `1px solid ${srv.scope === "global" ? "#4a9eff66" : "#00c85366"}`,
                            color: srv.scope === "global" ? "var(--status-idle)" : "var(--status-running)",
                          }}>{srv.scope.toUpperCase()}</span>
                          <span style={{
                            fontSize: "10px", fontWeight: "bold", letterSpacing: "0.5px", padding: "1px 4px",
                            border: `1px solid ${srv.type === "http" ? "#ffab0066" : "#88888866"}`,
                            color: srv.type === "http" ? "var(--status-waiting)" : "var(--text-muted)",
                          }}>{srv.type === "http" ? "HTTP" : "STDIO"}</span>
                        </div>
                        <div style={{ color: "var(--text-faint)", fontSize: "10px", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {srv.type === "http" ? (srv.url ?? "http") : `${srv.command} ${srv.args.join(" ")}`}
                        </div>
                        <div style={{ color: "var(--border-strong)", fontSize: "9px", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tildify(srv.source_file)}
                        </div>
                      </div>

                      {/* Remove (writable agents only) */}
                      {srv.writable && (
                        <button onClick={() => handleRemove(srv)} style={{
                          background: "none", border: "1px solid #ff3d0044", color: "var(--status-error)", fontSize: "10px",
                          fontFamily: "var(--font-ui)", cursor: "pointer", padding: "2px 6px", flexShrink: 0,
                        }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--status-error)")}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#ff3d0044")}
                        >REMOVE</button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border-default)", color: "var(--border-strong)", fontSize: "10px" }}>
          Aggregated from Claude, Codex, Cursor, Gemini &amp; Grok configs. + ADD writes to Claude (~/.claude.json); Codex &amp; Grok are view-only (TOML).
        </div>
      </div>
    </div>
  );
});
