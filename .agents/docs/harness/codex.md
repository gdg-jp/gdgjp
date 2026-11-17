# pstack in Codex

Read this file and `AGENTS.md` once per pstack session. Skills are canonical in
`.agents/skills/`, which Codex discovers directly. Read a routed skill's `SKILL.md`
even when the slash-command menu does not list it.

## Repository configuration

Read `.codex/pstack-models.md`, a link to `.agents/pstack/models.mdc`.
Repository choices override user-global pstack rules. `setup-pstack` updates that
canonical file, preserving the approved budget and role choices unless changed
by the user. Never write a global rule for a repo-local setup.

## Tools and models

| Cursor instruction | Codex action |
| --- | --- |
| `Task` | Use the session's subagent tool when available and authorized. |
| `poteto-agent` | Use a supported general worker and start its brief with the absolute `poteto-mode/worker.md` read instruction. Read `poteto-mode/SKILL.md` too. |
| `comment-sicko` | Read `.agents/agents/comment-sicko.md` and give its instructions to a supported reviewer. |
| `readonly` | State read-only ownership in the brief and check the diff afterward. |
| Cloud environment or worktree isolation | Use a separate local git worktree. Do not claim a Cursor cloud agent ran. |
| Todo list | Use the available plan tool, otherwise maintain the task's phase list in its work log. |
| `AskQuestion` | Use an available user-input tool only for missing decisions. Preserve earlier answers. |
| Cursor's built-in `create-skill` | Use the available `skill-creator` skill for project-local authoring, then validate its frontmatter, references, and executable helpers. |
| Transcript | Use only the active conversation's transcript if available. Otherwise audit tool evidence and disclose the missing transcript. |

Detect callable model identifiers from the live subagent tool schema. Pass model
and reasoning effort separately when the schema supports that. Never construct a
model slug by appending an effort suffix to a GPT identifier.

Native Codex subagents in the setup session support GPT models only. A configured
Claude model is a preference, not a claim that Codex can execute it. Report the
limitation, then follow the invoked skill's fallback and inherit the parent model
if no configured model is callable. Never count that fallback as a different
vendor. Skip a mandatory cross-vendor judgment with an explicit gap if there is
no supported way to run it. Do not start a nested external agent CLI solely to
pretend that the native tool supports another provider.

## Available workflows

Run `node scripts/pstack.mjs list` for the complete pstack and project-verification
catalog. Run `node scripts/pstack.mjs doctor` before diagnosing an installation.

Use `verify-platform` for local Accounts OIDC and Wiki authoring, search, and
authorization journeys. Use `verify-wiki` for the smaller reading fixture,
`verify-acl-boundaries` for bounded exhaustive authorization checks, and
`verify-job-lifecycle` for runner SQL, generation fencing, and mutation checks. Use
`maintain-verification-skill` and `maintain-formal-verification-skill` when their
coverage has drifted.

Browser verification uses Orca Browser. Read the `orca-cli` skill and fetch its
version-matched `references/browser.md` before operating a tab. Use existing
Playwright specs as behavioral references, not as the browser driver for this setup.

Cursor Automations, Bugbot startup, and Cursor cloud dashboards are unavailable
unless a tool explicitly exposes them. Report the skipped step and continue
independent work. `deslop`, `control-ui`, and `control-cli` are optional
`cursor-team-kit` capabilities, not bundled pstack dependencies. Use available
local checks and verification skills and report when the named tool did not run.
