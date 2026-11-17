# Stage 5c — `agents/` workspace and webhook verification

## Context — Background and Repository State

This stage creates the `agents/` workspace (Next.js + Chat SDK on Vercel) and builds its trust root: the
module that proves an incoming webhook really came from Google Chat or Discord. Scaffold and verification
ship together deliberately, so the workspace never exists in a state where a request can reach application
logic without being verified first.

Everything in Stage 5 rests on the claim "this request came from the platform, and the Chat user ID in the
payload is the one the platform authenticated." That ID is the lookup key for the account link built in
Stage 5d. **An unverified webhook lets anyone POST a crafted payload carrying a linked member's Chat user ID
and read every Wiki page that member can see.** Verification is a precondition, not a hardening pass.

**Dependencies:** none in this repo. Runs in parallel with 5a and 5b.
**Blocks:** Stage 5d and 5e.
**Target workspaces:** `agents/` (new), `gdg-lib/`, and repo-root configuration.

Stage overview: [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md).

### Prerequisite verification (the first task of this stage)

Confirm both before writing verification logic. If either fails, **stop and report** rather than working
around it.

1. The Google Chat app is configured with an HTTP endpoint and its **project number is known** — that number
   is the required `aud` value. A Chat app configured without a fixed audience cannot be verified safely.
2. The Discord application is registered and its **public key** is available for Ed25519 verification.

### Required reading

- `CLAUDE.md` (root) — workspace structure; Biome; `import type`; "keep Vercel runtime secrets in the Vercel
  project environment"
- `.agents/skills/chat-sdk/SKILL.md` — the vendored Chat SDK skill, pinned in `skills-lock.json`
- Chat SDK's own docs, which land at `node_modules/chat/docs/` and `node_modules/chat/resources/` after
  `pnpm add chat`. Read them before implementing adapters.

### Existing implementations to reuse

- **`tinyurl-gateway/` is the working Vercel-workspace precedent.** `@gdgjp/tinyurl-gateway`, private, ESM,
  `vercel.json` with `"regions": ["hnd1"]`, a committed `.vercel/project.json`, a **standalone**
  `tsconfig.json` that does not extend `tsconfig.base.json`, vitest with no `vitest.config.ts`, and scripts
  `build` / `typecheck` / `test` but **no `dev` and no `deploy`** — deployment runs from CI. Copy this shape.
- `gdg-lib/src/auth/index.ts` — `CHAPTERS_CLAIM`, `IS_ADMIN_CLAIM`, `CHAPTERS_SCOPE` constants.

## Design

### 1. Workspace registration

| File | Change |
|---|---|
| `pnpm-workspace.yaml` | add `"agents"` to `packages` |
| `turbo.json` | add `.next/**` to the `build` task `outputs` (currently `build/**`, `.react-router/**`) |
| `biome.json` | add `**/.next` to `files.ignore` — `**/.vercel`, `**/.turbo`, `**/coverage` are already there, `**/.next` is not |
| `.github/workflows/ci.yml` | `pnpm --filter @gdgjp/agents typecheck` / `test` / `build` steps mirroring the `tinyurl-gateway` ones (~lines 74, 107, 138) |
| `.github/workflows/deploy.yml` | a build step (~line 117) and a `vercel deploy --prod` step (~line 176) mirroring the gateway |

**`VERCEL_PROJECT_ID` is a single repo-level secret already bound to the tinyurl-gateway project.** Reusing it
for the agents deploy step silently deploys agents into the gateway's Vercel project. Introduce a distinct
secret — `VERCEL_PROJECT_ID_AGENTS` — and set it on the agents deploy step only. Name this in the PR
description; it is an operator action that must happen before the workflow can succeed.

`agents/package.json` is `@gdgjp/agents`, private, `"type": "module"`, with `build` / `typecheck` / `test`
scripts. Install Chat SDK with `pnpm --filter @gdgjp/agents add chat`.

### 2. `gdg-lib` claim constants for a non-Workers runtime

`@gdgjp/gdg-lib`'s root export re-exports `src/auth/rp.ts`, which imports `@cloudflare/workers-types` and
drives D1 directly — it cannot run on Vercel, and `@cloudflare/workers-types` is only a devDependency.
`agents/` needs just three string constants from that package.

Add a `"./auth/claims"` export subpath to `gdg-lib/package.json`, backed by a new `gdg-lib/src/auth/claims.ts`
holding `CHAPTERS_CLAIM`, `IS_ADMIN_CLAIM`, and `CHAPTERS_SCOPE`, and re-export it from `src/auth/index.ts` so
no existing import moves. `agents/` imports that subpath. Because the package ships raw TypeScript with no
build step, `agents/next.config.ts` sets `transpilePackages: ["@gdgjp/gdg-lib"]`.

Do not copy the constants into `agents/` — a divergence between the claim key here and at the IdP fails as a
silently empty chapter list, which reads as "this user has no chapters" rather than as an error.

### 3. Directory layout

```
agents/
  app/api/chat/route.ts       ← Chat SDK webhook entry point
  app/auth/callback/route.ts  ← OAuth callback (implemented in Stage 5d; stub here)
  lib/verify.ts               ← signature / audience / replay verification (section 4)
  lib/adapters.ts             ← Google Chat / Discord adapter registration
  lib/agent.ts                ← ToolLoopAgent (Stage 5e)
  lib/tools/wiki.ts           ← tool definitions (Stage 5e)
  lib/link-account.ts         ← account linking (Stage 5d)
  lib/token-crypto.ts         ← AES-256-GCM (Stage 5d)
  vercel.json  tsconfig.json  next.config.ts  .env.example  .gitignore
```

This stage implements `app/api/chat/route.ts`, `lib/verify.ts`, and `lib/adapters.ts`. The remaining modules
belong to 5d and 5e; leave them absent rather than stubbing them with placeholder logic.

`agents/.env.example` lists every variable Stage 5 uses, so the Vercel project can be configured once:
`IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` / `ACCOUNTS_URL` / `REDIS_URL` / `WIKI_API_URL` /
`GOOGLE_CHAT_AUDIENCE` / `DISCORD_PUBLIC_KEY` / `TOKEN_ENCRYPTION_KEYS`.

### 4. `lib/verify.ts`

One module, run before the Chat SDK adapter dispatches, so there is a single place to audit and a single
target for the rejection tests. A request that fails verification is rejected with 401 and never reaches the
agent — no parsing, no state read, no Wiki call.

**Google Chat.** Requests carry `Authorization: Bearer <JWT>` issued by `chat@system.gserviceaccount.com`.

- Fetch signing certificates from
  `https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com` and cache
  them by `kid` with a bounded TTL. Refetch on an unknown `kid`; do not pin a single key.
- Require `iss == chat@system.gserviceaccount.com`, `aud == GOOGLE_CHAT_AUDIENCE` (the Chat app project
  number), and an unexpired `exp`. **Audience checking is mandatory** — without it, a valid Google-signed JWT
  minted for a *different* Chat app is accepted.
- Reject unsigned tokens and `alg: none` explicitly.

**Discord.** HTTP Interactions are signed with Ed25519.

- Verify `X-Signature-Ed25519` over `X-Signature-Timestamp || rawBody` against `DISCORD_PUBLIC_KEY`.
- **Read the raw body before JSON parsing.** A route handler that calls `request.json()` first cannot
  reproduce the exact bytes, and verification then fails in a way that invites disabling it. Call
  `await request.text()` once, verify, then parse that string.
- Answer the `PING` interaction (type 1) with type 1. Discord requires a 401 on a bad signature to validate
  the endpoint — never return 200 on failure.

**Replay protection.** Both platforms retry, so a valid signature does not make a request unique.

- Reject any request whose timestamp (`iat` for Chat, `X-Signature-Timestamp` for Discord) falls outside a
  ±5 minute window.
- Record the message identifier (`jti` for Chat, interaction `id` for Discord) in Redis with a TTL longer
  than that window, and drop duplicates. Retry-driven duplicate deliveries share the identifier.

Chat SDK's adapters implement much of this. **Confirm it is actually enabled rather than assuming it**, and
pin the behaviour with the rejection tests below — otherwise a silent adapter default change reopens the hole
with no test failure.

### Constraints

- **Never trust a Chat user ID from an unverified request.** No lookup, no state read, no Wiki call may run
  before verification passes.
- **Do not add a "skip verification in development" flag** that reads an environment variable at request
  time. Use fixture-signed payloads with locally generated keys in tests instead. A runtime bypass flag is
  one misconfigured environment away from being the production behaviour.
- Do not log tokens, JWT contents, raw bodies, or Chat conversations — including in error paths.
- `agents/` targets Vercel. Do not rewrite it for Cloudflare Workers, and do not add Wrangler configuration.
- Do not commit `.env` / `.env.local`. Only `.env.example` is tracked.
- Do not touch `tinyurl-gateway/` or its Vercel project.
- Do not implement account linking or the agent itself here — those are Stages 5d and 5e. Adding a
  provisional link lookup now would place unverified-path code next to the verifier.
- Google Cloud Chat app configuration, Discord application registration, Vercel project creation, and Vercel
  environment variables are manual operator work, not code.
- Follow Biome and use `import type`.

## Files to touch

### New workspace

- `agents/package.json`, `tsconfig.json`, `next.config.ts`, `vercel.json`, `.env.example`, `.gitignore`
- `agents/app/api/chat/route.ts`, `agents/lib/verify.ts`, `agents/lib/adapters.ts`
- `agents/lib/verify.test.ts` and fixtures

### Repo configuration

- `pnpm-workspace.yaml`, `turbo.json`, `biome.json`
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

### Shared library

- `gdg-lib/package.json` (new `./auth/claims` export), `gdg-lib/src/auth/claims.ts` (new),
  `gdg-lib/src/auth/index.ts` (re-export)

## Verification — Completion Criteria and Validation

### Completion criteria

`pnpm --filter @gdgjp/agents build` succeeds, the workspace passes root lint and typecheck, and a POST to
`/api/chat` without a valid platform signature returns 401 having performed no Redis read and no outbound
fetch. A correctly signed Discord `PING` returns type 1.

### Commands

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm --filter @gdgjp/agents build
```

```bash
pnpm ci:quick
```

### Webhook rejection tests (write these before the adapter wiring)

Fixture-driven, with locally generated keys. **Do not call the live platforms.**

- An unsigned request, a request with a missing `Authorization` header, and a request with `alg: none` are
  each 401.
- A Chat JWT signed by a key that is not in the fetched certificate set is 401.
- A **correctly signed Chat JWT whose `aud` is a different project number is 401.** This is the
  impersonation case; a suite that only covers bad signatures does not cover it.
- A Chat JWT whose `iss` is not `chat@system.gserviceaccount.com` is 401.
- A Discord payload whose body is altered after signing is 401.
- A Discord `PING` (type 1) with a valid signature returns type 1; with an invalid signature it returns 401,
  never 200.
- A request with a timestamp 10 minutes old is rejected.
- Replaying a previously accepted request with the same `jti` / interaction `id` is dropped and produces no
  second downstream call.
- **No outbound fetch and no Redis read occurs on any rejected request** — assert on the mocks, not just on
  the status code.

### Manual E2E

1. `pnpm --filter @gdgjp/agents build` locally, then run the Next.js dev server.
2. `curl -X POST http://localhost:3000/api/chat -d '{}'` with no `Authorization` header → 401.
3. Post a fixture-signed Discord `PING` → `{"type":1}`.
4. Post the same `PING` twice → the second is dropped as a replay.
5. Receive a real Google Chat event through Chat SDK's local webhook forwarding and confirm it verifies
   against the configured `GOOGLE_CHAT_AUDIENCE`. Change `GOOGLE_CHAT_AUDIENCE` to a different number and
   confirm the same event is now rejected with 401.
