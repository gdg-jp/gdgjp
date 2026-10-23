# Agent access, Skills, and distribution

Use this to connect authoritative design knowledge to the agent that needs it. The central flow is:

```text
authoritative contracts -> catalog + dependency resolver -> task Skill -> artifact
                       -> human reference views
artifact -> shared checker <- CLI / MCP / supported hook / CI
report -> proposal -> reviewed authority update -> regenerated views -> next task
```

## Build one catalog from authority

Give each retrievable contract a stable ID, kind, description, location, and references. Resolve the scenario's dependencies transitively, deduplicate them, and include the relevant task Skills. Unknown IDs, missing Skills, broken references, and unsupported detector declarations must fail; returning a partial contract as complete leaves the producer unaware of the gap.

The entrypoint owns the authority map and workflow. Detailed values stay in tokens/contracts; explanatory prose owns rationale. Generate human reference tables and machine resources from those same records. A generated file must have a named producer, consumer, and non-mutating freshness command. Do not manually copy values into MCP handlers or Skill instructions.

Keep the resolver independent of its transport so the CLI and MCP return the same selections. A small in-memory index of local files is enough for a small catalog. The sample's single catalog file represents component, pattern, and scenario responsibilities; a target can retain its existing file layout and schema.

## Expose MCP retrieval and checks

Reuse an existing MCP server when it fits the target. For a new local integration, stdio avoids adding a hosted service. Use a supported SDK rather than implementing the protocol. Pin the tested dependency versions and transport/client compatibility in the project; do not assume that using a newer SDK proves a particular protocol negotiation path.

| Surface | Input | Output / behavior |
| --- | --- | --- |
| Resources | A listed resource URI | Entrypoint, tokens, component/pattern/scenario contracts, rules, or a task Skill; never arbitrary filesystem reads |
| Search | Nonempty query | Bounded ID/title/description matches with an explicit truncation indicator |
| Context resolver | Existing scenario ID | Required resources, Skill entrypoints, and a contract revision |
| Design check | Actual supported artifact source; applicable scenario | Rule findings, evidence identity, mechanical status, and coverage/limits |

For the starter, the tools are `search_design({query})`, `resolve_design_context({scenarioId})`, and `check_design({source, scenarioId?})`. Omitted check scope means the sample `scenario.profile-edit`. The CLI takes the equivalent optional scenario after the HTML path. Scope selection controls which rules run; a lesson for one scenario must not silently become global policy.

Tool descriptions should explain when to call, accepted IDs/formats, result meaning, and errors. Resource discovery must return only readable resources. Reject unknown resources and invalid inputs. Use published IDs, not caller-supplied filesystem paths or shell commands. Do not trim or rewrite artifact bytes before computing their identity.

Report coverage honestly: a static detector may inspect an attribute without validating its semantics, runtime behavior, or layout. A rule with no matching element is inapplicable to that source; an unavailable check remains unevaluated. Share result logic and error/exit meaning with the CLI rather than translating an error into an empty violation list.

Define update behavior. The starter serves a validated snapshot per process, returns `contractRevision`, and requires restart after authority changes. A target with live reload should prove that reads, resolution, and checking use the same revision; merely re-reading one file is insufficient.

## Create Agent Skills for actual tasks

An agent entrypoint is an index, a Skill is an executable workflow, and a reference holds topic detail. Build/reuse these roles without prescribing a folder per design concept:

| Role | Trigger / inputs | Work and output |
| --- | --- | --- |
| Build | New or revised artifact; brief and scenario | Resolve relevant knowledge, implement required states, run checks, render, correct, and report evidence |
| Review | Existing artifact and scenario | Inspect the actual revision; report mechanical violations, contextual findings, and unevaluated items separately |
| Improve | Repeated correction, new pattern, knowledge/code mismatch | Produce a scoped proposal, retain its decision, update accepted authority, and prove next-task consumption |

Use valid `name` and `description` frontmatter. Include the input source, precise reading path, working directory, command, result destination, and stopping conditions. The starter supplies three real Skills under `.agents/skills/`, linked from `AGENTS.md` and the scenario. For another client, use its established discovery location without copying authority into client-specific instructions.

Create topic references when the target actually needs them: component APIs, UX writing, domain statuses, translation conventions, accessibility, or edge cases. Provide approved/rejected examples and their context. A product's label grammar or a library's API is not a universal policy. Read those references when the task requires them, not on every invocation.

Verify invocation with a realistic task: discover the Skill, resolve its inputs, follow its commands, inspect its output, and run a fresh task after a reference update. A frontmatter validator alone does not establish that an agent used the workflow. Record whether the evidence comes from a deterministic test, an operator walkthrough, or an actual agent run.

## Run the bundled starter

From the repository containing this skill, choose a destination that does not exist (its parent must exist):

```sh
node build-design-harness/scripts/copy-starter.mjs /tmp/my-design-harness
cd /tmp/my-design-harness
npm ci
npm run design:generate
npm test
npm run design:resolve -- scenario.profile-edit
npm run design:check -- examples/profile.html
npm run design:drift
```

The copier includes the existing [token generator](../assets/token-pipeline/generate-tokens.mjs) as `generate-tokens.mjs` in the destination. It refuses existing destinations. No dependency installation or global client configuration is performed by the copier.

The starter's [DESIGN.md](../assets/harness-starter/DESIGN.md) is the complete operator guide: setup, MCP connection, exact commands, report semantics, learning walkthrough, and update/removal. The [tests](../assets/harness-starter/test.mjs) exercise subprocess stdio, not only direct handler calls. The test suite makes disposable workspaces; its accepted decisions are explicitly simulated test inputs, not stakeholder approvals.

The runtime requires Node.js 22+. Its dependencies are the official MCP server SDK, a schema library, and an HTML parser; the MCP client is a test dependency. The sample detects required attributes on tag selectors. It does not evaluate CSS, JSX, browser interactions, complete accessibility, or visual quality. Keep the target's browser and native-media verification in the [verification workflow](verification.md).

## Install, update, and remove

Provide the exact server executable/arguments, working directory, Skill discovery location, dependencies, and smoke-test command. For a package consumed by another project, expose a named `bin` with a Node shebang and have the consumer install that package. Configure the stdio client to run `npx <bin-name>` from the consumer project root; only protocol messages may reach stdout. Verify the installed package through a real stdio client, not just a source-file invocation. Merge with existing client settings instead of replacing them. Prove connection in the selected client when client installation is part of the requested work; the starter test itself does not modify a user's global configuration.

For shared or vendored packages, record the contract/API version, upstream origin, pinned revision, local modifications, and license. Keep upstream URLs in the target's provenance file. Update in one reviewed change and run consumer checks against the resolved version. Compatibility checks should cover removed IDs, required states, allowed variants, rule strengths, MCP tool/schema/resource contracts, and Skill paths that consumers actually use. Use a real consumer fixture, not two declarations that repeat the same list.

Removal disconnects the MCP registration and removes only the installed Skill pointers/managed files. Preserve authored contracts and the project's unrelated settings. A single project does not need a registry, package publishing, or synchronization service to follow this procedure.
