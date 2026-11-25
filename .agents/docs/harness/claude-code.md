# pstack in Claude Code

pstack skills use Cursor names. In Claude Code, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the folder that holds `skills/` and `docs/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Tools

| Cursor | Claude Code |
| --- | --- |
| `Task` | `Agent` |
| `AskQuestion` | `AskUserQuestion`. In `-p` mode it is absent, so ask in plain text. |
| Open a todolist, or copy steps into the todolist tool | Use `TodoWrite` if the session offers it. Otherwise keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | `Read` `<pstack>/skills/<name>/SKILL.md` and follow it. The `Skill` tool refuses most pstack skills. Use `/name` for repository-local skills. Only marketplace plugin commands use `/pstack:<name>`. |
| `Grep`, `Glob` | `Bash` with `rg` when the session has no `Grep` or `Glob`. |

## Subagent fields

| Cursor | Claude Code |
| --- | --- |
| `subagent_type: generalPurpose` | `subagent_type: "general-purpose"` |
| `poteto-agent`, `comment-sicko` | `poteto-agent`, `comment-sicko` |
| `readonly: true` | `subagent_type: "Explore"`. It keeps `Bash`, so the brief also says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | `general-purpose`. It keeps the session's MCP servers. |
| `environment: "cloud"` | `isolation: "worktree"`. Name the branch or commit the worker checks out. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit. Subagents run in the background by default and notify you when they finish. |
| `resume` | Spawn a new agent and paste the earlier result into its brief. |
| `file_attachments` | List the paths in the brief. |

## Models

| Cursor | Claude Code |
| --- | --- |
| `claude-opus-<version>-<effort>[-fast]` | `model: "opus"` and the listed `effort`. Drop `-fast`. |
| `claude-fable-<version>-<effort>` | `model: "fable"` and the listed `effort`. |
| `claude-sonnet-<version>-<effort>` or `claude-haiku-<version>-<effort>` | Use the corresponding `sonnet` or `haiku` alias and listed `effort`, only when the live tool schema supports them. |
| A `gemini-*` or other non-Claude slug | Omit `model` so the agent runs on the session model, and say so. |
| `auto` or `inherit-parent` | Omit `model`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `.claude/rules/pstack-models.md`, linked to `.agents/pstack/models.mdc`. Read the repository rule before considering a user-global file. If a role is missing, use the skill default. |
| A role value `<model> <effort>`, such as `opus high` | `model: "opus"` and `effort: "high"`. |

## setup-pstack

Use `.agents/pstack/models.mdc` as the repository-local target. Preserve its YAML
frontmatter, including `alwaysApply: true`, its `# defaults: 3` marker, and its role labels.
Keep portable Cursor-style Claude slugs in this shared file. Translate them into
Claude's supported model and effort fields only when spawning an agent.
Do not write `opus high` values into the shared file or overwrite a user-global rule.

Detect available models from the live `Agent` schema. Preserve previously approved
choices and budget on a rerun unless the user changes them. Record newly confirmed
identifiers and their evidence in `.agents/pstack/availability.json` before running
doctor. That file is a dated setup record, not live model entitlement detection.

## Paths

| Cursor | Claude Code |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.claude/skills/`, `~/.claude/skills/` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `~/.claude/plugins/`, `.claude-plugin/plugin.json` |
| `.cursor/rules/*.mdc`, always-applied rules | `CLAUDE.md`, or `AGENTS.md` when no `CLAUDE.md` exists. Claude Code never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. The plugin ships the skills, `docs/guide/`, and `README.md`. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.claude/projects/<slug>/<session>.jsonl`. The slug is the workspace path with each `/` and `.` changed to `-`, so `/Users/you/proj` is `-Users-you-proj`. The newest `.jsonl` directly in that folder is the current session. Its `<session>/subagents/` folder holds subagent transcripts. Read only this workspace's folder. |

## Cursor-only features

Claude Code has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Claude Code: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Claude Code |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |

## Repository overrides

Read `AGENTS.md` and `.agents/pstack/models.mdc` before invoking pstack here.
Repository model choices override user-global files and skill defaults. `/setup-pstack`
updates `.agents/pstack/models.mdc`, preserving the existing medium budget unless
requested otherwise. `.claude/rules/pstack-models.md` links to that same file.
Use the local unprefixed skill names and agent definitions in `.claude/skills/`
and `.claude/agents/`. The marketplace plugin is optional for these workflows.
Do not claim a cross-vendor judge ran when an unsupported model fell back to Claude.

Browser verification uses Orca Browser. Load the `orca-cli` skill and its
version-matched browser reference. `verify-wiki` starts the isolated local server;
drive its user journeys through Orca rather than launching Playwright browsers.
