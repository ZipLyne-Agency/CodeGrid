#!/usr/bin/env node
/**
 * CodeGrid Agent Bus — MCP stdio server.
 *
 * Lets one agent observe and message another agent's pane, natively, by talking
 * to CodeGrid's local JSON-RPC Unix socket (no tmux). Tools:
 *   - list_agents()                      → every pane CodeGrid is running
 *   - read_pane(session_id, max_bytes?)  → recent output of a pane (ANSI-stripped)
 *   - message_agent(session_id, text, submit?) → type into a pane (+Enter)
 *
 * Configure into an agent's MCP servers as:
 *   { "command": "node", "args": ["<abs>/agent-bus-mcp.cjs"] }
 */
"use strict";
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const SOCKET_PATH_FILE = path.join(HOME, ".codegrid", "socket-path");
const SOCKET_FALLBACK = path.join(HOME, ".codegrid", "socket");

// This server runs as a child of the agent CLI inside a CodeGrid pane, so it
// inherits the pane's identity from the environment. Sending the workspace id
// with every RPC lets CodeGrid scope the bus to a single workspace: an agent
// only sees and can only message other agents in its own workspace. Absent
// (e.g. a CLI launched outside CodeGrid) → unscoped, sees everything.
const SELF_WORKSPACE_ID = process.env.CODEGRID_WORKSPACE_ID || null;

function socketPath() {
  try {
    const p = fs.readFileSync(SOCKET_PATH_FILE, "utf8").trim();
    if (p) return p;
  } catch {}
  return SOCKET_FALLBACK;
}

// ---- CLI: `setup` (auto-configure agents) / `print-config` (show snippets) ----
const MODE = process.argv[2];
if (MODE === "setup" || MODE === "print-config" || MODE === "--help" || MODE === "-h") {
  runCli(MODE);
  process.exit(0);
}

/** One JSON-RPC round-trip over the CodeGrid Unix socket. */
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath());
    let buf = "";
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("CodeGrid RPC timeout")), 8000);
    sock.on("connect", () => {
      sock.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n");
    });
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        clearTimeout(timer);
        const line = buf.slice(0, nl);
        try {
          const msg = JSON.parse(line);
          if (msg.error) done(reject, new Error(msg.error.message || "RPC error"));
          else done(resolve, msg.result);
        } catch (e) {
          done(reject, e);
        }
      }
    });
    sock.on("error", (e) =>
      done(reject, new Error(`Can't reach CodeGrid (is the app running?): ${e.message}`)),
    );
  });
}

/* eslint-disable no-control-regex */
// Canonical ANSI/control-sequence stripper. Escape-based so it survives any encoding.
const ANSI = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])",
  "g",
);
function clean(s) {
  return (s || "").replace(ANSI, "").replace(/\r/g, "");
}

const TOOLS = [
  {
    name: "list_agents",
    description:
      "List every agent/pane CodeGrid is currently running, with its session_id, pane number, working dir, command, and status. Call this first to find who to talk to.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_pane",
    description:
      "Read the recent output of another agent's pane (ANSI-stripped). Use before messaging an agent so you know its state, and after, to read its reply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target pane's session_id (from list_agents)." },
        max_bytes: { type: "number", description: "How much tail to read (default 4000)." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "message_agent",
    description:
      "Send a message to another agent by typing it into that agent's pane. By default also presses Enter (submit) so the agent acts on it. Read the pane afterward to get the reply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target pane's session_id (from list_agents)." },
        text: { type: "string", description: "The message/prompt to deliver." },
        submit: { type: "boolean", description: "Press Enter after typing (default true)." },
      },
      required: ["session_id", "text"],
    },
  },
];

async function callTool(name, args) {
  args = args || {};
  if (name === "list_agents") {
    const r = await rpc("agent_list", { workspace_id: SELF_WORKSPACE_ID });
    const agents = (r && r.agents) || [];
    if (agents.length === 0) return "No agents are currently running in CodeGrid.";
    const lines = agents.map(
      (a) =>
        `• ${a.id}  [pane ${a.pane_number}]  ${a.status}  cmd=${(a.command || "").split("/").pop()}  dir=${a.working_dir}`,
    );
    return `Agents in CodeGrid:\n${lines.join("\n")}`;
  }
  if (name === "read_pane") {
    if (!args.session_id) throw new Error("session_id is required");
    const r = await rpc("agent_read", {
      session_id: args.session_id,
      max_bytes: args.max_bytes,
      workspace_id: SELF_WORKSPACE_ID,
    });
    const text = clean(r && r.output).trimEnd();
    const tail = text.split("\n").slice(-40).join("\n");
    return tail || "(no recent output)";
  }
  if (name === "message_agent") {
    if (!args.session_id) throw new Error("session_id is required");
    if (typeof args.text !== "string") throw new Error("text is required");
    await rpc("agent_send", {
      session_id: args.session_id,
      text: args.text,
      submit: args.submit !== false,
      workspace_id: SELF_WORKSPACE_ID,
    });
    return `Message delivered to ${args.session_id}. Use read_pane to see its reply.`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

/* ---- MCP stdio (newline-delimited JSON-RPC) ---- */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "codegrid-agent-bus", version: "0.1.0" },
      },
    });
    return;
  }
  if (method && method.startsWith("notifications/")) return; // no response to notifications
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    try {
      const text = await callTool(name, args);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true },
      });
    }
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

let inbuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inbuf += chunk;
  let nl;
  while ((nl = inbuf.indexOf("\n")) >= 0) {
    const line = inbuf.slice(0, nl).trim();
    inbuf = inbuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg).catch((e) => console.error("[agent-bus] handler error:", e));
  }
});
process.stdin.on("end", () => process.exit(0));

/* ------------------------------------------------------------------ */
/*  CLI: setup / print-config                                          */
/* ------------------------------------------------------------------ */
function runCli(mode) {
  const cp = require("child_process");
  const SELF = __filename; // self-locating: configs point at wherever this file lives
  const NAME = "codegrid-agent-bus";
  const entry = { command: "node", args: [SELF] };

  if (mode === "--help" || mode === "-h") {
    console.log(`CodeGrid Agent Bus
  node agent-bus-mcp.cjs            Run the MCP server (stdio) — used by agents
  node agent-bus-mcp.cjs setup      Auto-configure installed agents (Claude, Codex, Gemini, Cursor)
  node agent-bus-mcp.cjs print-config   Print config snippets to paste manually`);
    return;
  }

  const print = mode === "print-config";
  const backup = (f) => { try { if (fs.existsSync(f)) fs.copyFileSync(f, f + ".codegrid.bak"); } catch {} };

  // JSON agents that share the { mcpServers: { name: {command,args} } } shape.
  const jsonTargets = [
    { label: "Claude Code", file: path.join(HOME, ".claude.json") },
    { label: "Gemini CLI", file: path.join(HOME, ".gemini", "settings.json") },
    { label: "Cursor", file: path.join(HOME, ".cursor", "mcp.json") },
    { label: "Grok Build", file: path.join(HOME, ".grok", "settings.json") },
  ];

  if (print) {
    console.log(`# Paste into each agent's MCP config.\n`);
    console.log(`## Claude Code (~/.claude.json) · Gemini (~/.gemini/settings.json) · Cursor (~/.cursor/mcp.json) · Grok (~/.grok/settings.json)`);
    console.log(JSON.stringify({ mcpServers: { [NAME]: entry } }, null, 2));
    console.log(`\n## Codex  (~/.codex/config.toml)`);
    console.log(`[mcp_servers.${NAME}]\ncommand = "node"\nargs = ["${SELF}"]`);
    console.log(`\n## Or just run:  node "${SELF}" setup`);
    return;
  }

  console.log("Configuring CodeGrid Agent Bus into your agents...\n");

  for (const t of jsonTargets) {
    try {
      const dir = path.dirname(t.file);
      const detected = fs.existsSync(t.file) || fs.existsSync(dir);
      if (!detected) { console.log(`  – ${t.label}: not found, skipped`); continue; }
      let cfg = {};
      if (fs.existsSync(t.file)) cfg = JSON.parse(fs.readFileSync(t.file, "utf8"));
      else fs.mkdirSync(dir, { recursive: true });
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers[NAME] = entry;
      backup(t.file);
      fs.writeFileSync(t.file, JSON.stringify(cfg, null, 2));
      console.log(`  ✓ ${t.label}: ${t.file}`);
    } catch (e) {
      console.log(`  ✗ ${t.label}: ${e.message}`);
    }
  }

  // Codex — prefer its CLI, fall back to editing config.toml.
  try {
    cp.execSync(`codex mcp remove ${NAME}`, { stdio: "ignore" });
  } catch {}
  try {
    cp.execSync(`codex mcp add ${NAME} -- node ${JSON.stringify(SELF)}`, { stdio: "ignore" });
    console.log(`  ✓ Codex CLI: added via 'codex mcp add'`);
  } catch {
    try {
      const f = path.join(HOME, ".codex", "config.toml");
      if (fs.existsSync(path.dirname(f))) {
        backup(f);
        const block = `\n[mcp_servers.${NAME}]\ncommand = "node"\nargs = ["${SELF}"]\n`;
        const cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
        if (!cur.includes(`[mcp_servers.${NAME}]`)) fs.appendFileSync(f, block);
        console.log(`  ✓ Codex: ${f}`);
      } else {
        console.log(`  – Codex: not found, skipped`);
      }
    } catch (e) {
      console.log(`  ✗ Codex: ${e.message}`);
    }
  }

  console.log(`\nDone. Restart your agents (or open fresh CodeGrid panes) to load the tools.`);
  console.log(`Verify in an agent with:  /mcp   (look for "${NAME}")`);
}
