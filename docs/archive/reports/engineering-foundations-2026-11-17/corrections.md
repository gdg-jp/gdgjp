# Corrections encoded in repository checks

This review connects selected repository corrections to executable constraints.
It covers the two November 8 Wiki fixes below, the foundation and delivery
commits through `192a491c`, and the [decision record](decisions.tsv) available on
November 18, 2026.
It does not cover private Slack, previous agent transcripts, all review comments,
or every historical correction. Commit messages describe the original incidents.
Their code changes and assertions establish the mechanisms inspected here.

## Queue recovery and payload ownership

`e517067e9630d32742edf9dbc0826b54338ec826` repairs a queue recovery deadlock.
A leased synthesis job could expire while a newer job was already queued for its
space. Returning the leased job to `queued` violated
`idx_agent_jobs_one_queued_per_space`. The leased row then blocked other clone jobs.
The commit merges its payload into the queued job and retires the old row.
It also recovers expired leases before each lease request.

The existing [runner tests](../../../../apps/wiki/app/features/jobs/runner.server.test.ts)
assert that expired work becomes leasable before the hourly cron, retries merge
into a newer queued job, and the source row becomes failed after that transfer.
These are useful behavior checks to retain through internal refactoring.

The historical fix still reads payloads and writes the merged payload and source
status in separate operations. Those operations do not establish safety when
another request changes ownership or adds work between them. Commit `224bce80` addresses that gap with these mechanisms:

| Demonstrated failure | Structural change | Negative check |
| --- | --- | --- |
| Completion reads a valid owner, then overwrites a reassigned lease | Conditional SQL checks ID, leased status, host, and captured attempt at the write | `completion-cas` mutation removes the write condition |
| An old callback returns after the same host leases the job again | Heartbeat and result carry the captured `attempts` generation in both Wiki and Go callers | `lease-generation` mutation removes the attempt predicate |
| Recovery reads expiry before a concurrent heartbeat renews the lease | Recovery rechecks expiry and ownership in its update | `renewed-retry` and `renewed-terminal` mutations remove the expiry predicates |
| Concurrent accepted enqueues overwrite an earlier payload | One upsert merges the current stored payload with the incoming payload | `payload-conservation` mutation discards the existing JSON arrays |
| Payload transfer and source retirement arrive in a different order | One ordered transactional batch transfers work and retires or requeues the source | `recovery-atomicity` mutation replaces the batch with independent concurrent requests |

The named mutations live in
`apps/wiki/app/features/jobs/runner.server.verification.mutations.json`.
The independent properties in `runner.server.verification.test.ts` inspect real
SQL results, including acknowledged source IDs, document IDs, and requester records.
The test that reorders independent SQL requests checks the transaction boundary,
rather than assuming that an array of promises commits in order.

The integrated phase 3 verifier rejected all ten mutations and passed its
baselines and Go race tests. Its actual Worker HTTP E2E passed too. See
[validation](validation.md) for the source record and executed results. Finite SQLite enumeration does not prove
unbounded behavior or a deployed D1 instance.

## A successful job must contain the requested work

`74a42eb13e70d59d3e82bc4cebacedd4005a6cf7` repairs **Integrate now** after a
`needs_review` result. The action previously supplied a space ID without document
IDs. The resulting empty job could report success without integrating documents.
The commit makes `integrateNow()` collect that space's unintegrated documents and
uses the same selection as the scheduled safety check.

The [enqueue regression](../../../../apps/wiki/app/features/jobs/enqueue.server.test.ts)
`queues the space's unintegrated documents, not an empty job` inserts one pending
and one integrated document. It checks that the queued payload contains the
pending document and its source. The observable contract is the work preserved
in the job, rather than the runner's success status or elapsed time.

The phase 3 atomic enqueue change retains this contract. Its concurrent payload
properties extend conservation to multiple accepted producers. They do not
establish that a downstream agent produced a correct article.

## Fresh verification must not inherit developer state

The [decision record](decisions.tsv) records a PR E2E failure caused by 61 old open
mock jobs. The new job was behind the runner's 50-job polling boundary.
Deleting developer rows would have hidden the cause and altered development data.
Commit `04fb9938` gives each PR E2E run its own persistence and Worker registry.

The [PR isolation regressions](../../../../.github/scripts/pr-e2e-isolation.test.mjs)
check fresh state across runs, argument forwarding, failure propagation, and
preservation of an existing developer database. Commit `0e128570` extends source
snapshot isolation to the complete configured E2E catalog.
The [snapshot regressions](../../../../.github/scripts/run-isolated-e2e.test.mjs)
check secret exclusion, local workspace links, occupied-port refusal, owned-child
termination, retained failure evidence, and rejection of successful commands
that produce no browser report.

A new fixture also exposed migration output larger than the default child-process
buffer. Wiki setup now streams non-JSON migration output.
The [large-output regression](../../../../.github/scripts/wiki-e2e-setup.test.mjs)
produces 150,000 migration-output lines and still requires validated fixture
counts and a usable local session file. Increasing a test timeout would not repair
this failure.

## Redirect ownership must survive component removal

Commit `0e128570` repairs Screen stage deletion. The Durable Object's deletion
event removes the component before its fetcher's redirect finishes.
Router-owned submission now owns that navigation.

The [stage E2E](../../../../apps/screen/e2e/stage.spec.ts) case
`a stage takes a custom id that is also its invite link` holds the delete HTTP
response until the UI displays the deleted state. It then releases the real
response and requires navigation to the stage list. The test exercises the
problematic event order without increasing the timeout or repeating the click.
This local deletion journey does not establish real SFU media behavior.

## Policy checks must survive resolution and catalog changes

The dependency checker review found that treating `#` as a URL fragment stripped
Node package-import aliases. Commit `0e128570` preserves the leading hash and
resolves the alias before checking workspace ownership.
The [alias regression](../../../../.github/scripts/check-workspace-boundaries.test.mjs)
`resolves Node package import aliases without treating their leading hash as a fragment`
rejects the prohibited import through that spelling.

The same phase replaces an incomplete handwritten E2E list with the configured
suite catalog. The [catalog regression](../../../../.github/scripts/changed-workspaces.test.mjs)
`every first-party configured browser suite is selected for complete CI` compares
actual workspace manifests and Playwright configurations with the detector's
selection. A newly configured suite must enter the delivery path.

The CI review also replaced ordinal step assertions with named-step assertions.
A policy step inserted earlier in the workflow must not invalidate unrelated
selection tests. These checks belong beside the selector and workflow consumers,
so another prose instruction or copied CI list is unnecessary.

## Local routes and modal ownership

Phase 4 found that local previews retained production Worker routes. Wrangler
rewrote the callback host, and the provider rejected the resulting non-loopback
HTTP redirect. Direct HTTP and service-binding probes ruled out credential-method
and body-serialization theories. The runner now removes production route fields.
The fixture in `e2e-ports.test.mjs` proves that the old preview retains them and
the current preview removes them.

The seeded UI properties then found a mobile menu/dialog lifetime conflict.
An extra Escape did not fix it. The diagnostic showed a closed, inert menu that
still retained modal presence. `192a491c` waits for menu teardown before opening
the next dialog. The original mobile invariants pass. The old force-click loop
was removed from the access-control driver. It now clicks once and observes the
result. No general instruction about adding delays was introduced.

The observation review found another false-success boundary. An explicit
`complete: false` export was overridden when the returned count matched the
reported total. The health report now preserves explicit incompleteness and
rejects malformed completeness values. The added regression fails the old code.
The hosted collector separately checks consistent totals and unique IDs across
all returned pages.

## Evidence and scope

The phase 1 full run records 17 configured suites, 179 passed cases, no failed or
flaky cases, and one explicitly skipped real-SFU case. Its evidence is
`local_data/pstack/e2e/2026-11-17T14-57-33-817Z-545d7fec/result.json`.
This is an executed local fixture result, not production performance data.
Earlier failed runs remain in the same evidence tree and in
[validation](validation.md).

This history pass reads source and existing assertions. It does not rerun browser
journeys or substitute historical assertions for current execution.
The adoption phases own their recorded verification and commits.
The [source correspondence](sources.md) remains the record of reviewed poteto
ideas and their final implementation status.
