---
name: verify-accounts-client-revocation
description: Model-check accounts.gdgs.jp's promise that a developer's OAuth client and its tokens stop working when the owner has no active chapter membership, with Alloy 6 over the membership triggers, the developer console, and token issuance. Use after changing apps/accounts developer clients, membership triggers, or how oauthClient rows are written.
---

# Verify Accounts client revocation

Accounts lets an active chapter member create OAuth clients. Migration 0014 promises that
such a client is available only while its owner belongs to at least one chapter with an
active membership, and that losing the last one disables the client and deletes its tokens.
A break leaves someone outside every chapter with a working client: people who sign in
through it hand over their identity and chapter claims.

Migration 0026 makes the promise hold for writes that were decided before the revocation
and land after it. Creating or enabling a client is conditional on an active membership in
the same statement. Disabling a client, or changing its scopes, deletes its tokens, pending
codes, and grant-code records (migration 0025) in a trigger on `oauthClient`, and the token
insert triggers of migration 0025 refuse a token whose record is gone.

[model/clients.als](model/clients.als) is an Alloy 6 model of that promise. Every transition
in it is one D1 statement or one D1 batch in `apps/accounts`, with the triggers inside the
statement that fires them. The model checker tries every order of those statements inside
the bounds below. It checks the model, not the TypeScript or the SQL.

## Does your change touch this

Run the check when you change any of these in `apps/accounts`:

- `app/features/developer-apps/oauth-clients.server.ts`
- `migrations/0014_disable_owned_clients_without_membership.sql`,
  `migrations/0025_developer_client_grants_outlive_sessions.sql`, or
  `migrations/0026_developer_client_revocation_holds_for_late_writes.sql`, or a new
  migration that drops, replaces, or adds a trigger on `memberships`, `oauthClient`,
  `verification`, `oauthAccessToken`, or `oauthRefreshToken`, or rebuilds one of them or
  `developerClientGrantCode`
- `app/features/auth/auth.server.ts`, where it configures client registration
- the version of `@better-auth/oauth-provider`

Also run it when you write `oauthClient` from anywhere else. The script counts
`INSERT INTO oauthClient`, `UPDATE oauthClient`, `DELETE FROM oauthClient`, and writes of
`disabled` in every file under `apps/accounts/app` and `apps/accounts/workers`, and reports
a new one. Code that writes `memberships` needs no run: the triggers apply to every
statement, and the model lets a membership statement change a user's rows in any way.

## Run

From the repository root. It needs Node 22.18 or newer and a Java runtime on `PATH`.
Verified with Node 26.3.1 and Temurin 21.0.3 on macOS arm64.

```sh
node .agents/skills/verify-accounts-client-revocation/scripts/verify.mjs
node .agents/skills/verify-accounts-client-revocation/scripts/verify.mjs --mutation-proof
```

The first run downloads Alloy 6.2.0 (21 MB) to `local_data/pstack/tools/` and checks its
SHA-256. The version, URL, and hash are pinned in `scripts/verification/alloy.mjs`. On a
machine without network access, set `ALLOY_JAR` to a copy of that file. Either command
takes about 20 seconds.

The last line names a JSON report under `local_data/pstack/accounts-client-revocation/`.
It holds every result and every counterexample as numbered steps.

## Read the result

Each line is one check:

- `ok    <name>: holds` means Alloy found no trace that breaks the property.
- `ok    <name>: reachable` means a witness still exists: a token can work, a membership
  loss can revoke, an owner who returns can enable a client again, and a new authorization
  through that client works. Without these, the other checks could pass because nothing
  can happen.
- `open  <name>: finding A<n> still reproduces` means a recorded break of the product code
  is still there. The steps follow.
- `FAIL` means the result differs from `coverage.json`.

Exit codes:

- 0: every check matches `coverage.json` and the covered code is unchanged. Open findings
  are listed, and they are still bugs.
- 1: a property that held now has a counterexample, a recorded finding now holds, a witness
  vanished, a mutation was not caught, or the tool failed.
- 2: covered code changed. Nothing ran. See "When covered code changes".

## Properties

| Check | Property | Harm when it breaks | Now |
| --- | --- | --- | --- |
| `EnabledClientHasMemberOwnerWhenSerial` | When requests do not overlap, an enabled developer client belongs to someone with an active membership. | Someone outside every chapter keeps a working client. | holds |
| `EnabledClientHasMemberOwner` | The same, when requests may overlap. | Someone outside every chapter keeps a working client. | holds (was finding A1) |
| `RevokedTokenStaysDeadWhenSerial` | When requests and sign-ins do not overlap, a token issued before its client was revoked (its owner lost membership or disabled it) never works again. | A revoked grant works again without a new authorization. | holds |
| `RevokedTokenStaysDead` | The same, when a sign-in may be in flight while other statements run. | A revoked grant works again without a new authorization. | holds (was finding A2) |

[references/findings.md](references/findings.md) tells the fixed findings A1 and A2 as steps,
how migration 0026 closed them, and what was seen while reading.

## Bounds and assumptions

Alloy checks every trace of up to 14 states with exactly 2 chapters, 2 users, 2 developer
clients, 3 tokens, and 2 developer-console requests in flight at once. A pass says nothing
beyond these bounds.

The model assumes:

- A D1 statement, and a D1 batch, is atomic, and a trigger runs inside the statement that
  fires it. Statements of different requests interleave freely.
- A Worker can stop after any statement.
- A statement that leaves a user with no active membership, when the user had one before
  it, fires the trigger. This covers single-row deletes and updates, the admin's chapter
  list batch, and rows deleted by a chapter's foreign-key cascade. The cascade case rests
  on the migration's own statement of intent, not on a test.
- Better Auth, at the version in `coverage.json`, refuses a disabled client at the token
  endpoint, treats a disabled client's tokens as inactive, inserts token rows in a later
  statement than the one that reads the client, and writes the code's identifier into
  `authorizationCodeId` of every token, copying it through refresh rotations. These were
  read in the installed library, not executed. The SQL side (the triggers refusing a token
  whose grant record is gone) is replayed in
  `apps/accounts/app/features/developer-apps/oauth-clients.server.revocation.test.ts`.
- A token's grant-code record exists when the token endpoint reads its code. The model
  grants it at that read, which allows at least every record the real trigger writes.

It does not cover:

- seeded first-party clients, which have no owner and are outside the triggers;
- an authorization request that read the client before a revocation and inserts its code
  after the owner rejoined and enabled the client again. The code is then recorded and can
  be exchanged. The model treats that code as a new authorization, because the user is
  authorizing at that moment through a client whose owner is a member; codes inserted while
  the client is disabled are never recorded (migration 0026, tested in SQL);
- scope narrowing as a property: a scope change purges grants in the model, but no check
  states that tokens with the old scopes stop working;
- whether a grant outlives the browser sign-in that created it. Since migration 0025 it
  does by design: a developer client's grant is the user's consent, not the session;
- who is allowed to change memberships, and the last-organizer rules;
- Bearer tokens that wiki and connpass accept from any client through userinfo;
- whether the TypeScript and SQL do what the model says. `coverage.json` ties the two
  together, and a person keeps it true.

## When covered code changes

Exit code 2 lists each changed file, each new or removed call site, a changed library
version, and each anchor that no longer matches. An anchor is a line of production code
that a model transition stands for. `coverage.json` names the transition next to it.

1. Read the diff of every listed file since `syncedCommit` in `coverage.json`. For a new
   library version, reread how the token endpoint checks the client and when it inserts
   token rows.
2. For each change, decide whether it alters a step that the model describes: what
   `requireDeveloperAccess` checks, what a write to `oauthClient` requires or sets, when
   tokens are deleted, what a trigger does and when it fires, the order of statements in a
   request, or a new path that writes `oauthClient`.
3. If it does, change `model/clients.als` to say what the code now does. Keep one statement
   or batch as one transition. Write the change from the code, before you look at a result.
   Update the anchors and the `find` text of any mutation that no longer matches.
4. Run with `--allow-source-drift --mutation-proof`. This runs the checks against your
   updated model and still exits 2.
5. When every line is `ok` or a recorded `open`, and you have confirmed that the model
   describes the code, run with `--record`. It reruns everything, then writes the new
   hashes, call sites, library version, and `syncedCommit`. It writes nothing if any check
   differs.

Do not run `--record` to silence exit code 2. It moves the sync point, so run it only after
steps 1 to 3.

## A counterexample appears

Replay the steps against the code. Each step names what a request read or wrote, and
`coverage.json` gives the line.

- If a step cannot happen in the code, the model is wrong. Fix the model and say what was
  wrong.
- If every step can happen, the code breaks the property. Report it with the steps and the
  harm. Do not weaken the property, add a premise, or shrink a bound to make it pass, and do
  not change product code unless the user asked for the fix.

To confirm a counterexample on real SQL, load `apps/accounts/schema.sql` into `node:sqlite`
with `PRAGMA foreign_keys = ON` and run the statements from the code in the order of the
steps. The schema dump includes the triggers. A1 and A2 were confirmed that way, and
`oauth-clients.server.revocation.test.ts` keeps both replays as tests.

## A finding is fixed

When product code closes a finding, its check reports `FAIL ... but it now holds`. Update
the model for the fix as in "When covered code changes", set that check's `expect` to
`holds` in `coverage.json`, remove its `finding`, and add a mutation in `scripts/verify.mjs`
that removes the new guard from the model and names the check it must break. Then run
`--record`.

## Prove the check can fail

`--mutation-proof` copies the model, removes one guard per copy, and requires the named
property to fail. Each guard stands for production code:

| Mutation | Guard removed | Property that must fail |
| --- | --- | --- |
| `trigger-leaves-clients-enabled` | `UPDATE oauthClient SET disabled = 1` in the triggers | `EnabledClientHasMemberOwnerWhenSerial` |
| `trigger-leaves-tokens` | the token `DELETE`s in the triggers | `RevokedTokenStaysDeadWhenSerial` |
| `membership-loss-leaves-grant-records` | the `developerClientGrantCode` `DELETE` of migration 0026's trigger, as the membership triggers fire it | `RevokedTokenStaysDead` |
| `disable-leaves-grant-records` | the same `DELETE`, as `setDeveloperClientEnabled(false)` fires it | `RevokedTokenStaysDead` |
| `create-without-membership` | `WHERE EXISTS` (active membership) on the client `INSERT` | `EnabledClientHasMemberOwner` |
| `enable-without-membership` | the active-membership `EXISTS` on the enabling `UPDATE` | `EnabledClientHasMemberOwner` |

The membership check in `requireDeveloperAccess` has no mutation. Since the writes check
membership themselves, removing it breaks no property in the model; it still keeps a
non-member out of the console.

## Coverage record

[coverage.json](coverage.json) holds the SHA-256 of four source files, the call-site counts,
the library version, the anchors, the expected result of each check, and `syncedCommit`:
the commit at which the model was last confirmed to describe the code. Use
`/maintain-formal-verification-skill` when earlier changes skipped this review.
