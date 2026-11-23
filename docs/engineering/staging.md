# Staging environments

Three staging slots, `stg-1`, `stg-2`, and `stg-3`, run every Cloudflare Worker in
[the deploy target list](../../.github/scripts/changed-workspaces.mjs) except
`live-checkin`. The Vercel `tinyurl-gateway` is not part of a slot. Each slot uses
production data, production secrets, and production Worker configuration.
Its hostnames and the resources that hold state differ from production.

| Production | Slot `stg-N` |
| --- | --- |
| `accounts.gdgs.jp`, `wiki.gdgs.jp`, ... | `accounts.stg-N.gdgs.jp`, `wiki.stg-N.gdgs.jp`, ... |
| `gdgs.jp` (website) | `stg-N.gdgs.jp` |
| Worker `gdgjp-x` | Worker `gdgjp-x-stg-N` |
| D1, KV, R2, queue, workflow, AI Search, and Analytics Engine names | the same name with `-stg-N` appended |

Hostnames come from the production Worker's live custom domains and routes, including
those set only in the dashboard. Staging always serves them as custom domains. Vars come
from the built Worker config with `gdgs.jp` URLs moved into the slot. Workers with
`keep_vars` also receive their production dashboard vars. OAuth scope and claim URIs
under `https://gdgs.jp/scopes/` and `/claims/` are identifiers and are not rewritten.

## Deploying a pull request

Add the label `deploy-stg-1`, `deploy-stg-2`, or `deploy-stg-3` to a pull request from
this repository. [The Staging workflow](../../.github/workflows/staging.yml) builds the
PR head, deploys every Worker to that slot, and applies D1 migrations in the same order
as production: deploy first, then migrate. It then runs
`apps/accounts/e2e/rp-sign-in.spec.ts` against every first-party relying party in the
slot. The workflow removes the label when it finishes, whether or not the deploy
succeeded. It also comments on the PR and records a GitHub deployment for environment
`stg-N`.

A slot runs `main` by default. Pushes to `main` redeploy every slot whose latest
deployment is not a PR. Closing a PR returns its slots to `main`. Fork PRs are ignored
because their workflows receive no secrets.

## Data

[The nightly sync](../../.github/workflows/staging-sync.yml) runs at 03:00 JST. It exports
each production D1 database once, recreates every slot's database from that export, and
copies KV namespaces and R2 buckets. It then redeploys each slot's current ref, so a
PR's migrations run again on fresh production data. FTS5 virtual tables are copied
row by row because `wrangler d1 export` cannot export them. Accounts OAuth client
redirect URIs are rewritten to the slot's hosts.

`wrangler d1 export` makes the production database unavailable while it runs. That is
why the sync is a nightly batch, not part of each PR deploy. Wiki is the largest
database (about 250 MB). Run the sync manually only when brief Wiki unavailability is
acceptable.

Not copied: Durable Object storage, queue backlogs, AI Search indexes (Wiki rebuilds a
space's index when a page in it changes), and Analytics Engine history.

## Isolation and side effects

Staging Workers have no cron triggers, so scheduled posting, reminders, sweeps, and
imports never run twice. Queue consumers, outbound email, Discord, X, Google, and other
integrations still use production credentials when someone triggers them in a slot.
Do not publish, send, or post from staging unless that external effect is intended.

Staging RP cookies are scoped to `stg-N.gdgs.jp`. Browsers still send production's
`Domain=gdgs.jp` `gdg_sid` cookie to staging hosts. Use a private window for staging if
a production session interferes with staging sign-in.

The deploy refuses any Worker whose production secret names are not all present in
`STAGING_WORKER_SECRETS`. Production data never runs with missing or substitute secrets.

## Trust model

A staging slot executes PR code with production secrets and production data. Anyone who
can add a `deploy-stg-*` label can therefore give that PR's code access to them. Read a
PR before you label it. The Cloudflare token used for staging can also change production
Workers, because Cloudflare tokens cannot be limited by Worker name.

## Setup

The `staging` GitHub environment holds:

| Secret | Contents |
| --- | --- |
| `STAGING_WORKER_SECRETS` | JSON `{ "<production worker>": { "<SECRET>": "<value>" } }` with every production secret |
| `STAGING_CLOUDFLARE_API_TOKEN` | Optional; defaults to the repository `CLOUDFLARE_API_TOKEN` |
| `STAGING_R2_ACCESS_KEY_ID`, `STAGING_R2_SECRET_ACCESS_KEY` | R2 S3 credentials; without them the sync skips R2 |

`node scripts/staging/staging.mjs secrets-template` prints the JSON skeleton with every
current production secret name. Update `STAGING_WORKER_SECRETS` whenever a production
secret changes. Google sign-in on a slot also requires
`https://accounts.stg-N.gdgs.jp/oauth/google/callback` as an authorized redirect URI on
the Google OAuth client.

## Commands

Run from the repository root with Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, or a
`wrangler login` session).

```sh
node scripts/staging/staging.mjs build
node scripts/staging/staging.mjs provision --slot stg-1
node scripts/staging/staging.mjs plan --slot stg-1
node scripts/staging/staging.mjs sync --slot stg-1
node scripts/staging/staging.mjs deploy --slot stg-1 [--apps accounts,tinyurl]
node scripts/staging/staging.mjs e2e-env --slot stg-1
```

`plan` prints the rewritten Worker configs without deploying them. The rewrite rejects any
non-empty binding type it does not know how to isolate, so a new binding kind needs a
rule in `scripts/staging/lib.mjs` before it can reach staging.
