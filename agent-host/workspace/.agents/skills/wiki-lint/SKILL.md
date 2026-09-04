---
name: wiki-lint
description: Health-check this GDG Japan Wiki for contradictions, stale claims, orphan pages, missing entities, catalog/hierarchy drift, missing summaries or citations, sensitive-information violations, and dangling inline citations; fix what's fixable and record everything in log. Use whenever the user asks to run `gdg wiki lint`, lint or audit the wiki, or check it for consistency/staleness issues.
---

# Wiki lint

This assumes the repo's `AGENTS.md` conventions (front matter schema, page types and
placement, sensitive-information table) are already known — read `AGENTS.md` first if they
aren't. For the exact contradiction-block format and citation rules used when fixing issues
below, see the `wiki-ingest` skill.

On `gdg wiki lint`, check in order and record results in `log`; fix when possible:

1. **Contradictions** — same subject, conflicting facts.
2. **Staleness** — new sources not reflected.
3. **Orphans** — pages linked from nowhere.
4. **Missing entities** — entities mentioned by multiple pages without their own page.
5. **Catalog sync** — `index` covers every namespace; every catalog matches direct children.
6. **Hierarchy** — ≥3 similar sibling pages not grouped; oversized catalogs not split;
   misplaced `parent_slug`.
7. **Missing `summary`** — empty or inconsistent with body.
8. **Missing citations** — concrete facts/examples with empty `sources`.
9. **Primary-source loss** — material source information omitted without a
   Sensitive-information, duplication, or placement reason.
10. **Example separation** — concrete examples abstracted/paraphrased, omitted, duplicated,
    or mixed onto a generalized page instead of a separate page.
11. **Sensitive information** — violations of the table in `AGENTS.md`.
12. **Classification consistency** — `index` namespace list vs directories; pages fitting two
    namespaces equally; event/entity/playbook/example facts duplicated instead of linked.
13. **Dangling inline citations** — collect `(source: xxx)` from `pages/`; compare with
    `.gdgwiki/state.json` `manifest.documents[].sourceId`. A value matching only an
    `ingested` map key is a `documentId`/`sourceId` mix-up: resolve through that manifest
    entry's `sourceId` if still present; otherwise leave "Needs action". Never guess absent
    IDs.

For anything unresolved, add a "Needs action" entry to `log`.
