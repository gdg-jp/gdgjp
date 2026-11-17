# Fix: accounts Worker isolate poisoning causes indefinite loading + forced sign-out

> Generated from Claude Code plan: `/Users/hari/.claude/plans/a-bug-is-occurring-fluffy-wilkinson.md`

## Goal

Fix: accounts Worker isolate poisoning causes indefinite loading + forced sign-out

## Repo context

Users intermittently cannot log in to `accounts.gdgs.jp`. Once it starts:

- every tab hangs in a loading state, then after ~5 s lands back on `/signin`
- the Google OAuth callback hangs indefinitely (no timeout on that path)
- a direct visit to `accounts.gdgs.jp` hangs too
- all browsers and all accounts are affected simultaneously
- **waiting a while, or redeploying, fixes it**

That signature — global, self-healing, redeploy-clearing — is per-isolate poisoned
state, and there is an exact, confirmed mechanism for it.

### Root cause

`@better-auth/core` resolves `AsyncLocalStorage` through a **module-scope dynamic
import promise**:

```js
// @better-auth/core/dist/async_hooks/index.mjs:2
const AsyncLocalStoragePromise = import("node:async_hooks").then(m => m.AsyncLocalStorage)...
```

Every `auth.api.*` call awaits it before touching D1 — `toAuthEndpoints` calls
`await hasRequestState()` first (`better-auth/dist/api/to-auth-endpoints.mjs:47`),
which reaches `ensureAsyncStorage()` in `@better-auth/core/dist/context/request-state.mjs:4-11`.

`accounts/workers/app.ts:5` loads the server build via `() => import("virtual:react-router/server-build")`,
so that module body — and therefore that promise — is **first evaluated inside the
first request's I/O context**. workerd never settles promises belonging to an
aborted request. One aborted first request leaves the promise permanently pending,
and every later request in that isolate awaits it forever.

The same hazard applies to the cached auth context. `betterAuth()` eagerly starts
`init()` (`better-auth/dist/auth/base.mjs:8`, `const authContext = initFn(options)`),
`getAuth()` caches it at module scope (`accounts/app/lib/auth.server.ts:19-27`), and
`init()` awaits **another dynamic import** — `getAdapter()` does
`await import("../adapters/kysely-adapter/index.mjs")`
(`better-auth/dist/db/adapter-kysely.mjs:5-9`). Every `auth.api.*` and
`auth.handler` call does `await ctx` on that promise.

This is upstream [better-auth#10315](https://github.com/better-auth/better-auth/issues/10315);
the fix ([PR #10318](https://github.com/better-auth/better-auth/pull/10318)) is
**still unmerged**, and the installed `better-auth@1.6.23` / `@better-auth/core@1.6.23`
still contain the dynamic import (verified in `node_modules`). The upstream reporter's
trigger — rapid navigation that supersedes/aborts in-flight authenticated fetches —
matches "it happens after some operation on the management screen, with no correlation
to which operation."

Why the two observed failure shapes differ:

| Path | Bounded? | Result when poisoned |
|---|---|---|
| `getSessionUser` (`/`, `/signin`, `/dashboard`, all authenticated routes) | yes, `SESSION_LOOKUP_TIMEOUT_MS = 5_000` (`auth.server.ts:15`) | ~5 s spinner, then `null` session → redirect to `/signin` (the intentional fallback) |
| `auth.handler` (`/oauth/google/callback`, `/authorize`, `/oauth/token`, `/userinfo`, `/api/auth/*`) | **no timeout anywhere** | tab spins until the Worker wall-clock limit |

The existing 5 s timeout masks the symptom but never clears the poisoned cache, so
the isolate stays broken until it is recycled or redeployed — exactly what is observed.

### Secondary defect (independent cause of forced sign-outs)

better-auth silently enables rate limiting in production
(`enabled: options.rateLimit?.enabled ?? isProduction`,
`better-auth/dist/context/create-context.mjs:171`) and `accounts` never configures it.
Keys come from `getIp`, which reads **only `x-forwarded-for`** and returns `null`
whenever the header has more than one entry
(`@better-auth/core/dist/utils/ip.mjs:188,194`). Unkeyable requests — anything behind
a second proxy, and server-to-server calls from the sibling RPs — collapse into a
single shared bucket `no-trusted-ip|<path>`
(`better-auth/dist/api/rate-limiter/index.mjs:275,287`): 100 req / 10 s globally, and
**3 req / 10 s on `/sign-in*`** (`rate-limiter/index.mjs:370-376`). A 429 on
`/oauth2/token` makes every RP throw `refresh_failed` and bounce the user to `/signin`.

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

```bash
pnpm --filter @gdgjp/accounts test && pnpm --filter @gdgjp/accounts typecheck
```

```bash
pnpm ci:quick
```

```bash
pnpm --filter @gdgjp/accounts test:e2e
```

Then exercise the flow end to end against `wrangler dev` (`pnpm --filter @gdgjp/accounts dev`):
sign out, sign in through Google, land on `/dashboard`, and confirm an RP round trip
(`/authorize` → `/oauth/token` → `/userinfo`) still succeeds — changes 4 and 5 touch
those paths.

To sanity-check the poisoning fix itself, add a temporary probe route that logs
`Boolean(globalThis[Symbol.for("better-auth:global")]?.context?.requestStateAsyncStorage)`
on the very first request of a fresh isolate; it must already be `true` before any
`auth.api.*` call. The upstream repro (fire several authenticated fetches and abort
them mid-flight while new isolates spin up) is worth running against a preview deploy,
but it is probabilistic — the seeded-global assertion is the deterministic check.

After deploying, the tell that it worked is that the ~5 s spinner → `/signin` episodes
stop recurring without a redeploy.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
