<div align="center">

<img src="icons/icon.png" alt="CodeGrid" width="96" />

# CodeGrid

**The workspace for orchestrating AI coding agents.**

Run Claude, Codex, Gemini, Cursor, Grok, Venice/aider, and shells side by side on a free-form 2D canvas — and let them **talk to each other**. One agent can hand a task to another, read its reply, and keep going. Native, local, no tmux.

[![Download](https://img.shields.io/github/v/release/ZipLyne-Agency/CodeGrid?label=Download&color=ff8c00&style=for-the-badge)](https://github.com/ZipLyne-Agency/CodeGrid/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/macOS-Apple_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/ZipLyne-Agency/CodeGrid/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)

[**Download for macOS →**](https://github.com/ZipLyne-Agency/CodeGrid/releases/latest) · [Docs](https://codegrid.app/docs) · [Agent Bus](https://codegrid.app/agent-bus) · [Website](https://codegrid.app)

</div>

---

## The Problem

If you run AI coding agents seriously, you're juggling several at once across multiple repos. Terminal tabs and tmux panes don't scale — you lose track of which agent is waiting, which one errored, and which one needs your input. And they can't easily work *together*.

## The Solution

CodeGrid gives every agent its own pane on a **single infinite 2D canvas**. See everything at once, broadcast one prompt to all of them, get a native notification the moment one needs you — and with the **Agent Bus**, let one agent delegate to, review, or coordinate with another.

The current Apple Silicon download is about **12 MB**. CodeGrid is built with Tauri, not Electron, and keeps workspace state on your Mac. Optional OpenAI features store your key in macOS Keychain; Venice keys are held only for the active session.

---

## Features

### 🤖 Multiple Agents, One Workspace
Run **Claude Code, Codex, Gemini, Cursor, Grok, Venice/aider**, and plain shells side by side. Agent CLIs are not bundled; CodeGrid launches the tools already installed on your machine.

### ⇄ Agent Bus — agents that talk to each other
The headline feature. A built-in MCP server (`list_agents`, `read_pane`, `message_agent`) lets one agent **message and read another's pane** — Claude hands a task to Codex, reads its reply, and keeps going. Native and local, **no tmux**. One click in onboarding sets it up for every agent. → [Learn more](https://codegrid.app/agent-bus) · [Docs](https://codegrid.app/docs/agent-bus)

### 🔔 Attention & Notifications
Native macOS notifications when an agent finishes, errors, or needs your input. A global attention bar shows the whole fleet at a glance; `Cmd+Shift+A` jumps to the next agent that needs you. Dock badge + menu-bar (tray) status included.

### 🗂 2D Canvas Layout
Arrange agent panes freely — drag to reposition, resize from any edge, zoom, and pan. Instant **AUTO / FOCUS / COLS / ROWS / GRID / FIT** layouts tile everything in a click.

### 📡 Broadcast Mode
`Cmd+B` — type once, send to every pane simultaneously. Run the same prompt or command across all your agents in one keystroke.

### 🍎 Native Mac app
Full menu bar, menu-bar (tray) extra, `codegrid://` deep links, a first-run onboarding, and signed auto-updates from inside the app.

### 👁 Activity Detection
Status indicators on every pane (running / waiting / idle / error), visible even when zoomed out. You know what every agent is doing at a glance.

### 💾 Session Persistence
Close the app, reopen it — sessions come back exactly where you left them. Same directories, same layout, same names.

### 🌿 Full Git Manager
Stage, commit, push, pull, branch, stash, and view diffs — all from the sidebar. No context switching.

### 🗃 File Explorer
Browse files with git status indicators. Create, rename, move, delete, drag-and-drop. Right-click context menu.

### ✏️ Code Editor
Click any file to open it in the built-in editor with syntax highlighting. Always editable.

### 🕸 Dependency Graph
Interactive force-directed graph showing how your files connect. Supports TypeScript, JavaScript, Python, and Rust.

### ⌨️ Command Palette
`Cmd+K` — switch workspaces, open folders, focus sessions, run git commands. Everything in one search box.

### 🗄 Multiple Workspaces
Separate workspaces per project. Each has its own layout, sessions, and git context. Auto-named after the folder.

### 🔌 MCP Server Manager
Add, toggle, and configure Claude MCP servers from the sidebar. No config files to edit manually.

### 🔗 External Control API
Control CodeGrid from scripts, Alfred workflows, or IDE extensions via a local Unix socket — the same socket that powers the Agent Bus (`agent_list`, `agent_read`, `agent_send`).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New session |
| `Cmd+W` | Close session |
| `Cmd+K` | Command palette |
| `Cmd+B` | Broadcast to all |
| `Cmd+Shift+A` | Go to next agent needing attention |
| `Cmd+Enter` | Maximize / restore pane |
| `Cmd+1–9` | Jump to pane |
| `Cmd+Arrow` | Navigate between panes |
| `Cmd+S` | Toggle sidebar |
| `Cmd+Tab` | Switch workspace |
| `Cmd+Shift+N` | New workspace |
| `Cmd+F` | Search in terminal |
| `Cmd+,` | Settings |

---

## Requirements

- macOS 13 Ventura or later
- Apple Silicon (M1 / M2 / M3 / M4)
- At least one agent CLI on your `PATH` — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [Cursor](https://cursor.com/docs/cli). CodeGrid launches them; it doesn't bundle them.
- Node.js 20+ (for source builds and the Agent Bus)

---

## Building from Source

```bash
# Install prerequisites
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
fnm install 22   # or: nvm install 22

# Clone and run
git clone https://github.com/ZipLyne-Agency/CodeGrid.git
cd CodeGrid
npm ci
npm run tauri dev
```

### Production build

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

### Verification

```bash
npm ci && npm run build && npm audit
(cd landing && npm ci && npm test && npm run build && npm audit)
(cd src-tauri && cargo fmt --check && cargo check --locked && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked)
```

The three archived staking-era Workers under `staking/services/` also have `npm run typecheck` scripts. They are retained as historical source and are not required by the free desktop app.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript |
| Terminal renderer | xterm.js 5 (WebGL) |
| State management | Zustand 5 |
| Styling | Tailwind CSS v4 |
| PTY | portable-pty |
| Local database | SQLite (rusqlite) |

---

## Architecture

```
Tauri (Rust)                    Webview (React)
├── PTY Manager          <IPC>  ├── Canvas Layout Engine
├── Process Pool         <───>  ├── xterm.js Instances
├── Session Store                ├── Workspace Manager
├── SQLite DB                    ├── Status Indicators
├── Shell Detector               ├── Command Palette
└── Worktree Manager             └── Keyboard Nav Layer
```

---

## Trust & security

CodeGrid is **local-first** with no ZipLyne telemetry, account, or license keys. Release
builds are **code-signed with an Apple Developer ID and notarized by Apple**, and the entire source is
here under MIT so anything we claim is verifiable.

Workspace data stays local. User-triggered AI review, commit-message, terminal-summary, and voice features send the relevant content directly to OpenAI using the key you provide; CodeGrid does not proxy it through ZipLyne servers. GitHub credentials use your configured secure Git credential helper.

- 🔒 [Security](https://codegrid.app/security) — data handling, signing, filesystem boundaries, secrets
- 🤖 [Responsible AI](https://codegrid.app/responsible-ai) — CodeGrid orchestrates third-party agents; it trains nothing and stores no prompts
- 🛡 Report a vulnerability: [`SECURITY.md`](SECURITY.md) / admin@codegrid.dev
- 🔐 [Privacy](https://codegrid.app/privacy) · [Terms](https://codegrid.app/terms)

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) and our
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT — free to use, fork, and build on. See [`LICENSE`](LICENSE).

---

<div align="center">

A product of **ZipLyne LLC** — a Wyoming company. · [codegrid.app](https://codegrid.app) · [About](https://codegrid.app/about) · [Founder](https://codegrid.app/founder)

</div>
