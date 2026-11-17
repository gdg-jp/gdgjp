# Repository pstack workflow

Paths below are relative to the repository root. Read this before using a pstack skill.

Before using a pstack skill, read `.codex/pstack-models.md` for this repository's
role-to-model choices and reasoning budget. This takes precedence over pstack's
user-global model configuration and skill defaults. Claude Code loads the same
configuration from `.claude/rules/pstack-models.md`; both files link to
`.agents/pstack/models.mdc`, which is the single source of truth.
Cursor reads it through `.cursor/rules/pstack-models.mdc`.

Model identifiers are harness-specific. Use a configured model only when the current
harness supports it, and pass reasoning effort separately when required. Do not pass
Cursor Claude slugs to Codex's native subagent tool. If a configured model is unavailable,
report the limitation and follow the invoked skill's supported fallback; do not claim
that the configured model ran. Preserve vendor diversity when a skill requires it.

Read `.agents/docs/harness/codex.md` in Codex or
`.agents/docs/harness/claude-code.md` in Claude Code once per pstack session.
The local `setup-pstack` target is `.agents/pstack/models.mdc`; do not write a
user-global configuration unless explicitly requested. Skills live in `.agents/skills/`.
Run `node scripts/pstack.mjs doctor` to check the installation, and
`node scripts/pstack.mjs setup` to restore missing discovery links.
