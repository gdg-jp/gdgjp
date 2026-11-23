# Open findings

Each finding is a counterexample that Alloy found in the model and that was then read
against `apps/accounts`. Paths are under `apps/accounts`. The verifier prints the current
steps on every run.

Both come from one design fact: the membership triggers act once, at the moment the last
active membership goes away. A write that was decided before that moment and lands after it
is not seen by the trigger and is not checked again.

## A1. A request that passed the membership check re-enables or creates a client

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

With requests that do not overlap, the property holds.

## A2. A token inserted after the purge works again when the owner returns

Property: a token issued before its client's owner lost membership never works again. The
migration says the same: restoring a membership does not restore a client's tokens, and
the owner must enable the client and authorize again.

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

`setDeveloperClientEnabled(false)` has the same shape: it deletes tokens in the batch that
disables the client, and a sign-in in flight inserts its rows afterwards.

## Seen while reading, not model-checked

- A grant survives the expiry of the sign-in that created it. Migration 0023 deletes a
  session's tokens when the session row is deleted. A session that expires is not deleted
  unless a first-party app asks about it (`app/features/oauth/rp-session.server.ts`). The
  installed `@better-auth/oauth-provider` refuses an access token whose session expired,
  but its refresh grant issues new tokens anyway, without a session link. A developer
  client can therefore keep refreshing after the user's 14-day session ended.
- `packages/gdg-lib/src/auth/bearer.ts` `getBearerIdentity` accepts an access token of any
  client through userinfo. Together with A1, a token obtained through a client that should
  be disabled is accepted as a Bearer token by the apps that use it.
- `app/features/auth/auth-redirect.ts` `safeReturnTo` accepts `/<TAB>/evil.example`. The
  WHATWG URL parser removes the tab and resolves it to `https://evil.example`. Not checked
  in a browser.
