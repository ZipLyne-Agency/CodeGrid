# Contributing to CodeGrid

Thanks for your interest in CodeGrid! Contributions — bug reports, fixes, features, and docs — are
welcome. This is an open-source project by ZipLyne LLC, MIT-licensed.

## Ground rules

- Be respectful — see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- For security issues, **do not** open a public issue — follow [`SECURITY.md`](SECURITY.md).
- For anything non-trivial, open an issue first so we can align before you build.

## Development setup

Requirements: macOS (Apple Silicon), [Rust](https://rustup.rs), Node.js 20+, and the agent CLIs you
want to test (`claude`, `codex`, `gemini`, `cursor-agent`).

```bash
# Frontend deps
npm install

# Run the app in dev (Tauri + Vite)
npm run tauri dev
```

Useful checks before opening a PR:

```bash
npm run build                      # typecheck + frontend build
(cd src-tauri && cargo check)      # Rust typecheck
(cd src-tauri && cargo clippy)     # Rust lints (keep it warning-free)
```

## Pull requests

1. Fork and create a branch from `main`.
2. Keep changes focused; match the surrounding code style.
3. Make sure the checks above pass (TypeScript, `cargo check`, `clippy` all clean).
4. Describe what changed and why; link any related issue.
5. By contributing, you agree your contributions are licensed under the MIT License.

## Project layout

- `src/` — React + TypeScript frontend (canvas, terminals, Git UI, panels).
- `src-tauri/` — Rust backend (PTY manager, Git/GitHub, filesystem, SQLite, IPC).
- `landing/` — the marketing site (Next.js).

Thanks for helping make CodeGrid better.
