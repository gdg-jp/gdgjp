# Fix: Google Drive source import 404s on shared-drive files

> Generated from Claude Code plan: `/Users/hari/.claude/plans/importing-google-docs-slides-spreadsheet-quiet-ullman.md`

## Goal

Fix: Google Drive source import 404s on shared-drive files

## Repo context

Importing a Google Doc / Slides / Spreadsheet at `/sources` fails on both local and production with:

```
Google Drive file metadata failed (404): File not found: 1aBF_s3AhUjNk2lejI1qsP59IW5XnipWpK_TwN9A12uw.
```

**Root cause (verified empirically against the live Drive API using the real OAuth token from the local D1):**
the org's files live in **shared drives** (`files.get` reports `driveId: 0AGczmP63WPXTUk9PVA`). Drive API v3
`files.get` returns **404 "File not found"** for shared-drive items unless the request passes
`supportsAllDrives=true`. A repo-wide grep for `supportsAllDrives|includeItemsFromAllDrives` returns zero hits.

Same token, same file ID, back to back:

| Request | Result |
| --- | --- |
| `files/{id}?fields=name,mimeType` | **404** |
| `files/{id}?fields=name,mimeType&supportsAllDrives=true` | **200** |
| `files/{id}/export?mimeType=text/plain` (no param) | **200** — `files.export` is not gated |
| `docs.googleapis.com/v1/documents/{id}` | **200** — Docs API is not gated |

The two reverted commits (`bf92aac`, `f5069ad`) chased a malformed-`external_id` theory. That theory is dead:
the 404 message quotes the *correct* file ID, and the local `sources` row stores the correct `external_id`.
Do not reintroduce them.

### Known blocker beyond this code change

`sheets.googleapis.com` returns **403 SERVICE_DISABLED** — "Google Sheets API has not been used in project
428142970890 before or it is disabled". The Sheets API is **not enabled** in the GCP project backing
`GOOGLE_DOCS_CLIENT_ID`. Docs and Slides imports will work as soon as this code fix lands; **spreadsheet**
imports will not, until someone enables the Sheets API in the console. That is a console action, not code.

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

1. `pnpm --filter @gdgjp/wiki dev`, sign in, open `/sources`.
2. **Acceptance test = a shared-drive Google Doc or Slides deck**, not the spreadsheet. Paste its URL and watch
   `pending → fetching → ready`. A Doc exercises `files.get` + Docs API + export and never touches the disabled
   Sheets API, so a green result isolates this fix.
3. Then hit **Refresh** on the failed spreadsheet row `Pq5R_sCd82vT-j4ol1KzJ`. `enqueueSourceRefresh` resets it to
   `pending` and `SourceImportDurableObject.start` calls `ctx.storage.deleteAll()`, so the `metadata` phase re-runs
   from scratch — no manual cleanup.
4. **Expected: still `error`, but a different one** — the failure moves from `Google Drive file metadata failed (404)`
   to `Google Sheets metadata failed (403): ... SERVICE_DISABLED`. That status change *is* the proof the Drive fix
   landed.
5. Enable the **Google Sheets API** in GCP project `428142970890`, wait a few minutes, Refresh again → expect
   `ready` with `<sheet>.md` + `<sheet>.pdf` documents. Report the spreadsheet case as fixed only after this.
6. Read results without stopping the dev server by copying the miniflare sqlite first (miniflare holds an exclusive
   lock): `SELECT id, status, substr(error_message,1,200) FROM sources WHERE id='Pq5R_sCd82vT-j4ol1KzJ';` against
   `wiki/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/cb6da886….sqlite`.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
