# Set up pstack for this repository

> Setup snapshot from the initial installation. Use [the local workflow](../../../../.agents/docs/pstack.md)
> for current agent instructions.

The repository vendors pstack skills under `.agents/skills/`. The complete catalog
includes design, implementation, investigation, review, parallel work, evaluation,
verification, maintenance, and writing workflows. List it with:

```sh
node scripts/pstack.mjs list
```

## Install and check

Initialize the workspace and install its locked dependencies:

```sh
git submodule update --init packages/design-system skills
pnpm install --frozen-lockfile
node scripts/pstack.mjs setup
node scripts/pstack.mjs doctor
```

Setup restores missing relative links. It refuses to replace an existing different
file or link. It does not install global plugins, modify global configuration,
authenticate a provider, or run product deployments.

The setup command is safe to repeat. Doctor checks every cataloged skill's
frontmatter and direct Markdown references, model roles, and discovery links.
It reports CLI presence separately from authentication and model availability.

## Use each harness

| Harness | Skills | Model configuration | Adapter |
| --- | --- | --- | --- |
| Cursor | `.cursor/skills` links to `.agents/skills` | `.cursor/rules/pstack-models.mdc` | Native pstack names |
| Codex | `.agents/skills` | `.codex/pstack-models.md`, loaded through `AGENTS.md` | `.agents/docs/harness/codex.md` |
| Claude Code | `.claude/skills` | `.claude/rules/pstack-models.md` | `.agents/docs/harness/claude-code.md` |

All model configuration paths resolve to `.agents/pstack/models.mdc`.
`CLAUDE.md` links to `AGENTS.md`. Local agent definitions are in `.agents/agents/`
and linked from `.cursor/agents/` and `.claude/agents/`.

Start a new session after setup. Invoke `poteto-mode` for the working style or
invoke a specific workflow such as `architect`, `arena`, `interrogate`, `swarm`,
`recall`, `reflect`, `technical-writing`, `eval-audit`, or the verification skills.
Read `.agents/README.md` and `.agents/docs/guide/` for the upstream guide.
The optional marketplace plugin uses its own namespaced commands; these local
skills use the unprefixed names.

The approved budget is `medium`. Regular work starts at high reasoning and panel
entries at medium. Claude models were confirmed by the user. GPT identifiers were
listed by the setup session's tool schema. The dated evidence and its limits are
in `.agents/pstack/availability.json`. This records preferences, not live
entitlements. Native Codex in the setup session could not execute Claude directly.
The adapters require an explicit fallback notice and forbid reporting a GPT-only
review as cross-vendor review.

## Verify behavior

See [verification results and limits](verification.md) for the setup run's evidence.

Use the generated `verify-wiki` and `verify-acl-boundaries` skills. Their commands,
coverage, evidence paths, and limits live in each `SKILL.md`. Keep their coverage
current with `maintain-verification-skill` and `maintain-formal-verification-skill`.
Browser verification uses Orca Browser as requested. The Wiki helper starts an
isolated test server and fixtures; the agent drives the browser through Orca.

## Provenance and scope

Existing skill implementations were retained. Missing support files came from
the installed upstream pstack Claude plugin version `0.15.42`. The source and
catalog are recorded in `.agents/pstack/manifest.json`. The upstream MIT license
is preserved in `.agents/LICENSE`. The repo-specific Codex adapter and overrides
are additions, not upstream claims.

Optional Cursor-only services and `cursor-team-kit` features are not installed by
this setup. Existing unrelated broken skill links are not repaired implicitly.
