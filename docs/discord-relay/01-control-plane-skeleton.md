# Stage 01 — Control Plane の骨格: `discord-relay/` 新設、OIDC RP、チャプター境界、監査

## Context — 背景とリポジトリ状況

[`index.md`](index.md) の Stage 01。**依存: `00`（Accounts に OAuth クライアントが無いとログインが通らない）。
以降の CP 側ステージ（`02`〜`05`・`09`・`10`）はすべてこの上に乗る。**

担当するのは [BIZ-006 認証・認可](../rdra/discord-relay/contexts/auth.md) のうち
**UC-601〜604 / SCR-601・602**。UC-605（Plane 間認証）は
[`04-plane-contract.md`](04-plane-contract.md) の担当で、ここでは触らない。
**認証系統が 2 つあり、混ぜてはならない** — ダッシュボードの OIDC と `/api/dp/*` の Bearer は
[ADR-005](adr.md#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする) Decision 3 で
完全に別系統と決まっている。

このステージが成立させるのは 1 文である。**「誰が、どのチャプターの何を触ってよいか」が決まる。**
`02` の紐付けも `03` のルールも `(chapter, role)` を主体に持つので、ここが無いと
「誰のギルドか」が定義できない（[`index.md` §依存グラフ](index.md#依存グラフ) の `01 → 02` の辺）。

### 読むべきもの

- [`../rdra/discord-relay/contexts/auth.md`](../rdra/discord-relay/contexts/auth.md) —
  **このステージの仕様書**。IdP の仕様表（issuer / スコープ / クレーム名 / トークン寿命）、
  §実装上の必須事項、BUC-601 / BUC-602 の業務フロー、UC-603 のロバストネス図
- [`../rdra/discord-relay/shared/information-model.md`](../rdra/discord-relay/shared/information-model.md) —
  INFO-001（Chapter）と INFO-012（AuditLog）の属性
- [`00-prerequisites.md`](00-prerequisites.md) §8 — このステージで使う名前（Worker 名・D1 名・
  ホスト名・cookie prefix・dev ポート）はすべて `00` で確定済み
- [`index.md` §新規パッケージの登録先](index.md#新規パッケージの登録先) — **登録漏れは静かに壊れる**
- `gdg-lib/src/auth/rp.ts:23-75` — `RpAuthConfig` と `RpAuthInstance` の全 API。
  `getFreshClaims` / `getAccessToken` / `handleAuthRequest` / `handleSignOutRedirect`
- `gdg-lib/src/auth/rp.ts:648-675` — `parseClaims()`。`chapterId` が number でないエントリを捨てる防御的パース
- `gdg-lib/src/auth/index.ts:17-29` — `UserClaims`。**`chapter`（単数）はレガシー互換フィールド**で、
  新規実装は `chapters` 配列を使う
- `ost/` 一式 — 最も新しい React Router v7 + Workers + D1 + RP 認証のアプリ。骨格の手本
- `sns/app/lib/access.server.ts:8-62` — 複数チャプター所属者の切替（cookie）と認可の組み立て
- `accounts/app/lib/permissions.ts:18-46` — `canManageChapter` / `requireOrganizerOf` の権限プリミティブ
- `accounts/app/routes/api.chapters.directory.ts` — チャプター表示名の供給元（`{id, slug, name, kind, region}`）
- `gdg-lib/src/ui/app-links.ts:8-54` — `GDG_APP_LINKS`。**共有ランチャと gdgs.jp のトップが
  同じ配列を読む。** 消費側は `gdg-lib/src/ui/menus.tsx:14-24` と `website/app/routes/home.tsx:1,37`

### 再利用する既存実装

- **`ost/` を骨格の出発点にする。** `package.json` / `tsconfig.json` / `react-router.config.ts` /
  `vite.config.ts` / `vitest.config.ts` / `playwright.config.ts` / `workers/app.ts` /
  `app/root.tsx` / `types/env.d.ts` の構成が最も新しく、かつ
  `ost/migrations/0001_init.sql:5-36` に **`gdg-lib` の RP 認証が要求する `user` / `oidc_session`
  テーブルの正確な DDL** がある。ここを写す
- **`ost/app/lib/auth.server.ts` の `getAuth()`** — `initializeRpAuth` のラップと
  `ACCOUNTS` サービスバインディング経由の `fetch`。`cookiePrefix` だけ差し替える
- **`ost/app/routes/api.auth.$.ts` / `signin.tsx` / `auth.signout.ts`** — UC-601 / UC-604 の
  ルート 3 本。ほぼそのまま
- **`sns/app/lib/access.server.ts:15-25` の `readSelectedChapter` / `chapterCookie`** と
  **`sns/app/routes/api.chapter.ts`** — UC-602 の切替。cookie 名だけ差し替える
- **`ost/app/routes/dev.login.tsx`** — 本番で 404 になる dev 専用ログイン。
  実 Google 往復なしで e2e がチャプター境界のルートを叩ける
- **`ost/e2e/global-setup.ts`** — spec の前に `wrangler d1 migrations apply --local` を回す

### 踏襲してはならない既存実装

**`ost/app/lib/chapter.server.ts:12-14` の 30 秒クレームキャッシュ**（`CACHE_TTL_MS = 30_000`）を
写さない。COND-604 が「認可判定でクレームをキャッシュしない」を要求しており、
[auth.md §実装上の必須事項](../rdra/discord-relay/contexts/auth.md) が
「アクセスを決定する画面にこのキャッシュをコピーするな」という既存の警告を引いている。
**所属喪失が即座に反映されなければならない**（REQ-601）。
`ost/` はファイルの形の手本であって、この部分の手本ではない。

### スコープ制限

- **ギルドもルールも作らない。** INFO-002〜INFO-006 のテーブルは `02` / `03`
- **`/api/dp/*` を作らない。** [`04`](04-plane-contract.md) の担当
- **Queues・R2・DLQ を設定しない。** [`05`](05-delivery-pipeline.md) の担当
- **Durable Object を宣言しない。** [`10`](10-relay-hub-do.md) が入れるかどうかを決める
- 画面は SCR-601 / SCR-602 と、それらが載る空のダッシュボード枠まで

## Design — 設計

### 1. ワークスペースの新設と、7 箇所の登録

`discord-relay/` を作る。名前は [`00`](00-prerequisites.md) §8 で確定済み。

**登録先は `index.md` が数えた 6 箇所に、`00` で見つかった 7 箇所目を足したものになる。**
どれも漏らしても CI は赤くならない。

| # | 対象 | 場所 | 入れる値 |
|---|---|---|---|
| 1 | ワークスペース | `pnpm-workspace.yaml` | `"discord-relay"` |
| 2 | CI の検査対象 | `.github/scripts/changed-workspaces.mjs` の `CI_WORKSPACES` | `{ directory: "discord-relay", workspace: "@gdgjp/discord-relay", build: true, e2e: true }` |
| 3 | デプロイ対象 | 同 `DEPLOY_TARGETS` | `{ app: "discord-relay", workspace: "@gdgjp/discord-relay", provider: "cloudflare", migrate: true }` |
| 4 | デプロイ手順 | `.github/workflows/deploy.yml` の `deploy` ジョブ | build / deploy / `migrate:remote` の 3 行 |
| 5 | pre-commit の絞り込み | `scripts/run-ci.mjs:63-77` の `workspaces` Map | `["discord-relay", "@gdgjp/discord-relay"]` |
| 6 | パッケージ一覧 | `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` | 説明 1 段落 + dev ポート |
| 7 | 信頼済みクライアント | `accounts/app/lib/auth.server.ts:137-147` | **`00` で済ませている**（未了ならここで） |

`CI_WORKSPACES` に載せるとき `gdg-lib` への依存も宣言する必要がある —
同ファイルの `GDG_LIB_DEPENDENTS` セットに `"discord-relay"` を足す。
これを忘れると **`gdg-lib` の変更で discord-relay の CI が走らない。**

> `scripts/run-ci.mjs` の `workspaces` Map には既に `pay` と `agents` が入っていない
> （[`index.md` の注記](index.md#新規パッケージの登録先)）。6 箇所が独立に存在する以上ドリフトする。
> **`discord-relay` を足すときに `pay` も併せて埋める。**

### 2. Worker 構成

`wrangler.toml` は `ost/wrangler.toml` を出発点にする。このステージで置くバインディングは
D1 とサービスバインディングだけ。

```toml
name = "gdgjp-discord-relay"
main = "./workers/app.ts"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"
APP_URL = "https://relay.gdgs.jp"
ACCOUNTS_URL = "https://accounts.gdgs.jp"
IDP_URL = "https://accounts.gdgs.jp"
IDP_CLIENT_ID = "discord-relay"

[[d1_databases]]
binding = "DB"
database_name = "gdgjp-discord-relay-db"
migrations_dir = "./migrations"

# Worker-to-Worker OIDC (discovery, token, UserInfo) stays on Cloudflare's
# internal network instead of looping through public HTTPS.
[[services]]
binding = "ACCOUNTS"
service = "gdgjp-accounts"

[[routes]]
pattern = "relay.gdgs.jp/*"
zone_name = "gdgs.jp"
```

秘密は `.dev.vars.example` にキー名だけ置き、本番は `wrangler secret put`。

| 名前 | 用途 | このステージで使うか |
|---|---|---|
| `RP_SESSION_SECRET` | セッション / OIDC トランザクション cookie の HMAC 鍵 | ○ |
| `IDP_CLIENT_SECRET` | Accounts が発行したこの RP のクライアントシークレット | ○ |
| `DISCORD_RELAY_BOT_TOKEN` | Discord HTTP API（チャンネル一覧） | `03` |
| `DISCORD_RELAY_CLIENT_SECRET` | Bot 招待の code 交換 | `02` |
| `DP_SHARED_SECRET_CURRENT` / `_PREVIOUS` | Plane 間認証 | `04` |

**キー名だけは `.dev.vars.example` に今のうちに全部並べておく。** 後段のステージで
「どのステージがどれを使うか」のコメントを添える。`.dev.vars` はコミットしない。

`vite.config.ts` は `server: { port: 5181, strictPort: true }`。
`ost/vite.config.ts:16-30` の `resolve.dedupe` と `optimizeDeps.include` も写す —
`@gdgjp/gdg-lib` をソースのまま食うため、これが無いと React が 2 つ入って
hydration で invalid hook call になる。

### 3. D1 スキーマ（マイグレーション `0001_init.sql`）

このステージで作るテーブルは 4 つ。

| テーブル | 由来 | 備考 |
|---|---|---|
| `user` | `gdg-lib` の RP 認証が要求 | `ost/migrations/0001_init.sql:5-19` をそのまま |
| `oidc_session` | 同上 | `ost/migrations/0001_init.sql:21-36` をそのまま |
| `chapters` | INFO-001 | **表示用キャッシュのみ。** SSoT は GDG Accounts |
| `audit_log` | INFO-012 | `actorUserId` / `actorRole` / `chapterId` / `action` / `targetType` / `targetId` / `occurredAt` |

`chapters` に**メンバーシップを持たない。** 所属とロールはクレームから毎回読む（COND-604）。
このテーブルが持つのは `chapter_id` / `slug` / `name` / `kind` と取得時刻だけで、
`accounts` の `api.chapters.directory` から埋める。

`audit_log` の `actor_role` は VAR-601 の値（`organizer` / `member` / `is_admin`）を入れる。
**`is_admin` の行使を後から判別できることが COND-603 の要件そのもの**なので、
「organizer でもあり admin でもある」場合にどちらを記録するかを決めて固定する
（**実際に権限判定を通した根拠のほう**を記録する）。

`schema.sql` は生成物である。マイグレーションを書き、`pnpm --filter @gdgjp/discord-relay migrate:local`
が `schema:dump` を呼んで生成する。**手で編集しない。**

### 4. UC-601 / UC-604: OIDC サインインとサインアウト

`app/lib/auth.server.ts` に `getAuth(env)` を置く。`ost/app/lib/auth.server.ts` と同じ形で、
`cookiePrefix` を **`gdgjp-discord-relay`** にする（`*.gdgs.jp` の他アプリと cookie を分離する）。

ルートは 3 本。

| ルート | 対応 | 中身 |
|---|---|---|
| `routes/api.auth.$.ts` | UC-601 / EVT-601 | `handleAuthRequest` に丸投げ。loader と action の両方 |
| `routes/signin.tsx` | SCR-601 | `return_to` を検証して `/api/auth/signin` へリダイレクト |
| `routes/auth.signout.ts` | UC-604 | `handleSignOutRedirect`。**RP-initiated logout で IdP セッションも終える** |

スコープは `gdg-lib` が `openid email profile offline_access https://gdgs.jp/scopes/chapters` を
固定で送る（`gdg-lib/src/auth/rp.ts:187`）。アプリ側で組み立てない。
**issuer の個別 URL をハードコードしない** — discovery で引く。

### 5. UC-602 / SCR-602: チャプター切替

`chapters` 配列から選び、選択を cookie に保持する。`sns` の方式を写す。

- cookie 名 `discord-relay-chapter`、値は `chapterId`（`sns/app/lib/access.server.ts:23-25` と同形）
- 選択が無い / 無効なら `chapters[0]`
- 所属が 0 件なら `/no-chapter`（`ost/app/routes/no-chapter.tsx` と同じ扱い）
- 切替 API は `routes/api.chapter.ts`（`sns/app/routes/api.chapter.ts` と同形）。
  **`Set-Cookie` を返して `return_to` に戻すだけ**で、切替そのものは副作用を持たない

**`chapters` 配列を使う。`chapter`（単数）を使わない。**
単数はプライマリ（organizer 優先 → 最古承認順）のレガシー互換フィールドで、
`gdg-lib/src/auth/index.ts:24-28` が新規実装は配列を使うよう明記している。
**1 ユーザー = 1 チャプターで設計してはならない**（REQ-603）。

SCR-602 はヘッダのセレクタとして出す。表示名は `chapters` テーブル（`accounts` のディレクトリ API 由来）
から引き、無ければ `chapterSlug` にフォールバックする。**メンバーシップは非公開**なので
ディレクトリ API 以外からチャプター名を取らない。

### 6. UC-603: 認可判定

`app/lib/access.server.ts` に 1 本の入口を置く。UC-603 のロバストネス図の 5 段
（セッション解決 → `getFreshClaims` → チャプター境界 → ロール → admin バイパス）をそのまま関数にする。

```ts
// 形だけ。実装はこのステージで書く。
requireChapterAccess(env, request): Promise<{
  user: AuthUser;
  chapter: UserChapter;        // 現在選択中
  chapters: UserChapter[];     // 所属全部
  isAdmin: boolean;
  crossChapter: boolean;       // admin が自分の所属外を見ているか
}>
requireOrganizer(access, chapterId): void   // COND-602。満たさなければ 403
```

守る条件は 4 つ。

| 条件 | 実装 |
|---|---|
| COND-601 | `chapters` に対象チャプターが含まれること。`status=active` の所属だけがクレームに現れるので、アプリ側で pending を除く処理は要らない |
| COND-602 | 編集系（ルール編集・ギルド紐付け・シークレット操作・手動再送）は `role === "organizer"` |
| COND-603 | `is_admin` で**自分の所属外**に触れたときは必ず `audit_log` に残す。**記録なしの行使を許さない** |
| COND-604 | `getFreshClaims()` を呼ぶ。結果をモジュールスコープにもリクエスト間にもキャッシュしない |

`getFreshClaims()` は `ClaimsUnavailableError` を投げうる（セッション不在 / refresh 失敗 /
userinfo 失敗）。**catch して `/signin` へリダイレクトする** — 500 にしない。
`sns/app/lib/access.server.ts:44-49` が同じ扱いをしている。

`accounts/app/lib/permissions.ts` の `canManageChapter` / `requireOrganizerOf` は
`accounts` のローカル `Membership` 型を取るのでそのままは使えないが、
**判定の形（super admin → メンバーシップ一致 → role → status）を写す。**

**アプリ独自のロールを持たない。** ロールは organizer / member の 2 値だけで、
これは GDG Accounts から供給される（VAR-601、D-4）。

### 7. INFO-012: 監査ログの書き込み

`app/lib/audit.server.ts` に 1 本の関数を置き、以降のステージが全部そこを通す。

```ts
recordAudit(db, {
  actorUserId, actorRole, chapterId, action, targetType, targetId
}): Promise<void>
```

`action` は `rule.create` / `guild.claim` / `secret.rotate` / `delivery.resend` のような
ドット区切りの動詞（INFO-012 の記述に例がある）。**このステージで書き込むのは
`chapter.cross_access`（COND-603）だけ**で、残りは `02` 以降が足す。

SCR-505（監査ログ画面）は [`09`](09-observability.md) の担当。ここでは**書き込みだけ**を作る。
読む画面が無いうちから記録を始めるのが正しい — 後から遡って作れない。

### 8. 画面の骨格

- `routes/home.tsx` — ダッシュボード。このステージでは「サインイン済み / 現在のチャプター /
  所属一覧」を出すだけの枠。`02` がサーバー一覧、`03` がルール一覧を足す
- `routes/signin.tsx`（SCR-601）
- `routes/no-chapter.tsx` — 所属 0 件
- `components/header.tsx` — SCR-602 のチャプターセレクタを載せる。`ost/app/components/header.tsx` を参考に

### 9. 共有アプリランチャと gdgs.jp トップページへの登載

**載せる。** 本サービス全体が organizer 向けの内部ツールであり、
`GDG_APP_LINKS` は既にそういう性格のアプリ（Connpass / Pay / SNS Manager）を並べている。

**編集するのは `gdg-lib/src/ui/app-links.ts` の 1 ファイルだけで、両方の面に出る。**

| 面 | 消費側 | 経路 |
|---|---|---|
| 共有アプリランチャ | `gdg-lib/src/ui/menus.tsx:14-24` `GdgAppLauncher` | 既定引数が `GDG_APP_LINKS` |
| gdgs.jp トップ | `website/app/routes/home.tsx:1,37` | 配列をそのまま `<ul>` に描画 |

足すエントリ:

```ts
{
  iconUrl: "https://relay.gdgs.jp/app-icon.png",
  label: "Discord Relay",
  url: "https://relay.gdgs.jp",
},
```

**アイコンは暫定的に既存のものを複製する。** これはリポジトリの既存慣行である —
`pay/public/app-icon.png` と `scheduler/public/app-icon.png`、
`connpass/public/app-icon.png` と `img/public/app-icon.png` が現に byte 同一である
（`sha256sum */public/app-icon.png` で確認できる）。
`discord-relay/public/app-icon.png` として 1254×1254 の PNG を置く。

Discord 公式のロゴを持ってくる選択もある。その場合は**恒久のアイコンとして採る前に
Discord のブランドガイドラインを確認する** — 第三者アプリのアイコンにそのまま使うと
提携関係を示唆しうる。暫定は複製、恒久は別途、という切り分けにしておくのが安全。

**アイコンは未認証で到達できなければならない。** gdgs.jp のトップは**サインアウト状態の
訪問者にも**この `<img>` を出す。`[assets]` は既定で Worker より先に配信されるので
`public/` に置けば通るが、`run_worker_first` に `/app-icon.png` を含む glob を書くと
認証ゲートに落ちて画像が壊れる。

**順序に注意する。** `app-links.ts` を触ると `website` は自動的にデプロイ対象になる —
`.github/scripts/changed-workspaces.mjs` の `GDG_LIB_DEPENDENTS` に `website` が入っており、
`gdg-lib/` の変更が `affectedDirectories` 経由で `DEPLOY_TARGETS` にも波及するためである。
**`relay.gdgs.jp` が実際に応答するようになってからエントリを足す。**
同一 PR で両方を出すと、`deploy` ジョブの並列ステップの順序次第で
gdgs.jp が一時的に死んだリンクと壊れた画像を出す。

### 制約

- **`getFreshClaims()` の結果をキャッシュしない。** `ost/app/lib/chapter.server.ts` の
  30 秒キャッシュを写さない（COND-604 / REQ-601）
- **`chapter`（単数）を使わない。** `chapters` 配列だけを見る（REQ-603）
- **`wiki.discord_guild_settings` を共有しない。** 目的が違い、`chapter_id` の UNIQUE で
  1 チャプター 1 ギルドに固定されている（[server-registration.md](../rdra/discord-relay/contexts/server-registration.md)）。
  ただしこのステージではまだギルドのテーブル自体を作らない
- **`is_admin` の横断アクセスを監査なしで通す経路を作らない**（COND-603）
- **`/api/dp/*` に OIDC を掛けない。** そもそもこのステージで `/api/dp/*` を作らない
  （[ADR-005](adr.md#adr-005-plane-間認証を-2-鍵ローテーション可能な-bearer-共有シークレットにする) Decision 3）
- **`schema.sql` を手で編集しない。** マイグレーションを書いて生成させる
- **issuer の個別エンドポイント URL をハードコードしない。** discovery を使う
- **`accounts` 側の OAuth クライアント登録をこのステージでやり直さない。** `00` で済んでいる。
  クライアントシークレット・ID・redirect URI を変えたら `/admin/seed-clients` を再実行する
- **`app-links.ts` のエントリを `relay.gdgs.jp` の稼働前に出さない**（§9）。
  gdgs.jp のトップに死んだリンクと壊れた画像が出る
- **`/app-icon.png` を認証ゲートの後ろに置かない**（§9）

## Files to touch — 変更ファイル

### 新規

- `discord-relay/package.json`（`@gdgjp/discord-relay`。scripts は `ost/package.json` と同じ 11 本）
- `discord-relay/wrangler.toml`
- `discord-relay/.dev.vars.example`
- `discord-relay/tsconfig.json` / `react-router.config.ts` / `vite.config.ts` / `vitest.config.ts`
- `discord-relay/playwright.config.ts`（`PORT = 5181`）
- `discord-relay/types/env.d.ts`
- `discord-relay/workers/app.ts`
- `discord-relay/app/root.tsx` / `app/app.css` / `app/entry.server.tsx`
- `discord-relay/app/routes.ts`
- `discord-relay/app/routes/api.auth.$.ts` / `signin.tsx` / `auth.signout.ts` / `no-chapter.tsx` /
  `home.tsx` / `api.chapter.ts` / `dev.login.tsx`
- `discord-relay/app/lib/auth.server.ts` / `access.server.ts` / `audit.server.ts` / `db.ts` /
  `return-to.ts` / `chapters.server.ts`（ディレクトリ API のキャッシュ）
- `discord-relay/app/lib/access.server.test.ts` / `audit.server.test.ts`
- `discord-relay/app/components/header.tsx`
- `discord-relay/migrations/0001_init.sql`
- `discord-relay/e2e/global-setup.ts` / `e2e/auth.spec.ts`
- `discord-relay/public/favicon.svg`
- `discord-relay/public/app-icon.png`（1254×1254。**既存アプリのものを複製する。**
  `pay` ⇔ `scheduler`、`connpass` ⇔ `img` が現に同一ファイル）
- `discord-relay/README.md` / `discord-relay/CLAUDE.md`

### 更新

- `pnpm-workspace.yaml`
- `.github/scripts/changed-workspaces.mjs`（`CI_WORKSPACES` / `DEPLOY_TARGETS` / `GDG_LIB_DEPENDENTS`）
- `.github/workflows/deploy.yml`（`deploy` ジョブに build / deploy / `migrate:remote`）
- `.github/workflows/ci.yml`（`typecheck` / `build` / `test` / `e2e` の `parallel` に 1 ステップずつ）
- `.github/scripts/workflows.test.mjs`（`cloudflareWorkspaces` に `discord-relay`。
  **`connpass` と `pay` の欠落も併せて埋める** — この配列は `deploy.yml` の実態から既に遅れており、
  登録漏れを捕まえる役を果たしていない）
- `scripts/run-ci.mjs`（`workspaces` Map。**`pay` の欠落も併せて埋める**）
- `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`（パッケージ一覧と dev ポート。
  **この 2 ファイルは byte 単位で同一である。** 片方だけ直さない）
- `gdg-lib/src/ui/app-links.ts`（`GDG_APP_LINKS` に 1 エントリ。§9。
  **これ 1 箇所でランチャと gdgs.jp トップの両方に出る。** `relay.gdgs.jp` の稼働後に出すこと）

## Verification — 完了条件と検証

### 完了条件

- [ ] `pnpm --filter @gdgjp/discord-relay dev` が 5181 で起動し、`/` が `/signin` へ飛ぶ
- [ ] Accounts でサインインでき、`user` と `oidc_session` に行が入る
- [ ] 複数チャプター所属のユーザーで SCR-602 のセレクタが全所属を出し、切り替えると
      cookie が変わり、以降の画面が新しいチャプターで絞られる
- [ ] 所属 0 件のユーザーが `/no-chapter` に落ちる
- [ ] サインアウトでローカルセッションが消え、**IdP 側のセッションも終わっている**
      （もう一度サインインすると Accounts の認証画面が出る）
- [ ] `member` ロールで編集系エンドポイントを叩くと 403 になる
- [ ] `is_admin` が自分の所属外のチャプターを開くと `audit_log` に `chapter.cross_access` が入る
- [ ] `getFreshClaims()` の結果がキャッシュされていない（後述の回帰テスト）
- [ ] 7 箇所の登録が済んでいる。`discord-relay/` を 1 文字変更した diff で
      `changed-workspaces.mjs` が `@gdgjp/discord-relay` を返す
- [ ] `gdg-lib/` を 1 文字変更した diff でも `@gdgjp/discord-relay` が返る
- [ ] `discord-relay/public/app-icon.png` があり、**サインアウト状態で**
      `https://relay.gdgs.jp/app-icon.png` が 200 を返す
- [ ] `GDG_APP_LINKS` に `Discord Relay` があり、**共有ランチャと gdgs.jp のトップの両方**に
      アイコンとラベルが出る。`relay.gdgs.jp` の稼働後に出したこと
- [ ] `pnpm ci:quick` が通る

### コマンド

```bash
pnpm --filter @gdgjp/discord-relay migrate:local
```

```bash
pnpm --filter @gdgjp/discord-relay typecheck
```

```bash
pnpm --filter @gdgjp/discord-relay test
```

```bash
pnpm --filter @gdgjp/discord-relay test:e2e
```

```bash
node .github/scripts/changed-workspaces.mjs --base origin/main --head HEAD
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`requireChapterAccess` が呼び出しごとに `getFreshClaims()` を呼ぶ**
  （スパイを 2 回叩いて呼び出し回数が 2 になること。COND-604 / REQ-601 の担保。
  `ost` の 30 秒キャッシュを写すとここで落ちる）
- **クレームから所属が消えたら、次のリクエストで即座に 403 / `/no-chapter` になる**
  （所属喪失の即時反映。上と対になる）
- **`chapters` が 2 件以上のとき、cookie の選択が反映される。無効な cookie 値では
  `chapters[0]` にフォールバックする**（REQ-603）
- **`chapterId` が number でないクレームエントリを捨てる**
  （`gdg-lib/src/auth/rp.ts:651-663` の防御的パースに依存していることの明示。
  壊れたクレームで認可が通らないこと）
- **`role === "member"` で編集系が 403**（COND-602）
- **`is_admin` の横断アクセスが `audit_log` に 1 行残る。残せなかったら操作自体を失敗させる**
  （COND-603 は「記録なしの行使を許さない」であって「ベストエフォートで記録する」ではない）
- **`ClaimsUnavailableError` が 500 ではなく `/signin` へのリダイレクトになる**
- **`changed-workspaces.mjs` が `discord-relay/**` と `gdg-lib/**` の両方で
  `@gdgjp/discord-relay` を返す**（`.github/scripts/changed-workspaces.test.mjs` に追記。
  `GDG_LIB_DEPENDENTS` の登録漏れは CI を赤くしないので、テストでしか捕まらない）
- **`workflows.test.mjs` の `cloudflareWorkspaces` を `DEPLOY_TARGETS` から導出する**
  （ハードコードした配列を 2 つ並べれば必ずドリフトする。現に `connpass` と `pay` が落ちていて、
  「デプロイ手順の登録漏れを捕まえる」というこのテストの目的が既に果たされていない。
  `changed-workspaces.mjs` から `DEPLOY_TARGETS` を import し、
  `provider === "cloudflare"` を絞って回す形に変える）
- **`GDG_APP_LINKS` の各 `iconUrl` が、その `url` と同一オリジンの `/app-icon.png` である**
  （`gdg-lib/src/ui/` に新規テスト。gdgs.jp のトップは他アプリの本番オリジンから画像を引くので、
  オリジンを取り違えると**別アプリのアイコン**が出て気づけない。
  CLI と Learn は外部ホストなので例外として許す）
- **`GDG_APP_LINKS` に `url` の重複が無い**（`menus.tsx` も `home.tsx` も `key={app.url}` で
  描画しており、重複すると React が片方を落とす）

### 手動 E2E

1. `accounts` と `discord-relay` の dev サーバーを同時に起動する
   （`pnpm --filter @gdgjp/accounts dev` と `pnpm --filter @gdgjp/discord-relay dev`）
2. `http://localhost:5181/` を開き、`/signin` 経由で Accounts にリダイレクトされることを確認する
3. サインインし、ダッシュボードに現在のチャプターが出ることを確認する
4. `accounts` の管理画面で自分の所属を 2 チャプターにし、**再ログインせずに** discord-relay を
   リロードしてセレクタが 2 件になることを確認する（COND-604 の実地確認。
   キャッシュがあるとここで最大 30 秒古い表示が出る）
5. セレクタでチャプターを切り替え、cookie `discord-relay-chapter` が変わることを確認する
6. `accounts` 側で自分の所属を全部外し、discord-relay をリロードして `/no-chapter` に落ちることを確認する
7. `is_admin` のユーザーで自分の所属外のチャプターを開き、
   `wrangler d1 execute gdgjp-discord-relay-db --local --command "SELECT * FROM audit_log"` に
   `chapter.cross_access` が 1 行入っていることを確認する
8. サインアウトし、もう一度 `/signin` を開いて **Accounts の認証画面が再度出る**ことを確認する
   （ローカルセッションだけ消えて IdP セッションが残っていたら UC-604 が未達）
9. **ここまで通ってから** `app-links.ts` にエントリを足す。`discord-relay` を本番へデプロイし、
   シークレットウィンドウ（＝未認証）で `https://relay.gdgs.jp/app-icon.png` が 200 で
   画像を返すことを確認してから push する
10. `website` のデプロイ後、シークレットウィンドウで `https://gdgs.jp/` を開き、
    Discord Relay のカードがアイコンつきで出て、リンク先が開くことを確認する
11. 他アプリ（例: `wiki`）にサインインしてヘッダのランチャ（`GdgAppLauncher`）を開き、
    Discord Relay が並んでいることを確認する
