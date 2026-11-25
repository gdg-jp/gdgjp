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
| Production RUM | Cloudflare Web Analytics Core Web Vitals per production host, or separately supplied samples | Missing data remains unavailable. Local or synthetic samples cannot populate it |

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

## Production RUM

Production performance comes from Cloudflare Web Analytics, which Cloudflare
collects on proxied `gdgs.jp` hostnames once Real User Measurements are enabled.
No application code, binding, beacon endpoint, or migration is involved.
`apps/tinyurl-gateway/` on Vercel serves redirects, not pages, and is not covered.
A first-party beacon stored in Workers Analytics Engine would need code in every app
and a receiving Worker, so it is the fallback only if Cloudflare's data proves insufficient.

The collector `.github/scripts/collect-production-rum.mjs` reads the account-level
GraphQL dataset `rumWebVitalsEventsAdaptiveGroups` for one explicit window:

```sh
CLOUDFLARE_RUM_API_TOKEN=... CLOUDFLARE_RUM_ACCOUNT_ID=... \
  node .github/scripts/collect-production-rum.mjs \
  --since 2026-10-25T00:00:00Z --until 2026-11-24T00:00:00Z \
  --output local_data/pstack/engineering-observations/production-rum.json
```

It groups by request host only and excludes bot traffic. It does not request paths,
query strings, referrers, countries, user agents, or element names. Cloudflare
states that its beacon uses no cookies, local storage, or fingerprinting. Hosts map to
apps through each app's production Wrangler `pattern` and `APP_URL` entries.
`[env.*]` sections and comments are ignored. Other hosts, including staging slots,
are only counted in `excludedHostCount` and `excludedPageViews`.

Cloudflare applies adaptive sampling. `pageViews` and each metric's `sampleCount`
are Cloudflare estimates, and `sampleInterval` is the average sampling interval.
The collector adds no sampling of its own. Timings arrive in microseconds and
are written in milliseconds. Negative Cloudflare values mean not applicable and
become `null`. A metric with zero samples has null percentiles.

The aggregate envelope contains `kind: "production-rum"`, `format: "aggregate"`,
`collectedAt`, `source`, `window` (`since`, `until`), `sampling`, `privacy`,
`apps`, `excludedHostCount`, and `excludedPageViews`. Each app entry has `app`,
`host`, `pageViews`, `visits`, `sampleInterval`, and `metrics`. `metrics` holds
`ttfbMs`, `fcpMs`, `lcpMs`, `inpMs`, and `cls`, each with `sampleCount`, `p50`,
`p75`, `p90`, and `p99`. TTFB and FCP describe navigation and startup, LCP
describes the main content, and INP describes interaction. The report rejects
localhost, IP, and `.localhost` hosts, `synthetic: true`, percentiles without
samples, and relabeled kinds. It marks the source stale when `window.until` is
older than the freshness limit. The per-sample `samples` envelope remains accepted.

## Throughput, reverts, and production performance

`deliveryAndPerformance` places independent measurements for the report window
side by side. `throughput` holds commits, explicit reverts, and deployment
workflow attempts with their source status and completeness. Each row in `apps`
holds that app's commits and explicit reverts, plus `production` for each of its
hosts: page views, sampling interval, and p75 with sample count for every metric.
A commit counts for an app when its changed paths include `apps/<app>/`. One
commit can count for several apps, and merge commits list no paths. Deployment
attempts are not split by app, because one workflow can deploy several apps.

`production` is filled only from aggregate production RUM whose window equals the
report window. A different window leaves every row's `production` null and adds a
gap. Missing RUM leaves it null with basis `unavailable`. Synthetic navigation
never reaches this section. The section states that causality is not inferred.
Pass the collector's `--since` and `--until` to `engineering-health.mjs` to compare
the same window.

## Delivery integration

Local quick, full, and staged CI write an observation report after their actual
checks, including failed runs. Their metrics file points to the retained report
under `local_data/pstack/engineering-health/`. The report keeps a copy of the
exact CI input instead of mixing a later run into an earlier result.

The hosted observation job runs after its check dependencies even when they fail.
It chooses one 30-day window, reads Git and deployment history for it, and uploads
the report and collection evidence. On pushes to `main` it also collects production
RUM for the same window. Without the token or account ID, that step writes
`production-rum-collection.json` with status `unavailable` and passes no RUM input.
A failed collection writes the same record with a failure reason and fails the step.
Pull requests never receive the token. Host-local CI metrics and synthetic timings
remain unavailable unless separately supplied. The workflow's green
report-generation step does not turn those gaps into measured success.

To turn on production RUM, a person with Cloudflare and repository admin access:

1. Enables Web Analytics (Real User Measurements) for each production hostname in the
   `gdgs.jp` zone in the Cloudflare dashboard, using automatic setup for proxied sites.
   Then confirms that an HTML response includes the `static.cloudflareinsights.com`
   beacon and that the browser reaches `cloudflareinsights.com/cdn-cgi/rum`.
2. Creates an account API token with only **Account Analytics: Read** for that account.
3. Stores it as the repository Actions secret `CLOUDFLARE_RUM_API_TOKEN`. It stays outside
   the deploy environments.
4. Sets the repository Actions variable `CLOUDFLARE_RUM_ACCOUNT_ID`. It can also set
   `CLOUDFLARE_RUM_SITE_TAGS` to a comma-separated list of Web Analytics site tags.

This adds no Worker binding, D1 migration, deployment step, or `.dev.vars.example`
entry.

The report's `VERIFIED` or `NOT VERIFIED` describes source availability and
freshness. Outcomes remain separate. Collection time and the age of the newest
observation are both recorded. Reading an old file today does not freshen it.
