# Stage 06 — tinyurl links/tags/folders CLI API

## Context

Stage 05 extracted `createLinkWithExtras`/`updateLinkWithExtras` into
`tinyurl/app/features/links/link.service.server.ts`. This stage adds CLI-scoped JSON routes for link CRUD,
tags, and folders (sharing is part of link create/update per Stage 05's `shares` field — not a
separate resource) built on top of those functions, under a separate `api.cli.v1.*` namespace from
the existing cookie routes (`api.links.tsx`, `links.$id.tsx`, `tags.tsx`, `folders.tsx`), which
keep their HTTP/UI behavior while their tag/folder imports move. Domains (Stage 07) and campaigns (Stage 08) are explicitly out of scope here — they
get their own CLI routes in later stages, partly because domain provisioning needs the async
Job+Queue pattern this stage's endpoints don't.

Depends on Stage 01 (`getCliIdentity`) and Stage 05 (`createLinkWithExtras`/
`updateLinkWithExtras` — call them directly, do not reimplement their validation inline in the new
routes).

Read first: `tinyurl/CLAUDE.md`'s "Authorization" section (`link_permissions` grants, "Email-as-
principal is intentional", `visibility = 'public'`, `isSuperAdmin` short-circuit) — the new routes
must enforce the same rules Stage 05's functions and `app/lib/permissions.ts`'s
`canViewLink`/`canEditLink` already implement; call those functions, don't re-derive the rules.

## Design

### 1. New route files under `tinyurl/app/routes/api.cli.v1.*.ts`

Every route: `getCliIdentity(request, env.ACCOUNTS_URL)` (Stage 01) → `401 { error:
"invalid_token" }` if `null` → for single-link operations, load the link and check
Stage 05's link policy → `403 { error: "forbidden" }` if false → call the link service. Read
operations that Stage 05 did not need must be added to the feature repository, not reached through
the legacy catch-all `app/lib/db.ts` from a new route.

- `POST /api/cli/v1/links` — create, via `createLinkWithExtras`.
- `GET /api/cli/v1/links` — bounded list of the caller's visible links (owned, any chapter-owned,
  shared, or
  public — same visibility rule as `canViewLink`), with `?folderId=`/`?tagId=` filters mirroring
  the dashboard's existing filter query params.
- `GET /api/cli/v1/links/:id` — single link, gated by the link policy.
- `PATCH /api/cli/v1/links/:id` — via `updateLinkWithExtras`, gated by the link policy.
- `DELETE /api/cli/v1/links/:id` — soft delete (sets `deleted_at`, matching the existing
  `deleteLink` semantics used by the cookie route), gated by `canEditLink`.
- `GET|POST /api/cli/v1/tags` and `PATCH|DELETE /api/cli/v1/tags/:id` — bounded list plus
  create/update/delete, scoped to the caller exactly like `tags.tsx`.
- `GET|POST /api/cli/v1/folders` and `GET|PATCH|DELETE /api/cli/v1/folders/:id` — bounded list plus
  get/create/update/delete, preserving existing `canViewFolder`/`canEditFolder`, non-empty-folder,
  and nested-folder behavior.

Create focused `app/features/tags/` and `app/features/folders/` repositories/services/policies by
moving the owned functions out of the catch-all `app/lib/db.ts`. New routes must not import that
catch-all directly. Existing dashboard routes consume the new boundaries in the same stage so
there remains one implementation of each mutation.

### 2. Extend `tinyurl/openapi/`

Add `paths/cli-links.yaml`, `paths/cli-tags.yaml`, `paths/cli-folders.yaml`. tinyurl's
`openapi/` today only documents the public redirect and the HMAC-signed internal gateway API
(`GatewayTimestamp`/`GatewaySignature`/`GatewayHost` security schemes) — add a `BearerAuth`
security scheme (matching the shape Stage 03 added to img's, or Stage 01's contract directly:
`type: http, scheme: bearer`) alongside the existing gateway schemes, don't replace them.

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/cli/v1/links` | CLI Bearer | `{ domainId, slug, destinationUrl, title?, description?, ogImageUrl?, visibility, tagIds?, newTagNames?, comment?, campaignChannelId?, folderId?, shares? }` | `201 { link: Link }` | `400`, `401`, `403`, `404`, `409` |
| `GET` | `/api/cli/v1/links` | CLI Bearer | query: `folderId?`, `tagId?`, `limit?`, `cursor?` | `200 { links: Link[], nextCursor }` | `400`, `401` |
| `GET` | `/api/cli/v1/links/:id` | CLI Bearer | — | `200 { link: Link }` | `401`, `403`, `404` |
| `PATCH` | `/api/cli/v1/links/:id` | CLI Bearer | partial create body minus `domainId` | `200 { link: Link }` | `400`, `401`, `403`, `404` |
| `DELETE` | `/api/cli/v1/links/:id` | CLI Bearer | — | `200 { id, deleted: true }` | `401`, `403`, `404` |
| `GET` | `/api/cli/v1/tags` | CLI Bearer | query: `limit?`, `cursor?` | `200 { tags: Tag[], nextCursor }` | `400`, `401` |
| `POST` | `/api/cli/v1/tags` | CLI Bearer | `{ name, color? }` | `201 { tag: Tag }` | `400`, `401` |
| `PATCH` | `/api/cli/v1/tags/:id` | CLI Bearer | `{ name?, color? }` | `200 { tag: Tag }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/api/cli/v1/tags/:id` | CLI Bearer | — | `200 { id, deleted: true }` | `401`, `403`, `404`, `409` |
| `GET` | `/api/cli/v1/folders` | CLI Bearer | query: `parentFolderId?`, `limit?`, `cursor?` | `200 { folders: Folder[], nextCursor }` | `400`, `401` |
| `POST` | `/api/cli/v1/folders` | CLI Bearer | `{ name, parentFolderId? }` | `201 { folder: Folder }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/folders/:id` | CLI Bearer | — | `200 { folder: Folder }` | `401`, `403`, `404` |
| `PATCH` | `/api/cli/v1/folders/:id` | CLI Bearer | `{ name }` | `200 { folder: Folder }` | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/api/cli/v1/folders/:id` | CLI Bearer | — | `200 { id, deleted: true }` | `401`, `403`, `404`, `409` |

`Link` is `app/lib/db.ts`'s existing exported type; response bodies wrap it in a named field
(`link`/`links`) rather than returning it bare, matching connpass's `GetEventResponse`/
`ListEventsResponse` envelope convention (`{ groupId, event }` / `{ groupId, events }`) — here
there's no equivalent "parent id" to include, so the envelope is just `{ link }`/`{ links }`.

### 制約

- Do not implement domain creation/provisioning here — `POST /api/cli/v1/links` requires an
  already-`active` `domainId` (Stage 05's `createLinkWithExtras` already enforces this); domain
  provisioning is Stage 07's async endpoint.
- Do not implement campaign-channel creation here — `campaignChannelId` in the create/update body
  must reference an existing channel (Stage 08 adds the endpoints that create one); this stage
  only accepts the id as a foreign key.
- Preserve the existing `canViewLink`/`canEditLink`/`matchingRole` semantics in Stage 05's link
  policy and make both CLI and dashboard adapters call it. The dashboard passes one currently
  selected `chapterId`; the CLI evaluates the same policy once per bearer identity membership and
  allows if any membership matches. That is deliberately more permissive than the current UI
  selection, not an "identical to UI" claim. If CLI callers appear to need a
  permission nuance cookie-session callers don't, that's
  a sign the shared function needs a deliberate, separately-reviewed change — flag it rather than
  forking a CLI-only copy.

## Files to touch

- `tinyurl/app/routes/api.cli.v1.{links,links.$id,tags,tags.$id,folders,folders.$id}.ts` (new)
- `tinyurl/app/routes.ts` (register)
- `tinyurl/app/features/links/` (consume Stage 05's service/repository/policy; the policy accepts
  all caller chapter ids rather than selecting one, and routes add no parallel permission helper)
- `tinyurl/app/features/{tags,folders}/` plus existing `tags.tsx`/`folders*.tsx` adapters (move
  owned operations out of `app/lib/db.ts`; both browser and CLI routes consume them)
- `tinyurl/openapi/paths/cli-{links,tags,folders}.yaml` (new),
  `tinyurl/openapi/components/security-schemes.yaml` (add `BearerAuth`)

## Verification

1. Completion criteria: every endpoint works against a real CLI-scoped token, tags/folders can be
   managed through completion, no new route imports the catch-all `app/lib/db.ts`, and link access
   evaluates the dashboard policy across all caller memberships.
2. Commands:
   ```
   pnpm --filter @gdgjp/tinyurl typecheck && pnpm --filter @gdgjp/tinyurl test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- tinyurl/openapi
   ```
3. Regression to pin explicitly: a bearer-token caller who is neither the link's owner, its
   chapter's member, nor a share grantee must get `403` on `GET /api/cli/v1/links/:id` for a
   *private* link, and `200` for a *public* one — this is the exact rule `canViewLink` encodes
   today (`tinyurl/CLAUDE.md`'s "Authorization" section) and is easy to get subtly wrong when
   porting to a new route.
   Add a multi-membership case where only the non-selected-equivalent chapter matches, proving the
   machine API evaluates all memberships deliberately.
4. Manual E2E: `pnpm --filter @gdgjp/tinyurl dev`, then with a valid bearer token, create a link
   via `POST /api/cli/v1/links`, list it via `GET /api/cli/v1/links`, edit its title via `PATCH`,
   and delete it via `DELETE` — confirm each response matches the API Contract table and that the
   link disappears from the dashboard UI's list after the delete.
