---
name: wiki-ingest
description: Claim one pending Wiki source via `gdg wiki ingest lock`, file it into pages/ under AGENTS.md rules, commit and push, then run `gdg wiki ingest --commit --document-id <id>` (marks ingested and unlocks). Use for `gdg wiki ingest`, `/wiki-ingest`, or `/wiki-ingest --parallel`.
---

# Wiki ingest procedure

This assumes the repo's `AGENTS.md` conventions (front matter schema, page types and
placement, source fidelity/examples/hierarchy rules, sensitive-information table) are
already known — read `AGENTS.md` first if they aren't.

## Parallel mode (`/wiki-ingest --parallel`)

When the invocation includes `--parallel` (for example `/wiki-ingest --parallel`):

1. Run **`gdg wiki ingest lock`** (no args). The CLI claims the next unlocked pending
   `document_id` and prints `Locked <id> …`. Use that id for the rest of this run.
   If lock fails (`no claimable pending documents`), stop — do not edit another item.
2. Other agents may be editing the same `pages/` tree at the same time. That is
   expected: if you hit merge conflicts, overwrite races, or inconsistent reads,
   resolve them and retry your own edits — do not stop the whole ingest for that.
3. Follow steps 2–9 below for the locked source (read source, update/create pages,
   catalogs, ACL tags, log).
4. Then **do** finish the ingest yourself for that document:
   - `gdg wiki ingest --commit --document-id <id>` — marks ingested **and unlocks**
5. If you abort without `--commit`, run `gdg wiki ingest unlock <id>` (add `--force`
   if needed). Do **not** use a `--` separator before the id.
6. Do **not** leave queue advancement or unlocking to the launcher.

ACL tagging rules still apply. Run `gdg wiki verify-acl` (or rely on commit hooks)
before commit when needed.

When `--parallel` is **not** present, use the same lock → edit →
`--commit --document-id` flow below (still start with `gdg wiki ingest lock`).

## Default procedure

Claim one pending source with `gdg wiki ingest lock`. Touch ≤15 pages per source; if more
are needed, split/defer the rest.

1. Run `gdg wiki ingest lock` and note the locked `document_id`. Read that queue entry's
   `raw/` path from `INGEST_QUEUE.md`.
2. Read `index`, relevant namespace/category catalogs, and existing pages.
3. Preserve the source's information as fully as possible under **Source fidelity, examples,
   and hierarchy** (in `AGENTS.md`). This means maximal *content* transfer, not copying
   `raw/`'s own folder/filename structure into `pages/` — see rule 8 there and
   `references/directory-structure-examples.md` for a worked good/bad comparison. For a
   meeting-minutes source specifically, see **Meeting minutes** below before creating any
   page.
4. Update existing pages first; create pages when no page fits, when concrete examples must
   be separated, or when hierarchy rules require grouping.
5. If ≥3 sibling pages share a category, create/reuse an intermediate hierarchy: first check
   whether flat sibling pages for that topic already exist and move them in (do not leave
   duplicates at both the flat and nested location). Choose a **globally** unique slug
   (server UNIQUE on `pages.slug` — parent path does not scope it). Recurring event-child
   roles already claimed elsewhere need a disambiguator (`io-extended-osaka-swag/`, not a
   second bare `swag/`); see **Slug uniqueness (global)** in `AGENTS.md`.
6. For every written fact/example, add source to front matter: queue `source_id` →
   `sourceId`; use `(source: …)` inline where needed. Never use `document_id`. If queue lacks
   `source_id`, follow the human-authored rule below.
7. **Span ACL (mandatory when `visibility` ≠ `member`).** Wrap every statement derived from
   that source in `<acl src="<source_id>">…</acl>` (see **Confidentiality and Span ACLs** in
   `AGENTS.md`). Do not put `<acl>` in title/summary/front matter. `acl_required` /
   `acl_untagged_read_source` mean tagging is incomplete — fix tags and retry; they do **not**
   mean you lack permission if you can already read `raw/`.
8. When creating/moving a page, update its parent catalog(s).
9. Append one line to `log` at the top.
10. Commit and `git push`.
11. Fetch/fast-forward the server snapshot; verify pages, catalogs, hierarchy, and `log`.
12. Run `gdg wiki ingest --commit --document-id <id>` (marks ingested and unlocks),
    refresh queue, and confirm the processed source is gone from the queue.

## Push and ingest completion

Remote applies operations then generates a normalized snapshot; it may assign `id`,
normalize front matter, and advance `origin/main`.

- After successful push: `rtk git fetch origin`; `rtk git merge --ff-only origin/main`;
  inspect normalization; never overwrite assigned `id`.
- Rejected push (`400`, `unknown_tag`, `sync_failed`, non-fast-forward) may still have applied
  earlier operations. Fetch and diff `HEAD` vs `origin/main` before retrying; ensure failed
  page creation did not leave only catalog/`log` entries.
- Rebase remaining local work onto fetched snapshot before retrying; never force-push.
- If `gdg wiki ingest --commit` cannot fast-forward, fetch/fast-forward explicitly and retry.
- Retry transient `5xx` once. If repeated, do not edit `INGEST_QUEUE.md`/`.gdgwiki/`; report
  that changes were pushed but processed marker is pending.

## Meeting minutes

Meeting-minutes source material is a log of discussion, not a page shape. These rules
mirror **Meeting minutes (mandatory)** in `AGENTS.md` — follow both.

1. **Never create one page per meeting date** (`minutes-YYYY-MM-DD/page.md` or any
   per-source-file equivalent). A new dated minutes document arriving is not by itself a
   reason to create a new page.
2. **Never paste a minutes file wholesale** onto an event overview or topic hub — including
   as `page_metadata.kind: example` or with framing like 「原資料をそのまま掲載」. That is
   still a minutes-shaped page and defeats query (facts stay buried in narrative). A
   multi-topic discussion log is **not** a concrete example under rule 2.
3. **Route every static fact** — decisions, budgets, candidate lists, checklists, staffing
   plans, promotion strategy, speaker status, venue lock-ins, and so on — onto the normal
   topic page (entity, `playbooks/`, or an event topic child such as `…-swag/`,
   `…-promotion/`). **Update that same topic page** on later ingest passes; do not add a
   sibling dated page.
4. **Verbatim only for** (a) bounded artifacts found inside the minutes (price tables,
   tweet drafts, setup checklists, order forms) as separate `kind: example` children, and
   (b) content where the *sequence itself* is the point (one day-of timeline / incident log
   per event — never fragmented across per-date pages).
5. **Do not rebuild minutes cadence on the parent** as 「開催N日前の状況」 sections. Dated
   progress belongs as rows/tables on the topic child.

When a new dated minutes source reaches the front of the queue: read it fully, extract
every fact/example, file each on its topic's static page (creating one with a **globally
unique** slug if none fits); only the genuinely time-ordered residue, if any, goes on the
event's one chronological page. See `references/directory-structure-examples.md`.

**Anti-pattern that already happened once:** ingest treated each queued minutes file as one
`kind: example` page, put a short synthesis on the parent, and dumped the file body on the
child — satisfying a misreading of "overview synthesizes" + "verbatim examples on separate
pages." That produced 15+ `minutes-*` pages and later topic hubs that still said
「原資料をそのまま掲載」. Do not repeat either form.

## Updating existing pages

You own `pages/**` and may rewrite comprehensively. If reversing a human edit, record why in
`log`.

Human-authored pages live under `raw/`, not `pages/`. Treat them as primary information.
Create corresponding synthesized/generalized pages and, where they contain concrete
examples, separate source-faithful example pages. Cite/link the original; both raw and
Wiki-layer representations coexist.

## Handling contradictions

Do not choose arbitrarily. Add:

```markdown
> **Unresolved**: capacity
> - 120 people — July 14 regular meeting minutes (`sourceId: xxxxx`)
> - 90 people — Google Chat #io-extended 2026-06 (`sourceId: yyyyy`)
```

Record in `log`; remove when resolved by a human. Newer is not automatically more correct.

`wiki-lint`'s Contradictions check uses this same block format when flagging or fixing
issues.

## Citations

Every statement/example must trace to a source: page-level `sources`; `(source: xxxxx)`
inline when sources differ. Never add information absent from `raw/`; unavoidable inference
must be labeled `speculation`.

For `raw/wiki-human/`, do not use queue namespaced `document_id` or assume raw front matter
`id` is a valid `sourceId`. Unless a recognized source ID is independently known, cite title
+ absolute Wiki URL and link it in the body:

```yaml
sources:
  - title: Tips for hands-on preparation
    url: https://wiki.gdgs.jp/wiki/tips-for-hands-on-preparation
```

Each source needs recognized `sourceId` or both `title` and `url`. Accept server-normalized
`sources` after push.

Inline `(source: xxx)` is unchecked text and may be dangling; never assume it is safe for
front matter. A bad front-matter source ID causes `sync_failed`/FK failure, distinct from
malformed-entry `400 invalid_request`. On FK failure: do not retry the ID; drop it
(`sources: []` allowed), preserve existing inline citation, and record "Needs action" in
`log`.

`wiki-lint`'s Missing citations and Dangling inline citations checks rely on these rules.
