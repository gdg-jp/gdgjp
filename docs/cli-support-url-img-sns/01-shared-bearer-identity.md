# Stage 01 — shared bearer identity and strict CLI identity

## Context

connpass and wiki each maintain an identical, hand-copied `getCliIdentity()` function
(`connpass/app/lib/cli-identity.server.ts`, `wiki/app/lib/cli-identity.server.ts`) that turns an
inbound `Authorization: Bearer <token>` header into a caller identity by forwarding it to
accounts' OIDC `/api/auth/oauth2/userinfo` endpoint. tinyurl/img/sns need the same normalized
identity shape behind a stricter CLI authorization boundary, and duplicating parsing a third,
fourth, and fifth time compounds an already-acknowledged duplication. This stage extracts shared implementations into
`gdg-lib/src/auth/` and migrates the two existing copies onto the compatibility-preserving one.
tinyurl/img/sns (Stages 03, 06, 07, 08, 12, 13 — see `00-overview.md` for the full dependency
graph) consume the strict helper without
writing their own copy.

Read first: `gdg-lib/CLAUDE.md`'s "Types are an API contract" section — `AuthUser`/`UserClaims`/
`UserChapter` changes ripple into every RP via `workspace:*` — and `connpass/CLAUDE.md` ("Auth:
Bearer GDG Accounts access token (CLI / agents)").

The existing copies forward to OIDC `/userinfo`. That authenticates a token but does not prove it
was granted `https://gdgs.jp/scopes/cli`: developer clients may receive identity and chapter
claims without permission to mutate CLI resources. Accounts already has the correct primitive,
`requireCliTokenUser`, which verifies the access-token row and CLI scope. This stage exposes that
check through an Accounts-internal CLI identity endpoint and shares its strict consumer for all new
mutation APIs.

That strict check is intentionally narrower than the existing wiki/connpass contract:
`requireCliTokenUser` requires both `clientId = "gdg-cli"` and the CLI scope. Wiki's `/api/agent/*`
surface is called with linked-user tokens issued to the legitimate `agents` OAuth client, whose
seeded/requested scopes currently exclude the CLI scope. Therefore connpass/wiki must not be moved
to the strict helper as a supposedly behavior-preserving refactor. They consume a second shared
helper that keeps their current `/userinfo` semantics. This removes the duplicate local parsing
without silently breaking the agents product or widening the new mutation APIs.

Existing types this must slot into (`gdg-lib/src/auth/index.ts`): `AuthUser = { id, email, name,
image, isAdmin }`, `UserChapter = { chapterId: number, chapterSlug: string, role: "organizer" |
"member" }`. Every downstream app's permission function already takes `AuthUser`/`UserChapter` as
input (`img/app/lib/permissions.ts`'s `canMutateImage(user: AuthUser, image)`,
`tinyurl/app/lib/permissions.ts`'s `canManageChapterDomains(user: AuthUser, chapter: UserChapter)`,
`sns/app/lib/access.server.ts`'s `requireSnsAccess`). So returning these exact types — rather than
connpass's bespoke `CliIdentity` shape, whose `chapters` entries type `chapterId` as
`string | number` even though the runtime check only ever accepts `number` — means Stages 03, 06,
07, 08, 12, 13 can call each app's existing permission functions directly, with zero adapter code.

Depends on: none. This is the first stage every CLI API stage in the plan needs.

## Design

### 1. Accounts endpoint: `GET /api/cli/v1/identity`

Add an Accounts route that reads the `Authorization` header and calls the existing
`requireCliTokenUser(env, authorization)` (`accounts/app/lib/oauth-clients.server.ts:396-412`).
It returns only `{ id: string }` (the row's `userId`) — it does **not** return email/name/image/
isAdmin/chapters, so the route must assemble the rest of the identity itself from two already-
exported primitives, not from the private `chapterClaims` helper in `auth.server.ts` (which is
unexported and additionally expects an already-loaded user object as a parameter — do not export
it just for this):

1. Look up the profile row via `getUserById(env.DB, id)`
   (`accounts/app/lib/db.ts:588-594`). **This stage must first extend that function's return
   type**: today's `UserSummary = { id, email, name }` and its `SELECT id, email, name FROM
   "user" WHERE id = ?` omit the `image` and `is_admin` columns that actually exist on the `user`
   table (`accounts/schema.sql:22-27`: `id, name, email, image, is_admin, created_at,
   updated_at, email_verified`). Widen `UserSummary` to `{ id, email, name, image: string | null,
   isAdmin: boolean }` and the query to `SELECT id, email, name, image, is_admin FROM "user"
   WHERE id = ?`, mapping `is_admin` (`0`/`1`) to a boolean. This is additive to `UserSummary`'s
   shape — existing callers destructuring only `{ id, email, name }` are unaffected — but confirm
   by grepping `UserSummary`'s other call sites before assuming zero blast radius. If no row is
   found for the id `requireCliTokenUser` returned (shouldn't happen given the foreign key, but
   defensive), return `401`, not a 500.
2. Look up chapter memberships via the already-exported `listActiveChaptersForUser(env.DB, id)`
   (`accounts/app/lib/db.ts:285-303`), which already returns `UserChapter[]`
   (`{ chapterId, chapterSlug, role }`) directly — no reshaping needed.
3. Return `{ user: { id, email, name, image, isAdmin }, chapters }`.

Because `requireCliTokenUser` queries `clientId = "gdg-cli"`, both that client id and a stored
`https://gdgs.jp/scopes/cli` scope are required for step 1 to succeed at all. Return `401 { error:
"invalid_token" }` for missing, expired, revoked, malformed, or non-CLI-scoped tokens (i.e. any
rejection from `requireCliTokenUser` itself) and set `Cache-Control: no-store`. Do not expose
refresh-token ids, raw scopes, or access-token records.

This is an Accounts API route, not an OIDC `/userinfo` extension: its purpose is authorization for
first-party CLI operations. Add it to Accounts OpenAPI and test explicitly that (a) a valid token
without the CLI scope is rejected, and (b) the response's `user.image`/`user.isAdmin` fields
actually reflect the `user` table row, not `null`/`false` defaults — this is the regression the
`UserSummary` extension in step 1 exists to prevent.

### 2. New module: `gdg-lib/src/auth/bearer.ts`

```ts
export async function getBearerIdentity(
  request: Request,
  accountsUrl: string,
): Promise<BearerIdentity | null>

export type BearerIdentity = { user: AuthUser; chapters: UserChapter[] };

export async function getCliIdentity(
  request: Request,
  accountsUrl: string,
): Promise<{ user: AuthUser; chapters: UserChapter[] } | null>
```

`getBearerIdentity` is the compatibility path. It calls
`/api/auth/oauth2/userinfo`, accepts any valid OAuth client token as today, requires a non-empty
`sub`, defaults missing optional string claims exactly as the local implementations do, and drops
individual malformed chapter entries while preserving valid memberships. This leniency is part of
the existing authorization contract and is covered before deleting the local copies.

`getCliIdentity` is the strict path for Stages 03/06/07/08/12/13:

1. Read `request.headers.get("authorization")`. If missing, or not `"Bearer "`-prefixed, return
   `null`.
2. `fetch(new URL("/api/cli/v1/identity", accountsUrl), { headers: { authorization } })`.
   If `!response.ok`, return `null`.
3. Parse the JSON body and validate the complete boundary: `user.id/email/name/isAdmin`, nullable
   image, and every
   chapter entry. A malformed Accounts response is an integration failure and returns `null`; do
   not silently drop selected entries and continue with a partial authorization context.
4. Return `{ user: AuthUser, chapters: UserChapter[] }`.

`accountsUrl` is a plain string parameter, not read from `env` inside the function — callers
control where it comes from. Each app already has an `ACCOUNTS_URL` env var (or, for connpass,
an e2e override on top of it); that override logic stays app-local, resolved by the caller before
calling the corresponding shared helper, not rebuilt inside `gdg-lib`.

Export both functions from `gdg-lib/src/auth/index.ts` alongside the existing types. They may share
private parsing utilities, but the lenient compatibility behavior and strict CLI behavior must be
separate named exports; do not expose a boolean `strict` option at call sites.

### 3. Migrate connpass and wiki onto it

Delete both duplicated `app/lib/cli-identity.server.ts` files rather than leaving permanent thin
wrappers. Export `BearerIdentity` from gdg-lib and update every production/test import to use
`getBearerIdentity`/`BearerIdentity` directly. Wiki calls
`getBearerIdentity(request, env.ACCOUNTS_URL)`. Move connpass's e2e-aware URL resolution into a
focused `app/lib/accounts-url.server.ts`, then call
`getBearerIdentity(request, accountsBaseUrl(env))`.

This is a source-level import/signature migration across all consumers, not a zero-caller-change
swap. Its HTTP authorization behavior remains compatible because those consumers still call
`/userinfo`. Do not route them through `/api/cli/v1/identity` unless a separate breaking migration
first changes every non-`gdg-cli` caller and its OAuth scopes.

The current direct consumer inventory that regression coverage must protect is:

- connpass: `app/lib/event-route.server.ts`; `app/routes/api.jobs.$jobId.ts`;
  `api.admin.groups.ts`, `api.admin.groups.$groupId.ts`, `api.admin.session.relogin.ts`; and all
  `api.groups.$groupId.events*` route files (collection/detail, conference, publish, sub-events,
  survey).
- wiki: `app/lib/agent-workspace.server.ts`; `api.cli.wiki.{agents-md,chat-senders,snapshot,
  sources,sync,validate-acl}.ts` plus source-content and attachment routes; and every
  `api.agent.*` route reached through `resolveAgentWorkspace`.

Re-run `rg -n "getCliIdentity|cli-identity\\.server" connpass/app wiki/app` when implementing and
update this inventory if the tree has changed. Completion requires zero matches and deletion of
both local files. Tests must include both a `gdg-cli` token and an `agents` client token for wiki;
the latter must continue to work through `/userinfo`.

### 4. Update architecture documentation

Add a line under `gdg-lib/CLAUDE.md`'s "Architecture" section distinguishing
`src/auth/bearer.ts`'s compatibility and strict consumers. connpass/wiki use
`getBearerIdentity`; tinyurl/img/sns mutation APIs use `getCliIdentity`.

### API Contract

Accounts HTTP contract:

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/cli/v1/identity` | `gdg-cli` access token containing the GDG CLI scope | `200 { user: AuthUser, chapters: UserChapter[] }` | `401 { error: "invalid_token" }` |

Shared consumer signature:

```ts
getBearerIdentity(request: Request, accountsUrl: string): Promise<BearerIdentity | null>
// /userinfo compatibility; malformed chapter rows are dropped

getCliIdentity(request: Request, accountsUrl: string): Promise<{
  user: AuthUser;          // { id, email, name, image, isAdmin }
  chapters: UserChapter[]; // { chapterId: number, chapterSlug: string, role: "organizer" | "member" }
} | null>
```

The strict helper returns `null` for a missing/malformed Authorization header, non-OK CLI identity
response, or any invalid response field. The compatibility helper preserves today's `/userinfo`
normalization and drops only malformed chapter rows. Neither helper catches network-level `fetch`
exceptions. Only the compatibility helper is behavior-preserving for connpass/wiki.

### 制約

- Do not change `AuthUser`, `UserChapter`, `UserClaims`, or `ChapterRole` in
  `gdg-lib/src/auth/index.ts`. Per `gdg-lib/CLAUDE.md`, those types ripple into every RP via
  `workspace:*`, and any change requires updating accounts' `/userinfo` response in lockstep —
  out of scope here. This stage only adds `bearer.ts`; it does not touch existing types.
- Do not change `connpass/app/lib/authorize.server.ts` or wiki authorization logic beyond the
  necessary shared `BearerIdentity` type import. Authorization decisions remain unchanged.
- Do not modify `/api/auth/oauth2/userinfo` or add the CLI scope to its response. The new
  `/api/cli/v1/identity` endpoint has a different authorization purpose.

## Files to touch

- `accounts/app/routes/api.cli.v1.identity.ts` and `accounts/app/routes.ts`
- `accounts/app/lib/db.ts` (widen `UserSummary`/`getUserById` to include `image`/`isAdmin`,
  per Design step 1 — do not add a second, parallel user-lookup function)
- `accounts/openapi/` (document the CLI identity endpoint)
- generated Accounts TypeScript and Go OpenAPI clients (regenerate; never hand-edit)
- `gdg-lib/src/auth/bearer.ts` (new; compatibility and strict consumers)
- `gdg-lib/src/auth/index.ts` (add export)
- `gdg-lib/CLAUDE.md`
- `connpass/app/lib/cli-identity.server.ts`, `wiki/app/lib/cli-identity.server.ts` (delete)
- `connpass/app/lib/accounts-url.server.ts` (move the e2e-aware Accounts URL resolver)
- every connpass/wiki production and test consumer listed above (direct shared import/signature)
- `connpass/e2e/mock-idp.mjs` and connpass identity/route tests (preserve `/userinfo` behavior)
- wiki CLI/agent route identity tests (pin both `gdg-cli` and `agents` callers)

## Verification

1. Completion criteria: Accounts rejects tokens that lack either `clientId = "gdg-cli"` or the CLI
   scope; both shared helpers are exported; new mutation stages use only `getCliIdentity`;
   both local duplicate files are deleted with all consumers using `getBearerIdentity`; and their
   existing route behavior remains unchanged, including valid `agents` tokens and partial chapter
   normalization.
2. Commands:
   ```
   pnpm --filter @gdgjp/accounts typecheck && pnpm --filter @gdgjp/accounts test
   pnpm --filter @gdgjp/gdg-lib typecheck && pnpm --filter @gdgjp/gdg-lib test
   pnpm --filter @gdgjp/connpass typecheck && pnpm --filter @gdgjp/connpass test
   pnpm --filter @gdgjp/wiki typecheck && pnpm --filter @gdgjp/wiki test
   pnpm openapi:lint && pnpm openapi:check
   ```
3. Required security regressions: a token from `gdg-cli` without the CLI scope and a token from a
   different client even if it somehow carries the CLI scope both receive `401` from the strict
   endpoint; a valid `gdg-cli` token succeeds. Update connpass's mock Accounts server on `:5181`
   only as needed to preserve its `/userinfo` contract. Wiki agent-route tests must prove an
   `agents` client token still succeeds, while new CLI mutation API tests prove it is rejected.
   Additionally: a test user with `image` set and `is_admin = 1` in D1 must get back
   `user.image`/`user.isAdmin` matching those exact values from `GET /api/cli/v1/identity` — this
   is the regression that would silently reappear if a future change reverted `getUserById` back
   to its narrower `{ id, email, name }` shape.
4. Manual E2E: with `pnpm --filter @gdgjp/connpass dev` running, `curl -H "Authorization: Bearer
   <a valid gdg-cli access token>" http://localhost:5179/api/groups` and confirm the response is
   identical (same status, same body shape) to before this stage's changes; then repeat with no
   `Authorization` header and confirm a `401`.
