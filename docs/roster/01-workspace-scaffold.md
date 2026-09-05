# Stage 01 — roster ワークスペースの新設とモノレポ登録

## Context — 背景とリポジトリ状況

### なぜやるか

GDG Japan のイベント運営で、スタッフのシフト表を作ることが準備のボトルネックになっている。
これを自動生成 + 手動編集で解くアプリ `roster.gdgs.jp` を新規に作る。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**
このステージは全体の第 1 段で、**ドメインの機能は一切作らない**。やることは 3 つ。

1. `roster/` ワークスペースを作り、サインインできる状態にする
2. モノレポの登録ポイントを漏れなく埋め、CI と deploy に乗せる
3. アーキテクチャ規約を強制するテストを、コードが増える前に置く

3 が今でなければならない理由は [`adr.md` の ADR-003](adr.md#adr-003-feature-first-とアーキテクチャテストを初日から入れる)
にある。`wiki/` は同じ規約を後付けで導入するのに 6 ステージ費やしている。

### 対象範囲

`roster/`（新規）と、モノレポの登録ポイント、`accounts/` の OAuth クライアント登録。
**他アプリのコードには触らない**（`accounts/` への追加を除く）。

### 読むべきもの

- [`docs/roster/index.md`](index.md) — 全体計画。**必読**
- [`docs/roster/adr.md`](adr.md) — ADR-001（雛形）、ADR-002（ポート）、ADR-003（アーキテクチャ）
- `ost/` の一式 — **これが雛形**。特に `vite.config.ts`, `wrangler.toml`,
  `react-router.config.ts`, `app/lib/auth.server.ts`, `app/lib/chapter.server.ts`,
  `app/lib/auth-redirect.server.ts`, `app/lib/return-to.ts`, `migrations/0001_init.sql`
- `ost/CLAUDE.md` — アプリ単位の `CLAUDE.md` の粒度の手本
- `wiki/tests/architecture/` の `layering.test.ts` / `file-size.test.ts` /
  `test-colocation.test.ts` / `route-urls.test.ts` — **移植元**
- `wiki/ARCHITECTURE.md` — コードマップの手本。**この粒度を真似る**
- `AGENTS.md`（リポジトリ根） — モノレポ全体の規約

### 再利用する既存実装 — 書き直さないこと

- **`ost/vite.config.ts` の `resolve.dedupe` + `optimizeDeps.include` ブロック** —
  `@gdgjp/gdg-lib` はソースのまま consume されるため、これがないとクライアントに React が 2 つ入り
  ハイドレーション時に "invalid hook call" で落ちる。**コメントごとコピーする。**
  `esbuild: { keepNames: true }` は ost の Durable Object 固有なので**落とす**。
- **`ost/migrations/0001_init.sql` の `user` / `oidc_session` テーブル定義** — gdg-lib の RP 認証の
  正準スキーマ。**そのままコピーする。** 自分で書き起こさない。
- **`ost/app/lib/auth.server.ts`** — `initializeRpAuth` を env 単位でキャッシュする形。
  `cookiePrefix` を `gdgjp-roster` に変えるだけ。`idp.fetch` で `ACCOUNTS` サービスバインディングを
  経由する形も引き継ぐ。
- **`ost/app/lib/chapter.server.ts`** — `getFreshClaims` → 30 秒キャッシュ（LRU 上限 500）→
  `{ primary, all }`。dev cookie 名だけ `roster-dev-chapters` に変える。
- **`ost/app/lib/return-to.ts`** — `safeReturnTo`。プロトコル相対 URL と制御文字を弾く。そのまま。
- **`ost/app/routes/api.auth.$.ts` と `auth.signout.ts`** — 認証パススルー。両アプリで同一。そのまま。
- **`ost/vitest.config.ts`** — `scheduler/` と byte-identical。そのまま。
- **`wiki/tests/architecture/` の 4 本** — `fileURLToPath(new URL("../../", import.meta.url))` で
  ワークスペース根を取るだけで wiki 固有ロジックがない。**allowlist を空にしてコピーする。**

### 前提として確認済みの事実（再調査不要）

- `ost/` と `scheduler/` に**ワークスペース単位の `.gitignore` は無い**。根の `.gitignore` が
  `.dev.vars*` / `build/` / `.react-router/` / `.wrangler/` / `worker-configuration.d.ts` を
  すべてカバーしている。`roster/.gitignore` は**作らない**。
- `biome.json` / `turbo.json` / `tsconfig.base.json` は**すべてパターンベース**で、
  新規ワークスペースのための追記は不要。
- `.gtrconfig` の `[copy] include = **/.dev.vars` はグロブなので追記不要。
- ポートの実測値と空き番は [`adr.md` の ADR-002](adr.md#adr-002-dev-ポートを-5186-にする) にある。
  **5186 が空き。** PRD が提案していた 5178 は `sns/` が使用中。
- `accounts/` に利用者検索 API は無い（公開されているのは `/userinfo` のみ）。このステージでは
  使わないが、Stage 04 の設計前提になっている。
- `local_data/` は既に `.gitignore` 済み。このステージで触る必要はない。

---

## Design — 設計

### 1. `roster/` ワークスペースの生成

`ost/` をコピーして改名するのが最短。以下を `ost` → `roster` に置換する。

| 項目 | 値 |
|---|---|
| パッケージ名 | `@gdgjp/roster` |
| Worker 名 | `gdgjp-roster` |
| D1 データベース名 | `gdgjp-roster-db` |
| cookie prefix | `gdgjp-roster` |
| IdP client id | `roster` |
| 本番ホスト | `roster.gdgs.jp` |
| dev ポート | `5186` |
| dev chapter cookie | `roster-dev-chapters` |

**落とすもの**（ost の Durable Object 固有）: `[durable_objects]`、`[[migrations]]`、
`esbuild.keepNames`、`workers/app.ts` の `/ws` upgrade 分岐、`export { OstBoard }`、
`[assets]` の `run_worker_first`。

**`package.json` の scripts** は ost と同形にする。

```json
{
  "build": "react-router build",
  "dev": "react-router dev",
  "deploy": "wrangler deploy",
  "typecheck": "wrangler types && react-router typegen && tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "cf-typegen": "wrangler types",
  "schema:dump": "bash ../scripts/dump-schema.sh",
  "migrate:local": "wrangler d1 migrations apply gdgjp-roster-db --local && pnpm schema:dump",
  "migrate:remote": "wrangler d1 migrations apply gdgjp-roster-db --remote && pnpm schema:dump"
}
```

依存は ost に揃える（`react-router ~7.13.2`, `wrangler ~4.112.0`, `@cloudflare/vite-plugin ~1.28.0`,
`@types/node ^22`）。`class-variance-authority` / `clsx` / `sonner` / `tailwind-merge` /
`tw-animate-css` は ost が持たないので**入れない**。

`tsconfig.json` は `../tsconfig.base.json` を extends し、`types` に `"node"` を含める（ost と同じ）。
`react-router.config.ts` は `future: { v8_viteEnvironmentApi: true }`。

D1 データベースは実際に作る必要がある。

```sh
wrangler d1 create gdgjp-roster-db
```

返ってきた `database_id` を `roster/wrangler.toml` に書く。

### 2. マイグレーション `0001_init.sql`

`ost/migrations/0001_init.sql` の `user` と `oidc_session` の定義**だけ**を移す。
ost の `events` テーブルは持ってこない（roster の `events` は Stage 02 が別の形で作る）。

**このステージで作るテーブルは `user` と `oidc_session` の 2 つだけ。**
ドメインテーブルは Stage 02 以降の担当。

`pnpm --filter @gdgjp/roster migrate:local` を実行して `schema.sql` を生成する。
**`schema.sql` は生成物なので手で編集しない。**

### 3. 認証（accounts の RP）

`ost/` の 4 ファイルを移す。

- `app/features/auth/auth.server.ts` — `getAuth(env)`。`cookiePrefix: "gdgjp-roster"`、
  `idp.fetch` で `env.ACCOUNTS.fetch` を使う
- `app/features/auth/chapter.server.ts` — `fetchChaptersForUser` / `fetchChapterForUser`
- `app/features/auth/auth-redirect.server.ts` — `requireUserWithChapter` / `getOptionalUser` /
  `buildSignInRedirect`
- `app/lib/return-to.ts` — `safeReturnTo`（ドメインを持たない横断プリミティブなので `app/lib/`）

**注意: 配置が ost と違う。** ost は認証を `app/lib/` に置いているが、roster は feature-first
（ADR-003）なので `app/features/auth/` に置く。`app/lib/` に残すのは `return-to.ts` と
`db.server.ts`（Stage 02 で作る）と `utils.ts` だけ。

`app/features/auth/permissions.ts` も作る。MVP はフラットな権限モデル
（同一 Chapter のメンバーは全員同権）だが、**判定をここ 1 箇所に集約する**。将来 RBAC を
入れる際の変更点を閉じ込めるため。このステージでは
`canManageEvent(chapters, event)` の骨格だけでよい。

ルートは以下だけ。

```ts
index("routes/home.tsx"),                        // 空のイベント一覧（Stage 02 で中身を入れる）
route("signin", "routes/signin.tsx"),
route("no-chapter", "routes/no-chapter.tsx"),
route("api/auth/*", "routes/api.auth.$.ts"),
route("auth/signout", "routes/auth.signout.ts"),
route("dev/login", "routes/dev.login.tsx"),      // ENVIRONMENT === "production" で 404
route("dev/seed", "routes/dev.seed.tsx"),        // 同上
```

`dev/login` と `dev/seed` は `ost/` の実装を踏襲し、**`env.ENVIRONMENT === "production"` のとき
ハード 404** にする。E2E がここに依存する（下記 6）。

### 4. アーキテクチャテストの移植

`roster/tests/architecture/` に 4 本置く。`wiki/tests/architecture/` からコピーし、
**allowlist をすべて空にする**。

| ファイル | roster での設定 |
|---|---|
| `layering.test.ts` | `ROOTS = ["app", "workers"]`（wiki の `shared` は無い）。`app/lib/` の許可リストは `db.server.ts` / `utils.ts` / `return-to.ts` の 3 本。`app/components/` はアプリシェル + `ui/` のみ |
| `file-size.test.ts` | `MAX_LINES = 400`、`ALLOWLIST = {}` |
| `test-colocation.test.ts` | `ALLOWLIST = new Set()` |
| `route-urls.test.ts` | 上記 7 ルートのスナップショットを作る |

`vitest.config.ts` の `include` は ost のままだと `app/**` しか拾わない。
**`tests/**` も含むように広げる。**

```ts
include: ["app/**/*.{test,spec}.{ts,tsx}", "workers/**/*.{test,spec}.{ts,tsx}", "tests/**/*.test.ts"],
```

### 5. `roster/CLAUDE.md` と `roster/ARCHITECTURE.md`

- `CLAUDE.md` — `ost/CLAUDE.md` の粒度。dev コマンド、**ポート 5186 の自己記述**、バインディング表、
  auth の前提、無 ORM の規約、`app/features/` 配置ルール、E2E の前提。
- `ARCHITECTURE.md` — `wiki/ARCHITECTURE.md` の形。**散文を書かない。表と箇条書きだけ。**
  このステージ時点ではコードマップはほぼ空でよいが、
  「配置ルール」と「規約を強制しているテスト」の節は最初から埋める。
  **ファイルを移動したら同じ変更内で更新する契約**であることを明記する。

`README.md` はアプリの利用者向け（何ができるか、画面）。

### 6. E2E の方針

`ost/` の `/dev/login` バイパスを採用する。`accounts` の実クライアントを CI で用意しなくて済み、
`ci.yml` の `.dev.vars` ヒアドキュメントに roster のブロックを 1 つ足すだけで動く。

ただし **`CI_WORKSPACES` では `e2e: true` にする**。公開登録フォーム（Stage 04）と公開閲覧 URL
（Stage 09）がこのアプリの中核で、CI で回す価値があるため。

`playwright.config.ts` は ost の形（単一 `webServer`、TCP ポート待ち、`timeout: 240_000`）にする。
**HTTP 200 を待たない**こと — roster のルートは未サインインだと全部リダイレクトするため。

このステージでの E2E は 1 本でよい: 「`/` に未サインインでアクセスすると `/signin?return_to=%2F`
へリダイレクトされる」。認証ゲートの契約を回帰として固定する。

### 7. モノレポ登録（漏らすと静かに壊れる）

**13 箇所すべてを埋める。** 番号順に確認すること。

| # | ファイル | 追加内容 |
|---|---|---|
| 1 | `pnpm-workspace.yaml` | `- "roster"` |
| 2 | `.github/scripts/changed-workspaces.mjs` | `CI_WORKSPACES` に `{ directory: "roster", workspace: "@gdgjp/roster", build: true, e2e: true }`、`DEPLOY_TARGETS` に `{ app: "roster", workspace: "@gdgjp/roster", provider: "cloudflare", migrate: true }`、`GDG_LIB_DEPENDENTS` に `"roster"`。**`OPENAPI_DIRECTORIES` には追加しない** |
| 3 | `.github/scripts/changed-workspaces.test.mjs` | **ハードコードされた配列長を全部 +1**（`ci` 15→16 / `build` 13→14 / `deploy` 12→13）。`gdg-lib` 伝播テストの期待配列に `"@gdgjp/roster"` / `"roster"` を追加 |
| 4 | `.github/workflows/ci.yml` | `typecheck` / `test` / `build` の各 `parallel:` に 1 ステップずつ。e2e マトリクスは動的なので編集不要だが、**「Create accounts dev vars」ステップに `roster/.dev.vars` のヒアドキュメントを追加する** |
| 5 | `.github/workflows/deploy.yml` | `parallel:` に `build` → `run deploy` → `migrate:remote` の 3 行を持つステップ |
| 6 | `.github/scripts/workflows.test.mjs` | `cloudflareWorkspaces` 配列に `"roster"` |
| 7 | `scripts/run-ci.mjs` | `workspaces` Map に `["roster", "@gdgjp/roster"]` |
| 8 | `accounts/.dev.vars.example` | `ROSTER_CLIENT_SECRET` / `ROSTER_CLIENT_ID=roster` / `ROSTER_REDIRECT_URLS=http://localhost:5186/api/auth/callback/gdgjp` |
| 9 | `accounts/wrangler.toml` `[vars]` | `ROSTER_CLIENT_ID = "roster"` / `ROSTER_REDIRECT_URLS = "https://roster.gdgs.jp/api/auth/callback/gdgjp"` |
| 10 | `accounts/app/lib/seed-clients.server.ts` | `collectSpecs()` の `apps` タプルに `["GDG Japan Roster", env.ROSTER_CLIENT_ID, env.ROSTER_CLIENT_SECRET, env.ROSTER_REDIRECT_URLS]`。**accounts 側の `Env` 型宣言にも 3 変数を追加する**（既存の `OST_CLIENT_ID` を grep して同じ場所に足す） |
| 11 | `.claude/launch.json` | `roster-dev` エントリ（`ost-dev` と同形、`"port": 5186`） |
| 12 | `README.md` / `AGENTS.md` / `CONTRIBUTING.md` | Apps 表に行を追加 / RP のリストに `roster/` を追加 / dev ポート段落に `5186` (roster) を追加 |
| 13 | `roster/CLAUDE.md` | ポート 5186 を自己記述 |

`ci.yml` に足すステップの形:

```yaml
- name: Typecheck roster
  if: contains(fromJSON(needs.changes.outputs.ci), '@gdgjp/roster')
  run: pnpm --filter @gdgjp/roster typecheck
```

`deploy.yml` に足すステップの形:

```yaml
- name: Build, deploy, and migrate roster
  if: contains(fromJSON(needs.changes.outputs.deploy-apps), 'roster')
  run: |
    pnpm --filter @gdgjp/roster build
    pnpm --filter @gdgjp/roster run deploy
    pnpm --filter @gdgjp/roster migrate:remote
```

### ⚠ CI の穴 — テストが守ってくれない経路

**`.github/scripts/workflows.test.mjs` は `deploy.yml` しか読まない。**
`CI_WORKSPACES` の各ワークスペースに `ci.yml` の typecheck / test / build ステップが存在するかを
検証するテストは**リポジトリのどこにも存在しない**。

つまり上表の **#2 だけやって #4 を忘れると**、`changes` ジョブの `ci` 出力配列には
`@gdgjp/roster` が入るが、それを消費する `parallel:` ステップが 1 つも無いため、
**CI は roster を永久に無言でスキップする。しかもテストは全部通る。**

そのため完了条件に「実 PR の GitHub Actions ログで 3 ジョブが roster に対して実際に走ったことを
目視確認する」を入れてある（Verification 4）。ローカルのテストだけで判断しないこと。

なお #3 は逆に**忘れると必ず落ちる**（配列長がハードコードされているため）。落ちたら
「roster を足したぶん +1」であることを確認して直す。

### 制約

- **`roster/schema.sql` は生成物。** 手で編集せず `migrate:local` で更新する。
- **`worker-configuration.d.ts` は生成物。** `wrangler.toml` のバインディングを変えたら
  `cf-typegen` を実行する。手編集しない。
- **`tests/architecture/` の allowlist を空のまま保つ。** allowlist は縮小専用。
  このステージで既に例外が要るなら、それは配置が間違っている。
- **`app/lib/` に置くのは `return-to.ts` だけ。** 認証は `app/features/auth/`。
  ost が `app/lib/` に置いているのは ost が feature-first でないためで、真似しない。
- **ドメインのテーブル・画面を作らない。** `events` も `time_slots` も Stage 02 の担当。
  `routes/home.tsx` は「イベントがありません」を出すだけでよい。
- **他アプリのポート・設定を直さない。** `pay` / `website` の 5180 衝突は
  [ADR-010](adr.md#adr-010-スコープ外として記録するだけの既存の不整合) で
  スコープ外と決めてある。`CONTRIBUTING.md` は roster の行を足すだけに留める。
- **lockfile は `pnpm install` の結果として変わるだけ。** 手で編集しない。
- `accounts/` に触るのは #8 #9 #10 の 3 ファイルだけ。他のロジックを変えない。

---

## Files to touch — 変更ファイル

### `roster/`（すべて新規）

```
roster/package.json
roster/tsconfig.json
roster/vite.config.ts
roster/vitest.config.ts
roster/react-router.config.ts
roster/playwright.config.ts
roster/wrangler.toml
roster/.dev.vars.example
roster/CLAUDE.md
roster/README.md
roster/ARCHITECTURE.md
roster/migrations/0001_init.sql
roster/schema.sql                          （生成物。migrate:local が作る）
roster/workers/app.ts
roster/types/env.d.ts
roster/app/root.tsx
roster/app/routes.ts
roster/app/entry.server.tsx
roster/app/app.css
roster/app/lib/return-to.ts
roster/app/features/auth/auth.server.ts
roster/app/features/auth/auth-redirect.server.ts
roster/app/features/auth/chapter.server.ts
roster/app/features/auth/permissions.ts
roster/app/routes/home.tsx
roster/app/routes/signin.tsx
roster/app/routes/no-chapter.tsx
roster/app/routes/api.auth.$.ts
roster/app/routes/auth.signout.ts
roster/app/routes/dev.login.tsx
roster/app/routes/dev.seed.tsx
roster/tests/architecture/layering.test.ts
roster/tests/architecture/file-size.test.ts
roster/tests/architecture/test-colocation.test.ts
roster/tests/architecture/route-urls.test.ts
roster/tests/architecture/__snapshots__/route-urls.test.ts.snap
roster/e2e/auth-gate.spec.ts
roster/public/                             （favicon 等）
```

### モノレポ登録（既存ファイルの編集）

```
pnpm-workspace.yaml
.github/scripts/changed-workspaces.mjs
.github/scripts/changed-workspaces.test.mjs
.github/scripts/workflows.test.mjs
.github/workflows/ci.yml
.github/workflows/deploy.yml
scripts/run-ci.mjs
.claude/launch.json
README.md
AGENTS.md
CONTRIBUTING.md
```

### `accounts/`（3 ファイルのみ）

```
accounts/.dev.vars.example
accounts/wrangler.toml
accounts/app/lib/seed-clients.server.ts
（+ accounts の Env 型宣言ファイル。`OST_CLIENT_ID` を grep して特定する）
```

---

## Verification — 完了条件と検証

### 完了条件

1. `pnpm --filter @gdgjp/roster dev` が **5186** で起動し、`/` にアクセスすると
   `/signin?return_to=%2F` へリダイレクトされる
2. `accounts` を 5173 で起動した状態で実際にサインインでき、Chapter を持つユーザーは `/` に、
   持たないユーザーは `/no-chapter` に着地する
3. `tests/architecture/` の 4 本が **allowlist 空のまま**緑
4. **GitHub Actions の実 PR で `Typecheck roster` / `Test roster` / `Build roster` /
   `E2E (roster)` の 4 ジョブが実際に実行された**ことをログで確認した

### コマンド

```sh
# 依存の解決と git hooks の導入
pnpm install

# D1 を作り、database_id を wrangler.toml に転記してから
pnpm --filter @gdgjp/roster migrate:local     # schema.sql も再生成される
pnpm --filter @gdgjp/roster cf-typegen        # wrangler.toml を変えたら必ず

# .dev.vars を用意（RP_SESSION_SECRET / IDP_CLIENT_SECRET / APP_URL=http://localhost:5186）
cp roster/.dev.vars.example roster/.dev.vars

pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster test:e2e

# モノレポ側の登録が壊れていないこと
node --test .github/scripts/changed-workspaces.test.mjs
node --test .github/scripts/workflows.test.mjs

# 全体
pnpm ci:quick
```

`accounts` 側は `ROSTER_CLIENT_SECRET` を設定して**デプロイし、`/admin/seed-clients` を実行する**
まで roster は本番でサインインできない。ローカルは `accounts/.dev.vars` に
`ROSTER_CLIENT_SECRET` を書いて `/admin/seed-clients` を叩く。

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`.github/scripts/changed-workspaces.test.mjs` の配列長** — roster を `CI_WORKSPACES` に足すと
  必ず落ちる。落ちなかったら #2 の追加が効いていない
- **`tests/architecture/route-urls.test.ts` のスナップショット** — 7 ルートが固定される。
  以降のステージでルートを足すたびに落ちるのが正しい挙動
- **`e2e/auth-gate.spec.ts`** — `/` → `/signin?return_to=%2F`。認証ゲートを緩めたときに気づく
- **`layering.test.ts` の `app/lib/` ホワイトリスト** — `db.server.ts` / `utils.ts` /
  `return-to.ts` の 3 本に固定。Stage 02 以降で「とりあえず `app/lib/` に置く」を防ぐ

### 手動 E2E

1. `pnpm --filter @gdgjp/accounts dev`（5173）と `pnpm --filter @gdgjp/roster dev`（5186）を並行起動
2. `http://localhost:5186/` を開く → `/signin?return_to=%2F` にリダイレクトされる
3. サインインする → `/` に戻る。Chapter を持つアカウントなら「イベントがありません」が出る
4. Chapter を持たないアカウントでサインインする → `/no-chapter` に着地する
5. `/auth/signout` → サインアウトされ、`/` が再びサインインへ飛ぶ
6. `http://localhost:5186/dev/login?as=owner&chapter=1:x` が動くことを確認する
   （E2E がこれに依存する）
7. `roster/wrangler.toml` の `[vars] ENVIRONMENT` を `production` にして
   `/dev/login` が **404** になることを確認し、元に戻す
