# Starter design harness

This is a runnable example of retrieval, static validation, and reviewed learning. Its profile page is a local prototype, not a production editor. The image example deliberately lacks alternative text to demonstrate a coverage gap.

## Authority and consumers

| Source | Consumer |
| --- | --- |
| `design/tokens.json` | `generate-tokens.mjs` → `generated/theme.css` → profile page |
| `design/catalog.json` | CLI, MCP resources, context resolver, checker, generated catalog |
| `.agents/skills/*/SKILL.md` | Task discovery and workflow; referenced by the scenario |
| `DESIGN.md` | Human and agent entrypoint, including the MCP entry resource |
| `feedback/*.json` | Review only; excluded from resources and context resolution |
| `design/catalog.json` adoption receipts | Evidence of applied decisions; never generated policy |

The executable checker supports only required attributes on static HTML elements. Its `mechanicalPassed` field does not approve appearance, interaction, meaningful alternative text, or task fit. This vocabulary is illustrative; replace it with verified project contracts when adopting the starter.

## First run

Create the working copy with the parent skill's `scripts/copy-starter.mjs`. It copies this template and the existing token generator into a new directory. Inside that directory, with Node.js 22 or newer:

```sh
npm ci
npm run design:generate
npm test
npm run design:catalog
npm run design:resolve -- scenario.profile-edit
npm run design:check -- examples/profile.html
npm run design:drift
```

`generated/catalog.md` includes the actual authoritative records, their resource URIs, and the contract revision. Do not edit it. Generation rebuilds derived files; `design:drift` only checks and never repairs them.

Open `examples/profile.html` in a browser after generation. Enter a name, save, and inspect the outcome. Empty input invokes native required-field validation. No backend or permanent storage is involved. The static command does not execute these actions; browser evidence is separate.

The check command exits 0 when its mechanical checks pass, 1 for an observed violation, and 2 for an execution/input error. It writes a JSON report to stdout even on exit 1. Manual rules stay `not-evaluated` until a reviewer has rendered evidence. No matching element is `not-applicable`, with an explanation.

The default check scenario is `scenario.profile-edit`. For another declared scenario, pass its ID after the HTML path, or use MCP's optional `scenarioId`. Only rules in that scenario's dependency context apply.

## MCP connection

To connect from a consumer project, pack this working copy after the first run and install the resulting tarball in that project:

```sh
# In the harness working copy
npm pack --pack-destination /absolute/output/directory
# In the consumer project root
npm install /absolute/output/directory/design-harness-starter-0.1.0.tgz
```

Configure its stdio client with command `npx`, argument `design-harness-mcp`, and the consumer project root as its working directory. The installed bin resolves its own contracts, independent of the client's source checkout. `npm run mcp:start` remains a source-checkout check; the client connection uses `npx design-harness-mcp`.

1. Start the server through your client's existing MCP configuration mechanism.
2. List resources and read `harness://design/design.entry`.
3. Call `resolve_design_context` with `{"scenarioId":"scenario.profile-edit"}` and read its returned resources.
4. Use `search_design` with `{"query":"button"}` for discovery.
5. Call `check_design` with the actual HTML in `source`. It uses the same checker as the CLI.

The server publishes one validated snapshot per process. Restart it after authority or Skill updates, then resolve again; the returned `contractRevision` identifies the snapshot. Unknown resources/IDs and invalid inputs are errors. There are no write or command-execution tools.

Update an adopted copy through the team's normal reviewed changes, install its locked dependencies, then run generation, tests, and drift checks before restarting MCP. Remove its client registration to disconnect; no global configuration is changed by these scripts.

## Build and review

Resolve the scenario, read only the relevant contracts and Skills, implement the states, check the actual HTML, and inspect its rendered behavior. Correct specific failures with at most two automatic correction attempts. Stop for unresolved intent or missing tooling, retaining the report. A clean static report still leaves `TASK-FIT` open.

Use `node cli.mjs check ...` when redirecting a report to a file; it emits JSON without task-runner banners. Reports bind both source and contract revisions. Keep images, commands, and contextual decisions with the relevant report in `runs/`.

## Learning walkthrough

Use a disposable copy: this exercise adds a rule to its authority. Record a real decision under the existing task authorization; the CLI records that decision but does not authenticate the reviewer or grant permission.

```sh
mkdir -p runs
node cli.mjs check examples/image.html > runs/image-before.json
npm run feedback -- propose examples/image-alt-proposal.json
```

Read `feedback/image-alt.json` and the referenced HTML/report. The previous check did not cover `img`; a zero mechanical exit did not prove accessibility. If the responsible reviewer accepts the proposed rule, record their name and reason:

```text
npm run feedback -- decide image-alt accepted "REVIEWER" "REASON"
npm run feedback -- apply image-alt
npm run design:drift
```

The drift command must now fail. Regenerate, restart MCP, resolve the scenario, and inspect the new `HTML-IMAGE-ALT` resource:

```sh
npm run design:generate
npm run design:drift
node cli.mjs check examples/image.html > runs/image-after.json
```

The last command must exit 1 with `HTML-IMAGE-ALT`. Add appropriate alternative text to the actual `img` element and rerun, saving `runs/image-corrected.json`. Check a second image case too: a decorative image may use `alt=""`, while omitting the attribute must fail. Human review decides whether the wording or decorative treatment is appropriate.

To reject a proposal, use `decide ID rejected REVIEWER REASON`; it remains in `feedback/` but cannot be applied or retrieved as design guidance. To reconsider, create a new proposal. If authority changed after proposal creation, recreate and review the proposal against the new revision. Do not edit the stored revision to bypass the check.

An applied rule and its decision receipt are saved together in one atomic catalog write. Reapplying the same accepted proposal is a no-op. Local maintenance is serialized with `.feedback.lock`; after a crash, confirm no maintenance process is running before removing a leftover lock. Use normal Git review to coordinate different machines.

Decisions bind the reviewed proposal digest, and evidence files are hashed when proposing. Changes to either before application are rejected. Preserve evidence snapshots in `runs/` when the original artifact will be edited. This detects changed review inputs; it is not a protection against someone deliberately rewriting local records.

The starter demonstrates adding a supported rule. Changes to component guidance, patterns, Skill references, or requirements follow the same proposal/review/reverification procedure through a normal reviewed diff; they are not forced into a rule or automated by this CLI.
