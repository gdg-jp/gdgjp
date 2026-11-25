# Roulette feature map

`apps/roulette` is the event prize lottery. Organizers who belong to a chapter create a
project, set prizes and a draw mode at `/admin/<slug>`, and open it. Anonymous visitors spin
the wheel once per device at `/<slug>`. Drive these journeys in the stack that
[verify-apps](../../SKILL.md) starts with `--app roulette`: a built Worker preview
(`wrangler dev --local` over the React Router build) on `http://localhost:6190` with fresh
local D1. There is no Accounts server unless the run passes `--accounts`, so every signed-in
identity comes from `/dev/login`.

Every journey starts as `NOT VERIFIED`. A recipe is not execution evidence. Record status and
evidence paths for the run under its evidence directory (`run.json` names it).

## Identities

| Label | Fixture login (append `&return_to=<path>`) | Purpose |
| --- | --- | --- |
| `organizer` | `/dev/login?as=verify-roulette&chapter=1:dev-chapter` | Driver identity; owns every project |
| `member` | `/dev/login?as=verify-roulette-member&chapter=1:dev-chapter:member` | Same chapter, `member` role |
| `multi` | `/dev/login?as=verify-roulette-multi&chapter=1:dev-chapter&chapter=2:other-chapter` | Two chapters; sees the chapter picker |
| `outsider` | `/dev/login?as=verify-roulette-outsider&chapter=2:other-chapter` | Signed in, wrong chapter |
| `nochapter` | `/dev/login?as=verify-roulette-none&chapter=0` | Signed in, no chapter |
| visitor | none (anonymous) | Spins on the public page |

Only `organizer` is in the driver's `apps.mjs`. Open the others in the browser profile that
the recipe names. A dev session carries its chapters inside the cookie, so a second login in
the same profile replaces the first. Cookies on `localhost` ignore the port: an img or other
app session in the same profile does not collide (`gdgjp-roulette-session` is app-specific),
but the visitor's `roulette-device` cookie is shared by every tab of that profile.

Visitors are identified only by the `roulette-device` cookie: an httpOnly UUID, `Path=/`,
`SameSite=Lax`, one year, set by the first GET of `/<slug>`. The unique index on
`(project_slug, device_id)` enforces one spin per device. A different Orca profile, or
`orca cookie delete --name roulette-device`, is a new device. `/dev/reset/<slug>` (404 unless
`APP_URL` is loopback, no sign-in needed) clears every draw of that project for all devices and
redirects to `/<slug>`. The built preview has `import.meta.env.DEV` false, so the result
screen's 「もう一度回す（開発用）」 button and `?demo=<variant>-<level>` do not exist here; use
`/dev/reset/<slug>` directly.

## Sitemap

| Route | Who reaches it | Main actions | Visible states |
| --- | --- | --- | --- |
| `/` | Chapter member (any role) | List projects; 「プロジェクトを作成」 dialog (プロジェクト名, URL, チャプター when 2+ chapters) | Empty: 「プロジェクトがありません」. List rows `localhost:6190/<slug> · 景品 N 種 · 抽選 M 回 · <chapter>` with badge 受付中 / 停止中. Field errors in the dialog. Anonymous: 302 `/signin?return_to=%2F`. No chapter: 302 `/no-chapter` |
| `/admin/:slug` | Member of the project's chapter | Mode radios, 想定人数, prize rows, 「変更を保存」, 「抽選を受け付ける」 switch, URL コピー / 開く, その他の操作 → 抽選結果をリセット, 抽選ログ, CSV link; polls every 15 s | Onboarding alert 「景品を登録して、受付を始めましょう」; 「未保存の変更があります」; validation alert and field errors; toasts. Other chapter: 403 「アクセスできません」. Unknown or invalid slug: 404 「ページが見つかりません」. Anonymous: 302 to sign-in |
| `/admin/:slug/draws.csv` | Same gate | Download every draw, oldest first | `text/csv`, BOM, `"No.","日時","等級","景品"`, filename `<slug>-draws.csv`, `Cache-Control: private, no-store`. Anonymous 302, other chapter 403 |
| `/:slug` | Anyone, no sign-in | 「ルーレットを回す」 (tap or long press), 音を消す / 音を出す | Open; closed 「いまは抽選を受け付けていません」 with a disabled button; sold out 「景品はすべてなくなりました」 with no button; already drawn 「この端末ではもう抽選しました」; result card; 「混み合っています。もう一度回してください。」; 「Cookie を有効にしてから、ページを開き直してください。」. Unknown, reserved or malformed slug: 404 |
| `/signin` | Anyone | Redirects to `/api/auth/signin` and then to Accounts | Without an Accounts server the OIDC discovery fails; never treat that as a product result |
| `/no-chapter` | Signed in without a chapter | 「チャプターに参加する」 link to Accounts `/onboarding` | Heading 「GDG チャプターへの参加が必要です」. With a chapter: 302 `/`. Anonymous: 302 to sign-in |
| `/auth/signout` | Signed in | Account menu 「ログアウト」 | Clears `gdgjp-roulette-session`, 302 `/signin` |
| `/api/auth/*` | Anyone | `me`, `signin`, `callback`, `signout` | `/api/auth/me` returns `{"user":null}` when anonymous |
| `/dev/login` | Local only | Mint a dev session | 302 to `return_to` |
| `/dev/reset/:slug` | Local only, unauthenticated | Clear a project's draws | 302 `/<slug>`; 404 off loopback or for a bad slug |

## Journeys

| Journey ID | Feature | Identity | Recipe | Map status |
| --- | --- | --- | --- | --- |
| `roulette-projects` | Empty list, create project, form errors, duplicate URL | `organizer` | [projects.md](projects.md) | In map |
| `roulette-project-chapter` | Chapter picker for a two-chapter organizer | `multi` | [projects.md](projects.md) | In map |
| `roulette-prize-settings` | Prize rows, modes, validation, save, odds preview | `organizer` | [settings.md](settings.md) | In map |
| `roulette-evil-mode` | Excluded prize shown but never drawn | `organizer`, visitor | [settings.md](settings.md) | In map |
| `roulette-open-toggle` | 抽選を受け付ける on and off, URL copy and open | `organizer`, visitor | [settings.md](settings.md) | In map |
| `roulette-spin` | Visitor win, loss, result card, no stock shown | visitor | [spin.md](spin.md) | In map |
| `roulette-one-per-device` | Second spin refused, new device allowed, `/dev/reset` | visitor | [spin.md](spin.md) | In map |
| `roulette-closed-soldout` | Closed and sold-out visitor states, stock floor error | visitor, `organizer` | [spin.md](spin.md) | In map |
| `roulette-invalid-slug` | 404 for unknown, reserved and malformed slugs | visitor, `organizer` | [spin.md](spin.md) | In map |
| `roulette-draw-log` | Live log, CSV download, CSV over HTTP | `organizer` | [draw-log.md](draw-log.md) | In map |
| `roulette-reset` | 抽選結果をリセット from the admin menu | `organizer`, visitor | [draw-log.md](draw-log.md) | In map |
| `roulette-access` | Anonymous gate, other chapter, member role, no chapter | all signed-in labels | [access.md](access.md) | In map |
| `roulette-signout` | ログアウト ends the dev session | `organizer` | [access.md](access.md) | In map |
| `roulette-oidc-signin` | Real sign-in through Accounts | Accounts user | [OIDC sign-in](../oidc-signin.md) | Local with `--accounts` |
| `roulette-spin-effects` | CHANCE cut-in colors, 連打 / 押せ, おしい…！ staging | visitor | none | Outside: randomized presentation; the only forcing hook (`?demo=`) exists only in Vite dev, not in this built preview. A spin journey still records whatever staging appeared |
| `roulette-sound-haptics` | BGM, sound effects, vibration, iOS switch haptics | visitor | none | Outside: audio output and vibration are not observable through Orca Browser; the 音を消す toggle's label change is covered in `roulette-spin` |
| `roulette-save-conflict` | 「保存中に抽選が進みました…」 when a spin races a save | `organizer`, visitor | none | Outside: needs a spin to commit between the client's validation and the D1 batch; not reproducible by hand |
| `roulette-busy-retry` | 「混み合っています。もう一度回してください。」 | visitor | none | Outside: appears only after repeated D1 batch contention |

The map covers every route and user-facing control. It does not cover browser sizes beyond
the 390 px visitor viewport and the default desktop admin viewport, the dark theme toggle, or
the account menu's link to Accounts `/dashboard`.
