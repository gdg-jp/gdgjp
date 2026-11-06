# Stage 03 — 配信と計測の土台: `SNS.PrService` / `TINYURL.PrService`、短縮リンクの自動作成、X 投稿の受け渡し、Discord リマインド

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 配信経路の一覧は overview §8-1、計測の設計は §8-2。

Stage 02 までで下書きは承認できるが、承認しても何も起きない。このステージで「承認した X 投稿が sns 経由で**複数のアカウント**に予約され、
短縮リンクが tinyurl のキャンペーンに紐づき、レビュー依頼・スタッフへのリマインド・ストーリー掲載依頼が Discord に届く」ようにする。
連携は overview §2-6 のとおり **service binding + `WorkerEntrypoint`** で、相手アプリの既存の権限関数を通す。

実運用（[`00a`](00a-devfest-2026-usecase-review.md) §2-4）では主催 Greater Kwansai の @gdgkwansai に加えて oC Osaka の @gdsc_osaka でも
投稿し、スタッフは各自の Instagram ストーリーに画像を上げた。配信先はチャプターごとに持ち、**そのチャプターのメンバーが承認したときだけ**
RPC で書く（overview §2-11）。承認者がいなければ依頼アイテムになる。

### 依存と対象範囲

- 依存: Stage 02（`drafts` / `in_review` / `approved`、`draft_reviews`、`schedule_items.status`）、Stage 01（`campaign_chapters`、`campaign_members`、`request_status`）、Stage 00（`constants.channelCatalog`、`{{shortlink}}`）。
- 対象: `apps/pr/`（配信、設定、リンク台帳）、`apps/sns/`（`PrService` の追加だけ）、`apps/tinyurl/`（`PrService` の追加だけ）、
  `packages/gdg-lib/`（RPC の型）。
- **`apps/connpass` は触らない**（Stage 04）。画像の添付は Stage 06（本ステージは手でアップロードした画像を draft に付ける経路だけ）。
  当日実況の予約投稿の**生成**も Stage 06（本ステージの `live_post` は写真付き投稿と、人が書いた予約投稿の受け渡しだけ）。
- sns / tinyurl の既存ルートと UI を変えない。`PrService` は既存のサービス関数を呼ぶ薄い層。

### 事前確認（実装前に必ず）

1. **ローカルでの service binding 解決。** tinyurl → img（`IMG_UPLOAD`、`entrypoint = "ImageUploadService"`）は本番で動いている。
   ローカルで pr → sns を呼ぶには、両方の dev サーバ（`@cloudflare/vite-plugin`、`remoteBindings: false`）を同時に起動し、
   Wrangler の dev registry で解決されることを確認する。解決されない場合は、pr の e2e では `SNS` / `TINYURL` を
   **モック Worker**（`e2e/mock-services/`）に差し替える方式に倒し、本物の結合は手動 E2E に置く。
2. sns の `createDraft` は `scheduledAt` が未来であること、`xAccountId` がそのチャプターの有効なアカウントであることを要求する
   （`post-policy.ts`）。テスト用チャプターに X アカウントが接続されていなければ、`x_accounts` に失効済みでない行を直接入れる
   手順を sns の e2e に倣って用意する。

### 読むべきもの

- `apps/img/workers/app.ts` — `WorkerEntrypoint` の前例（`ImageUploadService.upload`）。`packages/gdg-lib/src/image-upload.ts` が
  入出力の型を持ち、`apps/tinyurl/wrangler.toml` の `[[services]]` が `entrypoint` を指定している
- `apps/sns/app/features/posts/{post-draft.service.server.ts,post-draft.deps.server.ts,post.types.ts,post-policy.ts}` —
  `createDraft(deps, input)` / `updateDraft` / `attachMedia` / `getDraft`、`CreateDraftInput`
- `apps/sns/app/features/auth/{access.server.ts,chapters.server.ts}`、`features/contributors/` — `requireSnsAccess` の判定
  （organizer / super admin / contributor）。RPC 用に **Request を持たない同じ判定**を切り出す
- `apps/sns/app/features/x-accounts/x-account.repository.server.ts` — `listXAccounts(db, chapterId)`
- `apps/tinyurl/app/features/campaigns/campaign.service.ts` — `createCampaignForActor` / `listCampaignsForActor` /
  `createCampaignChannelForActor` / `createCampaignChannelSourceForActor`（`CampaignServiceActor = { user, chapters }`）
- `apps/tinyurl/app/features/links/{link.service.ts,link.types.ts}` — `createLinkWithExtras(deps, actor, rawInput)`、
  `CreateLinkInput`（`domainId`, `slug`, `destinationUrl`, `ogImageUrl`, `campaignChannelId`, `visibility`）
- `apps/tinyurl/app/features/domains/domain.repository.ts` — `getDomainByHostname`（`gdgs.jp` の system ドメイン）
- `apps/tinyurl/app/features/campaigns/campaign-cli-analytics.ts` — `getCampaignAnalyticsForActor(env, actor, campaignId, query)`
  （Stage 07 で使う。本ステージでは `PrService.getAnalytics` の薄い口だけ作る）
- `apps/sns/app/lib/crypto.server.ts` — `encryptSecret` / `decryptSecret`。Discord webhook URL の保存に同じ方式を使う
- `apps/sns/workers/app.ts` — 毎分 cron で `publishDuePosts`。pr は予約だけして公開は sns に任せる

### 再利用する既存実装（書き直さない）

- sns の `createDraft` / `updateDraft` / `attachMedia` / `getDraft` と `postDraftDepsFromEnv(env)` — `PrService` はこれを呼ぶだけ。
  投稿の検証（文字数、時刻、アカウント）は sns 側のまま
- tinyurl の `createCampaignForActor` 系と `createLinkWithExtras` — 同上。slug の重複（`slug_taken`）も tinyurl が返す
- `apps/img/workers/app.ts` の Entrypoint の形（`extends WorkerEntrypoint<Env>`、メソッドは `this.env` を使う）
- Stage 01 の `schedule/derive.ts`（派生アイテム）、Stage 02 の承認フロー

## Design — 設計

### 1. RPC の型（`packages/gdg-lib/src/pr-rpc.ts`、`index.ts` から export）

型だけ。実行時コードは置かない。

```ts
export type PrActor = { user: AuthUser; chapters: UserChapter[] };
export type PrRpcFailure = { ok: false; code: string; message?: string };

// sns
export type SnsListXAccountsInput = { actor: PrActor; chapterId: number };
export type SnsCreateScheduledPostInput = {
  actor: PrActor; chapterId: number; xAccountId: string; text: string;
  scheduledAt: string;                   // ISO instant（UTC）
  condition: "scheduled" | "photo_required";
  tagHandles?: string[];
};
export type SnsAttachMediaInput = { actor: PrActor; postId: string; bytes: ArrayBuffer; contentType: string; altText?: string; sortOrder: number };
export type SnsPostSummary = { id: string; status: string; scheduledAt: string; publishedXPostId: string | null; failureReason: string | null };

// tinyurl
export type TinyurlEnsureCampaignInput = { actor: PrActor; chapterId: number; code: string; name: string; defaultDestinationUrl?: string | null };
export type TinyurlEnsureChannelInput = { actor: PrActor; campaignId: number; code: string; name: string };
export type TinyurlCreateLinkInput = {
  actor: PrActor; chapterId: number; domainHostname: string; slug: string; destinationUrl: string;
  title?: string; ogImageUrl?: string | null; campaignChannelId: number; sourceCode?: string;
};
export type TinyurlLinkSummary = { id: string; shortUrl: string; slug: string };
export type TinyurlAnalyticsInput = { actor: PrActor; campaignId: number; from: string; to: string; bucket?: "hour" | "day" };
```

RPC は例外を投げず `{ ok: true, ... } | PrRpcFailure` を返す（例外は binding を越えると型が落ちる）。

### 2. `apps/sns/workers/app.ts` の `PrService`

```ts
export class PrService extends WorkerEntrypoint<Env> {
  listXAccounts(input)         // assertPrActor → listXAccounts(db, chapterId) の id / username / displayName
  createScheduledPost(input)   // assertPrActor → createDraft(postDraftDepsFromEnv(env), { ...input, createdByUserId: actor.user.id })
  updatePost(input)            // updateDraft
  attachMedia(input)           // attachMedia
  getPost(input)               // getDraft → SnsPostSummary
}
```

`features/auth/rpc-access.server.ts` に `assertPrActor(env, actor, chapterId)` を置く。判定は `requireSnsAccess` と同じ
（organizer / super admin / contributor）だが、Request も cookie も redirect も持たない。`requireSnsAccess` 側は変えない。
`chapterId` が `actor.chapters` に無く super admin でもなければ `{ ok: false, code: "forbidden" }`。

`PostDraftError` は `code` に写して返す（`invalid_text` / `invalid_schedule` / `account_not_found` …）。

### 3. `apps/tinyurl/workers/app.ts` の `PrService`

```ts
export class PrService extends WorkerEntrypoint<Env> {
  ensureCampaign(input)   // code で検索（listCampaignsForActor）→ 無ければ createCampaignForActor({ chapterIds: [chapterId] })
  ensureChannel(input)    // 同様に code で検索 → createCampaignChannelForActor
  ensureSource(input)     // createCampaignChannelSourceForActor
  createLink(input)       // getDomainByHostname(domainHostname) → createLinkWithExtras(deps, { user, chapters, selectedChapterId: chapterId }, { domainId, slug, destinationUrl, title, ogImageUrl, campaignChannelId, visibility: "private" })
  getAnalytics(input)     // getCampaignAnalyticsForActor（Stage 07 が使う）
}
```

既存の `workers/app.ts` は apex の 302 fast path を持つ。`export default` の `fetch` は変えず、クラスを**追加**するだけ。

### 4. pr 側（`apps/pr/`）

#### 4-1. バインディングと設定

`wrangler.toml`:

```toml
[[services]]
binding = "SNS"
service = "gdgjp-sns"
entrypoint = "PrService"

[[services]]
binding = "TINYURL"
service = "gdgjp-tinyurl"
entrypoint = "PrService"
```

`migrations/0003_distribution.sql`:

```sql
CREATE TABLE campaign_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('x','ig','connpass_group','discord')),
  chapter_id  INTEGER NOT NULL,                       -- このアカウントを持つチャプター（campaign_chapters に含まれること）
  external_id TEXT NOT NULL,                          -- x: sns の x_accounts.id / ig: ハンドル / connpass_group: group slug / discord: webhook は chapter_settings
  label       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'mirror' CHECK (role IN ('primary','mirror')),
  UNIQUE (campaign_id, kind, external_id)
);
CREATE TABLE dispatch_targets (                       -- 1 アイテム × 1 配信先。承認はここに付く
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_item_id INTEGER NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES campaign_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dispatching','scheduled','done','failed','skipped','delegated')),
  approved_by TEXT, approved_at INTEGER,
  external_ref TEXT,                                  -- JSON: { snsPostId } など
  UNIQUE (schedule_item_id, account_id)
);
CREATE TABLE chapter_settings (
  chapter_id             INTEGER PRIMARY KEY,
  discord_webhook_cipher TEXT,                        -- encryptSecret(SETTINGS_ENCRYPTION_KEY, url)
  updated_by             TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
ALTER TABLE campaigns ADD COLUMN auto_staff_reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN actor_snapshot TEXT;               -- §4-5
CREATE TABLE campaign_channels (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                          -- constants.channelCatalog の値
  tinyurl_channel_id INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, channel)
);
CREATE TABLE campaign_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  tinyurl_link_id TEXT NOT NULL, short_url TEXT NOT NULL, slug TEXT NOT NULL,
  channel TEXT NOT NULL, source_code TEXT, og_image_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE dispatch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_item_id INTEGER NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                               -- sns_create / sns_poll / discord_send / link_create
  ok INTEGER NOT NULL, detail TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

secret `SETTINGS_ENCRYPTION_KEY`（sns の `crypto.server.ts` をコピーして使う。gdg-lib には上げない。理由: 2 アプリの類似コードは
共有の根拠にならない — `docs/software-architecture.md`）。

`/c/:slug/settings` に追加: 配信先アカウント（`campaign_accounts`。X は主催・共催それぞれの `SNS.listXAccounts({ chapterId })` から選ぶ。
IG はハンドルだけ）、`auto_staff_reminders`、Discord webhook（チャプター設定として `/settings/chapter` に分け、URL は保存後マスク表示。
共催チャプターの webhook はそのチャプターの organizer が自分の `/settings/chapter` で設定する）。

#### 4-2. キャンペーンの有効化（`status: draft → active`）

`features/integrations/activate.server.ts`:

1. `TINYURL.ensureCampaign({ code: campaign.slug, name, defaultDestinationUrl: brief.event.connpassUrl })` → `tinyurl_campaign_id`
2. 採用済み計画の `channelMix[].channel`（無ければ `constants.channelCatalog` 全部）ごとに `ensureChannel({ code: channel })` → `campaign_channels`
3. `actor_snapshot` に操作者の `{ user, chapters }` を保存（§4-5）

失敗したら `status` を変えずにエラーを画面に出す。`ensure*` は冪等なので再実行できる。

#### 4-3. 短縮リンク（`features/links/`）

draft（`x_post` / `ig_post` / `connpass_mail` / `discord_post`）の本文に `{{shortlink}}` があるとき、**承認時**に 1 本作る:

- slug: `<campaign.slug>-<kind 略>-<item id>`（例 `devfest-kansai-2026-x-42`）。`features/links/slug.ts` で 40 字に収める
- destination: draft の `attachment.link.url` → 無ければ `brief.event.connpassUrl` → 無ければ承認を拒否（「リンク先が無い」）
- `ogImageUrl`: `attachment.link.ogImage`（Stage 06 までは draft 画面で URL を手入力）。`attachment.kind = ogp` なのに無ければ
  承認を拒否（`OGP-ON-SHORTLINK`）
- `campaignChannelId`: `campaign_channels[item.channel]`。`sourceCode`: `item.kind`
- 結果を `campaign_links` に保存し、`{{shortlink}}` を `short_url` に置換した本文を**配信用**に使う（draft の版は書き換えない。
  置換は `dispatch` が行う）

#### 4-4. 配信（`features/dispatch/`）

`x_post` / `live_post` は `dispatch_targets`（アイテム × `campaign_accounts` の X アカウント）単位で動く。下書きの `approved`（Stage 02）は
「本文が確定した」ことで、**配信先ごとの承認**は `dispatch_targets.status = approved` が別に要る。承認できるのはその `account.chapter_id` に
属するメンバー（`campaign_members` にいて、live claims にそのチャプターがある人）。主催チャプターの lead が共催チャプターの
アカウントを承認することは**できない**（sns 側の権限関数でも弾かれる）。承認者がいない配信先は `delegated` にして依頼アイテム
（「@gdsc_osaka での投稿をお願いします」+ 本文コピー）を作る。

| kind | いつ | 何を |
|---|---|---|
| `x_post`, `live_post`（人が書いた予約投稿） | **配信先の承認時**（action の中、承認者の live claims で） | `SNS.createScheduledPost({ actor, chapterId: account.chapter_id, xAccountId: account.external_id, text: 置換済み, scheduledAt: item.due_at, condition: live_post(photo) ? "photo_required" : "scheduled", tagHandles })`。手で付けた画像があれば `attachMedia`。`dispatch_targets.external_ref = { snsPostId }`、`status = scheduled`。全配信先が `scheduled` / `done` / `skipped` / `delegated` になったらアイテムも `scheduled` |
| 投稿権限の事前検証 | キャンペーン有効化時と配信先の追加時 | `SNS.listXAccounts` でアカウントが有効で、承認予定者が contributor / organizer であることを確認。満たさなければ設定画面に警告（DevFest 2026 で当日に判明した事故の再発防止） |
| `x_post` の状態追従 | 毎時 cron（配信先ごとの `approved_by` の claims スナップショット） | `SNS.getPost` → `published` なら `done`（`external_ref.publishedXPostId`）、`failed` なら `failed` + `dispatch_log` |
| `staff_reminder` | 毎分 cron、`due_at` 到来 | `auto_staff_reminders` なら Discord webhook に送って `done`。そうでなければ `needs_approval`（文面は draft か `guides/reminders.md` の既定文）。人が承認すると即送信。型は 3 つ: いいね・リポスト依頼、**ストーリーへの掲載依頼**（画像 URL 付き）、**レビュー依頼**（`in_review` になった draft のリンク。Stage 02 の状態遷移から即時に送る） |
| `discord_post` | `due_at` 到来、`approved` のもの | Discord webhook → `done` |
| `speaker_request` | 送らない | `/c/:slug/approvals` に文面とコピー用ボタン。人が「送った」で `done`。`purpose = own_announce`（本人の登壇予告の依頼）と `quote` の両方 |
| `community_ask`, `org_outreach`, `sponsor_ask`, `delegated` の配信先 | 送らない | **依頼アイテム**: 文面（`pr-plan` の `outreach[].pitchMd` か人）、宛先（`contacts`）、担当者。`request_status` を `sent` → `replied` / `declined` に人が更新。`sent` のまま `request_followup_at` を過ぎたら担当者に Discord で再連絡リマインド |
| `ig_post`, `x_ad_start`, `ig_ad_start`, `short_video`, `line_post`, `flyer_*`, `print_item`, `lt_at_event`, `interview`, `website_update`, `metrics_review` | 送らない | チェックリスト。担当者と「完了」 |

**二重配信の防止**: 配信前に `UPDATE dispatch_targets SET status = 'dispatching' WHERE id = ? AND status = 'approved'` を打ち、
更新行数 0 なら何もしない。sns 作成後に `scheduled` へ。cron の重なりと承認ボタンの連打の両方をこれで止める。

承認時の配信が失敗したら draft は `approved` のまま、item は `failed` + `dispatch_log` に理由。画面に「再試行」。

#### 4-5. cron から呼ぶときの actor

RPC は `actor` を要求するが、cron には操作者がいない。tinyurl 向けは `campaigns.actor_snapshot`（有効化した人の `{ user, chapters }`）、
sns の状態追従は `dispatch_targets.approved_by` の claims スナップショット（`campaign_members.claims_snapshot`。承認のたびに更新）を使う。
相手アプリは通常の権限関数で判定するので、その人がチャプターを抜けていれば `forbidden` が返り、`dispatch_log` に残る。

#### 4-7. 短縮リンクの死活監視（`features/links/health.server.ts`）

毎時 cron で `campaign_links` と `brief.event.connpassUrl` の宛先に `HEAD`（ダメなら `GET`、リダイレクトは追う）を打ち、2xx / 3xx 以外が
2 回続いたら Discord に「リンク切れ」を送り、ダッシュボードに赤ランプを出す。印刷物に載せるリンクは必ず短縮リンクにする
（宛先を後から差し替えられる）ことを `guides/channels.md` に書く（Tips 外だが実運用の事故から。proposal として）。

#### 4-6. Discord webhook（`features/notify/discord.server.ts`）

`POST <webhook>` に `{ content, allowed_mentions: { parse: [] } }`。文面は draft があればそれ、無ければ
`guides/reminders.md` の既定文（Playbook から読む。文面を TS に直書きしない）に投稿本文の先頭 1 行と予定時刻を埋める。
429 は 1 回だけ待って再試行。

### 5. 画面の変更

- `/c/:slug/settings`: 配信先アカウントの一覧と追加（チャプター別）、投稿権限の検証結果、`auto_staff_reminders`、有効化ボタン（§4-2）と tinyurl キャンペーンへのリンク
- `/c/:slug/drafts/:id`: 配信先ごとの承認ボタン（自分が承認できるものだけ有効。他は「○○チャプターのメンバーが承認」と表示）、`delegated` の依頼文
- `/settings/chapter`: Discord webhook（新規）
- `/c/:slug/drafts/:id`: 承認ボタンの横に「配信先: sns の @account に <日時> で予約」の説明。`attachment` の画像 URL / OGP URL の入力。
  承認失敗の理由
- `/c/:slug/schedule`: `scheduled` / `done` / `failed` のバッジ、`external_ref` のリンク（sns の投稿、X の投稿）
- `/c/:slug/approvals`: `speaker_request` と `staff_reminder` の文面 + コピー + 「送った」/「送信」、依頼アイテムの `request_status` 更新
- `/c/:slug/metrics`（Stage 07 で本実装。本ステージは最小）: リンクの死活

### 制約

- **RPC は相手アプリの既存権限関数を通す。** `PrService` に独自の許可ロジックを書かない。理由: pr が信頼済み Worker でも、
  actor の権限で判定することで誤設定の影響を限定する。
- **sns / tinyurl の既存ルート・UI・テストを変えない。** `workers/app.ts` にクラスを足すだけ。理由: 他の利用者がいる。
- **配信先の承認ボタンだけが外部に書く。** cron は状態の追従とリマインド送信だけ。理由: 承認者の live claims で判定するため。
- **他チャプターのアカウントに主催側が書かない。** そのチャプターのメンバーの承認か、依頼アイテム。理由: overview §2-11。sns 側の権限関数も通す。
- **`draft_versions.content` を配信用に書き換えない。** `{{shortlink}}` の置換は配信時のコピーに対して行う。
- **二重配信の防止を `dispatching` ガードで行い、崩さない。**
- **Discord webhook URL を平文で保存しない。ログにも出さない。**
- Instagram / 広告 / connpass への書き込みは作らない（§11、Stage 04）。当日実況の生成は Stage 06。

## Files to touch — 変更ファイル

### `packages/gdg-lib/`

- `src/pr-rpc.ts`（新規）、`src/index.ts`

### `apps/sns/`

- `workers/app.ts`（`PrService` 追加）
- `app/features/auth/rpc-access.server.ts`（新規）と `rpc-access.server.test.ts`
- `app/features/posts/pr-service.server.ts`（新規。Entrypoint から呼ぶ薄い関数群）と `pr-service.server.test.ts`
- `app/architecture.test.ts`（必要なら許可リスト）

### `apps/tinyurl/`

- `workers/app.ts`（`PrService` 追加）
- `app/features/campaigns/pr-service.server.ts`、`app/features/links/pr-service.server.ts`（新規）と各 `*.test.ts`
- `tests/architecture/layering.test.ts`（必要なら）

### `apps/pr/`

- `wrangler.toml`（`SNS` / `TINYURL`、secret の注記）、`.dev.vars.example`（`SETTINGS_ENCRYPTION_KEY`）
- `migrations/0003_distribution.sql`、`schema.sql`
- `app/lib/crypto.server.ts`（sns からコピー）
- `app/features/integrations/{sns.server.ts,tinyurl.server.ts,activate.server.ts,accounts.server.ts,permission-check.server.ts}` と `*.test.ts`
- `app/features/dispatch/{targets.server.ts,targets.test.ts,delegate.server.ts}`、`app/features/links/{health.server.ts,health.test.ts}`
- `app/features/requests/{request-status.server.ts,followup.server.ts,followup.test.ts}`
- `app/features/links/{slug.ts,slug.test.ts,link.repository.server.ts,create.server.ts}`
- `app/features/dispatch/{dispatch.server.ts,dispatch.test.ts,poll.server.ts,reminders.server.ts}`
- `app/features/notify/{discord.server.ts,discord.test.ts}`
- `app/features/settings/{chapter-settings.server.ts}`
- `app/routes/campaigns/settings.tsx`、`app/routes/settings/chapter.tsx`（新規）、`app/routes/drafts/detail.tsx`、
  `app/routes/approvals/queue.tsx`、`app/routes/schedule/calendar.tsx`、`app/routes.ts`
- `workers/app.ts`（cron 分岐の追加）、`tests/architecture/route-urls.test.ts`
- `e2e/mock-services/`（事前確認 1 の結果次第）、`e2e/distribution.spec.ts`
- `ARCHITECTURE.md`、`CLAUDE.md`

## Verification — 完了条件と検証

### 完了条件

1. sns / tinyurl の既存テストが無変更で通り、`PrService` のテストが「非メンバーは forbidden」「organizer は作成できる」を示す。
2. pr でキャンペーンを有効化すると、tinyurl にキャンペーンとチャネルができ、`campaign_channels` に id が入る。
3. `{{shortlink}}` 入りの `x_post` を承認し、配信先（主催 X）を承認すると、tinyurl にリンクが切られ、sns に `scheduled` の投稿ができ、
   配信先とアイテムが `scheduled` になる。承認ボタンを連打しても sns の投稿は 1 件。共催チャプターの X は主催の lead では承認できず、
   共催のメンバーで承認すると**その人の claims** で sns に予約される。
3b. `in_review` になった draft のレビュアーに Discord の通知が届く。`org_outreach` の `sent` が `request_followup_at` を過ぎると担当者に通知が届く。
3c. 宛先を 404 にした短縮リンクが 2 回の cron 後に Discord とダッシュボードで赤くなる。
4. `auto_staff_reminders` を on にしたキャンペーンで、派生 `staff_reminder` の `due_at` が来ると Discord に 1 件届く。
5. sns 側で投稿が `published` になると、毎時 cron で item が `done` になる。
6. `attachment.kind = ogp` で OGP URL が空の draft は承認できない。

### コマンド

```sh
pnpm --filter @gdgjp/gdg-lib typecheck
pnpm --filter @gdgjp/sns test && pnpm --filter @gdgjp/sns typecheck
pnpm --filter @gdgjp/tinyurl test && pnpm --filter @gdgjp/tinyurl typecheck
pnpm --filter @gdgjp/pr migrate:local && pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
pnpm --filter @gdgjp/pr test:e2e
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`dispatching` ガード**: `approved` 以外からの配信は何もしない。同じ配信先に対する 2 つの承認で `SNS.createScheduledPost` が 1 回しか呼ばれない（モック binding で回数を数える）
- **チャプター境界**: 共催チャプターの `dispatch_target` を主催の lead が承認しようとすると 403。承認できる人がいないと `delegated` + 依頼アイテム
- **投稿権限の事前検証**: contributor でない承認予定者がいると設定画面に警告が出て、承認時にも拒否される
- **`{{shortlink}}` の置換が draft の版を変えない**（`draft_versions.content` が配信後も同一）
- **OGP 必須**: `attachment.kind = ogp` かつ `ogImageUrl` 無しで承認が拒否される
- **`assertPrActor`**: `chapters` に無い `chapterId` は forbidden、contributor は許可、super admin は許可
- **tinyurl `createLink` の slug 衝突**: `slug_taken` がそのまま `PrRpcFailure.code` に写る（握りつぶさない）
- **`actor_snapshot` 無しの cron**: 追従と送信をスキップして `dispatch_log` に `no_actor` を残す（例外で cron 全体を止めない）
- **Discord 文面**: `guides/reminders.md` の既定文を使い、TS に文面が無い（テストで `reminders.server.ts` に日本語リテラルが無いことを確認）
- **sns / tinyurl の既存テスト**が無変更で通る

### 手動 E2E

1. accounts / sns / tinyurl / pr の dev サーバを起動（事前確認 1 の方式）。sns のテストチャプターに X アカウントを用意。
2. pr の `/settings/chapter` に Discord の検証用 webhook を保存。
3. `/c/:slug/settings` で X アカウントを選び「有効化」。url.gdgs.jp（ローカル）のキャンペーン画面にチャネルが並ぶ。
4. Stage 02 の手順で `x_post` の draft（`{{shortlink}}` 入り、`attachment.kind = ogp`、OGP URL 入力）を承認 → sns の投稿一覧に `scheduled`。
5. 派生 `staff_reminder` の時刻を 1 分後に変え、`auto_staff_reminders` on → Discord に届く。
6. sns で手動公開（publish now）→ pr の毎時 cron 相当（`/dev/cron?name=hourly`、loopback 限定）を叩いて `done` になる。
