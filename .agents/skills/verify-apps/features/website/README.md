# Website feature map

The website (`apps/website`, apex `gdgs.jp`) is the public GDG Japan landing page: a hero, a
directory of GDG applications, and the privacy policy and terms. In production its Worker
serves `/`, `/privacy`, `/terms`, `/favicon.svg`, and `/assets/*` and delegates every other
apex path (short links such as `/abc123`, `/cli/install.sh`) to the TinyURL Worker through the
`TINYURL` service binding.

Drive these journeys in the stack started by [verify-apps](../../scripts/verify-apps.mjs) at
`http://localhost:6180` (Vite dev with `cloudflareDevProxy`, no database, no seeds). Every
journey starts as `NOT VERIFIED`; a recipe here is not execution evidence.

There are no identities: every page is anonymous and has no sign-in.

## Local delegation behaviour

Vite dev renders React Router directly; `workers/app.ts` and its `routeApexRequest` never run.
An unknown path therefore does not reach the `TINYURL` binding at all: React Router answers
HTTP 404 with the framework's default root error page inside the site's `Layout` (only an h1
`404 Not Found`, no header, footer, or `<title>`), because `app/root.tsx` defines no
`ErrorBoundary`. That page is a dev artifact, not the production behaviour. Only a built Worker
run (`wrangler dev`) executes the delegation; there, with no `gdgjp-tinyurl` dev session
registered, wrangler's local service proxy answers the delegated request with an error response
(HTTP 503, a "Couldn't find a local dev session" message naming `gdgjp-tinyurl`) instead of a
short-link redirect. That case is not reachable in this stack.

## Routes

| Route | Who can reach it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Anyone | Header **GDG Japan ホーム** (home link), 主要ナビゲーション **プライバシー** / **利用規約**; アプリケーション cards (TinyURL, Wiki, Scheduler, Images, SNS Manager, Connpass, Pay, CLI, Learn); footer フッターナビゲーション **ホーム** / **プライバシーポリシー** / **利用規約** | Eyebrow GDG Japan, h1 **コミュニティの活動を、もっと身近に。**, lead paragraph, `© <year> GDG Japan` |
| `/privacy` | Anyone | Same header and footer; external links Google プライバシーポリシー etc. | h1 **プライバシーポリシー**, 最終更新日: 2026年7月28日, sections 1. 適用範囲 … 6. お問い合わせと改定 |
| `/terms` | Anyone | Same header and footer | h1 **利用規約**, sections 1. 適用 … 6. お問い合わせ |
| `/favicon.ico` | Anyone | none | Static icon from `public/` |
| Any other path | Anyone | none | Production: TinyURL's response. Local Vite dev: React Router 404 (see above) |

## Journeys

| Journey ID | Feature | Identity | Recipe | Status |
| --- | --- | --- | --- | --- |
| `website-home` | Hero, metadata, application directory links | Anonymous | [pages.md](pages.md) | In map |
| `website-policies` | Header and footer navigation between home, privacy, and terms | Anonymous | [pages.md](pages.md) | In map |
| `website-shortlink-delegation` | Non-site apex paths handed to TinyURL | Anonymous | none | Outside: Vite dev bypasses `workers/app.ts`, and the `TINYURL` Worker is not running; the routing table is covered by `workers/apex-routing.test.ts` only |
| `website-app-icons` | Application card icons | Anonymous | none | Outside: icons load from production hosts (`https://<app>.gdgs.jp/app-icon.png`, GitHub, `learn.gdgs.jp`), so their rendering depends on the external network; the map checks labels and `href`s only |
