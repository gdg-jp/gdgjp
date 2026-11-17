# Stage 11 — sns contributors/X-account service-layer extraction

## Context

Like Stage 10's posts/media logic, sns's contributor management and X-account revoke/OAuth flows
are raw inline SQL directly in route actions rather than in `app/lib/`:
`app/routes/settings.contributors.tsx:14-25` (add/remove a contributor), `settings.x.tsx:12-18`
(revoke an X account), `x.connect.ts:11-23` and `x.callback.ts:21-55` (OAuth-transaction
insert/lookup for connecting a new X account). This stage moves contributor operations into
`app/features/contributors/` and X-account repository, OAuth, and provider concerns into
`app/features/x-accounts/`. The existing `app/lib/x.server.ts` provides the behavior to preserve —
`randomVerifier`, `codeChallenge`,
`xAuthorizationUrl`, `exchangeXCode`, `accessTokenForAccount`, `resolveXUsername`), so Stage 12's
CLI API routes have something to call.

Depends on: none — independent of Stage 10, can run in parallel with it and everything else (see
`00-overview.md`).

Read first: `sns/migrations/0000_init.sql`'s `sns_contributors` table (composite primary key
`(chapter_id, user_email)`, `COLLATE NOCASE`) and `x_accounts` table (`revoked_at` nullable
timestamp — revoke is a soft-delete, not a row delete, since published posts still reference
`x_account_id`). `sns/app/lib/access.server.ts`'s `isContributor` (already imported by
`access.server.ts` from `db.server.ts`). Move it into the contributor repository and update
`access.server.ts` to depend on that focused module; the feature must remain lower-level than the
session and CLI access adapters so this does not create a circular import.

## Design

### 1. `app/features/contributors/`

Create contributor types, repository, service, and `contributor-policy.ts`. Extract
`settings.contributors.tsx:14-25`'s list/add/remove logic into the feature, matching the table's
`COLLATE NOCASE` email comparison semantics exactly (a
case-insensitive email match must behave the same after extraction as the raw SQL did before).

The policy is explicit: organizer or super-admin for list/add/remove. Being a contributor grants
post access, never contributor administration.

### 2. `app/features/x-accounts/`

Move X account repository/OAuth/provider logic from `db.server.ts` and `x.server.ts` into focused
feature files. Add `listUsableXAccounts` and `revokeXAccount`; revoke sets `revoked_at` and does not
delete the row. Extract the OAuth transaction state into `x-oauth.service.server.ts`. The CLI can
list/revoke existing accounts; connecting one remains a browser OAuth workflow.

### API Contract

No HTTP/CLI surface in this stage — Stage 12 calls these directly:

```ts
// app/features/contributors/contributor.service.server.ts
export async function addContributor(
  deps: ContributorDependencies,
  chapterId: number,
  userEmail: string,
  grantedByUserId: string,
): Promise<void>

export async function removeContributor(
  deps: ContributorDependencies,
  chapterId: number,
  userEmail: string,
): Promise<void>

// app/features/x-accounts/x-account.service.server.ts
export async function listUsableXAccounts(
  deps: XAccountDependencies,
  chapterId: number,
): Promise<XAccountSummary[]>

export async function revokeXAccount(
  deps: XAccountDependencies,
  accountId: string,
  chapterId: number,
  expectedXUserId: string,
): Promise<void>
```

`ContributorDependencies` and `XAccountDependencies` expose focused repository/provider
interfaces. Services do not issue D1 queries or call X directly; Worker adapters construct the
dependencies from D1 and the X provider.

### 制約

- Do not delete an `x_accounts` row on revoke — set `revoked_at` only, matching the schema's soft-
  revoke design (`posts.x_account_id` has a `REFERENCES x_accounts(id)` foreign key with no
  `ON DELETE` clause, so a hard delete would break any post — published or not — that references
  a revoked account).
- Do not change the `sns_contributors`/`x_accounts`/`oauth_transactions` D1 schema.
- Do not change `settings.contributors.tsx`/`settings.x.tsx`/`x.connect.ts`/`x.callback.ts`'s
  external behavior — same redirect targets, same error messages, before and after.

## Files to touch

- `sns/app/features/{contributors,x-accounts}/`
- `sns/app/routes/{settings.contributors.tsx,settings.x.tsx,x.connect.ts,x.callback.ts}`

## Verification

1. Completion criteria: settings and OAuth routes call feature services instead of inline SQL;
   X account summaries are discoverable without exposing encrypted tokens; behavior is unchanged.
2. Commands:
   ```
   pnpm --filter @gdgjp/sns typecheck
   pnpm --filter @gdgjp/sns test
   ```
3. Regression to pin explicitly: `addContributor` on an email that differs only in case from an
   existing contributor row must be treated as the same contributor (matching `COLLATE NOCASE`) —
   write a test inserting `"Foo@Example.com"` then calling `addContributor(deps, chapterId,
   "foo@example.com", ...)` and asserting no duplicate row / no error, matching whatever the
   current inline SQL's behavior is (upsert vs. reject — confirm which, and preserve it).
4. Manual E2E: `pnpm --filter @gdgjp/sns dev`, add and remove a contributor through the settings
   UI, revoke an X account that has at least one published post referencing it, and confirm the
   published post still displays correctly (its `x_account_id` foreign key must not break).
