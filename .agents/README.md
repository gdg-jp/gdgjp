# Agents in this repository

Start with [repository instructions](../AGENTS.md) and the relevant application's
local instructions. The [application map](../docs/applications.md) identifies owners
and services.

## Use the installed skills

Read [the local pstack workflow](docs/pstack.md) before invoking a pstack skill.
It selects the harness adapter and repository model configuration.

Run these commands from the repository root:

```sh
node scripts/pstack.mjs doctor
node scripts/pstack.mjs list
```

Use `node scripts/pstack.mjs setup` to restore missing discovery links. It preserves
existing conflicting files and reports them rather than overwriting them.

Canonical skills live in `.agents/skills/`. Cursor and Claude discover them through
links; Codex reads this directory directly. Edit the canonical source. Model choices
live in `.agents/pstack/models.mdc`. The availability record is installation metadata,
not proof that the current harness can execute a model.

The [manifest](../.agents/pstack/manifest.json) records the vendored pstack source and version.
This checkout contains local adaptations. Do not replace them with a global plugin
installation or run generation commands from the upstream plugin repository here.
The [upstream guide](docs/guide/README.md) supplies examples; local workflow and
harness instructions determine executable commands in this repository.

## Verify the work

Use the [verification reference](../docs/engineering/verification.md) to choose
automated checks and runtime journeys. Report executed checks and missing coverage.
A skill installation check does not establish application behavior.

The [engineering changes](../docs/engineering/README.md) explain the source material,
the confirmed defects, and the work still needed.
