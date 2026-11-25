# Application conventions check

Run `pnpm check:apps` from the repository root. `pnpm lint`, local quick/full CI,
staged CI for `apps/` and `packages/gdg-lib/` changes, and the hosted repository policy
job run it. Each error names the cause and how to fix it, followed by its violation ID.

The checker enforces these rules for every application in `apps/` outside Git submodules:

- **Migrations and schema dumps.** Files in `migrations/` are named `NNNN_snake_case.sql`
  with unique numbers and apply in order on SQLite. `schema.sql` must equal what
  `scripts/dump-schema.sh` produces from them, so it cannot be edited by hand.
  `schema:dump`, `migrate:local` and `migrate:remote` exist and regenerate the dump.
- **Relying-party registration.** An app with `IDP_CLIENT_ID` that uses `@gdgjp/gdg-lib`
  declares `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET` and `APP_URL` in `.dev.vars.example`.
  An app with a matching Accounts client has its `<APP>_CLIENT_ID` and `<APP>_REDIRECT_URLS`
  in Accounts' `wrangler.toml`, its ID, secret and redirect in Accounts' `.dev.vars.example`,
  and an entry in `collectSpecs` (`seed-clients.server.ts`).
- **Dev ports.** Each app's dev server port is unique and matches its local `APP_URL` and
  the local Accounts redirect URL. The E2E port tests cover Playwright's side.
- **Cron dispatch.** With more than one `[triggers].crons` entry, every cron appears as a
  string literal in source, and every `*_CRON` constant is scheduled.
- **LLM-free Workers.** Apps listed in `llmFree` in `scripts/app-conventions.json` have no AI
  binding, model SDK dependency or import, model API key, or model API call.
- **Test placement.** `*.test.ts(x)` under `app/`, `workers/` or `src/` names a sibling subject
  (`<subject>.test.ts` or `<subject>.<aspect>.test.ts`; `architecture.test.ts` is exempt).
  Playwright `*.spec.ts` files live outside those directories, in `e2e/` or `tests/e2e/`.
- **Binding access.** `app/` code does not import `env` from `cloudflare:workers`; loaders
  and actions read `context.cloudflare.env`.
- **gdg-lib runtime.** `packages/gdg-lib/src` runtime code imports no `node:` module, and
  only tests import `@gdgjp/gdg-lib/testing/*`.

`scripts/app-conventions.json` holds a shrink-only `baseline` of violation IDs that existed
when a rule arrived. Fix the cause instead of adding an entry; the checker fails when an
entry no longer matches, so delete entries as their violations go. An applied migration's
duplicate number stays in the baseline, because renaming it would make Wrangler apply it again.

The checker reads manifests, Wrangler configuration, `.dev.vars.example`, and source text.
It does not run Wrangler, apply migrations to D1, or prove that a handler behaves correctly
for each cron. Its import and call matching is lexical.
