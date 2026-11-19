# Stage 01 — workspace-scaffold apps/meet ワークスペースの新設と RP 認証

## Context — 背景とリポジトリ状況

### なぜやるか

全体方針は [`00-overview.md`](00-overview.md)、PoC 検証結果は [`00a-poc-findings.md`](00a-poc-findings.md) にある。**着手前に必ず `docs/plans/meet/00-overview.md` と `docs/plans/meet/00a-poc-findings.md` を読むこと。**

GDG Japan / GDG on Campus Japan で共有アカウント `community-support@gdgoc.jp` のパスワードを配らずに Google Meet 会議を作成・管理できるよう、新規アプリ `meet.gdgs.jp`（ワークスペース `apps/meet/`、パッケージ `@gdgjp/meet`）の骨格を作る。このステージではドメイン機能は作らず、以下を完了させる。

1. `apps/roulette/` を手本に `apps/meet/` ワークスペースを新設し、GDG Accounts（`apps/accounts/`）の relying party としてサインイン・サインアウト・ローカル `dev login` が動く状態にする
2. 認証ガードに、チャプター所属必須の `requireUserWithChapter` とチャプター不要の `requireUser` の両方を実装し、空のトップページ（`/`）と `/no-chapter` を置く
3. `apps/accounts/` に RP クライアント `meet` を登録する
4. モノレポの CI / Deploy / Design Harness 登録ポイントとルート `CLAUDE.md` を更新し、アーキテクチャテストを初日から配置する

### 依存と対象範囲

- **先行ステージ**: なし（起点ステージ。本ステージ完了後に Stage 02 と Stage 03 を並行着手できる）
- **対象**: `apps/meet/`（新規）、`apps/accounts/`（`meet` OAuth クライアント登録のみ）、モノレポ登録ファイル（`.github/`, `scripts/`, `CLAUDE.md`, `pnpm-lock.yaml`）
- **本ステージで作らないもの（次ステージ以降の担当）**:
  - `MeetDirectoryService` RPC とディレクトリクライアント（Stage 02）
  - Google OAuth 接続・暗号化・Google API クライアント（Stage 03）
  - 会議テーブル・作成フォーム・一覧/詳細・Queue `MEET_JOBS`（Stage 04）
  - 会議の編集・取り消し（Stage 05）
  - Pub/Sub Push・生成ファイル共有・cron（Stage 06）

### 読むべきもの

- `CLAUDE.md`（リポジトリルート）— モノレポ全体の規約、`cf-typegen`、`migrate:local`
- `docs/software-architecture.md` — feature-first 配置規約
- `apps/roulette/` 一式 — **最小 RP アプリの手本**（`package.json`, `wrangler.toml`, `vite.config.ts`, `vitest.config.ts`, `react-router.config.ts`, `tsconfig.json`, `playwright.config.ts`, `.dev.vars.example`, `workers/app.ts`, `migrations/0001_init.sql`, `types/env.d.ts`, `app/root.tsx`, `app/entry.server.tsx`, `app/app.css`, `app/routes.ts`, `app/features/auth/*`, `app/layouts/AdminLayout.tsx`, `app/lib/use-hydrated.ts`, `app/routes/{signin.tsx,api.auth.$.ts,auth.signout.ts,dev.login.ts}`, `app/routes/auth/no-chapter.tsx`, `e2e/global-setup.ts`, `README.md`, `ARCHITECTURE.md`）
- `apps/pr/tests/architecture/`（`files.ts`, `layering.test.ts`, `file-size.test.ts`, `test-colocation.test.ts`, `route-urls.test.ts`）— アーキテクチャテストの移植元
- `apps/accounts/wrangler.toml`, `apps/accounts/.dev.vars.example`, `apps/accounts/types/env.d.ts`, `apps/accounts/app/features/oauth/seed-clients.server.ts` — OAuth クライアント登録方法
- `.github/scripts/changed-workspaces.mjs`, `.github/scripts/changed-workspaces.test.mjs`, `.github/scripts/workflows.test.mjs`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `scripts/run-ci.mjs`, `scripts/check-ui-conventions.mjs`, `scripts/check-design-harness.mjs` — CI / Deploy / UI 規約の登録と検査

### 再利用する既存実装（書き直さない）

- **`apps/roulette/vite.config.ts` の `resolve.dedupe` + `optimizeDeps.include` + `environments` ブロック** — `@gdgjp/gdg-lib` をソースのまま consume するため、無いとクライアントに React が二重に入りハイドレーションで落ちる。コメントごとコピーする
- **`apps/roulette/migrations/0001_init.sql` の `"user"` と `oidc_session`** — `gdg-lib` の RP 認証の正準スキーマ。そのままコピーする
- **`apps/roulette/app/features/auth/{auth.server.ts,chapter.server.ts,access.server.ts,return-to.ts}`** — `initializeRpAuth`（`env.ACCOUNTS.fetch` 経由）、`getFreshClaims`、`requireUserWithChapter` をそのまま再利用し、`cookiePrefix` を `"gdgjp-meet"` に変更して `requireUser` を追加する
- **`apps/roulette/app/app.css`** — `scripts/check-ui-conventions.mjs` が検証する `@layer` 宣言・4 つの `@import` 順・`@source "../../../packages/gdg-lib/src/ui";` をそのまま維持する
- **`packages/gdg-lib` / `@gdgjp/design-system`** — `installSignedOutReload`（`@gdgjp/gdg-lib/auth/signed-out-reload`）、`GdgAccountMenu`（`@gdgjp/gdg-lib/ui`）、`AppShell` / `ThemeProvider` / `ThemeToggle` / `Toaster` / `Card` / `EmptyState` / `PageHeader` / `Button` / `Icons` / `Stack` / `Heading` / `Text`

### 前提として確認済みの事実

- **dev ポート**: `apps/accounts/.dev.vars.example` では `5190`（`roulette`）、`5191`（`pr`）、`5192`（`mcp`）まで割り当て済みである。`apps/meet/` は **`5193`**（CI E2E は **`6193`**、inspectorPort は **`9293`**）を使用する（`00-overview.md` §8 のコールバック URI `http://localhost:5193/admin/google/callback` と一致）。
- **lockfile**: 新規ワークスペースの追加に伴い `pnpm install` 実行時にルート `pnpm-lock.yaml` が更新されるのは想定どおりである。
- **設定のパターン化**: `pnpm-workspace.yaml`（`apps/*`）、`biome.json`、`turbo.json`、`tsconfig.base.json` はグロブ／パターンベースのため追記不要。ルート `.gitignore` が `.dev.vars*` / `build/` / `.react-router/` / `.wrangler/` / `worker-configuration.d.ts` を無視するため、ワークスペース個別の `.gitignore` は作らない。

---

## Design — 設計

### 1. ワークスペース設定（`apps/meet/`）

`apps/roulette/` を雛形に作成し、以下の諸元を設定する。

| 項目 | 値 |
|---|---|
| ディレクトリ / パッケージ名 | `apps/meet/` / `@gdgjp/meet` |
| Worker 名 | `gdgjp-meet` |
| 本番ホスト | `meet.gdgs.jp`（`[[routes]] pattern = "meet.gdgs.jp", custom_domain = true`） |
| D1 データベース | binding `DB`、名前 `gdgjp-meet-db`（`wrangler d1 create gdgjp-meet-db` で発行した `database_id` を `wrangler.toml` に設定） |
| Service binding | `ACCOUNTS → gdgjp-accounts`（Stage 01 はこれのみ。`ACCOUNTS_DIRECTORY` は Stage 02、`MEET_JOBS` Queue は Stage 04、cron は Stage 06 で足す） |
| `[vars]` | `ENVIRONMENT = "production"`, `APP_URL = "https://meet.gdgs.jp"`, `ACCOUNTS_URL = "https://accounts.gdgs.jp"`, `IDP_URL = "https://accounts.gdgs.jp"`, `IDP_CLIENT_ID = "meet"` |
| Secrets（`.dev.vars.example`） | `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET` |
| dev / E2E / inspector ポート | `5193` / `6193` / `9293` |
| cookie prefix | `gdgjp-meet` |

- **`package.json`**: `apps/roulette/package.json` と同じ scripts / dependencies を採用し、`migrate:local` / `migrate:remote` の DB 名を `gdgjp-meet-db` に変更する。`typecheck` は `wrangler types && react-router typegen && node ../../node_modules/@typescript/native/bin/tsc --noEmit`、`schema:dump` は `bash ../../scripts/dump-schema.sh`。
- **`wrangler.toml`**: `compatibility_date = "2026-07-28"`, `compatibility_flags = ["nodejs_compat"]`, `[alias] "virtual:react-router/server-build" = "./build/server/index.js"`, `[assets] binding = "ASSETS", directory = "./build/client"`, `[observability]` / `[observability.logs]` を `apps/roulette/wrangler.toml` と揃える。
- **`vite.config.ts`**: `apps/roulette/vite.config.ts` をコピーし、`server: { port: 5193, strictPort: true }` と `inspectorPort: process.env.CI ? false : 9293` に変更する。
- **`playwright.config.ts` / `e2e/global-setup.ts`**: `const PORT = process.env.CI ? 6193 : 5193;` とし、`global-setup.ts` は `gdgjp-meet-db` へローカルマイグレーションを適用する（Windows/POSIX 互換のため `fileURLToPath(new URL("..", import.meta.url))` を `cwd` に渡す）。
- **`workers/app.ts`**: `apps/roulette/workers/app.ts` と同一の `fetch` ハンドラを置く（`queue` / `scheduled` は Stage 04 / 06 で追加する）。
- **`types/env.d.ts`**: `AppLoadContext` と `Env`（`RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`）を定義する。
- **`.dev.vars.example`**: `RP_SESSION_SECRET=""`, `IDP_CLIENT_SECRET=""`, `APP_URL=http://localhost:5193`, `ACCOUNTS_URL=http://localhost:5173`, `IDP_URL=http://localhost:5173`, `IDP_CLIENT_ID=meet`, `ENVIRONMENT=development` を記載する。

### 2. D1 スキーマ（`migrations/0001_init.sql`）

`apps/roulette/migrations/0001_init.sql` の `"user"` テーブル、`user_oidc_identity` 一意インデックス、`oidc_session` テーブル、`oidc_session_user_idx` インデックス**だけ**をコピーする。ドメインテーブル（`project`, `prize`, `draw` に相当するものや、Stage 03 以降の `google_connection`, `meetings` 等）は含めない。

`pnpm --filter @gdgjp/meet migrate:local` を実行して `apps/meet/schema.sql` を生成する。

### 3. 認証（`app/features/auth/`）と画面骨格

`00-overview.md` §6 の権限モデルに備え、チャプター所属不要のログイン者（招待されただけの参加者・co-host・管理者）と、チャプター所属必須の操作者（会議作成者）の両方を扱えるようにする。

- **`app/features/auth/auth.server.ts`**: `cookiePrefix: "gdgjp-meet"`, `env.ACCOUNTS.fetch` で `initializeRpAuth` を初期化・キャッシュする。
- **`app/features/auth/chapter.server.ts`**: `fetchChaptersForUser` / `fetchChapterForUser`（`apps/roulette` と同一）。
- **`app/features/auth/return-to.ts`**: `safeReturnTo`（`apps/roulette` と同一）。
- **`app/features/auth/access.server.ts`**:
  - `buildSignInRedirect(request)` と `getOptionalUser(env, request)`
  - `requireUser(env, request): Promise<AuthUser>` — チャプター不要のサインイン要求。`getAuth(env).requireUser(request)` を呼び、401 `Response` を catch した場合のみ `buildSignInRedirect(request)` を throw する（503 等はフェイルクローズのため再送出する）。
  - `requireUserWithChapter(env, request)` — チャプター所属必須のサインイン要求（`apps/roulette` と同一。`resolved.primary` が `null` なら `redirect("/no-chapter")` を throw、`ClaimsUnavailableError` なら `buildSignInRedirect(request)` を throw）。
- **`app/layouts/AppLayout.tsx`**: `apps/roulette/app/layouts/AdminLayout.tsx` を手本に `AppShell` + `GdgAccountMenu` + `ThemeToggle` を配置する。ブランド表記は `GDG Japan Meet`、ナビゲーションは `/`（「会議一覧」）。アイコン・UI 部品はすべて `@gdgjp/design-system` から import する。
- **ルート一覧（`app/routes.ts`）**:

| パス | ファイル | 認証・挙動 |
|---|---|---|
| `/` | `routes/meetings/home.tsx` | `requireUser`（チャプター不要）+ `fetchChaptersForUser`。見出し「GDG Japan Meet」と「まだ会議がありません」（空状態 `EmptyState`）を表示。Stage 04 で一覧と作成ボタンを実装 |
| `/no-chapter` | `routes/auth/no-chapter.tsx` | 未ログインなら `/signin?return_to=%2Fno-chapter`、チャプター所属済みなら `/` へリダイレクト。未所属なら「GDG チャプターへの参加が必要です」と `accountsUrl/onboarding` への誘導を表示 |
| `/signin` | `routes/signin.tsx` | `/api/auth/signin` へリダイレクト（`apps/roulette` と同一） |
| `/api/auth/*` | `routes/api.auth.$.ts` | `getAuth(env).handleAuthRequest`（`apps/roulette` と同一） |
| `/auth/signout` | `routes/auth.signout.ts` | `getAuth(env).handleSignOutRedirect`（`apps/roulette` と同一） |
| `/dev/login` | `routes/dev.login.ts` | `getAuth(env).handleDevLogin`（`APP_URL` が loopback 以外の本番では 404） |

### 4. アーキテクチャテストとドキュメント

- **`apps/meet/tests/architecture/`**: `apps/pr/tests/architecture/` の 4 本（`layering.test.ts`, `file-size.test.ts`, `test-colocation.test.ts`, `route-urls.test.ts` + `files.ts`）を allowlist 空でコピーし、`vitest.config.ts` の `include` に `"tests/**/*.test.ts"` を含める。これにより feature-first 境界・400 行上限・テストのコロケーション・公開 URL 集合を初日から機械的に固定する。
- **`apps/meet/README.md`**: アプリの目的（`community-support@gdgoc.jp` 代理による Meet 会議作成・co-host/参加者管理・生成ファイル共有）、構成と Cloudflare バインディング（Stage 01 の D1 / `ACCOUNTS` と、Stage 02〜06 で追加予定の `ACCOUNTS_DIRECTORY` / Queue `MEET_JOBS` / cron）、ローカル開発手順、本番デプロイ時の Secrets / `seed-clients` 運用手順の骨子を記載する。
- **`apps/meet/ARCHITECTURE.md`**: `apps/roulette/ARCHITECTURE.md` / `apps/accounts/ARCHITECTURE.md` の粒度で、ディレクトリ構成と責務表・依存方向ルール・アーキテクチャテストの役割を記載する。
- **ルート `CLAUDE.md`**: `apps/` 一覧に `apps/meet/` の説明を 1 項目（短く、`meet.gdgs.jp`、GDG Accounts relying party、Stage 01 時点の構成と後続ステージの役割）追加する。

### 5. `apps/accounts` への RP クライアント `meet` 登録

`apps/accounts/` の `ROULETTE_CLIENT_ID` / `ROULETTE_REDIRECT_URLS` と同じ配線で `meet` を追加する。

| ファイル | 追加内容 |
|---|---|
| `apps/accounts/wrangler.toml` | `[vars]` に `MEET_CLIENT_ID = "meet"` と `MEET_REDIRECT_URLS = "https://meet.gdgs.jp/api/auth/callback/gdgjp"` |
| `apps/accounts/.dev.vars.example` | `MEET_CLIENT_SECRET=""`、`MEET_CLIENT_ID=meet`、`MEET_REDIRECT_URLS=http://localhost:5193/api/auth/callback/gdgjp` |
| `apps/accounts/types/env.d.ts` | `Env` に `MEET_CLIENT_SECRET: string;` |
| `apps/accounts/app/features/oauth/seed-clients.server.ts` | `collectSpecs()` の `apps` 配列に `["GDG Japan Meet", env.MEET_CLIENT_ID, env.MEET_CLIENT_SECRET, env.MEET_REDIRECT_URLS]` |
| `apps/accounts/app/features/oauth/rp-session.server.ts` | `firstPartyRpClientIds()` に `env.MEET_CLIENT_ID`（ないと `/api/rp/v1/session` が meet を拒否し、ログイン後の全リクエストが失敗する） |

変更後、`pnpm --filter @gdgjp/accounts cf-typegen` で `apps/accounts` の `Env` 型を更新する（生成物はコミットしない）。

### 6. モノレポ CI / Deploy / Design Harness 配線

| ファイル | 追加内容 |
|---|---|
| `.github/scripts/changed-workspaces.mjs` | `CI_WORKSPACES` に `{ directory: "apps/meet", workspace: "@gdgjp/meet", build: true, e2e: true }`、`DEPLOY_TARGETS` に `{ app: "meet", workspace: "@gdgjp/meet", provider: "cloudflare", migrate: true }`、`GDG_LIB_DEPENDENTS` に `"meet"`、`packages/design-system` 連動配列に `"meet"` |
| `.github/scripts/changed-workspaces.test.mjs` | ハードコードされた `ci` / `build` / `deploy` の配列長（+1）と `gdg-lib` / `design-system` 伝播テストの期待配列に `@gdgjp/meet` / `meet` を追加 |
| `.github/workflows/ci.yml` | `typecheck` / `test` / `build` の各 `parallel:` に `Typecheck meet` / `Test meet` / `Build meet` ステップを追加。`e2e` の `Create accounts dev vars` ステップに `apps/meet/.dev.vars`（ポート `6193`, `IDP_CLIENT_ID=meet`, `ENVIRONMENT=development`）と `apps/accounts/.dev.vars` 用の `MEET_CLIENT_*` を追加 |
| `.github/workflows/deploy.yml` | `parallel:` に `Build, deploy, and migrate meet` ステップ（`build` / `run deploy` / `migrate:remote`）を追加 |
| `.github/scripts/workflows.test.mjs` | `cloudflareWorkspaces` 配列に `"meet"` を追加 |
| `scripts/run-ci.mjs` | `workspaces` Map に `["apps/meet", "@gdgjp/meet"]` を追加 |

### 制約

- **Google API・RPC・会議ドメインを先取りしない**: `ACCOUNTS_DIRECTORY`（Stage 02）、`google_connection` と Google API クライアント（Stage 03）、会議テーブルと `MEET_JOBS` Queue（Stage 04）は本ステージでは作らない。理由: Stage 02 と Stage 03 を独立して並行実装できるようにするため。
- **`apps/meet/schema.sql` と `worker-configuration.d.ts` を手で編集しない**: `migrate:local` と `cf-typegen` の生成物であるため。
- **`apps/meet/app/` のコードで `lucide-react` / `radix-ui` を直接 import しない**: アイコン・プリミティブは `@gdgjp/design-system` 経由に限定する。理由: `scripts/check-ui-conventions.mjs` が `legacy-import` として拒否するため。
- **`pnpm-lock.yaml` を手で編集しない**: `pnpm install` の実行結果としてのみ更新する。
- **`apps/roulette/` など手本アプリを改変しない**: `apps/accounts/` は `meet` クライアント登録の 4 ファイルのみ編集する。

---

## Files to touch — 変更ファイル

### `apps/meet/`（すべて新規）

- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `react-router.config.ts`, `playwright.config.ts`, `wrangler.toml`, `.dev.vars.example`
- `README.md`, `ARCHITECTURE.md`
- `workers/app.ts`, `types/env.d.ts`
- `migrations/0001_init.sql`, `schema.sql`（`migrate:local` により生成）
- `public/favicon.svg`
- `app/{root.tsx,entry.server.tsx,app.css,routes.ts}`
- `app/layouts/AppLayout.tsx`, `app/lib/use-hydrated.ts`
- `app/features/auth/{auth.server.ts,chapter.server.ts,access.server.ts,access.server.test.ts,return-to.ts}`
- `app/routes/{signin.tsx,api.auth.$.ts,auth.signout.ts,dev.login.ts}`, `app/routes/meetings/home.tsx`, `app/routes/auth/no-chapter.tsx`
- `tests/architecture/{files.ts,layering.test.ts,file-size.test.ts,test-colocation.test.ts,route-urls.test.ts}` + `__snapshots__/route-urls.test.ts.snap`
- `e2e/{global-setup.ts,auth.spec.ts}`

### `apps/accounts/`

- `wrangler.toml`
- `.dev.vars.example`
- `types/env.d.ts`
- `app/features/oauth/seed-clients.server.ts`
- `app/features/oauth/rp-session.server.ts`

### モノレポ登録・ドキュメント

- `.github/scripts/changed-workspaces.mjs`
- `.github/scripts/changed-workspaces.test.mjs`
- `.github/scripts/workflows.test.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `scripts/run-ci.mjs`
- `CLAUDE.md`
- `pnpm-lock.yaml`（`pnpm install` により更新）

---

## Verification — 完了条件と検証

### 完了条件

1. `pnpm --filter @gdgjp/meet typecheck`、`test`、`build`、`cf-typegen` がすべて通る。
2. `pnpm ci:quick`、UI 規約チェック（`check-ui-conventions.mjs`）、デザインハーネス（`check-design-harness.mjs`）が違反ゼロで通る。
3. ローカルで `/dev/login` によりサインインすると `/` に「GDG Japan Meet」と会議が空である旨が表示される。
4. チャプター未所属ユーザーで `/no-chapter` が表示され、チャプター所属ユーザーが `/no-chapter` にアクセスすると `/` へリダイレクトされる。
5. `apps/accounts` の `seedClients` 対象に `meet`（`https://meet.gdgs.jp/api/auth/callback/gdgjp`）が含まれる。

### コマンド

```sh
pnpm install
# D1 作成後、wrangler.toml に database_id を記入してから実行（ローカル検証のみなら database_id 仮値でも可）
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet cf-typegen
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet build
pnpm --filter @gdgjp/meet test:e2e
pnpm --filter @gdgjp/accounts cf-typegen
node scripts/check-ui-conventions.mjs --app apps/meet
node scripts/check-design-harness.mjs source apps/meet/app/root.tsx apps/meet/app/layouts/AppLayout.tsx apps/meet/app/routes/meetings/home.tsx apps/meet/app/routes/signin.tsx apps/meet/app/routes/auth/no-chapter.tsx
node --test .github/scripts/*.test.mjs
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`app/features/auth/access.server.test.ts`**:
  - `requireUser` は未ログイン（401）で `/signin?return_to=...` へリダイレクトし、IdP 到達不能時の 503 `Response` は飲み込まずそのまま再送出する
  - `requireUserWithChapter` はチャプター未所属ユーザーを `/no-chapter` へリダイレクトする
- **`e2e/auth.spec.ts`**:
  - 未ログインで `/` にアクセスすると `/signin?return_to=%2F` へリダイレクトされる
  - `/dev/login` でチャプターありログインすると `/` に「GDG Japan Meet」と空状態が表示される
  - `/dev/login?chapter=none&return_to=/no-chapter` で `/no-chapter` が表示され、チャプターありユーザーが `/no-chapter` を開くと `/` へリダイレクトされる
- **`tests/architecture/route-urls.test.ts`**: Stage 01 の公開ルート集合をスナップショットで固定する
- **`.github/scripts/changed-workspaces.test.mjs` & `workflows.test.mjs`**: `@gdgjp/meet` と `meet` の登録漏れを検知する

### 手動 E2E

1. `cp apps/meet/.dev.vars.example apps/meet/.dev.vars` し、`RP_SESSION_SECRET` / `IDP_CLIENT_SECRET` を埋める。
2. `pnpm --filter @gdgjp/meet migrate:local` を実行後、`pnpm --filter @gdgjp/meet dev`（`:5193`）を起動する。
3. ブラウザで `http://localhost:5193/` を開き、`/signin?return_to=%2F` へリダイレクトされることを確認する。
4. `http://localhost:5193/dev/login?as=organizer1&chapter=1:tokyo:organizer&return_to=/` を開き、`/` に「GDG Japan Meet」と会議が空である旨が表示されることを確認する。
5. `http://localhost:5193/dev/login?as=guest1&chapter=none&return_to=/no-chapter` を開き、`/no-chapter` が表示されることを確認する。
6. 一時的に `ENVIRONMENT=production` で `/dev/login` が 404 になることを確認し、開発設定へ戻す。
