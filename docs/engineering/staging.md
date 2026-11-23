# Staging environments

Three staging slots, `stg-1`, `stg-2`, and `stg-3`, run every Cloudflare Worker in
[the deploy target list](../../.github/scripts/changed-workspaces.mjs), including
`live-checkin`, plus a Vercel preview of `tinyurl-gateway`. Each slot runs production
code paths on a copy of production data. Its hostnames, secrets, external accounts, and
every resource that holds state are its own.

| Production | Slot `stg-N` |
| --- | --- |
| `accounts.gdgs.jp`, `wiki.gdgs.jp`, ... | `accounts.stgN.gdgs.jp`, `wiki.stgN.gdgs.jp`, ... |
| `gdgs.jp` (website) | `stgN.gdgs.jp` |
| Worker `gdgjp-x` | Worker `gdgjp-x-stg-N` |
| D1, KV, R2, queue, workflow, AI Search, and Analytics Engine names | the same name with `-stg-N` appended |

Hostnames come from the production Worker's live custom domains and routes. Vars come
from the built Worker config with `gdgs.jp` URLs moved into the slot, and every staging
Worker has the var `STAGING_SLOT`. OAuth scope and claim URIs under
`https://gdgs.jp/scopes/` and `/claims/` are identifiers and are not rewritten. Cron
triggers run as in production. A service binding to a Worker without a staging copy
stops the deploy instead of reaching production.

## Deploying a pull request

Add the label `E-deploy-stg1`, `E-deploy-stg2`, or `E-deploy-stg3` to a pull request from
this repository. [The Staging workflow](../../.github/workflows/staging.yml) builds and
bundles every Worker from the PR head in a job without secrets, then deploys that output
from a job that runs only `main`'s scripts and tools. Migrations run after each Worker
deploy, as in production. The deploy then runs `apps/accounts/e2e/rp-sign-in.spec.ts`
against all fourteen first-party relying parties in the slot. The workflow removes the
label when it finishes, comments on the PR, and records a GitHub deployment for
environment `stg-N`.

A slot runs `main` by default. Pushes to `main` redeploy every slot whose latest
deployment is not a PR. Closing a PR returns its slots to `main`. Fork PRs are ignored.

## Production can only be deployed from main

Cloudflare and Vercel deploy credentials exist only as secrets of the `Production` and
`staging` GitHub environments. Both environments accept only protected branches, so a
workflow on any other branch cannot read them. Staging runs on `pull_request_target`:
the workflow definition and the deploying job come from `main`, and the PR's code only
runs in the build job, which has no secrets, no cache writes, and a read-only token. The
deploy job removes `.env*`, `.dev.vars*`, and `.vercel` from the PR's output and invokes
`main`'s Wrangler with generated configs whose names all end in `-stg-N`.

Cloudflare API tokens cannot be limited to some Workers, so the staging token could
deploy production Workers. Only reviewed code on `main` ever holds it. Changes under
`.github/` and `scripts/staging/` require the code owner's approval.

## Secrets

Staging never receives a production secret. [scripts/staging/secrets.mjs](../../scripts/staging/secrets.mjs)
classifies every production secret name; the deploy stops on a name without a rule.

- **Internal** secrets (session signing, OAuth client secrets, encryption keys, runner and
  service tokens) are derived per slot from `STAGING_ROOT_SECRET` with HMAC-SHA256. Both
  ends of a pair, such as Accounts' `WIKI_CLIENT_SECRET` and Wiki's `IDP_CLIENT_SECRET`,
  derive the same value. The sync stores matching client secret hashes in the slot's
  Accounts database. Nobody needs to see or rotate these values.
- **External** credentials (Google, X, Discord, Resend, Gemini, connpass and Luma bots,
  Vercel, Cloudflare Realtime) come from staging-owned accounts. Store each as a `staging`
  environment secret named `STAGING_EXT__<WORKER>__<NAME>`, for example
  `STAGING_EXT__ACCOUNTS__GOOGLE_CLIENT_SECRET`. The same prefix overrides a var, such as
  `STAGING_EXT__ACCOUNTS__GOOGLE_CLIENT_ID`. A missing external value leaves that
  integration unconfigured and prints a warning naming the secret to set.

Encrypted values copied from production cannot be decrypted with staging keys, which is
intended.

## Data

[The nightly sync](../../.github/workflows/staging-sync.yml) runs at 03:00 JST. It exports
each production D1 database once and recreates every slot's database from that export,
copies KV namespaces, and copies R2 objects with their metadata through a temporary
Worker. It then redeploys each slot's current ref so a PR's migrations run on fresh data.
FTS5 virtual tables are copied row by row because `wrangler d1 export` cannot export them.

Credentials in the copy are removed in the same import, before any staging Worker can
read them: Accounts sessions, OAuth access and refresh tokens, JWKS signing keys,
social-account tokens, every relying party's `oidc_session`, stored Google, X, and Discord
tokens, push tokens, and encrypted webhooks. [scripts/staging/scrub.mjs](../../scripts/staging/scrub.mjs)
lists each credential-like column and whether it is removed or kept. A new column whose
name looks like a credential stops the sync until it is classified. The MCP OAuth,
connpass session, and agent KV namespaces are not copied.

Wiki's AI Search index is rebuilt in the slot: the sync clears `knowledge_items`, and the
hourly cron pushes every page to the slot's namespace.

Durable Object storage (Wiki collaboration documents and source imports, Screen stages,
OST boards, MC rooms, and Deck rooms) is copied through each app's `StagingSnapshot`
entrypoint after the slot is redeployed. A temporary Worker binds to the production and staging entrypoints, so the
copy never passes through a public URL; import refuses to run without `STAGING_SLOT`.
Objects are found by the names the app derives from its D1 rows, so a room whose name no
longer appears there is not copied. Agent's `PendingSweeper` holds only an alarm that
replies to real Discord and Chat users, so it is not copied.

`wrangler d1 export` makes the production database briefly unavailable. That is why the
sync is a nightly batch, not part of each PR deploy.

## People in the copied data

Staging-owned accounts keep side effects out of production, but the copied data still
holds real people's addresses. Two channels could reach them, and the slot closes both:

- Email: Accounts and Pay send from `onboarding@resend.dev`. With a Resend account that
  has no verified domain, Resend delivers only to the account owner.
- Calendar invitations: Meet sets `CALENDAR_SEND_UPDATES=none`, so Google creates the
  events without emailing attendees.

Discord, X, and connpass actions need the staging bot or account to be a member of the
target guild or group, which production data does not grant.

## Setup

1. Set the repository variable `STAGING_ENABLED` to `true`. The workflows are inert until then.
2. Create staging external accounts and store their credentials as `STAGING_EXT__*`
   secrets in the `staging` environment. Start with a Google OAuth client for Accounts
   sign-in, with redirect URIs `https://accounts.stg{1,2,3}.gdgs.jp/oauth/google/callback`.

## Commands

Run from the repository root with `CLOUDFLARE_API_TOKEN` or a `wrangler login` session.
`deploy`, `sync`, and `e2e-env` also need `STAGING_ROOT_SECRET`.

```sh
node scripts/staging/staging.mjs build
node scripts/staging/staging.mjs provision --slot stg-1
node scripts/staging/staging.mjs plan --slot stg-1
node scripts/staging/staging.mjs sync --slot stg-1
node scripts/staging/staging.mjs deploy --slot stg-1 [--apps accounts,tinyurl]
node scripts/staging/staging.mjs hosts --slot stg-1
```

`plan` prints the rewritten Worker configs without deploying them. The rewrite rejects any
non-empty binding type it does not know how to isolate, so a new binding kind needs a
rule in `scripts/staging/lib.mjs` before it can reach staging.
