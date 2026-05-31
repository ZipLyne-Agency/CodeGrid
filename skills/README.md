# CodeGrid agent skills

Drop-in skills that teach AI coding agents how to use CodeGrid and how to
collaborate with each other through it. Each is a self-contained `SKILL.md`
(YAML frontmatter + body) — compatible with Claude Code skills, `AGENTS.md`
context, and skill directories like Bankr's.

| Skill | Use it when |
|-------|-------------|
| [`using-codegrid`](./using-codegrid/SKILL.md) | An agent needs to operate CodeGrid — discover/spawn/list panes, read or message other agents, open projects, or drive the workspace via the local control socket or `codegrid://` deep links. |
| [`codegrid-agent-bus`](./codegrid-agent-bus/SKILL.md) | An agent needs to collaborate with another agent — delegate, review, run a pipeline, fan out work, or get a second opinion. The deep read→message→read protocol, patterns, etiquette, and failure recovery. |

## Install

- **Claude Code:** copy a skill folder into `~/.claude/skills/`, or reference it
  from your project's `CLAUDE.md`.
- **Other agents / `AGENTS.md`:** paste the `SKILL.md` body into the agent's
  instruction file.
- **Inside CodeGrid:** enable the Agent Bus (onboarding → "Enable collaboration")
  so the `list_agents` / `read_pane` / `message_agent` tools these skills
  reference are actually available. See <https://codegrid.app/docs/agent-bus>.

Both skills assume the CodeGrid app is running (the bus and control socket are
local, same-machine IPC).
