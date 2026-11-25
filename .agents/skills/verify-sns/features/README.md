# SNS Manager feature map

Drive these journeys against the isolated SNS stack that
`node scripts/verification/app-stack.mjs --app sns --serve` starts at
`http://localhost:6165`. Current-run status and evidence belong in
[coverage.json](../coverage.json). Every journey starts as `NOT VERIFIED`; a source
recipe is not execution evidence.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `sns-access-signed-out` | [Sign-in redirect](access.md) | Anonymous (needs `--platform <verify-platform ready.json>`) |
| `sns-access-roles` | [Role gate and no-chapter page](access.md) | Member, contributor, guest contributor, super admin |
| `sns-chapter-switch` | [Chapter switcher](access.md) | Switcher (two organizer chapters) |
| `sns-signout` | [Sign-out](access.md) | Organizer (last) |
| `sns-posts-list`, `sns-posts-empty` | [Post list](posts.md) | Organizer, switcher |
| `sns-schedule-create`, `sns-schedule-edit`, `sns-schedule-delete` | [Schedule composer](posts.md) | Organizer |
| `sns-post-locked`, `sns-post-isolation` | [Locked and cross-chapter posts](posts.md) | Organizer |
| `sns-media-composer`, `sns-media-photo-required` | [Post images and R2 media](media.md) | Organizer |
| `sns-x-accounts-list`, `sns-x-revoke` | [X account settings](x-accounts.md) | Organizer, contributor |
| `sns-x-connect` | [X authorization start, stopped before X](x-accounts.md) | Organizer |
| `sns-contributors-add`, `sns-contributors-remove` | [Contributor management](contributors.md) | Organizer, contributor |
| `sns-photos-album` | [Google Photos album settings](google-photos.md) | Organizer, contributor |
| `sns-photos-import` | [Importer HTTP contract](google-photos.md) | Import bearer token |
| `sns-photos-library` | [Google Photos library picker](google-photos.md) | Organizer |
| `sns-publish-failsafe` | [Publishing without reaching X](publishing.md) | Organizer |
| `sns-cli-auth`, `sns-cli-posts`, `sns-cli-media` | [CLI API](cli-api.md) | Accounts CLI bearer tokens (needs `--platform <verify-platform ready.json>`) |
| `sns-cli-contributors`, `sns-cli-x-accounts`, `sns-cli-publish-failsafe` | [CLI API](cli-api.md) | Accounts CLI bearer tokens (needs `--platform <verify-platform ready.json>`) |

## Fixture identities

Each identity signs in by navigating its URL in a fresh Orca Browser profile. The
RP mints user `dev-user-<as>` with email `<as>@dev.local`. HTTP checks reuse the same
URL with `curl -c <jar>`; the session cookie is `gdgjp-sns-session`.

| Identity | Dev-login URL |
| --- | --- |
| Organizer | `http://localhost:6165/dev/login?as=verify-sns-organizer&chapter=1:dev-chapter:organizer&return_to=/posts` |
| Switcher | `http://localhost:6165/dev/login?as=verify-sns-switcher&chapter=1:dev-chapter:organizer&chapter=3:empty-chapter:organizer&return_to=/posts` |
| Contributor (member plus contributor row) | `http://localhost:6165/dev/login?as=verify-sns-contributor&chapter=1:dev-chapter:member&return_to=/posts` |
| Guest contributor (no membership) | `http://localhost:6165/dev/login?as=verify-sns-guest&chapter=none&return_to=/posts` |
| Member (no contributor row) | `http://localhost:6165/dev/login?as=verify-sns-member&chapter=1:dev-chapter:member&return_to=/posts` |
| Super admin (member role) | `http://localhost:6165/dev/login?as=verify-sns-admin&chapter=1:dev-chapter:member&admin=1&return_to=/settings` |
| Other-chapter organizer (HTTP checks only) | `http://localhost:6165/dev/login?as=verify-sns-other&chapter=2:other-chapter:organizer&return_to=/posts` |

SNS admits a chapter when the membership role is `organizer`, the user is a super
admin, or `sns_contributors` lists the user's email for that chapter
(`app/features/auth/access.server.ts`, `chapters.server.ts`). A plain `member` with no
contributor row is redirected to `/no-chapter`.

## Baseline preconditions

- Fresh local D1 persistence with every migration applied, then
  [`../fixtures/seed.sql`](../fixtures/seed.sql) applied to `gdgjp-sns-db`.
- `.dev.vars` overrides, all test-only values:
  - `X_API_BASE_URL=http://127.0.0.1:9`
  - `X_TOKEN_URL=http://127.0.0.1:9/2/oauth2/token`
  - `X_AUTHORIZATION_URL=http://127.0.0.1:9/i/oauth2/authorize`
  - `X_CLIENT_ID=sns-verify-x-client`, `X_CLIENT_SECRET=sns-verify-x-secret`
  - `TOKEN_ENCRYPTION_KEY=sns-verify-token-key`
  - `GOOGLE_PHOTOS_IMPORT_TOKEN=sns-verify-import-token`
  - `GITHUB_ACTIONS_DISPATCH_TOKEN` empty.
  Port 9 on loopback is the discard port and is closed on developer machines, so any
  X request fails to connect. No X fake exists in the repository
  (`apps/pr/e2e/mock-services/sns.ts` fakes the SNS RPC service for pr, not X).
- Every seeded X account stores `access_token_ciphertext = 'fixture-not-encrypted'`.
  `decryptSecret` rejects it before any network call, so a publish attempt fails
  with `Invalid encrypted secret` and never builds an X request. Do not connect a
  real X account in this stack.
- Before any journey that can publish, run the guard in
  [publishing.md](publishing.md#driving-it-with-orca-browser). Stop the run if it fails.
- CLI journeys and `sns-access-signed-out` need `--platform <verify-platform ready.json>` (local Accounts at
  `http://localhost:6173`). CLI journeys also need
  [`../fixtures/accounts-seed.sql`](../fixtures/accounts-seed.sql) applied to the
  Accounts D1 `gdgjp-accounts-db`.
- Independent D1 reads run from the scratch `apps/sns` directory:
  `pnpm exec wrangler d1 execute gdgjp-sns-db --local --json --command "<SQL>"`.
  Add the helper's `--persist-to` value if it uses one.
- Never put a URL in post text. Draft saves fetch the first URL in the text for a
  link preview (`link-preview.server.ts`), which reaches the public internet.
- Never fill the `タグ付けするユーザー` field. Tag handles are resolved through the X
  users API on save.

## Ordering constraints

- Run `sns-access-roles` before the contributor journeys. `sns-contributors-remove`
  removes `verify-sns-contributor@dev.local`, and `sns-contributors-add` grants the
  member access, which changes the member's `/no-chapter` result.
- Run `sns-posts-list` before `sns-publish-failsafe`, which replaces the seeded failure
  reason. Run `sns-publish-failsafe` before any journey edits `post-verify-failed`;
  saving a failed post resets it to `scheduled`.
- `sns-x-revoke` revokes only `xacc-verify-revoke`; `sns-cli-x-accounts` revokes only
  `xacc-verify-cli-revoke`. Never revoke `xacc-verify-1`; the composer journeys use it.
- Run `sns-photos-album`, then part A of `sns-photos-library`, then
  `sns-photos-import`, then part B of `sns-photos-library`. Do not change the album URL
  after import; a URL change deletes the imported media and their R2 objects.
- The chapter cookie `sns-chapter` lasts 30 days. Run `sns-chapter-switch` and
  `sns-posts-empty` only in the switcher profile.
- Run `sns-signout` last in the organizer profile.

## What the map does not cover

- Completing X OAuth (`/x/callback` with a valid state and code), real X posting,
  media upload to X, alt-text metadata and tag-handle resolution. No local X fake
  exists, so these stay outside the map. `sns-x-connect` stops at the authorization
  redirect.
- Accounts contributor search (`/api/contributor-candidates` with a non-empty query).
  Dev-login sessions have no Accounts access token, so the endpoint cannot succeed
  locally without a real OIDC session. See [contributors.md](contributors.md#gotchas).
- The cron handler (`scheduled` in `workers/app.ts`): scheduled X publishing and the
  GitHub Actions dispatch for Google Photos. Dev Vite mode does not run it, and
  triggering it locally would attempt X and GitHub calls. See
  [publishing.md](publishing.md#gotchas).
- The GitHub Actions importer in `google-photos-importer/`, which scrapes Google
  Photos. The map drives only the Worker's importer endpoints.
- Link previews, which fetch external pages.
- The `PrService` RPC entrypoint that pr.gdgs.jp binds to; verify it from the pr app.
- Locales, narrow layouts beyond the default viewport, and theme switching.

Seeded Playwright specs in `apps/sns/e2e/` are separate regression evidence and do not
replace these Orca journeys.
