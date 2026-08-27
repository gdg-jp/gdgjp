# Raw-source ingest workflow

## Single-worker flow

```sh
gdg wiki raw pull
gdg wiki ingest
gdg wiki ingest lock
# Process only the locked document according to INGEST_QUEUE.md and AGENTS.md.
gdg wiki verify-acl
git add <exact files>
git commit -m "docs: ingest source"
git push
gdg wiki ingest --commit --document-id DOCUMENT_ID
```

`raw pull` downloads the caller-visible `raw/**` snapshot; `AGENTS.md` is synchronized through Git.
Plain `ingest` regenerates `INGEST_QUEUE.md`, resets the ingest trace, and prints the ingest prompt.
`ingest --agent claude|codex|cursor` additionally launches that coding agent in the clone.

## Locks and aborts

```sh
gdg wiki ingest lock [DOCUMENT_ID]
gdg wiki ingest unlock DOCUMENT_ID
gdg wiki ingest unlock DOCUMENT_ID --force
```

With no ID, `lock` claims the next unlocked pending document. A lock records the current Git HEAD
for trace and ACL validation. `GDG_WIKI_LOCK_OWNER` can supply a stable per-worker owner; orchestrated
runs may also set `GDG_WIKI_RUN_ID`. Do not force-unlock another worker's item unless the user has
explicitly decided that lock is stale or abandoned.

If processing is abandoned before finalization, unlock the document. Document IDs may begin with
`-`; lock/unlock intentionally use custom parsing so those IDs remain positional values.

## Finalization and ACL

Run `ingest --commit` only after the page change is committed and pushed. Without `--document-id`,
it selects the queue head; supply the ID in concurrent workflows. It checks ACL findings, marks the
current source hash as ingested, clears trace state, unlocks the document, and refreshes the queue.

`verify-acl` and finalization fail on actual ACL findings but fail open on infrastructure errors.
Treat fail-open warnings as unresolved operational risk and report them; never change visibility or
strip ACL annotations to silence a finding.
