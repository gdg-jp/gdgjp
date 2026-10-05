# Fix: wiki sidebar no longer highlights the active page

> Generated from Claude Code plan: `/Users/hari/.claude/plans/fix-a-bug-wiki-sequential-naur.md`

## Goal

Fix: wiki sidebar no longer highlights the active page

## Repo context

Commit `1982c2c` ("feat(wiki): serve pages at hierarchical URLs") changed the
wiki page route in [wiki/app/routes.ts:102](wiki/app/routes.ts:102) from
`route("/wiki/:slug", "routes/wiki.$slug.tsx")` to
`route("/wiki/*", "routes/wiki.$.tsx")`. The route param key therefore
changed from `slug` to the splat key `*` (a full hierarchical path like
`parent/child`, per [wiki/app/routes/wiki.$.tsx:69-70](wiki/app/routes/wiki.$.tsx:69)).

The layout component [wiki/app/routes/_app.tsx:75](wiki/app/routes/_app.tsx:75)
still does:

```ts
const { slug } = useParams();
```

and passes it straight through as `currentSlug` to `<Sidebar>`
([wiki/app/routes/_app.tsx:222](wiki/app/routes/_app.tsx:222)), which forwards
it to `PageTree`, which highlights a node via `node.slug === currentSlug`
([wiki/app/components/PageTree.tsx:204](wiki/app/components/PageTree.tsx:204)
and [:443](wiki/app/components/PageTree.tsx:443)).

Since the matched wiki route no longer produces a `slug` param (only `*`),
`useParams().slug` is now always `undefined` while viewing any wiki page, so
no sidebar item ever matches and the active-page highlight silently stopped
working. Other routes that still declare `:slug` (`/wiki/:slug/edit`,
`/wiki/:slug/history`, `/tasks/:slug`, etc. — unchanged in the same route
table) are unaffected.

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

- `pnpm --filter @gdgjp/wiki typecheck`
- `pnpm --filter @gdgjp/wiki exec vitest run` (or narrower: any existing
  `_app`/sidebar tests, plus `wiki/app/routes/wiki.$.test.ts` to ensure no
  regressions)
- Manually: `pnpm --filter @gdgjp/wiki dev`, open a nested wiki page (e.g.
  `/wiki/parent/child`) and confirm the corresponding sidebar tree item is
  highlighted; also check a top-level page (`/wiki/some-slug`) and an edit/
  history page still highlight correctly.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
