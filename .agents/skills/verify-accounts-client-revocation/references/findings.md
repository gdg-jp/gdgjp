# Findings

Each finding is a counterexample that Alloy found in the model and that was then read
against `apps/accounts`. Paths are under `apps/accounts`. The verifier prints the current
steps of any open finding on every run.

## Open findings

None.

## Fixed findings

Both came from one design fact: the membership triggers acted once, at the moment the last
active membership went away. A write that was decided before that moment and landed after
it was not seen by the trigger and was not checked again. Migration
`migrations/0026_developer_client_revocation_holds_for_late_writes.sql` and
`app/features/developer-apps/oauth-clients.server.ts` move the check to the late write
itself. `app/features/developer-apps/oauth-clients.server.revocation.test.ts` replays both
sequences on the migrated schema in `node:sqlite`; each replay failed before the fix.

### A1. A request that passed the membership check re-enabled or created a client

Property: an enabled developer client belongs to someone with an active chapter
membership.

1. A member opens the developer console and enables one of their clients, or creates a new
   one. `requireDeveloperAccess` reads `memberships` and finds an active row
   (`app/features/developer-apps/oauth-clients.server.ts`).
2. Before that request writes, an organizer or admin removes the member's last active
   membership. The trigger disables the member's clients and deletes their tokens
   (`migrations/0014_disable_owned_clients_without_membership.sql`).
3. The request writes `disabled = 0` on the client (`setDeveloperClientEnabled`), or inserts
   a new client with `disabled = 0` (`createDeveloperClient`). Neither statement looks at
   `memberships`.

The client is enabled and its owner belongs to no chapter. Nothing disables it later: the
triggers fire only when an active membership is lost, and this owner has none left to lose.
The owner can no longer open the developer console, but the client keeps working.

The window is the time between two statements of one request. The person being removed
chooses when to send the request and can repeat it. This sequence was replayed on
`schema.sql` in `node:sqlite` with the statements from the code: after step 3 the client row
has `disabled = 0` and the owner has no active membership.

With requests that do not overlap, the property held.

Fix: the `INSERT` of `createDeveloperClient` is an `INSERT ... SELECT ... WHERE EXISTS` on
an active membership of the owner, and the enabling `UPDATE` of
`setDeveloperClientEnabled` carries the same `EXISTS`. When the membership is gone at the
write, the statement changes nothing and the request answers 403. Migration 0026 also
disables every developer client that was already enabled while its owner had no active
membership.

### A2. A token inserted after the purge worked again when the owner returned

Property: a token issued before its client was revoked never works again. Migration 0014
says the same for membership loss: restoring a membership does not restore a client's
tokens, and the owner must enable the client and authorize again.

1. Someone signs in through a member's client. The token endpoint finds the client enabled.
2. Before the token rows are inserted, the member loses their last active membership. The
   trigger disables the client and deletes its tokens. The rows of step 1 do not exist yet.
3. The token endpoint inserts the token rows. The client is disabled, so the token does not
   work.
4. The member joins a chapter again and enables the client in the developer console.
5. The token of step 3 works, although it belongs to a grant from before the revocation.

Steps 1 and 3 are inside Better Auth. That the client check and the insert are separate
statements was read in the installed library, not executed. Steps 2 to 5 were replayed on
`schema.sql` in `node:sqlite`: a token row inserted after the purge is still there after the
owner returns and writes `disabled = 0`.

`setDeveloperClientEnabled(false)` had the same shape: it deleted tokens in the batch that
disabled the client, and a sign-in in flight inserted its rows afterwards. So did a scope
change in `updateDeveloperClient`.

Fix: a trigger on `oauthClient` (migration 0026) runs whenever a developer client is written
with `disabled = 1` or with different `scopes`, whichever path writes it: the owner, or the
membership triggers. It deletes the client's tokens, pending authorization codes, and
`developerClientGrantCode` records. The `BEFORE INSERT` token triggers of migration 0025
refuse a token whose code has no record, so the insert of step 3 aborts, before and after
step 4, and the token endpoint answers `invalid_grant`. The recording trigger now records a
code only while its client is enabled, so a code issued while the client is disabled can
never be exchanged. The installed `@better-auth/oauth-provider` copies
`authorizationCodeId` through refresh rotations, so a rotation in flight fails the same way.

## Seen while reading, not model-checked

- A grant survives the expiry of the sign-in that created it. This was written against
  migration 0023. Since migration 0025 it is the intended model for developer clients: the
  grant is the user's consent, which the user removes at `/settings/connected-apps`.
- `packages/gdg-lib/src/auth/bearer.ts` `getBearerIdentity` accepts an access token of any
  client through userinfo. With A1 fixed, a client can no longer be enabled for an owner
  outside every chapter, and UserInfo names the client (`https://gdgs.jp/claims/client`),
  but the Bearer check itself is unchanged and outside `apps/accounts`.
- `app/features/auth/auth-redirect.ts` `safeReturnTo` accepts `/<TAB>/evil.example`. The
  WHATWG URL parser removes the tab and resolves it to `https://evil.example` (Node 26
  `new URL("/\t/evil.example", "https://accounts.gdgs.jp")` gives `https://evil.example/`).
  It is an open redirect, not a revocation race, and is not fixed here. Not checked in a
  browser.
- An authorization request that read the client before a revocation can insert its code
  after the owner rejoined and enabled the client again; the code is then recorded and
  works. The user is authorizing at that moment through a client whose owner is a member,
  so this is treated as a new authorization. See "Bounds and assumptions" in `SKILL.md`.
