# TinyURL feature map

TinyURL (`apps/tinyurl`, dashboard `url.gdgs.jp`, short links on `gdgs.jp`, `go.gdgs.jp`, and
custom domains) lets chapter members create short links, organize them with folders, tags, and
campaigns, share them, read click analytics, and resolve them publicly. Custom domains reach the
same resolver through the Vercel gateway in `apps/tinyurl-gateway`.

Drive these journeys in the stack started by
`node scripts/verification/app-stack.mjs --app tinyurl --serve` (built Worker preview at
`http://localhost:6169`, fresh local D1, test-only `.dev.vars`). Current-run status and evidence
belong in `../coverage.json`. Every journey starts as `NOT VERIFIED`; a recipe here is not
execution evidence.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `tinyurl-access`, `tinyurl-accounts-continuation` | [Sign-in gate, chapter gate, sign-out](access.md) | Anonymous, `nochapter`, `owner` |
| `tinyurl-links-empty`, `tinyurl-link-create`, `tinyurl-link-validation`, `tinyurl-link-edit`, `tinyurl-link-archive-delete`, `tinyurl-qr`, `tinyurl-link-preview` | [Short links](links.md) | `owner` |
| `tinyurl-dashboard-view` | [Links list: search, filters, display](dashboard.md) | `owner` |
| `tinyurl-redirect` | [Public redirect, bot preview, not found](redirects.md) | Anonymous (HTTP) |
| `tinyurl-link-sharing`, `tinyurl-link-forbidden` | [Visibility, sharing, chapter co-ownership, 403](sharing.md) | `owner`, `peer`, `outsider`, `admin` |
| `tinyurl-tags`, `tinyurl-tag-ownership` | [Tags](tags.md) | `owner`, `peer`, `outsider` |
| `tinyurl-folders`, `tinyurl-folder-sharing` | [Folders](folders.md) | `owner`, `peer`, `outsider` |
| `tinyurl-campaigns`, `tinyurl-campaign-channels`, `tinyurl-campaign-acquisition` | [Campaigns, channels, sources, connpass import](campaigns.md) | `owner`, `outsider` |
| `tinyurl-domains` | [Domains](domains.md) | `owner`, `peer`, `outsider` |
| `tinyurl-analytics-empty`, `tinyurl-analytics` | [Analytics](analytics.md) | `owner`, `outsider` |
| `tinyurl-gateway` | [Custom-domain gateway](gateway.md) | None (signed server-to-server) |

## Identities

All sign-ins use the local-only `/dev/login` route (404 unless `APP_URL` is local). The user id is
`dev-user-<as>`, the email `<as>@dev.local`, the display name `<as> (dev)`. A chapter value is
`<id>:<slug>:<organizer|member>`. Navigating to another `/dev/login` URL replaces the session.

| Identity | Sign-in URL | Meaning |
| --- | --- | --- |
| `owner` | `http://localhost:6169/dev/login?as=owner&chapter=101:gdg-verify-tokyo:organizer&return_to=/links` | Chapter 101 organizer; manages domains for 101 |
| `peer` | `http://localhost:6169/dev/login?as=peer&chapter=101:gdg-verify-tokyo:member&return_to=/links` | Chapter 101 member; co-owner of chapter 101 links, cannot manage domains |
| `outsider` | `http://localhost:6169/dev/login?as=outsider&chapter=202:gdg-verify-osaka:organizer&return_to=/links` | Chapter 202 organizer; owns the seeded private link |
| `admin` | `http://localhost:6169/dev/login?as=admin&chapter=202:gdg-verify-osaka:member&admin=1&return_to=/links` | Super admin; bypasses link, folder, and campaign checks |
| `nochapter` | `http://localhost:6169/dev/login?as=nochapter&chapter=0:none&return_to=/links` | Signed in without a chapter |

Add `admin=1` only for `admin`. It short-circuits every link and folder permission check, so a
permission journey run as an admin proves nothing. Omitting `chapter` does not create a
chapterless user: gdg-lib then signs in to `1:dev-chapter:organizer`.

For HTTP read-backs with a session, mint a cookie jar with the same URL:
`curl -s -o /dev/null -c "$EVIDENCE/owner.jar" '<sign-in URL>'`, then pass `-b "$EVIDENCE/owner.jar"`,
where `$EVIDENCE` is the run's evidence directory. Never record cookie values.

## Baseline preconditions

- The helper reports ready for `tinyurl` at `http://localhost:6169`. Its `.dev.vars` sets
  `APP_URL` and `SHORT_URL_BASE` to `http://localhost:6169`, `ENVIRONMENT=development`, and a
  test `RP_SESSION_SECRET`. The `tinyurl-gateway` journey also needs
  `GATEWAY_SHARED_SECRET=verify-tinyurl-gateway-secret` in that file; without it every
  `/api/internal/gateway/*` request answers 401 and that journey is blocked.
- Apply [`../fixtures/seed.sql`](../fixtures/seed.sql) once, from the snapshot's `apps/tinyurl`
  directory, after migrations:
  `pnpm exec wrangler d1 execute gdgjp-tinyurl-db --local --persist-to .wrangler/state --file <absolute path>/seed.sql`.
  It adds the local apex domain `localhost:6169` (id 100), the active custom domain
  `verify-gw.example` owned by chapter 101 (id 101), and the outsider's private link
  `verify-seed-private` (`link_01KSEED00000000000000000PV`).
- D1 read-backs run from the same directory:
  `pnpm exec wrangler d1 execute gdgjp-tinyurl-db --local --persist-to .wrangler/state --json --command "<SQL>"`.
- Redirect read-backs send a browser user agent. Define once:
  `UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'`.
  curl's default `curl/x.y` agent is classified as a bot and receives the preview page, not a 302.
- Create every link a journey resolves on the `localhost:6169/` domain (control
  **Short link domain**). The default `gdgs.jp/` choice saves correctly but never resolves on the
  local host.
- Use IP-literal destinations such as `https://1.1.1.1/verify-first`. Hostname destinations are
  checked through DNS-over-HTTPS at `cloudflare-dns.com`; offline they fail with
  `Destination URL must not resolve to a private or loopback address.` Never follow a redirect to
  a destination; read `Location` instead.
- Drive the browser through Orca Browser (read the `orca-cli` skill and its version-matched
  browser reference first). Prefer roles and accessible names quoted in each recipe.

## Ordering

All journeys share one fresh D1. Run in this order, or recreate the precondition a recipe states:

1. `tinyurl-access`, then `tinyurl-accounts-continuation` (only with `--platform <verify-platform ready.json>`).
2. Empty states before anything is created as `owner`: `tinyurl-links-empty`,
   `tinyurl-analytics-empty`, and the first step of `tinyurl-tags`, `tinyurl-folders`, and
   `tinyurl-campaigns`. Public links appear on every member's list, so no identity may create a
   public link before these run.
3. `tinyurl-link-create`, `tinyurl-redirect`, `tinyurl-link-validation`, `tinyurl-link-edit`,
   `tinyurl-qr`, `tinyurl-link-preview`, `tinyurl-dashboard-view`,
   `tinyurl-link-archive-delete`.
4. `tinyurl-link-forbidden`, `tinyurl-link-sharing`, `tinyurl-tags`, `tinyurl-tag-ownership`,
   `tinyurl-folders`, `tinyurl-folder-sharing`, `tinyurl-campaigns`,
   `tinyurl-campaign-channels`, `tinyurl-campaign-acquisition`, `tinyurl-domains`,
   `tinyurl-analytics`, `tinyurl-gateway`.

Record every link id (the `/links/<id>` URL after creation), folder id, tag id, and campaign id
a journey produces; later journeys reuse them. Slugs stay unique after deletion, so never reuse a
slug from an earlier run in the same D1.

## Outside this map

| Journey | Why it is outside |
| --- | --- |
| `tinyurl-click-analytics` (nonzero click counts, breakdowns, campaign click charts, `?s=` source attribution) | Clicks are written to the Analytics Engine binding, which is local or absent, and read back through the Cloudflare AE SQL API with `CF_ACCOUNT_ID`/`CF_AE_API_TOKEN`. The test `.dev.vars` has neither, so every page shows zero. Covered by `app/features/analytics/*.test.ts`. |
| `tinyurl-ogp-fetch-success` (create dialog **Fetch**, detail **Fetch** filling title, description, image) | Fetches the destination page over the public internet after a DNS-over-HTTPS check. Only the offline failure message is in the map. Covered by `app/features/links/ogp.test.ts`. |
| `tinyurl-image-upload-success` (preview image upload to `img.gdgs.jp`) | Needs the `gdgjp-img` Worker through `IMG_UPLOAD`/`IMG_HTTP`; the stack does not run it. The map checks the client-side rejection and the 502 unavailable message. |
| `tinyurl-domain-connect`, `tinyurl-domain-sync`, `tinyurl-domain-remove` | Inspection resolves DNS and HTTPS on the public internet, and create, **Check DNS now**, and **Remove domain…** call the Vercel API with `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`. With no token the action throws before it reads the intent. Only the apex-input validation is local. Covered by `app/features/domains/*.test.ts`. |
| `tinyurl-gateway-origin-first` | Needs DNS-over-HTTPS validation of the upstream and a real HTTPS origin. Covered by `apps/tinyurl-gateway/test/index.test.ts`. |
| `tinyurl-cli-api` (`/api/cli/v1/*` with a token) | Bearer identity is resolved by a public fetch to Accounts `/api/cli/v1/identity` with a CLI token, which this stack cannot mint. Only the 401 envelope is in the map. Covered by the CLI route tests. |
| `tinyurl-cli-installer` (`gdgs.jp/cli/install.sh`, `.ps1`) | Served only when the URL host is `gdgs.jp`. |
| `tinyurl-pr-service` (`PrService` RPC entrypoint used by `pr.gdgs.jp`) | Service-binding RPC with no user entry point in this app. Covered by `app/features/campaigns/pr-service.server.test.ts` and the pr app's own verification. |
| `tinyurl-oidc-signin` (real Accounts sign-in and callback) | The map signs in through `/dev/login`; full OIDC belongs to `verify-platform`. |
| `go/` links in Chrome (extension download in the create dialog) | Downloads a release asset from GitHub and needs a browser extension install. |

The map lists user entry points that exist in the current source. It does not cover every
validation message, locale, viewport, keyboard path, or concurrent edit. The Playwright suite in
`apps/tinyurl/e2e/` is separate regression evidence and does not replace these Orca journeys.
