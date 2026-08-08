# Stage 5 — agents.gdgs.jp (Chat SDK)

## Context — Background and Repository State

Enable operations members to query the Wiki from the Google Chat / Discord environments they use every day.

Ingest can run locally, but local Query is inconvenient. Only this part belongs in the cloud.

The overall approach is in `docs/plans/00-llm-wiki-overview.md`.

**Dependencies:** Stage 3 (the `index` / `log` and page-type ontology must be in place)
**Target workspaces:** `wiki/`, `agents/` (new), and `accounts/`

### Prerequisite verification (the first task of this stage)

Confirm all three before writing agent logic. If any fails, **stop and report** rather than working around it.

1. The Google Chat app is configured with an HTTP endpoint, and its **project number is known** — it is the
   required `aud` value in section 1. Chat apps configured without a fixed audience cannot be verified safely.
2. The Discord application is registered and its **public key** is available for Ed25519 verification.
3. The accounts.gdgs.jp OAuth client supports **PKCE (S256)** and issues refresh tokens. Section 2's linking
   flow has no safe fallback without them.

### Required reading

- `wiki/CLAUDE.md` — bindings and conventions
- `CLAUDE.md` (root) — workspace structure; `tinyurl-gateway/` is the Vercel workspace precedent
- `docs/260518_sso_migration.md` — authentication architecture for the accounts IdP and RPs
- Chat SDK documentation. Installing `chat` in `agents/` includes it under `node_modules/chat/docs/` and
  `node_modules/chat/resources/`; consult it before implementation.

### Existing implementations to reuse

- `wiki/app/features/ai-search/rag-search.server.ts` — semantic search using Vectorize
- `getCliIdentity` in `wiki/app/lib/cli-identity.server.ts` — Bearer token → accounts `/userinfo` → chapter claim
- `getEffectivePagePermissions` in `wiki/app/lib/page-access.server.ts` — per-page permission evaluation
- `gdg-lib/` — authentication and signed-cookie helpers on the RP side

## Design

### 1. Webhook authenticity (the trust root — implement first)

Everything in section 2 rests on the claim “this request really came from Google Chat / Discord, and the Chat user ID
in the payload is the one the platform authenticated.” That claim is worthless unless the signature is verified,
because the Chat user ID is the lookup key for the account link. **An unverified webhook lets anyone POST a
crafted payload carrying a linked member's Chat user ID and read every Wiki page that member can see.**

Verify before any parsing, any state read, and any Wiki API call. A request that fails verification is rejected
with 401 and never reaches the agent.

**Google Chat.** Requests carry `Authorization: Bearer <JWT>` issued by `chat@system.gserviceaccount.com`.

- Fetch the signing certificates from
  `https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com`
  and cache them by `kid` with a bounded TTL. Refetch on unknown `kid`; do not pin a single key.
- Require `iss == chat@system.gserviceaccount.com`, `aud ==` the configured Chat app project number
  (`GOOGLE_CHAT_AUDIENCE`), and an unexpired `exp`. **Audience checking is mandatory** — a valid Google-signed
  JWT minted for a different Chat app is otherwise accepted.
- Reject unsigned tokens and `alg: none` explicitly.

**Discord.** HTTP Interactions are signed with Ed25519.

- Verify `X-Signature-Ed25519` over `X-Signature-Timestamp || rawBody` against the application public key.
- **Read the raw body before JSON parsing.** A Next.js route handler that calls `request.json()` first cannot
  reproduce the exact bytes, and the verification will fail in a way that invites disabling it. Read
  `await request.text()` once, verify, then parse that string.
- Respond to the `PING` interaction (type 1) with type 1. Discord requires a 401 on bad signatures to validate
  the endpoint; do not return 200 on failure.

**Replay protection.** Both platforms retry, so verification alone does not make a request unique.

- Reject any request whose timestamp (`iat` for Chat, `X-Signature-Timestamp` for Discord) is outside a ±5 minute window.
- Record the message identifier (`jti` for Chat, interaction `id` for Discord) in Redis with a TTL exceeding
  that window, and drop duplicates. Chat SDK's retry-driven duplicate deliveries share the same identifier.

Chat SDK's adapters implement most of this. **Confirm it is actually enabled rather than assuming it**, and pin
the behaviour with the rejection tests listed in Verification — a silent adapter default change would otherwise
reopen the hole with no test failure.

### 2. Permission model and account-link lifecycle

Most Wiki content is `restricted`, with granular control through `page_access`.
Because it contains speaker contact details, budgets, and incidents,
**link an account for each Chat user and call the Wiki API with that person's token.**

- Maintain a mapping from a Chat user ID (Google Chat's `users/XXXX` or a Discord user ID) to a GDG account.
  The Chat user ID is trusted **only** because section 1 verified the request signature.
- If it is not linked, return the accounts.gdgs.jp OAuth authorization URL and prompt the user to link it.
- On the Wiki side, pass that token through the existing `getCliIdentity` to userinfo and resolve permissions through
  `getEffectivePagePermissions`.

This structurally prevents incidents where pages that should not be visible in Chat appear in an answer.
**Do not use chapter-level service authentication.**

#### Linking flow

Authorization Code with PKCE against accounts.gdgs.jp. “Encrypt the token in Redis” is not by itself a security
boundary — the binding between the OAuth callback and the Chat identity that started it is what prevents an
attacker from completing a link into someone else's Chat account.

1. On an unlinked inquiry, generate `state` (128-bit random) and a PKCE `code_verifier`, and store in Redis under
   `link:state:<state>` → `{ platform, chatUserId, codeVerifier, spaceId, createdAt }` with a **10-minute TTL**.
2. Return the authorization URL with `code_challenge` (S256) and that `state`.
3. On `GET /auth/callback`, look up `state` and **delete it in the same operation** (single-use; a replayed
   callback finds nothing and is rejected). Missing or expired state → 400, and no token exchange.
4. Exchange the code with `code_verifier`. Bind the resulting tokens to the `platform` + `chatUserId` recovered
   **from the stored state**, never from a callback query parameter.

#### Token storage and rotation

| Item | Decision |
|---|---|
| Access token | Store with its `expires_at`. Refresh when under 60 s remain; never call the Wiki API with an expired token. |
| Refresh token | Encrypt with AES-256-GCM before writing to Redis. Random per-record IV; store `keyVersion` alongside the ciphertext. |
| Key material | `TOKEN_ENCRYPTION_KEYS` — a JSON map of `version → base64 key` in the Vercel project environment. Decrypt with the version recorded on the record; always encrypt with the current version. |
| Rotation | Add a new version, keep the old one for decryption, and re-encrypt lazily on next refresh. Remove the old version once no record references it. Rotation must never require re-linking every user. |
| Revocation | On refresh failure with `invalid_grant`, delete the link and return the linking URL again. Do not retry indefinitely. |
| Unlinking | A `/unlink` command deletes the link record and calls the accounts revocation endpoint. Deleting the Redis record alone leaves a live refresh token at the IdP. |
| Key scoping | Key link records by `(platform, chatUserId)`. A Discord ID and a Google Chat ID must never collide in one namespace. |

Redis is a cache, not a system of record: every code path must handle a missing link record by re-prompting for
linking rather than falling back to any broader identity.

### 3. Agent API on the Wiki side

Add these routes to `wiki/app/routes.ts`. All of them are constrained to the linked user's permissions through
`getCliIdentity` + `getEffectivePagePermissions`.

| Route | Contract |
|---|---|
| `GET /api/agent/index` | Contents of the `index` page (the catalog the agent reads first). |
| `GET /api/agent/search?q=` | **Retrieval only.** Hybrid of Vectorize and title/tag matching. Returns `{ slug, title, summary, score }[]` and no prose. |
| `GET /api/agent/page/*` | Body Markdown and `sources` for one page. Splat route. |
| `POST /api/agent/sources` | Submit links shared in Chat to raw (supports “Please read this document too”). |

**Slug encoding — use a splat, not `:slug`.** Stage 3 introduces namespaced slugs such as `venues/umeda-hall`,
and React Router's `:slug` segment does not match across `/`. Register
`route("/api/agent/page/*", "routes/api.agent.page.$.ts")` and read `params["*"]`. Reject any slug containing
`..`, a leading `/`, or an empty segment before it reaches the query, and resolve it as an exact `pages.slug`
match — never as a path join against storage.

**Search must be retrieval-only.** `rag-search.server.ts` calls
`createWikiModel(...).generateText(...)` ([rag-search.server.ts:51](../../wiki/app/features/ai-search/rag-search.server.ts:51))
and returns a generated `answer`. Reusing it here would run a second LLM inside the tool call, spend Gemini
tokens on text the agent discards, and produce an answer whose citations the agent cannot attribute. Extract the
retrieval half — embedding, Vectorize query, permission filtering — into a shared function, have
`rag-search.server.ts` call it for its existing behaviour, and have `/api/agent/search` return only the ranked
results. Composing the answer is the Chat SDK agent's job.

**`POST /api/agent/sources` requires an explicit scope.** Stage 1 made visibility a mandatory registration input
and treats a null `chapter_id` as readable by every signed-in member
([01-sources-raw-layer.md](01-sources-raw-layer.md)). The agent API must not reintroduce the omission path it
closed: require a `chapter` field that is either a chapter ID or the explicit `ALL_CHAPTERS` sentinel, return 400
on absence, and return 403 for a chapter the linked user does not belong to. Call Stage 1's `createSource` in
`app/lib/sources.server.ts` rather than inserting directly, so both surfaces share one chapter-resolution
implementation. When the user belongs to exactly one chapter the agent may fill the field itself; otherwise it
must ask in Chat before submitting.

Add these to `wiki/openapi/openapi.yaml` and put them on the same generation path as the CLI.

### 4. `agents/` workspace

Create a new workspace. Add it to `pnpm-workspace.yaml` and the root `turbo.json`.

- Next.js + Chat SDK (`chat` npm package)
- Deploy to **Vercel**. Use the `tinyurl-gateway/` Vercel workspace as the precedent for the deployment path and
  secret storage (Vercel project environment variables).
- Use **Redis** for the state adapter. Chat SDK's official state adapters are only memory / Redis / ioredis / PostgreSQL;
  there is no Cloudflare KV version.

Structure:

```
agents/
  app/api/chat/route.ts     ← Chat SDK webhook entry point
  app/auth/callback/route.ts ← OAuth callback; consumes single-use state
  lib/adapters.ts           ← Google Chat / Discord adapter registration
  lib/verify.ts             ← signature / audience / replay verification (section 1)
  lib/agent.ts              ← AI SDK ToolLoopAgent
  lib/tools/wiki.ts         ← tool definitions that call the agent API
  lib/link-account.ts       ← account-linking flow with accounts.gdgs.jp
  lib/token-crypto.ts       ← AES-256-GCM encrypt/decrypt with keyVersion
```

- Enable the Google Chat adapter (service-account authentication) and Discord adapter (HTTP Interactions).
- `lib/verify.ts` runs before the adapter dispatches. Keep it in one module so there is a single place to audit,
  and so the rejection tests in Verification have one target.
- Require tools to be used in this order: `wiki_index` → `wiki_search` → `wiki_read`.
  The policy of reading `index` first follows `llm-wiki.md`.
- Always include links to Wiki pages as citations in answers.

### 5. Accounts side

- Add one OAuth client to accounts.gdgs.jp (client ID: `agents`).
- Set the redirect URI to `https://agents.gdgs.jp/auth/callback`.
- Confirm the client supports **PKCE (S256)** and refresh-token issuance; section 2 depends on both. If the IdP
  does not yet support PKCE for confidential clients, report it and stop rather than falling back to plain
  authorization code.
- **After changing client information, reseed it with `/admin/seed-clients`** (repository convention).
- Add the following to `agents/.env.example`:
  `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` / `REDIS_URL` / `WIKI_API_URL` /
  `GOOGLE_CHAT_AUDIENCE` / `DISCORD_PUBLIC_KEY` / `TOKEN_ENCRYPTION_KEYS`.

### 6. DNS

Point `agents.gdgs.jp` at Vercel. This requires adding a DNS record on the Cloudflare side (manual work, out of scope for implementation).

### Constraints

- **Do not create a permission gap.** The agent API must always evaluate permissions with the linked user's token.
  Do not implement service-token access to all pages.
- **Never trust a Chat user ID from an unverified request.** No lookup, no state read, and no Wiki call may run
  before section 1's verification passes. Do not add a “skip verification in development” flag that reads an
  environment variable at request time; use fixture-signed payloads in tests instead.
- Do not store tokens in Redis in plaintext, and do not log tokens, authorization codes, `code_verifier`, or
  `state` values — including in error paths.
- Do not resolve a page slug by joining it onto a path. Match `pages.slug` exactly.
- Do not log Chat conversations or page bodies.
- Do not change the Wiki's existing routes or schema; only add the agent API.
- `wiki/openapi/types.generated.ts` is generated. Do not edit it manually.
- `agents/` targets Vercel. Do not rewrite it for Cloudflare Workers.
- Google Cloud Chat app configuration, Discord application registration, and Vercel environment-variable configuration are manual work.
  Document the procedure in `docs/agents-setup.md`.
- Follow Biome and use `import type`.

## Files to touch

- `wiki/app/routes.ts`, `wiki/app/routes/api.agent.*.ts` (including `api.agent.page.$.ts` for the splat route)
- `wiki/app/features/ai-search/rag-search.server.ts` (extract the retrieval-only half)
- `wiki/openapi/openapi.yaml`, `wiki/openapi/paths/agent.yaml`
- `agents/**` (new workspace)
- `pnpm-workspace.yaml`, root `turbo.json`
- Client definition in `accounts/` (+ reseed through `/admin/seed-clients` after deployment)
- `docs/agents-setup.md` (new)

## Verification — Completion Criteria and Validation

### Completion criteria

When someone asks in Google Chat, “Suggest venue candidates for the next event based on past results,” the system answers with citations based only on pages they are authorized to access. An unlinked user receives an account-linking URL.
A request that is not signed by Google Chat or Discord is rejected with 401 before any Wiki call is made.

### Commands

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm ci:quick
```

### Webhook rejection tests (write these before the agent logic)

Fixture-driven, with locally generated keys. **Do not call the live platforms.**

- An unsigned request, a request with a missing `Authorization` header, and a request with `alg: none` are each 401.
- A Chat JWT signed by a key that is not in the fetched certificate set is 401.
- A **correctly signed Chat JWT whose `aud` is a different project number** is 401. This is the impersonation case;
  a test that only covers bad signatures does not cover it.
- A Discord payload whose body is altered after signing is 401.
- A Discord `PING` (type 1) with a valid signature returns type 1; with an invalid signature it returns 401.
- A request with a timestamp 10 minutes old is rejected.
- Replaying a previously accepted request with the same `jti` / interaction `id` is dropped and produces no
  second Wiki call.
- **No Wiki API call and no Redis link lookup occurs on any rejected request** — assert on the mocks, not just on
  the status code.

### Account-link tests

- A callback with an unknown or expired `state` returns 400 and performs no token exchange.
- Replaying a callback with an already-consumed `state` returns 400 (single-use).
- The link is created for the `chatUserId` stored with the `state`, not for any value in the callback query.
- A refresh token round-trips through encrypt/decrypt; a record written under key version 1 still decrypts after
  version 2 becomes current.
- A refresh failing with `invalid_grant` deletes the link and returns the linking URL rather than retrying.
- Records are keyed by `(platform, chatUserId)`: the same ID string on Discord and Google Chat resolves to
  different links.

### Tests to establish as permission regressions

- When `/api/agent/search` is called with a token for a user who is `restricted` and absent from `page_access`, that page does not appear in the results.
- If the same user directly calls `/api/agent/page/*`, it returns 403.
- `/api/agent/search` returns ranked results only, with no generated prose field, and invokes no text-generation model.
- A namespaced slug (`venues/umeda-hall`) resolves through the splat route; `../` and absolute-path slugs are rejected with 400.
- An inquiry from an unlinked user does not reach the Wiki API.
- `POST /api/agent/sources` without a `chapter` field returns 400 and creates no row.
- `POST /api/agent/sources` does not create sources outside the linked user's chapter.

### Manual E2E

1. Receive a Google Chat event through Chat SDK local webhook forwarding.
2. `curl` the webhook endpoint with no `Authorization` header → 401, and confirm the Wiki logs show no request.
3. Make an inquiry as an unlinked user → an account-linking URL is returned.
4. Make an inquiry after linking → an answer with citations is returned.
5. **Confirm that the answer does not include content from pages the user is not authorized to access.**
6. Paste a Google Docs URL in Chat and say “Please read this too,” then confirm that it is registered in `sources`
   with the chapter that was explicitly chosen.
7. Run `/unlink`, then repeat step 4 and confirm the linking URL is returned again.
