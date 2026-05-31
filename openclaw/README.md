# OpenClaw bundle — `codegrid/`

This directory is a published copy of CodeGrid's agent skills, packaged in the
layout BankrBot's [`openclaw-skills`](https://github.com/BankrBot/skills)
registry expects (`provider/SKILL.md` + optional `references/`).

**Source of truth lives in `../skills/`.** This bundle is regenerated from it.
Do not hand-edit the reference files here.

## Sync from `skills/` → `openclaw/codegrid/references/`

```bash
cp skills/using-codegrid/SKILL.md    openclaw/codegrid/references/using-codegrid.md
cp skills/codegrid-agent-bus/SKILL.md openclaw/codegrid/references/codegrid-agent-bus.md
```

Then update `openclaw/codegrid/SKILL.md` (the umbrella) only if the surface area
changed — new tools, new methods, new differentiator. Bump
`metadata.version` when the umbrella itself changes.

## How to install (for users)

Either point OpenClaw at this repo URL directly, or — once the PR to
`BankrBot/skills` is merged — install the `codegrid` skill from the
registry by name:

```text
install the codegrid skill from https://github.com/BankrBot/skills
```

## How to contribute upstream

1. Fork `BankrBot/skills`.
2. Copy this `openclaw/codegrid/` directory into the fork's expected provider
   location.
3. Open a PR with a usage example (e.g. *"install the codegrid skill, then ask
   your agent to `list_agents` and message another pane"*).
