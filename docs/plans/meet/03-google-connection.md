# Stage 03 — google-connection Google 接続・暗号化保管・Google API クライアント

## Context — 背景とリポジトリ状況

**着手前に [`docs/plans/meet/00-overview.md`](00-overview.md) と [`docs/plans/meet/00a-poc-findings.md`](00a-poc-findings.md) を読むこと。**

### なぜやるか

GDG Japan Meet は共有アカウント `community-support@gdgoc.jp` の権限で Meet スペース作成・Calendar 予定登録・Drive ファイル共有・Workspace Events 購読を行う。本ステージでは管理者専用の Google OAuth 接続画面（`/admin/google`）、リフレッシュトークンの AES-GCM 暗号化保存、アクセストークンのリフレッシュおよび `invalid_grant` 検知、さらに Stage 04〜06 で使う Google API クライアント群とメールアドレス正規化関数を実装する。

### 実装前の疎通確認（必須）

**本ステージの実装を始める前に、以下の GCP 前提が満たされていることを必ず確認し、通らなければ作業を止めて利用者に報告すること。**

1. GCP プロジェクト `gdgs-meet` で **Web アプリケーション型の OAuth 2.0 クライアント** が作成済みであり、`GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` が取得できていること。
2. 同クライアントの承認済みリダイレクト URI に `https://meet.gdgs.jp/admin/google/callback` と `http://localhost:5193/admin/google/callback` が登録されていること。
3. OAuth 同意画面が **「内部（Internal）」** に設定されていること（外部・テスト中ではリフレッシュトークンが 7 日で失効するため不可）。
4. `gdgs-meet` で Google Meet REST API、Google Calendar API、Google Drive API、Google Workspace Events API、Cloud Pub/Sub API の 5 つがすべて有効化されていること。

### 依存と対象範囲

- 依存: Stage 01（`apps/meet/` 骨格）。**Stage 02 と並行実装できる。**
- 対象: `apps/meet/` のみ。
- 本ステージのスコープ外（**実装しない**）:
  - 会議の作成・編集・取り消し UI やテーブル（Stage 04 / 05）
  - Pub/Sub Push 受信エンドポイント・`google_subscription` テーブル・cron・生成ファイル共有（Stage 06）

### 読むべきもの

- `apps/accounts/app/features/google-workspace/encryption.server.ts` — AES-GCM 256-bit 暗号化・復号・鍵バージョンローテーション方式
- `apps/accounts/app/features/google-workspace/google-workspace.server.ts` — 単回利用 PKCE/state（`DELETE ... RETURNING`）、`access_type=offline`、`prompt=consent`、トークン交換・リフレッシュ・レスポンス検証の流儀
- `apps/accounts/app/routes/oauth.google-workspace.{start,callback}.ts` — OAuth コールバック検証とリダイレクト設計
- `apps/accounts/app/lib/crypto.server.ts` — `bytesToBase64Url`, `randomToken`, `sha256Base64Url`

### 再利用する既存実装（書き直さない）

- **`apps/accounts/app/features/google-workspace/encryption.server.ts` の暗号化方式** — `apps/accounts` のコードを直接 import せず、`apps/meet/app/features/google/encryption.server.ts` に同方式をコピーして `env.GOOGLE_TOKEN_ENCRYPTION_KEY` とキーバージョン列で運用する
- **`apps/meet/app/features/auth/access.server.ts`** — `requireUser` の戻り値 `AuthUser` の `isAdmin`（`@gdgjp/gdg-lib` の `IS_ADMIN_CLAIM` 由来）による管理者チェック。`isSuperAdmin` のような既存ヘルパーはないので、本ステージで `requireAdmin` を足す

## Design — 設計

### 1. 環境変数・Secrets（`wrangler.toml` / `.dev.vars.example` / `types/env.d.ts`）

| 変数名 | 種別 | 値 / 説明 |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `[vars]` | GCP Web 型 OAuth クライアント ID |
| `GOOGLE_HOST_EMAIL` | `[vars]` | `"community-support@gdgoc.jp"` |
| `GOOGLE_CLIENT_SECRET` | Secret | GCP Web 型 OAuth クライアントシークレット |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Secret | AES-GCM 256-bit 鍵（32 byte base64、`openssl rand -base64 32`） |

`wrangler.toml` を更新したら `pnpm --filter @gdgjp/meet cf-typegen` を実行する。

### 2. D1 スキーマ（`migrations/0002_google_connection.sql`）

`google_connection` はアプリ全体で 1 行のみ保持するため `id INTEGER PRIMARY KEY CHECK (id = 1)` とする。また OAuth の CSRF state と PKCE `code_verifier` を単回利用で消費するため `google_oauth_state` を設ける。

```sql
CREATE TABLE google_oauth_state (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX google_oauth_state_expires_idx ON google_oauth_state (expires_at);

CREATE TABLE google_connection (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  email                    TEXT NOT NULL,
  google_user_id           TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_nonce      TEXT NOT NULL,
  encryption_key_version   INTEGER NOT NULL,
  scope                    TEXT NOT NULL,
  connected_by_user_id     TEXT NOT NULL,
  connected_at             TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  last_error               TEXT
);
```

### 3. メールアドレス正規化（`app/features/google/email.ts`）

Stage 04（招待者解決・閲覧/co-host 判定）と Stage 06（Drive `permissions.list` 照合）で共通利用する純粋関数 `normalizeEmail(raw: string): string` を定義する。

1. `raw.trim().toLowerCase()`。
2. `@` でローカル部とドメイン部に分割する。
3. ドメイン部が `gmail.com` または `googlemail.com` の場合のみ、ローカル部からすべての `.` を除去する（**`+tag` 以降は除去しない**）。ドメイン部は `gmail.com` / `googlemail.com` それぞれそのまま（PoC 仕様に合わせ、ローカル部のドット除去のみ行う）。
4. `isValidEmail(raw: string): boolean`（制御文字・空白なし、単一 `@`、ローカル部・ドメイン部空でない簡易構文チェック）も併設する。

### 4. Google OAuth 接続フロー（`/admin/google`, `/admin/google/callback`）

#### 認可ガード
- `/admin/google` および `/admin/google/callback` はすべて `requireAdmin(env, request)`（`requireUser` 後に `user.isAdmin === true` を確認。非管理者は `403`）で保護する。

#### 開始（`POST /admin/google`）
- 期限切れの `google_oauth_state` を掃除し、`state`（ランダム 32byte base64url）と PKCE `code_verifier`（48byte）を D1 に TTL 600 秒で保存する。
- 以下のパラメータで `https://accounts.google.com/o/oauth2/v2/auth` へリダイレクトする:
  - `client_id`: `env.GOOGLE_CLIENT_ID`
  - `redirect_uri`: `${env.APP_URL}/admin/google/callback`
  - `response_type`: `"code"`
  - `scope`: `"https://www.googleapis.com/auth/meetings.space.created https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive openid email"`
  - `access_type`: `"offline"`
  - `prompt`: `"consent"`
  - `hd`: `"gdgoc.jp"`
  - `login_hint`: `env.GOOGLE_HOST_EMAIL`
  - `state`, `code_challenge`（S256）, `code_challenge_method`: `"S256"`

#### コールバック（`GET /admin/google/callback`）
1. `DELETE FROM google_oauth_state WHERE id = ? RETURNING ...` で単回消費し、存在しない・期限切れ・`row.user_id !== user.id` ならエラー付きで `/admin/google` へ戻す。
2. Google 認可コードを `https://oauth2.googleapis.com/token` で交換する（PKCE `code_verifier` 付き）。
3. 必須スコープ 3 つ（`meetings.space.created`, `calendar.events`, `drive`）が返却 `scope` にすべて含まれることを確認する（1 つでも欠けていれば拒否）。
4. `refresh_token` が存在することを確認する（`prompt=consent` のため通常必ず返る）。
5. レスポンスの `id_token` のペイロード、または取得した `access_token` による `https://openidconnect.googleapis.com/v1/userinfo` 応答を確認し（トークンエンドポイントへの TLS 直接通信で受け取った `id_token` のクレーム検証＋必要に応じ `userinfo` で二重確認）、次を必須とする:
   - `email_verified === true`
   - `normalizeEmail(email) === normalizeEmail(env.GOOGLE_HOST_EMAIL)`（一致しなければ即拒否し保存しない）
   - `sub` が空でない文字列 → これを `google_user_id` とする
6. `encryptRefreshToken(env, "google-connection:1", refreshToken)` で暗号化し、`google_connection (id = 1)` を `status = 'connected'`, `last_error = NULL` で upsert する。

### 5. アクセストークン管理（`app/features/google/token.server.ts`）

- `getGoogleAccessToken(env, fetchFn = fetch): Promise<string>`:
  1. Isolate 内メモリキャッシュ（`{ accessToken, expiresAtMs }`）が有効期限の 60 秒以上前であればそれを返す（テスト用にキャッシュリセット関数を用意するか、env/接続更新時刻で無効化できるようにする）。
  2. 同一 Isolate 内の並行リフレッシュは 1 本の Promise に合流（single-flight）させる。
  3. `google_connection (id = 1)` を読み、存在しないまたは `status !== 'connected'` なら `GoogleConnectionError("not_connected")` を投げる。
  4. `decryptRefreshToken` で復号し、`https://oauth2.googleapis.com/token`（`grant_type=refresh_token`）を呼ぶ。
  5. Google が `error === "invalid_grant"`（または HTTP 400/401 の無効トークン応答）を返した場合、即座に D1 の `google_connection` を `status = 'disconnected'`、`last_error = ...`、`updated_at = now` に更新し、メモリキャッシュをクリアして `GoogleConnectionError("invalid_grant")` を投げる。
  6. 成功時はキャッシュに格納して `access_token` を返す（`reencryptIfStale` 相当の鍵バージョン更新も組み込む）。

### 6. Google API クライアント群（`app/features/google/`）

すべてのクライアントは `fetch` を引数または `deps` で注入可能にし（既定 `globalThis.fetch`）、リトライ可能な HTTP/Google エラー情報（HTTP ステータス、`error.status`、`error.message`）を保持する型付きクラス `GoogleApiError` を返す／投げる形に統一する。ページングヘルパー `paginateAll` で `nextPageToken` を自動追従する。

- `client.server.ts`: 共通 JSON fetch ラッパー（Bearer 付与、`GoogleApiError` 抽出、ページング）。
- `meet.server.ts`:
  - `createSpace(accessToken, { accessType, moderation })`
  - `getSpace(accessToken, spaceName)`
  - `patchSpace(accessToken, spaceName, { accessType }, updateMask)`
  - `endActiveConference(accessToken, spaceName)`
  - `listSpaceMembers(accessToken, spaceName)`（ページング）
  - `createSpaceMember(accessToken, spaceName, { email, role? })`
  - `deleteSpaceMember(accessToken, memberName)`
  - `listConferenceRecords(accessToken, filter)` / `getConferenceRecord(accessToken, name)`
  - `listRecordings` / `getRecording`、`listTranscripts` / `getTranscript`、`listSmartNotes` / `getSmartNote`
- `calendar.server.ts`:
  - `insertEvent(accessToken, { calendarId: "primary", conferenceDataVersion: 1, sendUpdates, body })`
  - `getEvent(accessToken, { calendarId: "primary", eventId })`
  - `patchEvent(accessToken, { calendarId: "primary", eventId, sendUpdates, supportsAttachments, body })`
  - `deleteEvent(accessToken, { calendarId: "primary", eventId, sendUpdates })`
- `drive.server.ts`:
  - `getFile(accessToken, fileId, fields)`
  - `listFiles(accessToken, { q, fields })`（ページング）
  - `listPermissions(accessToken, fileId)`（ページング、`fields=nextPageToken,permissions(id,type,role,emailAddress)`）
  - `createPermission(accessToken, fileId, { emailAddress, role: "reader", type: "user", sendNotificationEmail: false })`
- `workspace-events.server.ts`:
  - `createSubscription(accessToken, { targetResource, eventTypes, pubsubTopic })`（LRO 応答 `done` / `response` を解釈）
  - `getSubscription(accessToken, name)` / `listSubscriptions(accessToken, filter)`（`subscriptions.list` は `filter` が必須。例 `event_types:"google.workspace.meet.conference.v2.ended"`。PoC もこの形で一覧した）
  - `patchSubscriptionTtl(accessToken, name, ttl = "0s")`（`updateMask=ttl`）
  - `deleteSubscription(accessToken, name)` / `reactivateSubscription(accessToken, name)`

### 7. 管理画面（`app/routes/admin/google.tsx`）と警告導線

- `/admin/google`:
  - 接続状態バッジ（未接続 / 接続済み / 切断 `invalid_grant`）、接続メールアドレス、保存済み `google_user_id`、付与済みスコープ、接続日時・最終更新日時、`last_error` を表示。
  - 「Google アカウントを接続（再接続）」ボタン（POST フォーム）と結果アラート（`?status=connected` / `?error=...`）。
  - 購読状態および失敗ジョブ一覧の枠は Stage 06 で追加する。
- トップページ（`/`）や `AppLayout` へ渡す接続状態の簡易チェック関数 `getGoogleConnectionSummary(db)` を用意し、切断（`disconnected`）または未接続のときにトップ画面に警告バナーを出せるようにする（管理者に `/admin/google` への導線を出す）。

### 制約

- **会議の作成・Pub/Sub Push・Queue・cron はこのステージで作らない。** 理由: Stage 04〜06 の担当であり、本ステージは接続管理とテスト済み API クライアント基盤に専念する。
- **`apps/accounts` のファイルを import しない。** 理由: Worker 間の依存はパッケージ（`@gdgjp/gdg-lib`）と service binding のみに限る。暗号化処理は `apps/meet` にコピーして独立させる。
- **トークンやシークレットをログ・画面・エラーレスポンスに出力しない。** 理由: セキュリティ原則（機密情報保護）。`last_error` にはエラーコード・概要のみを保存し、トークン文字列を絶対に含めない。
- **Google 側の制限（外部アプリ化・別アカウント同意）を許容しない。** `GOOGLE_HOST_EMAIL` 不一致の同意は必ず拒否し保存しない。

## Files to touch — 変更ファイル

### `apps/meet/`

- `wrangler.toml`, `.dev.vars.example`, `types/env.d.ts`
- `migrations/0002_google_connection.sql`（新規）、`schema.sql`（`migrate:local` で更新）
- `app/routes.ts`（`admin/google` と `admin/google/callback` 追加）
- `app/features/auth/access.server.ts`（`requireAdmin` 追加）
- `app/features/google/email.ts`（新規） + `email.test.ts`（新規）
- `app/features/google/encryption.server.ts`（新規） + `encryption.server.test.ts`（新規）
- `app/features/google/oauth.server.ts`（新規） + `oauth.server.test.ts`（新規）
- `app/features/google/token.server.ts`（新規） + `token.server.test.ts`（新規）
- `app/features/google/client.server.ts`（新規）
- `app/features/google/meet.server.ts`（新規） + `meet.server.test.ts`（新規）
- `app/features/google/calendar.server.ts`（新規） + `calendar.server.test.ts`（新規）
- `app/features/google/drive.server.ts`（新規） + `drive.server.test.ts`（新規）
- `app/features/google/workspace-events.server.ts`（新規） + `workspace-events.server.test.ts`（新規）
- `app/routes/admin/google.tsx`（新規）
- `app/routes/admin/google.callback.ts`（新規）
- `app/routes/meetings/home.tsx`（Google 接続が未接続・切断時の警告バナー表示を追加）
- `tests/architecture/__snapshots__/route-urls.test.ts.snap`（URL スナップショット更新）
- `ARCHITECTURE.md`（`features/google/` 追記）
- `docs/plans/meet/00a-poc-findings.md`（手動確認結果の追記: `sub` 一致確認）

## Verification — 完了条件と検証

### 1. 完了条件

1. `migrations/0002_google_connection.sql` 適用後、`typecheck` / `test` / `build` / `check-design-harness.mjs` がすべて通る。
2. `/admin/google` で非管理者が `403` で拒否され、管理者が `community-support@gdgoc.jp` で OAuth 接続すると暗号化済みリフレッシュトークンと `google_user_id`（`sub`）が D1 に保存される。
3. `GOOGLE_HOST_EMAIL` 以外のアカウントでの同意、スコープ不足、リプレイされた `state` がすべて拒否される。
4. 取得した `google_user_id`（`sub`）を用いて `workspaceevents.subscriptions.create` が実 API で通ることを確認し（確認後すぐ `subscriptions.delete` で削除）、`sub` と Cloud Identity ユーザー ID（`users/<id>`）が一致することを [`00a-poc-findings.md`](00a-poc-findings.md) に追記する。

### 2. コマンド

```sh
pnpm --filter @gdgjp/meet migrate:local
pnpm --filter @gdgjp/meet cf-typegen
pnpm --filter @gdgjp/meet typecheck
pnpm --filter @gdgjp/meet test
pnpm --filter @gdgjp/meet build
node scripts/check-design-harness.mjs
pnpm ci:quick
```

### 3. 回帰として固定すべきテスト

- **`email.test.ts`**: `gmail.com` / `googlemail.com` のローカル部ドット除去・大文字小文字正規化・`+tag` 保持・独自ドメイン（`gdgoc.jp` 等）のドット保持。
- **`encryption.server.test.ts`**: AES-GCM 往復、改ざん・別 AAD での復号失敗、キーバージョン分岐。
- **`oauth.server.test.ts`**: 単回利用 `state` リプレイ拒否、`GOOGLE_HOST_EMAIL` 以外のメール拒否、`email_verified: false` 拒否、必須スコープ欠落拒否、`refresh_token` 欠落拒否。
- **`token.server.test.ts`**: 有効期限内キャッシュ再利用、期限間近でのリフレッシュ、`invalid_grant` 時に D1 `status = 'disconnected'` へ遷移し `last_error` が残ること。
- **Google API クライアント各テスト（`fetch` モック）**:
  - `nextPageToken` を含む複数ページの連結取得
  - Google エラー応答（`error.status` / `error.message`）の型付き保持
  - `calendar.events.insert` の `conferenceData`・`conferenceDataVersion=1`・`sendUpdates`・`guestsCan*`・`events.patch` の `supportsAttachments=true` と `attachments` 形式
  - `drive.permissions.create` の `sendNotificationEmail=false`
  - `workspaceevents.subscriptions.patch` の `updateMask=ttl` と `{ ttl: "0s" }`

### 4. 手動 E2E（実 Google）

1. `.dev.vars` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN_ENCRYPTION_KEY` を設定して `pnpm --filter @gdgjp/meet dev` を起動する。
2. `/dev/login?as=admin&chapter=1:dev:organizer&admin=1` で管理者ログインし、`/admin/google` を開く。
3. 「Google アカウントを接続」を押し、まずは別のアカウント（例: 組織内テストアカウント）で同意してみる → `GOOGLE_HOST_EMAIL` 不一致エラーで拒否され、D1 に保存されないことを確認する。
4. 再度接続を開始し、`community-support@gdgoc.jp` で同意する → `/admin/google` に「接続済み」・`community-support@gdgoc.jp`・`google_user_id`・付与スコープが表示されることを確認する。
5. （使い捨てスクリプトまたはローカルテスト呼び出しで）保存された `google_user_id` を `//cloudidentity.googleapis.com/users/<google_user_id>` として Workspace Events のテスト購読を作成し、成功することを確認したうえで即 `subscriptions.delete` で削除する。確認結果を `00a-poc-findings.md` に記録する。