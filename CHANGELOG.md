# Changelog

All notable changes to CodeGrid are documented here.

## [0.1.0] — 2026-03-20

Initial public release.

### Added
- Free-form 2D grid canvas for managing multiple terminal sessions simultaneously
- Broadcast mode — type to all panes at once
- Workspace system — save, switch, and restore named layouts
- Full Git manager with file staging, commit, push/pull, branch create/switch/delete
- Git worktree isolation — each session gets its own worktree to avoid conflicts
- MCP server management — list, add, toggle, and remove Claude MCP servers
- GitHub integration — device flow auth, repo search, one-click clone
- Command palette (Cmd+K) with fuzzy search across sessions, workspaces, and actions
- Session naming, renaming, and activity detection (detects Claude, Git, and shell states)
- File tree and code viewer panel
- Project search
- License system — 14-day trial (9 panes), licensed tier (unlimited panes)
- Trial banner showing days remaining with upgrade prompt
- macOS native via Tauri v2 (~10MB binary)
- Signed and notarized for macOS — no Gatekeeper warnings
