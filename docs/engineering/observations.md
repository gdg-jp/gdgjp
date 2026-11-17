# Engineering observations

Run `node scripts/engineering-health.mjs --help` from the repository root.
The command reads Git and explicit JSON inputs. It does not deploy or change
external state.

```sh
node scripts/engineering-health.mjs --since 2026-11-10T00:00:00Z \
  --ci-metrics-dir .turbo/ci-metrics \
  --deploy-runs local_data/pstack/engineering-observations/deploy-runs.json \
  --synthetic-navigation local_data/pstack/engineering-observations/synthetic-navigation.json \
  --output local_data/pstack/engineering-observations/report.json
```

Choose the observation window explicitly. Missing optional inputs remain
unavailable. Malformed supplied inputs fail the command. Exit zero means the
report was generated, not that all sources are available or the product is healthy.

## Sources and units

| Source | Measurement | Limit |
| --- | --- | --- |
| Git | Reachable commits and explicit revert subjects in the window | No inferred causal regression or release-revert rate |
| Deployment export | Workflow attempts grouped by actual status and conclusion | One workflow can deploy multiple applications. Attempts are not releases |
| Local CI | Actual metrics records, failures, cancellation, incomplete execution, skipped steps, flaky tests, and cache results | A missing execution record is not a pass |
| Synthetic navigation | Completed document-navigation timings with URL, timestamp, driver, and evidence | Local fixtures and small samples do not establish production performance or a speedup |
| Production RUM | Separately supplied production observations | Missing data remains unavailable. Local or synthetic samples cannot populate it |

Deployment exports contain `collectedAt`, `source`, `workflow_runs`, optional
`total_count`, and optional boolean `complete`. An explicit incomplete export
stays incomplete even when its counts match. The hosted collector reads all
available deployment-history pages with a read-only Actions token. It checks
consistent totals and unique run IDs before claiming completeness. Collection
failure remains a failure and produces an unavailable-source record.

Synthetic envelopes contain `kind: "synthetic-navigation"`, `collectedAt`,
`source`, and `samples`. Each sample has `observedAt`, `url`, `outcome`, and
`evidence`. Successful samples include `navigation.duration`, `responseStart`,
`domContentLoadedEventEnd`, and `loadEventEnd`. Keep failed samples too. Use the
actual `PerformanceNavigationTiming` for the loaded document, not a planned URL
or a stopwatch around a helper command. Zero successful samples produce null
statistics.

## Delivery integration

Local quick, full, and staged CI write an observation report after their actual
checks, including failed runs. Their metrics file points to the retained report
under `local_data/pstack/engineering-health/`. The report keeps a copy of the
exact CI input instead of mixing a later run into an earlier result.

The hosted observation job runs after its check dependencies even when they fail.
It reads Git and deployment history and uploads the report and collection evidence.
Host-local CI metrics, synthetic timings, and production RUM remain unavailable
unless separately supplied. The workflow's green report-generation step does not
turn those gaps into measured success.

The report's `VERIFIED` or `NOT VERIFIED` describes source availability and
freshness. Outcomes remain separate. Collection time and the age of the newest
observation are both recorded. Reading an old file today does not freshen it.
