---
name: verify-job-lifecycle
description: Verify Wiki runner lease generations, retries, clone exclusion, and payload conservation against production SQL. Use after changes to Wiki jobs, runner HTTP contracts, the Go runner clients, or their database constraints.
---

# Verify job lifecycle

Keep stale runners from finishing another runner's job or discarding acknowledged work.
Execute the real TypeScript and SQL against SQLite with an independent bounded state machine.

## Run

Install this workspace's locked pnpm dependencies first. Use Node 22.18 or newer and Go
with race detector support. The versions confirmed during creation are Node 26.3.1,
pnpm 9.15.0, Vitest 4.1.10, and Go 1.25.5 on macOS arm64.

Run from the repository root:

```sh
node .agents/skills/verify-job-lifecycle/scripts/verify.mjs
node .agents/skills/verify-job-lifecycle/scripts/verify.mjs --mutation-proof
```

The helper creates a disposable source snapshot with linked installed dependencies.
It runs the focused Wiki tests and both Go runner packages with `-race -count=1`.
The mutation command also changes ten production expressions in that snapshot,
requires a failed assertion in each named property, restores every file, and reruns
the unmodified baseline. Missing tests and import failures do not count as detections.

Read the `job-lifecycle-result` JSON path printed by the command. Logs and JSON reports
remain under `local_data/pstack/job-lifecycle/` after the snapshot is removed.
Report the command's actual result and the recorded bounds.

## Interpret the result

- Exit 0 means the covered source is current and every requested check passed.
- Exit 1 means a property, mutation detection, tool operation, or cleanup failed.
- Exit 2 means covered source changed. No baseline or mutation is accepted before review.

Read [the properties and statechart](references/properties.md) for counterexamples,
atomicity assumptions, and exclusions. Use each failed test's command sequence and
persisted rows to distinguish a product bug from an incorrect oracle. Keep a demonstrated
product bug as a finding. Change the oracle only when intended behavior supports the change.

## Maintain the coverage record

[coverage.json](coverage.json) records each reviewed source hash and the base commit
that preceded this verification change. Exact hashes identify uncommitted source too.
The record covers the production functions, schema inputs, SQL adapter, Go wire
contracts, focused tests, mutation definitions, and tool configuration.

After a hash mismatch, review the covered diff before running the check again.
Confirm that the independent oracle, bounds, transaction assumptions, and mutation
targets still describe the intended behavior. Update the affected SHA-256 values and
`syncedBaseCommit` only after that review. Then run the mutation command again.
There is no flag that accepts source drift. Use `/maintain-formal-verification-skill`
when a previous change omitted this review.
