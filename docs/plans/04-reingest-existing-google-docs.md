# Stage 4 — Migrate Existing Google Docs Assets to Raw and Recompose

## Context — Background and Repository State

Migrate the 107 pages under `google-document/` to raw, then actually run the Stage 3 Ingest to recompose them into operations knowledge pages.

This will be the first proof of the entire pipeline. Stages 1–3 were all built for this.

The overall approach is in `docs/plans/00-llm-wiki-overview.md`.

**Dependencies:** Stages 1 and 3
**Target workspaces:** `wiki/` and `scripts/`

### Current state

The `wiki/` D1 database already contains the following.

- `google_document_imports` — `document_id` → `root_page_id`
- `google_document_import_nodes` — `(document_id, source_node_id)` → `page_id`, with `source_kind` of `document` \| `tab`

In other words, the mapping from each Wiki page to the document and tab it originated from remains intact. The migration only needs to follow this mapping.

The scope consists of 107 pages across two events.

- `2026-07-18 I/O Extended @ Osaka` — more than 20 meeting minutes, swag, X Ads, and link collections
- `Innovative Crosstalk / JamboreeGeeks26` — more than 20 speaker-coordination pages, the timetable, incidents, and event reports

Many pages have machine slugs (such as `page-1786197821498`), while `summary` and `sources` are empty.

### Required reading

- `docs/plans/03a-agents-md.md` — conventions agents must follow during Ingest
- `docs/plans/01-sources-raw-layer.md` — destination data model and R2 layout
- `scripts/` — conventions for existing repository automation scripts

## Design

### 1. Migration script

Create `scripts/migrate-google-docs-to-sources.ts`, following the conventions of the existing `scripts/` directory.

Process:

1. Scan `google_document_imports` and create one `sources` row per `document_id`
   (`kind: google-doc`, `external_id: document_id`, `url` is the Doc URL, and `chapter_id` is inherited from the source page).
2. Follow `google_document_import_nodes`, write each node's `pages.content_ja` to
   `raw/<sourceId>/<docId>/<hash>.md` in R2, and create a `source_documents` row.
   - `path` joins the node hierarchy with slashes.
   - Tabs with only machine IDs are slugified from the source page's `title_ja`.
3. Reassociate R2 objects from `page_attachments` with `source_assets`
   (copy the R2 keys; **do not delete the originals**).
4. Set the source Wiki pages to `status: archived` (**do not delete them**).
5. Always provide `--dry-run`, which only outputs counts and the mapping table.

**Make it idempotent.** Re-running it must not duplicate `sources` or `source_documents`.

### 2. Recomposition

After migration, run the Stage 3 Ingest locally.

```bash
gdg wiki clone --lang ja ~/proj/wiki-ingest
cd ~/proj/wiki-ingest
gdg wiki raw pull
gdg wiki ingest --agent claude
```

Following the instructions in `AGENTS.md` (`docs/plans/03a-agents-md.md`), the agent produces:

- `events/` — ledgers for the two events: dates, venues, attendee counts, budgets, and results by acquisition channel
- `venues/` — a catalog of used venues: capacity, costs, facilities, access, and actual problems encountered
- `vendors/` — catering providers and ordering records (headcount, unit price, and surplus)
- `people/` — speakers' presentation history, contact channels, and the tone of coordination
- `playbooks/` — speaker-office message templates and timelines, plus X Ads / connpass initiatives and outcomes
- updates to `index` / `log`

**Do not make it process everything at once.** As required by `AGENTS.md`, process one source at a time and at most 15 pages, review each result, and revise `AGENTS.md` as needed. As `llm-wiki.md` states, the schema co-evolves here. Give the first five of the 107 items especially careful attention.

### 3. Sensitive-information review (required)

Generated results must always undergo human review. Use the existing `sensitiveItems` categories
(`email` / `phone` / `sns-handle` / `financial` / `personal-opinion` / `credential`) as review criteria.

- Do not include speakers' personal email addresses or phone numbers in page bodies. Limit contact guidance to external Wiki channels.
- Monetary amounts may be included, but retain `visibility: restricted`.
- Do not name parties involved in incidents.

Reflect corrections made during review in the `AGENTS.md` rules so they do not recur in later Ingest runs.

### Constraints

- **Do not delete source data.** Source pages become `archived`, and original R2 objects remain in place.
- The migration script is idempotent: duplicate runs do not duplicate rows.
- Do not run against production D1 without `--dry-run`.
- Apply to production in this order: `--dry-run` → local verification → remote D1. Back up D1 before execution.
- Do not modify the APIs or data model created in Stages 1–3. Report any insufficiency and stop.
- Recomposition (running Ingest) is an interactive human process. Do not run it unattended from a script.
- Follow Biome and use `import type`.
- Do not add dependencies (do not change `pnpm-lock.yaml`).

## Files to touch

- `scripts/migrate-google-docs-to-sources.ts` (new)
- Tests in `scripts/` (follow existing conventions)
- A record of the migration results in `docs/` (mapping table and sensitive-information patterns found in review)

Wiki pages generated by recomposition are D1 data, not repository files. Therefore, this stage's code changes are limited to the script.

## Verification — Completion Criteria and Validation

### Completion criteria

- Machine-slug pages (such as `page-1786197821498`) no longer appear in the sidebar.
- Wiki pages can answer questions such as “What is the capacity of the Umeda venue?”, “How much did the previous catering cost?”, and “How many times has this person presented for us?”
- All pages are cataloged in `index`, and `log` contains migration and Ingest histories.

### Commands

```bash
pnpm --filter @gdgjp/wiki exec tsx scripts/migrate-google-docs-to-sources.ts --dry-run
```

```bash
pnpm ci:quick
pnpm --filter @gdgjp/wiki test:e2e
```

### Procedure

1. Visually inspect the `--dry-run` mapping table (which `source_document` each of the 107 pages becomes).
2. Run against local D1 and confirm that the number of `source_documents` matches the source-page count.
3. Verify idempotency: run it again and confirm that no rows are added.
4. After archiving, confirm that machine-slug pages disappear from the sidebar and `/search`.
5. Confirm that the original R2 objects remain.
6. Run Ingest one source at a time and manually review the resulting `venues/` and `people/` pages.
7. Back up D1 before production application.
