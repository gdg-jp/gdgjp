# Stage 01 — `apps/pr` ワークスペースの新設とキャンペーン・brief・スケジュールの手動 CRUD

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 用語・テーブル・`schedule_items.kind` の集合は
overview §4 が正本で、ここでは繰り返さない。

このステージは pr.gdgs.jp の土台を作る。やることは 5 つ。

1. `apps/pr/` を `apps/roulette/` から scaffold し、GDG Accounts でサインインしてチャプターでゲートできる状態にする
2. キャンペーン（= 1 イベント。主催 + 共催チャプター、プレイベントは子キャンペーン）、役割分担、brief、スケジュール（担当・レビュアー・
   告知開始条件）を**手で**作れる画面を作る。AI も書き込みの RPC もまだ無い
3. 告知先の正本である Wiki の「イベント告知対象とコネクション保有者」ページを `WIKI` service binding で**読み取り**、運用表 `contacts` に取り込む
4. Stage 00 の Playbook（`skills/pr-playbook`）をビルドに同梱し、`constants.json` から派生リマインドを機械的に作る
5. モノレポの登録ポイント（CI / deploy / accounts クライアント / 変更検出）を漏れなく埋め、アーキテクチャテストを最初から置く

実運用（DevFest Kansai 2026、[`00a`](00a-devfest-2026-usecase-review.md)）は 8 人のチームで、主催 Greater Kwansai に oC Osaka / Kobe / Kyoto が
加わり、成果物は「作成 → Rv → 公開」で流れた。2 と 3 はその形をそのまま持つ。

4 を今やる理由は `docs/roster/adr.md` の ADR-003 と同じ。後付けは高くつく。

### 依存と対象範囲

- 依存: Stage 00（`skills/pr-playbook/constants.json`、`references/brief.schema.json`、`rules.json`）。サブモジュールが
  そのコミットを指していること。
- 対象: `apps/pr/`（新規）、モノレポの登録ポイント、`apps/accounts/` のクライアント登録。**他アプリのコードは触らない。**
- Stage 02 の担当（`agent_jobs`、`/api/runner/*`、`drafts`、レビュー・承認キュー、cron）、Stage 03 の担当（sns / tinyurl への書き込み、Discord）は
  **作らない。** テーブルも作らない。本ステージの service binding は **`WIKI`（読み取りだけ）** の 1 本。

### 事前確認（実装前に必ず）

1. **wiki が `pr` クライアントのアクセストークンを受けること。** `apps/wiki/app/features/agent-api/agent-reader.server.ts` は
   「リンク済みユーザーの OAuth トークン → そのユーザー」として `/api/agent/*` を解決する。pr の RP セッション（`oidc_session.access_token`、
   `IDP_CLIENT_ID = pr`）のトークンで `GET /api/agent/cat?path=<告知先ページ>` が 200 を返すことをローカルで確かめる。
   クライアント id で弾かれるなら wiki 側の許可リストに `pr` を足す（wiki への変更は**その 1 行だけ**）。
2. 告知先ページのパス（Wiki の `イベント告知対象とコネクション保有者`）と見出し構造（人別 → 種別 → 団体名）を確認し、
   `contacts/wiki-import.ts` のパーサの fixture にする。

### 読むべきもの

- `CLAUDE.md`（リポジトリ根）— ワークスペースの規約、`cf-typegen`、`migrate:local`
- `docs/software-architecture.md` — feature-first の配置規約
- `apps/roulette/` 一式 — **雛形。** `vite.config.ts`、`wrangler.toml`、`react-router.config.ts`、`app/features/auth/*`、
  `app/routes.ts`、`workers/app.ts`、`migrations/0001_init.sql`、`e2e/global-setup.ts`、`playwright.config.ts`、`vitest.config.ts`
- `apps/roulette/ARCHITECTURE.md` と `README.md` — コードマップと README の粒度の手本
- `docs/roster/01-workspace-scaffold.md` — 同じ scaffold 作業の先例（パスは `apps/` 移行前のもの。読み替える）
- `apps/wiki/tests/architecture/{layering,file-size,test-colocation,route-urls}.test.ts` — アーキテクチャテストの移植元
- `.github/scripts/changed-workspaces.mjs`、`.github/workflows/ci.yml`、`.github/workflows/deploy.yml` — 登録ポイント
- `apps/accounts/app/features/oauth/seed-clients.server.ts`、`apps/accounts/wrangler.toml`、`apps/accounts/.dev.vars.example` —
  OAuth クライアントの登録方法
- `skills/pr-playbook/references/brief.schema.json`、`constants.json`、`rules.json`（Stage 00）
- `apps/agent/src/features/inquiry/wiki.ts`（`wikiClient`: `WIKI` binding に Bearer を付けて `/api/agent/{search,cat}` を呼ぶ形）と
  `apps/wiki/app/routes/api/agent/{cat,search}.ts` — 読み取りの契約
- `apps/wiki/app/features/agent-api/agent-reader.server.ts` — 誰として読むかの解決

### 再利用する既存実装（書き直さない）

- **`apps/roulette/vite.config.ts` の `resolve.dedupe` + `optimizeDeps.include` + `environments` ブロック** — `@gdgjp/gdg-lib` を
  ソースのまま consume するため、無いとクライアントに React が 2 つ入りハイドレーションで落ちる。コメントごとコピーする
- **`apps/roulette/migrations/0001_init.sql` の `user` / `oidc_session`** — gdg-lib の RP 認証の正準スキーマ。そのままコピー
- **`apps/roulette/app/features/auth/{auth,chapter,access}.server.ts`, `return-to.ts`** — `initializeRpAuth` のキャッシュ、
  chapter claims の 30 秒キャッシュ、`requireUserWithChapter`。cookie prefix と dev cookie 名を `gdgjp-pr` / `pr-dev-chapters` に
  変えるだけ
- **`apps/roulette/app/routes/{api.auth.$.ts,auth.signout.ts,signin.tsx,dev.login.ts}`, `routes/auth/no-chapter.tsx`** — そのまま
- **`apps/roulette/app/features/projects/access.server.ts`** — 「チャプター所属で所有権を判定する」形。`campaigns/access.server.ts` の手本
- **`apps/roulette/e2e/global-setup.ts`**（D1 マイグレーション適用）と `playwright.config.ts`（CI ポート切り替え、
  `scripts/run-e2e-dev.mjs`）— DB 名とポートを変えるだけ
- `@gdgjp/design-system` のコンポーネント（`PageHeader`, `Card`, `FormField`, `Input`, `Button`, `Alert`, `Stack`）。
  `packages/design-system/design/components/*.json` が契約

### 前提として確認済みの事実

- dev ポートは `5191` を使う（既存: 5180 website, 5182 pay, 5185 ost, 5186 roster, 5187 mc, 5188 screen, 5189 deck, 5190 roulette）。
  CI の e2e ポートは `6191`、inspector は `9291`。
- `apps/roulette/` は Workers Free プラン前提で DO / KV / R2 / cron を持たない。pr は Stage 02 で cron、Stage 06 で
  `[browser]` と R2 を足す。**本ステージの `wrangler.toml` は roulette と同じ構成**（D1 + assets + `ACCOUNTS` service binding）。
- CI の各ジョブは `git submodule update --init packages/design-system` だけを実行している。pr のビルドは `skills` も要る。
- accounts のクライアントは `wrangler.toml` の `*_CLIENT_ID` / `*_REDIRECT_URLS` + secret `*_CLIENT_SECRET` + `seed-clients.server.ts` の
  `apps` 配列 + `/admin/seed-clients` の再実行で登録される。

## Design — 設計

### 1. ワークスペース

| 項目 | 値 |
|---|---|
| パス / パッケージ | `apps/pr/` / `@gdgjp/pr` |
| 本番 | `pr.gdgs.jp`（`[[routes]] pattern = "pr.gdgs.jp", custom_domain = true`） |
| Worker 名 | `gdgjp-pr` |
| D1 | `gdgjp-pr-db`（`wrangler d1 create gdgjp-pr-db` で作り、`database_id` を `wrangler.toml` に書く） |
| vars | `ENVIRONMENT`, `APP_URL = https://pr.gdgs.jp`, `ACCOUNTS_URL`, `IDP_URL`, `IDP_CLIENT_ID = "pr"` |
| secrets | `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`（`.dev.vars.example` に項目を書く） |
| service binding | `ACCOUNTS → gdgjp-accounts`、`WIKI → gdgjp-wiki`（読み取りだけ。§4-2） |
| cookie prefix | `gdgjp-pr` |

`package.json` の scripts は roulette と同じ（`typecheck` は `wrangler types && react-router typegen && tsc`、`migrate:local` は
`schema:dump` 付き）。`dependencies` も同じ。

### 2. D1 スキーマ（`migrations/0001_init.sql`）

`user` / `oidc_session` は roulette のコピー。ドメインは次の 4 表。時刻は `INTEGER`（unixepoch）、JSON は `TEXT`。

```sql
CREATE TABLE campaigns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id          INTEGER NOT NULL,                -- 主催チャプター
  parent_campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,   -- プレイベントは本番の子
  slug                TEXT NOT NULL UNIQUE,            -- [a-z0-9-]{3,40}。予約語は app/features/campaigns/slug.ts
  name                TEXT NOT NULL,
  event_at            INTEGER,                         -- brief.event.startAt の写し（一覧の並び順用）
  venue               TEXT,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  connpass_group_slug TEXT,
  connpass_event_id   TEXT,
  tinyurl_campaign_id INTEGER,
  budget_total_yen    INTEGER NOT NULL DEFAULT 0,
  playbook_version    TEXT NOT NULL,                   -- 作成時のビルドの PLAYBOOK_VERSION
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX campaigns_chapter ON campaigns (chapter_id, status, event_at);

CREATE TABLE campaign_chapters (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('host','co-host')),
  PRIMARY KEY (campaign_id, chapter_id)
);

CREATE TABLE campaign_members (
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  roles          TEXT NOT NULL DEFAULT '[]',           -- JSON: lead / sub / connpass / writer / designer / video / outreach / photographer / reviewer
  discord_handle TEXT,
  added_by       TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE briefs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,                        -- 1 から。保存のたびに +1（上書きしない）
  body        TEXT NOT NULL,                           -- brief.schema.json 準拠の JSON
  author      TEXT NOT NULL,                           -- user id
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (campaign_id, version)
);

CREATE TABLE schedule_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id           INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,                 -- overview §4 の集合。app/features/schedule/kinds.ts が CHECK の正本
  channel               TEXT,                          -- constants.channelCatalog の値
  due_at                INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  note                  TEXT,
  draft_id              INTEGER,                       -- Stage 02 で drafts を参照。本ステージは NULL のまま
  assignee_user_id      TEXT,                          -- 作成者 / 担当者
  reviewer_user_id      TEXT,                          -- レビュアー（NULL なら lead）
  requires_approval     INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','drafting','in_review','needs_approval','approved','scheduled','done','failed','skipped')),
  blocked_by            TEXT NOT NULL DEFAULT '[]',    -- JSON: 'session:<id>:confirmed' / 'item:<id>:done' / 'date:<iso>'。全部満たすまで drafting に進めない
  request_status        TEXT CHECK (request_status IN ('sent','replied','declined')),   -- 依頼アイテム（community_ask / org_outreach / sponsor_ask / 他チャプター依頼）
  request_followup_at   INTEGER,                       -- 再連絡の期限
  external_ref          TEXT,                          -- JSON。Stage 03 以降
  derived_from_item_id  INTEGER REFERENCES schedule_items(id) ON DELETE CASCADE,
  offset_minutes        INTEGER,
  speaker_id            TEXT,                          -- brief.speakers[].id
  session_id            TEXT,                          -- brief.sessions[].id
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX schedule_items_due ON schedule_items (campaign_id, due_at);
CREATE INDEX schedule_items_derived ON schedule_items (derived_from_item_id);

-- 告知先の運用表。正本は Wiki の「イベント告知対象とコネクション保有者」で、ここは取り込み + 運用列。
CREATE TABLE contacts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id            INTEGER NOT NULL,
  organization          TEXT NOT NULL,                 -- 団体名の正規化キー（重複連絡を束ねる）
  kind                  TEXT NOT NULL CHECK (kind IN ('person','org','community','circle','lab','school','company','media')),
  name                  TEXT NOT NULL,
  relation              TEXT,
  channel               TEXT,                          -- 連絡手段（X DM / メール / Discord …）。個人の連絡先そのものは保存しない
  owner_user_id         TEXT,                          -- 誰のコネクションか（Wiki の人別見出しを user に対応付け。未対応なら NULL）
  wiki_person           TEXT,                          -- Wiki の人別見出しの表記
  wiki_path             TEXT,                          -- 取り込み元ページ
  synced_at             INTEGER,
  manual                INTEGER NOT NULL DEFAULT 0,    -- 1 = pr で手入力（Wiki に無い。次回の同期で消さない）
  last_used_campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  notes                 TEXT,
  outcomes              TEXT NOT NULL DEFAULT '[]',    -- JSON。Stage 08 が書く
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX contacts_chapter ON contacts (chapter_id, organization);
```

`status` の CHECK を SQL に置くのは「静かに不正値が入る」のを防ぐため。`kind` は集合が成長するので SQL の CHECK には
置かず、`kinds.ts` の `isScheduleKind()` で守り、`kinds.test.ts` が overview §4 の一覧と一致することを固定する。

### 3. Playbook の同梱（`app/features/playbook/`）

- `playbook.server.ts`: `import.meta.glob` で `../../../../skills/pr-playbook/{rules.json,constants.json}`（`eager`,
  `import: "default"`）と `guides/*.md`（`query: "?raw"`）を読み、`{ rules, constants, guides, version }` を返す。
  `version` は `vite.config.ts` の `define` で `__PLAYBOOK_VERSION__ = git -C ../../skills rev-parse HEAD` を埋める
  （`execFileSync`。サブモジュール未初期化なら**ビルドを失敗させる**。黙って空にしない）。
- `vite.config.ts` に `server.fs.allow: [repoRoot]` を足す（dev でモノレポ外ではないがアプリ root 外を読むため）。
- `constants.ts`: `constants.json` の型（`PlaybookConstants`）と `provisional` の取り出し。
- Stage 00 の検査器（`scripts/checks/*.mjs`）の import は **Stage 02 で**行う。本ステージは `rules` / `constants` / `guides` だけ。

### 4. feature の構成

```
app/features/
  auth/          roulette のコピー
  campaigns/     campaign.ts（型・slug 規則）、campaign.repository.server.ts、access.server.ts（チャプター所有）、
                 creation.server.ts、components/CampaignCard.tsx, StatusBadge.tsx
  briefs/        brief.ts（型 = brief.schema.json の TS 版、parseBrief()）、brief.repository.server.ts、
                 components/BriefForm.tsx（§5-2）
  schedule/      kinds.ts、item.ts、item.repository.server.ts、derive.ts（§4-1）、calendar.ts（週・月のバケット）、
                 components/Calendar.tsx, ItemForm.tsx, ItemRow.tsx
  contacts/      contact.ts、contact.repository.server.ts、components/ContactForm.tsx, ContactTable.tsx
  playbook/      §3
app/layouts/AppLayout.tsx     サインイン済みの共通シェル（roulette の AdminLayout を改名）
app/lib/use-hydrated.ts       roulette のコピー
```

#### 4-1. 派生アイテム（`schedule/derive.ts`）

純関数 `deriveItems(item, constants): DerivedItem[]`。Stage 00 のルール `REMIND-STAFF-BEFORE-POST` /
`SPEAKER-REQUEST-BEFORE-POST` / `SPEAKER-TIER-HIGH-NO-ASK` を**サーバ側で**実現する:

| 親 `kind` | 派生 | `due_at` | 備考 |
|---|---|---|---|
| `x_post`, `ig_post`, `live_post` | `staff_reminder` | 親 − `constants.reminders.staffOffsetMinutes` | `requires_approval = 0`（自動送信の可否は Stage 03 のキャンペーン設定） |
| `x_post` で `speaker_id` あり | `speaker_request` | 親 − `constants.reminders.speakerOffsetMinutes` | 登壇者の `tier = high` なら `note = "提案のみ（tier: high）"`、`requires_approval = 1`、`status = planned` のまま人が判断 |

派生は親の INSERT 時に同じ D1 batch で作る。親の `due_at` 変更で派生の `due_at` を追随させる（`offset_minutes` を保存しておく）。
親の削除は `ON DELETE CASCADE`。派生アイテムは手でも編集できるが、再派生はしない。

#### 4-2. Wiki からの告知先取り込み（`contacts/wiki-import.ts`、`contacts/wiki.server.ts`）

- `WIKI` binding に操作者の RP セッションのアクセストークンを Bearer で付け、`GET /api/agent/cat?path=<pages/…/告知対象ページ>` を呼ぶ
  （`apps/agent/src/features/inquiry/wiki.ts` の `wikiClient` と同じ形。pr 用に `app/features/contacts/wiki.server.ts` に薄く書く。
  サービストークンは使わない。**操作者が読める範囲だけ**を取り込む）。
- `wiki-import.ts` は純関数で Markdown を解析する: 「人別の告知対象」の `### <人名>` → `- 種別: 団体, 団体, …` を
  `{ wikiPerson, kind, organization }[]` に。`organization` は全角半角・空白・括弧を正規化したキー。
- 取り込みは upsert（`organization + wiki_person` で一致）。Wiki から消えた行は `manual = 0` なら削除、`manual = 1` は残す。
  `owner_user_id` は `campaign_members`（または accounts の表示名）と `wiki_person` の一致で埋め、無ければ画面で人が結ぶ。
- 同じ `organization` に複数の `wiki_person` がいれば画面で「重複連絡注意」を出す（Wiki の注意節と同じ）。
- pr から Wiki には**書かない**。結果の書き戻しは Stage 08 が提案文として出す。

### 5. 画面（`app/routes/`）

| URL | ファイル | 内容 |
|---|---|---|
| `/` | `routes/campaigns/home.tsx` | 自チャプターのキャンペーン一覧（`event_at` 昇順、`closed` は折りたたみ）+ 作成フォーム（name, slug, event_at, venue, budget） |
| `/c/:slug` | `routes/campaigns/overview.tsx` | brief の要約、直近 14 日のアイテム、status ごとの件数、Playbook バージョン、`provisional` な定数の一覧（警告） |
| `/c/:slug/brief` | `routes/briefs/edit.tsx` | §5-2 |
| `/c/:slug/schedule` | `routes/schedule/calendar.tsx` | 週 / 月のカレンダー、アイテムの追加・編集・status 変更・削除。派生アイテムは親の下にインデント表示 |
| `/c/:slug/settings` | `routes/campaigns/settings.tsx` | name / status / connpass_group_slug / connpass_event_id / budget。`tinyurl_campaign_id` は表示のみ（Stage 03 が書く） |
| `/contacts` | `routes/contacts/list.tsx` | 告知先の運用表。「Wiki から取り込む」ボタン（§4-2）、`organization` ごとの束ね、担当者の割り当て、手入力（`manual`） |
| `/c/:slug/members` | `routes/campaigns/members.tsx` | 共催チャプターの追加、メンバーと役割（`campaign_members`）。主催チャプターの organizer か lead だけが編集 |
| `/me` | `routes/me.tsx` | 自分が担当・レビュアーのアイテムを期限順に。レビュー待ち・期限切れ・`blocked_by` 未解消を分けて表示 |
| 認証系 | roulette と同じ | `signin`, `no-chapter`, `api/auth/*`, `auth/signout`, `dev/login` |

すべてのサインイン済み画面は `requireUserWithChapter` でゲートし、キャンペーンは **主催か共催のチャプター**（`campaign_chapters`）に
所属していれば見える（`campaigns/access.server.ts`）。共催チャプターの追加・brief・設定の編集は主催チャプターの organizer か
`roles` に `lead` を持つメンバー。スケジュールの編集はメンバー全員。super admin は全件。

#### 5-1b. スケジュールのアイテム

`ItemForm` は `kind` / `channel`（`constants.channelCatalog` の候補 + 自由入力）/ `due_at` / `title` / `assignee` / `reviewer` /
`session_id` / `speaker_id` / `blocked_by`（セッション確定・他アイテム完了・日付）を持つ。依頼系の kind（`community_ask` /
`org_outreach` / `sponsor_ask`）は `request_status` と `request_followup_at` を持ち、カレンダーには「返事待ち」バッジで出る。
`blocked_by` が未解消のアイテムは灰色で、Stage 02 以降の `post` ジョブはこれを積まない。

#### 5-2. brief の編集

`brief.schema.json` は配列（speakers / sessions / audienceSegments / connections）を含むので、フォームは 2 段構えにする。

- 上段: `event`（name / officialSeries / startAt / endAt / venue / format / fee / capacity / connpassUrl / hashtag / streamUrls）、
  `metaThemes`（3 行）、`goals.applications` と `goals.curve`（週次の目標曲線。行追加）、`budget.totalYen` / `printYen`、
  `skin`（bg / accent / textColor / tone / brandGuideUrl）、`copyConstraints` を通常のフォーム項目で
- 下段: `speakers` / `sessions`（`status` と `flags` の列付き）/ `audienceSegments` / `connections` / `novelty` / `constraints` /
  `preEvents` / `accounts` は行追加型のテーブル
- `sessions[].status` を `confirmed` に変えると、その `session_id` を `blocked_by` に持つアイテムの条件が解消される（保存時に再評価）
- 保存は `parseBrief()`（`briefs/brief.ts`）で検証し、不正なら項目ごとのエラーを返す。保存のたびに `briefs.version` を +1 し、
  `campaigns.event_at` / `venue` / `budget_total_yen` に写す
- `parseBrief()` の必須キーは `brief.schema.json` の `required` と一致させる。`brief.test.ts` が JSON Schema を読んで突合する

### 6. アーキテクチャテスト（`tests/architecture/`）

wiki の 4 本を allowlist 空でコピーし、workspace root の解決を `fileURLToPath(new URL("../../", import.meta.url))` にする。

- `layering.test.ts`: features → routes の import 禁止、`*.server.ts` のクライアント import 禁止、`app/lib/` は domain-free
- `file-size.test.ts`: 400 行上限
- `test-colocation.test.ts`: テストは被験対象の隣
- `route-urls.test.ts`: `app/routes.ts` の公開 URL 集合をスナップショットで固定（§5 の表）

### 7. 登録ポイント

| 場所 | 変更 |
|---|---|
| `.github/scripts/changed-workspaces.mjs` | `{ directory: "apps/pr", workspace: "@gdgjp/pr", build: true, e2e: true }` を追加 |
| `.github/workflows/ci.yml` | `Typecheck pr` / `Test pr` / `Build pr` の 3 ステップ（roulette の並びに倣う）、e2e マトリクスに `pr`、`apps/pr/.dev.vars` の生成ブロック（ポート 6191、`IDP_CLIENT_ID=pr`）、accounts の dev vars に `PR_CLIENT_ID=pr` / `PR_CLIENT_SECRET=ci-idp-client-secret`、**各ジョブの submodule 初期化に `skills` を追加**（`git submodule update --init packages/design-system skills`） |
| `.github/workflows/deploy.yml` | `Build, deploy, and migrate pr` ステップ、submodule 初期化に `skills` を追加 |
| `apps/accounts/wrangler.toml` | `PR_CLIENT_ID = "pr"`, `PR_REDIRECT_URLS = "https://pr.gdgs.jp/api/auth/callback/gdgjp"` |
| `apps/accounts/.dev.vars.example` | `PR_CLIENT_ID=pr`, `PR_CLIENT_SECRET=` |
| `apps/accounts/app/features/oauth/seed-clients.server.ts` | `apps` 配列に `["GDG Japan PR", env.PR_CLIENT_ID, env.PR_CLIENT_SECRET, env.PR_REDIRECT_URLS]` |
| `apps/accounts` | `cf-typegen` で `Env` を更新（生成物はコミットしない） |
| `CLAUDE.md`（根） | `apps/pr/` の段落を他アプリと同じ粒度で追加（relying party、chapter ゲート、D1 のみ、Playbook はサブモジュール同梱） |
| `apps/pr/CLAUDE.md`, `ARCHITECTURE.md`, `README.md` | roulette と同じ粒度。ARCHITECTURE は §4 の表 |

本番の secret は `wrangler secret put` で `RP_SESSION_SECRET` / `IDP_CLIENT_SECRET`（pr 側）と `PR_CLIENT_SECRET`（accounts 側）を
置き、accounts の `/admin/seed-clients` を再実行する。手順を `apps/pr/README.md` に書く。

### 制約

- **LLM を呼ばない、他アプリに書かない。** `agent_jobs` も書き込みの service binding も本ステージでは作らない。`WIKI` は読み取り専用で、
  `/api/agent/cat` と `/api/agent/search` 以外を呼ばない。理由: Stage 02 / 03 の担当で、境界を二重に守る。
- **告知先の正本は Wiki。** `contacts` に Wiki に無い情報を貯めない（`manual` は例外）。個人の連絡先を保存しない。理由: overview §12-15。
- **`schema.sql` は生成物。** `migrate:local` で更新し、手で編集しない。
- **`worker-configuration.d.ts` を手で編集しない。** `cf-typegen` で生成し、コミットしない。
- **Playbook を書き換えない。** `skills/pr-playbook` は読むだけ。足りない定数があれば Stage 00 の proposal に書く。
  理由: 正本は 1 つ。
- **`brief.schema.json` と `parseBrief()` を乖離させない。** テストで突合する。理由: Stage 02 以降、runner も同じスキーマで束を読む。
- **公開 URL は §5 の表どおり。** Stage 02 以降が `/c/:slug/drafts`、`/c/:slug/approvals`、`/admin/runner` を足す前提。
- `app/lib/` にドメインの型や DB アクセスを置かない（`use-hydrated.ts` だけ）。

## Files to touch — 変更ファイル

### `apps/pr/`（新規）

- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `react-router.config.ts`, `wrangler.toml`, `playwright.config.ts`,
  `.dev.vars.example`, `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`
- `workers/app.ts`
- `migrations/0001_init.sql`、`schema.sql`（生成）
- `app/{root.tsx,entry.server.tsx,app.css,routes.ts}`
- `app/features/auth/{auth.server.ts,chapter.server.ts,access.server.ts,return-to.ts}`
- `app/features/campaigns/{campaign.ts,slug.ts,slug.test.ts,campaign.repository.server.ts,access.server.ts,creation.server.ts,components/CampaignCard.tsx,components/StatusBadge.tsx}`
- `app/features/briefs/{brief.ts,brief.test.ts,brief.repository.server.ts,components/BriefForm.tsx}`
- `app/features/schedule/{kinds.ts,kinds.test.ts,item.ts,item.repository.server.ts,derive.ts,derive.test.ts,calendar.ts,calendar.test.ts,components/Calendar.tsx,components/ItemForm.tsx,components/ItemRow.tsx}`
- `app/features/contacts/{contact.ts,contact.repository.server.ts,wiki.server.ts,wiki-import.ts,wiki-import.test.ts,components/ContactForm.tsx,components/ContactTable.tsx,components/ImportButton.tsx}`
- `app/features/campaigns/{members.repository.server.ts,components/MembersTable.tsx}`、`app/features/schedule/blocked-by.ts`、`blocked-by.test.ts`
- `app/routes/campaigns/members.tsx`、`app/routes/me.tsx`、`fixtures/wiki/outreach-targets.md`（取り込みパーサの fixture。個人連絡先は含めない）
- `app/features/playbook/{playbook.server.ts,constants.ts,playbook.test.ts}`
- `app/layouts/AppLayout.tsx`, `app/lib/use-hydrated.ts`
- `app/routes/{signin.tsx,api.auth.$.ts,auth.signout.ts,dev.login.ts}`, `app/routes/auth/no-chapter.tsx`
- `app/routes/campaigns/{home.tsx,overview.tsx,settings.tsx}`, `app/routes/briefs/edit.tsx`, `app/routes/schedule/calendar.tsx`, `app/routes/contacts/list.tsx`
- `tests/architecture/{layering,file-size,test-colocation,route-urls}.test.ts`
- `e2e/{global-setup.ts,campaigns.spec.ts}`

### モノレポ

- `.github/scripts/changed-workspaces.mjs`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- `apps/accounts/wrangler.toml`, `apps/accounts/.dev.vars.example`, `apps/accounts/app/features/oauth/seed-clients.server.ts`
- `CLAUDE.md`

## Verification — 完了条件と検証

### 完了条件

1. `pnpm --filter @gdgjp/pr typecheck && test && build` が通り、`pnpm ci:quick` が通る。
2. ローカルで dev login → キャンペーン作成（共催チャプターを 1 つ追加）→ brief 保存（version 1, 2）→ `x_post` を `speaker_id` 付きで追加 →
   `staff_reminder`（−60 分）と `speaker_request`（−180 分）が派生し、カレンダーに親子で出る。共催チャプターのユーザーでも見える。
2b. `/contacts` で「Wiki から取り込む」→ 告知先が `organization` ごとに並び、同じ団体に 2 人付いている行に注意バッジが出る。
2c. `sessions[].status = tba` のセッション紹介アイテムが灰色（`blocked_by` 未解消）で、`confirmed` にすると解消される。
3. `tier: high` の登壇者の `speaker_request` に「提案のみ」の note が付く。
4. `pnpm --filter @gdgjp/pr build` が、`skills` サブモジュール未初期化だと `PLAYBOOK_VERSION` の解決で**失敗する**。
5. `node .github/scripts/changed-workspaces.mjs --all` の出力に `@gdgjp/pr` が入る。
6. accounts をローカルで起動し `/admin/seed-clients` を実行すると `pr` クライアントが書かれる。

### コマンド

```sh
git submodule update --init packages/design-system skills
pnpm install
pnpm --filter @gdgjp/pr migrate:local
pnpm --filter @gdgjp/pr typecheck
pnpm --filter @gdgjp/pr test
pnpm --filter @gdgjp/pr build
pnpm --filter @gdgjp/pr test:e2e
pnpm --filter @gdgjp/accounts cf-typegen
node .github/scripts/changed-workspaces.mjs --all | grep '@gdgjp/pr'
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`kinds.test.ts`: `kinds.ts` の集合が overview §4 の一覧と一致**（kind を足し忘れると Stage 02 の `plan` ジョブの出力が
  `isScheduleKind()` で落ちる）
- **`derive.test.ts`: 親の `due_at` を変えると派生の `due_at` が `offset_minutes` ぶんずれて追随し、派生の `offset_minutes` は変わらない**
- **`derive.test.ts`: `tier: high` の登壇者で `speaker_request` が `requires_approval = 1` のまま、note が付く**（静かに依頼が出る経路）
- **`brief.test.ts`: `brief.schema.json` の `required` と `parseBrief()` の必須キーが一致**（スキーマだけ更新して TS を忘れる経路）
- **`playbook.test.ts`: `rules.json` の `scope` に出てくる `draft.<kind>` が `kinds.ts` か drafts の種別として既知**（Stage 02 以降で未知の
  scope が無視される経路）
- **`route-urls.test.ts`: 公開 URL の集合**
- **`campaigns/access.server.test.ts`: 主催にも共催にも属さないチャプターのキャンペーンは 404。共催のメンバーは見えるが brief は編集できない**
- **`wiki-import.test.ts`: 人別見出しと種別行の解析、`organization` の正規化（全角括弧・空白）、Wiki から消えた行の削除と `manual` の保持**
- **`wiki-import.test.ts`: 取り込み結果にメールアドレスや電話番号が含まれない**（Wiki は非掲載だが、万一含まれても落とす）
- **`blocked-by.test.ts`: `session:<id>:confirmed` が brief の保存で解消される。未知の条件は解消されない（黙って解放しない）**

### 手動 E2E

1. `pnpm --filter @gdgjp/accounts dev`（:5173）と `pnpm --filter @gdgjp/pr dev`（:5191）を起動。
2. `http://localhost:5191/dev/login` でサインイン（チャプター付き）。
3. `/` でキャンペーン `devfest-kansai-2026` を作る。
4. `/c/devfest-kansai-2026/brief` に Stage 00 の `examples/briefs/devfest-kansai-2026.json` の内容を入れて保存。version が 1 になる。
5. `/c/devfest-kansai-2026/schedule` で `x_post`（登壇者あり、翌週の平日 17:30）を追加。派生 2 件を確認。
6. 親の時刻を 18:00 に変えて、派生が追随することを確認。
7. `/contacts` に 1 件追加し、別チャプターのユーザーで見えないことを確認。
