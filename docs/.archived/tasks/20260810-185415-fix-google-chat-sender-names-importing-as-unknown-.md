# Fix Google Chat sender names importing as `Unknown user (users/…)`

> Generated from Claude Code plan: `/Users/hari/.claude/plans/in-wiki-app-curious-narwhal.md`

## Goal

Fix Google Chat sender names importing as `Unknown user (users/…)`

## Repo context

Importing a Google Chat space from `/sources` produces Markdown where every message heading
reads `### [2026-08-10 12:03] Unknown user (users/111503568926175343887)` — each sender showing
their own distinct ID. Names never resolve, for anybody.

**Root cause: the only two name sources the importer uses require a Google Workspace domain,
and the spaces being imported belong to free (consumer) Google accounts.**

Sender resolution today ([google-chat-import.ts:247](wiki/workers/features/sources/google-chat-import.ts:247), `stepSenders`) tries exactly two things:

1. `people:listDirectoryPeople` with `sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`
   ([google-chat.ts:529](wiki/workers/features/sources/google-chat.ts:529)) — reads the **Workspace domain directory**. A consumer
   account has no domain directory, so this 403s. The non-OK branch returns `complete: true`
   ([google-chat.ts:558](wiki/workers/features/sources/google-chat.ts:558)), silently degrading to step 2.
2. `people:batchGet` on `people/{id}` ([google-chat.ts:583](wiki/workers/features/sources/google-chat.ts:583)) — the People API only returns a
   profile for yourself, your contacts, or your domain directory. For arbitrary consumer
   accounts it returns a row with no `names`, so `displayNameFromPerson` yields `undefined`.

Both fail for every sender, and `defaultSenderName` ([google-chat.ts:179](wiki/workers/features/sources/google-chat.ts:179)) bakes
`Unknown user (users/…)` into `senders.display_name`, which then lands in the document.

The third source — `message.sender.displayName`, which the Chat API returns in the same payload
the importer already downloads — is **deliberately discarded**. `ChatMessageSender`
([google-chat.ts:16](wiki/workers/features/sources/google-chat.ts:16)) does not even declare the field, a test asserts the resource-id
fallback "rather than a sender displayName" ([google-chat.test.ts:131](wiki/workers/features/sources/google-chat.test.ts:131)), and
`docs/google-chat-setup.md` justifies it as preferring directory names over "an unverified Chat
payload". That policy is why a Workspace-less import has nothing left to fall back to.

**Intended outcome:** use the Chat payload's own display name as a fallback tier, so consumer
spaces get real names, while directory-verified names still win where a Workspace exists.

> One honest caveat, and the reason verification step 0 below comes first: Google documents that
> "when a Chat app authenticates as a user, the output for a `User` resource only populates the
> user's `name` and `type`" ([User reference](https://developers.google.com/workspace/chat/api/reference/rest/v1/User)). Wiki uses user OAuth. If that note holds for
> `spaces.messages.list` in practice, `sender.displayName` will be absent and this fix changes
> nothing — see [Contingency](#contingency). The note is about Chat *apps*, the repo's own
> rationale was about trust rather than absence, and the check costs one curl, so confirm before
> building.

## Acceptance criteria

### 1. Accept and prefer the payload display name

`wiki/workers/features/sources/google-chat.ts`

- Add `displayName?: string` to `ChatMessageSender` (:16).
- Reorder `defaultSenderName` (:179) precedence to: trimmed `sender.displayName` →
  `"Bot"` when `type === "BOT"` → `Unknown user (${name})` → `"Unknown user"`.
  Existing assertions pass senders with no `displayName`, so they stay green.

### 2. Stop writing `Unknown user` into the sender table

Right now an unresolved sender is stored as the literal string `Unknown user (users/…)`, which
outranks the payload name at render time and can never be improved by a later run. Make
"attempted but unresolved" a distinct state instead of a name.

`wiki/workers/features/sources/import/do-store.ts`

- Add `lookup_done INTEGER NOT NULL DEFAULT 0` to the `senders` table (:12). `start()` calls
  `storage.deleteAll()` before re-running the schema helper
  ([source-import-durable-object.ts:34](wiki/workers/source-import-durable-object.ts:34)), so each run gets a fresh table — but the
  constructor also runs the helper against possibly-stale storage, so add a
  `try { ALTER TABLE senders ADD COLUMN lookup_done … } catch {}` guard for a run in flight
  across a deploy.

`wiki/workers/features/sources/google-chat.ts`

- Change `resolvePeopleDisplayNames` (:583) to return
  `{ names: Map<string, string>; attempted: Set<string> }` — real names only, plus every sender
  it actually issued a request for. Delete the `defaultSenderName` calls in its three failure
  branches (:621, :650, :656); keep the `warnGoogleChat` diagnostics and the `BOT → "Bot"`
  short-circuit.
- In `resolveDirectoryPeopleDisplayNames` (:558), log a distinct event when the directory is
  unavailable (403/404) so "this account has no Workspace directory" is visible in logs rather
  than indistinguishable from an empty directory.

`wiki/workers/features/sources/google-chat-import.ts`

- `stepSenders` (:247): select unresolved as `WHERE display_name IS NULL AND lookup_done = 0`;
  after the batchGet, `UPDATE senders SET display_name = ?` for `names` and
  `UPDATE senders SET lookup_done = 1` for every member of `attempted`. Drop the
  `startsWith("Unknown user")` string-sniffing that currently derives the counters (:312–317) —
  take them from `names.size` and `attempted.size - names.size`. The resumability check at :328
  becomes `WHERE display_name IS NULL AND lookup_done = 0`, preserving the existing
  "don't burn Unknown user into a document on a budget stop" guarantee (:332).
- `indexMessage` (:174): store `message.sender.displayName?.trim() || 'Bot'` for BOT senders so a
  named webhook keeps its name.
- `stepFinalizing` (:614): build `senderNames` from **non-null** `display_name` rows only, and
  make the resolver fall through to the payload:
  ```ts
  resolveSenderName: (sender) =>
    (sender?.name ? senderNames.get(sender.name) : undefined) ?? defaultSenderName(sender),
  ```
  Final precedence: directory → People batchGet → Chat payload `displayName` → `Unknown user (…)`.

### 3. Tests

- `google-chat.test.ts`: `defaultSenderName` returns the payload display name when present and
  still returns the resource-id fallback without one (keep :131 as-is); `normalizeChatMessages`
  renders the payload name when the resolver has no entry. Update :294 to the new
  `{ names, attempted }` shape.
- `google-chat-scopes.test.ts`: update the 250-sender batching assertion (:65+) to the new shape.
- `google-chat-import.test.ts`: a full-import case where directory + batchGet both resolve
  nothing and the finalized Markdown still shows payload names, plus one asserting a
  directory-resolved name outranks the payload.

### 4. Docs

`docs/google-chat-setup.md`: replace the paragraph declaring `Unknown user (users/...)` intended
behaviour with the new precedence, and note that consumer-account spaces resolve names from the
Chat payload and get nothing from `directory.readonly`.

`REQUIRED_GOOGLE_CHAT_SCOPES` stays unchanged — dropping `directory.readonly` would force every
connected account through a reauth for no gain here.

## How to verify

**0. Confirm the payload actually carries the name (do this first — the fix depends on it).**
With an access token carrying the Chat scopes (per `docs/google-chat-setup.md`), against one of
the affected consumer-account spaces:

```bash
curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" 'https://chat.googleapis.com/v1/spaces/SPACE_ID/messages?pageSize=5' | jq '.messages[].sender'
```

Each `sender` must contain a non-empty `displayName`. If it only has `name` and `type`, stop and
go to [Contingency](#contingency).

**1. Unit tests.**

```bash
pnpm --filter @gdgjp/wiki exec vitest run workers/features/sources/google-chat.test.ts workers/features/sources/google-chat-import.test.ts workers/features/sources/google-chat-scopes.test.ts
```

**2. Repo checks.**

```bash
pnpm ci:quick
```

**3. End to end.** `pnpm --filter @gdgjp/wiki dev`, connect Google on `/sources`, re-add the
affected space, and confirm the generated `source_documents` headings read
`### [YYYY-MM-DD HH:mm] Real Name`. Because the existing documents already have the wrong names
baked in, the source must be re-imported from scratch (delete and re-add, or clear its cursor) —
an incremental refresh only rewrites weeks that changed.

**4. Logs.** The `senders_resolved` event should now report `unresolved` matching the number of
senders with no payload name, and the new directory-unavailable event should appear once per run
for consumer accounts.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
