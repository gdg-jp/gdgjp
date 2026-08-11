# Hierarchical wiki page URLs

> Generated from Claude Code plan: `/Users/hari/.claude/plans/the-url-path-for-luminous-hennessy.md`

## Goal

Hierarchical wiki page URLs

## Repo context

The wiki app currently serves every page at a flat URL, `/wiki/:slug`, regardless of the page's
place in the content tree. Pages already have a `parent_id` self-reference in the `pages` table
(`wiki/app/db/schema.ts:98-135`) used for the sidebar tree and drag-and-drop reordering, but the
URL never reflects it. The ask is to also serve pages at a URL that mirrors that real hierarchy,
e.g. `/wiki/about-solution-challenge/solution-challenge-results`.

Because `pages.slug` is globally unique (`slug TEXT NOT NULL UNIQUE`), no schema change or new
`path` column is needed — the full path can always be derived on read by walking `parent_id`
upward. A stored/materialized path was considered and rejected: `parent_id` is mutated from at
least three independent code paths already (`api.pages.reorder.ts` drag-and-drop, the raw-SQL
`UPDATE` in `agent-notes.server.ts`, and zip import), and keeping a denormalized path in sync
across all of them is exactly the class of bug a computed-on-read query avoids. Page trees here
are shallow (the seeded namespaces are depth ≤ 2), so a recursive CTE is cheap. This repo already
has a working `WITH RECURSIVE` idiom over raw `env.DB.prepare()` for descendant walks
(`wiki/app/lib/page-archive.server.ts`) — the new code mirrors it, walking up instead of down.

Decisions confirmed with the user before writing this plan:
1. **Strict validation**: every segment of a multi-segment request must exactly match the page's
   real ancestor chain, or it's a 404 (no "last segment wins, ignore the rest").
2. **Flat URLs still resolve, via redirect**: `/wiki/:slug` for a page that has a parent
   301-redirects to the canonical hierarchical URL. Root-level pages are unaffected (flat is
   already canonical for them — no redirect fires).
3. **Migrate the link-building call sites**: introduce one shared helper and update the ~20 spots
   that currently inline-construct `` `/wiki/${slug}` `` so internal navigation goes straight to
   the canonical URL instead of bouncing through the redirect.
4. **Scope is the page-view route only**: `/wiki/:slug/edit` and `/wiki/:slug/history` keep their
   flat routing untouched — they still resolve by leaf slug regardless of a page's depth. Only the
   *links pointing at the view page* (e.g. "back to page" from the editor/history) change to use
   the canonical path.

Reconciling decisions 1 and 2 into one rule, applied only *after* the existing view-permission
check (so a 404 for "wrong path" and a 404 for "not allowed to view" stay indistinguishable to an
unauthorized caller — no hierarchy gets leaked pre-authorization):

```
requested segments == canonical segments        -> render normally
requested segments.length == 1 (bare flat slug)  -> 301 redirect to canonical URL
anything else (wrong/partial/reordered segments) -> 404
```

## Acceptance criteria

### 1. Path-computation helpers

**New `wiki/app/lib/wiki-page-path.server.ts`** (D1-backed, `.server` boundary) — recursive CTEs
in the same idiom as `page-archive.server.ts`'s `descendantsCte`, but walking up via `parent_id`:

- `getWikiCanonicalSlugPath(env, pageId): Promise<string[]>` — single page, root→leaf slugs.
  ```sql
  WITH RECURSIVE ancestry(id, slug, parent_id, depth) AS (
    SELECT id, slug, parent_id, 0 FROM pages WHERE id = ?
    UNION ALL
    SELECT pages.id, pages.slug, pages.parent_id, ancestry.depth + 1
    FROM pages JOIN ancestry ON pages.id = ancestry.parent_id
    WHERE ancestry.depth < 32
  )
  SELECT slug FROM ancestry ORDER BY depth DESC
  ```
- `getWikiCanonicalSlugPaths(env, pageIds): Promise<Map<string, string[]>>` — same idea with an
  `origin_id` passthrough column so many pages can be resolved in one query (SQLite's recursive
  CTE processes one queued row at a time, so `origin_id` just rides along per row and never mixes
  across origins). Chunk `pageIds` at 50 per call to stay under D1's bound-parameter ceiling.
  Used by list-style loaders (search, recent, favorites, admin pages) so they don't do it
  per-row.
- Cap depth defensively (32) against a corrupted cycle; this is a ceiling, not an expected depth
  — real trees here are ≤ 2 deep.

**New `wiki/app/lib/wiki-page-path.ts`** (pure, no `.server` suffix — safe in client bundles):
- `wikiPagePath(slugSegments: readonly string[]): string` → `` `/wiki/${segments.map(encodeURIComponent).join("/")}` ``
- `classifyWikiRequestPath(requested, canonical): "match" | "redirect" | "not-found"` implementing
  the rule above. Trivially unit-testable with no DB.

**Extend `wiki/app/lib/page-tree.ts`** with `buildSlugPathById(nodes: PageNode[]): Map<string, string[]>`
— walks the in-memory `PageNode` tree (already built for the sidebar) to produce root-relative
slug segments per id, so the sidebar doesn't need any new DB round trip.

### 2. The route itself

**`wiki/app/routes.ts`**: replace
```ts
route("/wiki/:slug", "routes/wiki.$slug.tsx"),
```
with
```ts
route("/wiki/*", "routes/wiki.$.tsx"),
```
React Router ranks static/dynamic-segment routes above splats regardless of array order (there's
already a splat precedent: `route("/api/images/*", "routes/api.images.$.ts")`), so `/wiki/new`,
`/wiki/:slug/edit`, and `/wiki/:slug/history` keep matching their exact shapes first; `/wiki/*`
catches everything else — both old single-segment and new multi-segment paths — through one route
module instead of two.

**Rename `wiki/app/routes/wiki.$slug.tsx` → `wiki.$.tsx`.** Keep the existing loader/action/JSX
almost entirely as-is; the only real change is:
- Parse `const segments = (params["*"] ?? "").split("/").filter(Boolean)`, look up the page by
  `segments.at(-1)` exactly like today's `params.slug ?? ""` lookup.
- Keep the existing 404 (missing/unpublished) and permission-check-driven 404/503 exactly where
  they are today.
- **After** the permission check passes, call `getWikiCanonicalSlugPath(env, page.id)`, run it
  through `classifyWikiRequestPath`, and branch: `"match"` → fall through to existing data
  loading unchanged; `"redirect"` → `throw redirect(wikiPagePath(canonical) + url.search, 301)`;
  `"not-found"` → `throw new Response("Not Found", { status: 404 })` (same shape as the existing
  404s).
- `action()`: same slug derivation (`segments.at(-1)`) replaces the three `params.slug` usages.
  No path validation needed in the action — it only needs to know which page a POST targets,
  exactly like today.
- Component: **no change** to the edit/history `Link`s (stay on `page.slug`, decision #4) or the
  OG `imagePath` (stays flat — `/og/wiki/:slug` isn't user-facing navigation). `location.pathname`
  driving the ja/en language tabs needs no change; it will just reflect whichever URL matched.

### 3. Call-site migration

No existing shared link-builder exists today — every call site inlines `` `/wiki/${slug}` ``.
Group by how much data each already has in scope:

- **In-memory tree, no DB call needed** — `wiki/app/components/PageTree.tsx:250,461`: compute
  `pathById = useMemo(() => buildSlugPathById(pages), [pages])` once at the top of the component,
  thread it down alongside the existing `currentSlug`/`expandedIds` props, and use
  `wikiPagePath(pathById.get(node.id) ?? [node.slug])` in the wiki branch (leave the
  `pageType === "task-list"` branch → `/tasks/${slug}` untouched, different route family).

- **List loaders without `parentId` today — wire the batch helper**: `wiki/app/routes/search.tsx`
  (lines ~352, 470), `recent.tsx:132`, `api.recent.ts` (feeds `RecentContent.tsx:84,115`),
  `api.favorites.tsx` (feeds `StarredContent.tsx:163`), `_index.tsx:157,291,321`,
  `admin.pages.tsx:155` (view link only — leave `:177`'s edit link on flat `page.slug`, decision
  #4). Each of these already returns a small/bounded set of page ids; call
  `getWikiCanonicalSlugPaths(env, ids)` once per loader and attach the resulting path to each row.

- **Single-page loaders — wire the single-page helper**: `api.page-access.$pageId.tsx:291` (wiki
  branch of the share-invitation email link; leave the `task-list` branch alone),
  `wiki.$slug.history.tsx` (its own `250,313,334` — all three are links to the *view* page, so all
  three become `wikiPagePath(canonicalSlugs)`; the history route's own URL stays flat per decision
  #4), and `wiki.$slug.edit.tsx` → `PageEditor.tsx:194` ("back to page" link).

- **Leave flat, no change** (with reasons already verified against the code): `wiki.new.tsx:68` —
  every page created via "New Page" has `parentId` unset today, so flat is already canonical, no
  parent-aware creation flow exists yet. `ZipImportDialog.tsx:94` — verified the redirect target
  is always the import's root page (`parentId === null`). `google-docs-markdown.server.ts:45,47`
  — rewrites Markdown links mid-import using only a slug map, no parent data available at that
  point, and the flat link still resolves via redirect regardless. `api.comments.ts:115,232` —
  one-off notification/email deep-links; a redirect-on-click is an acceptable UX for these,
  not worth a DB call per comment action.

- **Scoped pre-existing fix**: `wiki/app/lib/agent-notes.server.ts:134,193,259` — `pageUrl` (the
  browser-facing link returned from the "file an answer" tool) is flat today even though these
  pages are always parented under the fixed `ns-answers` page (`parent_id = NS_ANSWERS`,
  confirmed via `migrations/0043_seed_answers_namespace.sql`). Since the parent is a hard-coded
  constant here (not looked up), this is a pure string change, no DB helper needed:
  `wikiPagePath([ANSWERS_SLUG, parsed.body.slug])`. Do **not** touch the neighboring `path` field
  (`/wiki/${ANSWERS_SLUG}/${slug}`) — that's the agent workspace's own citation-path scheme
  (`wiki-adapter.ts`), already correct and unrelated to browser routing. Update the matching
  fixture in `wiki/app/routes/api.agent.notes.test.ts:97`.

## How to verify

- `pnpm --filter @gdgjp/wiki lint`, `pnpm --filter @gdgjp/wiki typecheck` (route rename changes
  the generated route-module type import), `pnpm --filter @gdgjp/wiki test`.
- New unit tests: `wiki-page-path.test.ts` for `classifyWikiRequestPath` (match / redirect /
  not-found, including a single-segment request whose canonical path is also single-segment —
  must NOT redirect) and `wikiPagePath` (segment encoding). Extend/add `page-tree.test.ts` for
  `buildSlugPathById` against a small fixture tree.
- Loader-level test(s) for `wiki.$.tsx` covering: exact multi-segment match → 200; flat request
  for a page with a parent → 301 to canonical (preserving `?lang=`); wrong intermediate segment →
  404; flat request for a root-level page → 200, no redirect; an unauthorized caller gets the same
  opaque 404/503 regardless of whether the path was right or wrong (no hierarchy leak).
- Manual check via `pnpm --filter @gdgjp/wiki dev`: create/use a parent+child page pair, confirm
  `/wiki/<parent>/<child>` renders, the old `/wiki/<child>` 301s to it, `/wiki/<wrong>/<child>`
  404s, and that sidebar/search/recent/starred/admin links go straight to the hierarchical URL
  with no redirect hop (check the Network tab). Confirm `/wiki/<slug>/edit` and `.../history`
  still work by leaf slug regardless of depth, and that "back to page" links from both land on the
  hierarchical URL.
- `wiki/tests/e2e/access-control.spec.ts` needs no change (its fixture page is root-level, so flat
  stays canonical for it) — but worth a quick read-through to confirm nothing else assumes a flat
  `/wiki/:slug` shape.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
