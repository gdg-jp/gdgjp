# Runtime evidence contract

The committed `coverage.json` is the feature map's latest execution summary.
`journeys.json` in an ignored run directory contains the detailed receipts.
Keep source recipes and execution records separate.

Each journey record has these fields:

| Field | Value |
| --- | --- |
| `id` | Stable journey ID from `coverage.json` |
| `status` | `VERIFIED`, `FAILED`, or `NOT VERIFIED` |
| `observedAt` | ISO timestamp, or null when unexecuted |
| `sourceBaseCommit` | The source checkout's HEAD at snapshot creation |
| `sourceHashes` | Relevant exact hashes from the helper's `ready.json` |
| `identity` | Fixture label and expected user ID, without cookie values |
| `entryPoint` | Actual local route used |
| `actions` | Ordered action labels and retained receipt paths |
| `observations` | Expected and observed values with evidence paths |
| `failure` | Failed precondition or observed mismatch, or null |

Use paths relative to the evidence directory in detailed records. For the committed
summary, use paths relative to the repository root and retain each proof artifact
under `local_data/pstack/platform/<run-id>/`. Those ignored files are local evidence,
not artifacts available from a fresh clone. The committed validation report should
summarize the actual observations and exact run path.

A `VERIFIED` journey requires its mapped entry point and assertions to pass.
An interrupted journey remains `NOT VERIFIED` unless it contains a demonstrated
failure. A demonstrated failure is `FAILED`. Do not replace a failed assertion
with a weaker one to obtain `VERIFIED`. A successful helper or E2E suite does
not change an Orca journey's status.

To update `coverage.json`, set only the executed row's `status`, `observedAt`,
`evidence`, and `result`. Set the top-level `sourceBaseCommit` and `runEvidence`
to the executed snapshot and run. Preserve unexecuted rows and exclusions.
Record the actual source hashes in the detailed journey file, including dirty
working source. A base commit alone does not identify an uncommitted snapshot.

Record cleanup separately in the run's `cleanup.json`:

- Created page IDs and profile IDs, and their close/delete receipts.
- Helper PID or session handle, its stop result, and final `result.json` path.
- `scratchRemoved` from the helper result and a filesystem existence check.
- Whether ports 6173 and 6177 are free after stopping owned processes.
- Evidence files still present after cleanup.

Synthetic timing records may use the engineering-health input shape:

```json
{
  "kind": "synthetic-navigation",
  "collectedAt": "2026-11-18T00:00:00.000Z",
  "source": "orca-local",
  "samples": []
}
```

Each sample records `observedAt`, `url`, `outcome`, `httpStatus` when known,
`evidence`, and `navigation` fields `duration`, `responseStart`,
`domContentLoadedEventEnd`, and `loadEventEnd`. Populate samples from actual Orca
observations. Leave zero samples explicit rather than inventing a timing.
