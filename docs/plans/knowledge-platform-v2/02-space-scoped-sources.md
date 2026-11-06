# Stage 02 — Space-scoped sources: R2 再配置・audience メタデータ・Discord サーバ単位ソース・ジョブ投入

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 03 の AI Search は R2 の prefix（`spaces/<id>/**`）でインスタンスを分け、オブジェクトの
カスタムメタデータ `audience` で黒塗りをフィルタする。そのため raw の置き場所とメタデータを
揃える必要がある。同時に v1 で不便だった 2 点を直す。

- Discord ソースがチャンネル単位（`discord-channel`）で、新チャンネルを拾えず、サーバ全体を一括管理できない。
- `sources.status = 'ready'` が「fetch 済み」しか意味せず、ページに統合されたかが分からない（`00-overview.md` §1-1）。

そして v2 の自動更新の起点となる **`agent_jobs` テーブル**を作り、raw が変わったら `synthesize`
ジョブを積む。ジョブを消費する runner は Stage 04。

### 依存と対象範囲

- 依存: Stage 01（`sources.space_id`）。
- 対象ワークスペースは `apps/wiki/` のみ。
- Stage 03 が R2 レイアウトと `audience` に、Stage 04 が `agent_jobs` と `last_integrated_at` に依存する。

### 読むべきもの

- `apps/wiki/workers/features/sources/README.md` — DO alarm 連鎖とドライバ構成
- `apps/wiki/workers/features/sources/import/discord/*.ts` — 現行 Discord ドライバの 4 フェーズ
- `apps/wiki/workers/features/sources/import/do-store.ts` — DO ローカル SQLite のカーソル保存
- `apps/wiki/app/features/discord/README.md`、`app/routes/api/discord/guild-channels.ts` — 既にカテゴリ別にチャンネルを列挙している
- `docs/plans/01-sources-raw-layer.md` — raw レイヤの当初設計と既知の divergence
- `docs/plans/09-source-visibility-acl.md` §1 — `visibility` と `chapter_id` の対応（`audience` キーの元）

### 再利用する既存実装（書き直さない）

- `workers/features/sources/import/run.ts` / `tick.ts` — `ImportKindDriver` 契約と alarm ループ。新ドライバはこれに登録するだけ
- `workers/features/sources/import/discord/{listing,attachments,finalize}.ts` — メッセージ取得・添付・グルーピング。チャンネル単位の処理関数として **そのまま呼ぶ**
- `workers/features/sources/subrequest-budget.ts` — 1 tick あたりの subrequest 予算
- `app/features/discord/api.server.ts` の `listGuildChannels` / `groupDiscordChannelsByCategory`
- `workers/features/sources/persist.ts` — `source_documents` upsert と `content_hash` 比較。**ここがジョブ投入点になる**
- `@gdgjp/gdg-lib/acl` の `sourceAudienceKey` — ソース行から audience キー（`member` / `organizer` / `chapter-member:<id>` / `chapter-organizer:<id>` / `private:<userId>`）を作る。**自前で文字列を組まない**

## Design — 設計

### 1. R2 レイアウトとメタデータ

| 旧 | 新 |
|---|---|
| `raw/<sourceId>/<path>` | `spaces/<spaceId>/raw/<sourceId>/<path>` |
| （ページのミラーは無い） | `spaces/<spaceId>/pages/<slug>.md`、`spaces/<spaceId>/acl/<audienceKey>/<slug>.md` — **Stage 03 が書く**。本ステージは prefix 規約だけ決める |

`workers/features/sources/persist.ts` の R2 キー生成を `rawObjectKey(spaceId, sourceId, path)` に
集約し、`source_documents.r2_key` は引き続き実キーを持つ。移行は一括コピーではなく
**次回 fetch 時に新キーへ書き、旧キーは Stage 07 で削除**する。すべてのソースを 1 回 `refresh` する
管理操作 `/api/admin/refresh-all-sources` を追加し、移行完了を `r2_key LIKE 'spaces/%'` の件数で確認する。

R2 書き込み時にカスタムメタデータを付ける（5 枠。Stage 03 の AI Search が読む）。

```ts
customMetadata: {
  layer: "raw",
  audience: sourceAudienceKey(source),   // ソースの visibility から。private は "private:<addedBy>"
  source_id: sourceId,
  page_type: "",
  lang,
}
```

`audience` はソースの `visibility` / `chapter_id` / `added_by` が変わったら **全文書を再書き込み**する
（`updateSourceVisibility` の成功時に `refresh` を予約する）。メタデータだけ古いと、権限を狭めた後も
旧 audience で検索に出続ける。

### 2. Discord サーバ単位ソース

新しい `sources.kind = 'discord-guild'`。`external_id` = guild snowflake。`sources.config`（TEXT JSON、新列）に選択規則を持つ。

```ts
type DiscordGuildConfig = {
  include: { categories: string[]; channels: string[] };  // どちらかに当たれば対象
  exclude: { channels: string[] };
  autoDiscover: boolean;   // include.categories 配下の新チャンネルを次回 tick で追加
};
```

ドライバ `import/discord-guild/phases.ts` のフェーズ: `discover`（チャンネル列挙 → 対象集合を DO ローカルに保存）→ `channels`（対象チャンネルを 1 tick に N 本ずつ既存の `listing` → `attachments` → `grouping` を回す。チャンネルごとのカーソルは `do-store.ts`）→ `finalizing`。
`source_documents.path` は `channels/<categorySlug>/<channelSlug>/<yyyy-mm>.md` とし、チャンネル単位ソースの出力形式（日付でのグルーピング）は踏襲する。

1 サーバ = 1 `visibility`。カテゴリごとに権限を分けたい場合は別ソースとして登録する（スパンの単位がソースなので、ソースを分けるのが唯一の方法）。登録フォームにその旨を表示する。

`/s/:slug/sources` の登録フォームは「Discord サーバ」を選ぶとサーバ → カテゴリ・チャンネルのチェックリスト（`guild-channels.ts` の結果）を出す。既存の `discord-channel` ソースは残して読めるが、新規登録は `discord-guild` のみにする。`refresh_policy` に `hourly` を追加し、cron を `0 * * * *` に 1 本足す。

### 2-b. ソース種別レジストリ — 種別の分岐を 2 箇所に閉じる

取得の実行は `ImportKindDriver`（`phases` / `step` / `complete`、`tick.ts` に登録）に閉じていて、
Drive / Chat / Discord / Web のどれも `persistSourceDocument()` を通って `source_documents` 行 + R2 オブジェクトになる。
そこから先（`audience` メタデータ、AI Search、`synthesize` ジョブ）は種別を知らない。**ここは変えない。**

一方、「種別ごとに何ができるか」の知識はドライバの外に散っている。実測（`kind ===` / `kind !==` でソース種別
リテラルを比較している箇所。`operation.kind` や zip の `entry.kind` のような別概念の `kind` は除く）:

| ファイル | 分岐の内容 | 置き換え先 |
|---|---|---|
| `workers/features/sources/fetch-source.ts` | 取得できる種別の許可リスト（6 種を列挙）、cron から `conversation` を除外 | `SOURCE_KINDS[kind].driver !== null` |
| `workers/features/sources/import/run.ts` `driverKindForSource` | Docs / Sheets / Slides → `google-drive` の畳み込み | `SOURCE_KINDS[kind].driver` |
| `app/features/sources/create.server.ts` | 入力種別で `classifyGoogleChatSpace` / `classifyDiscordChannel` / `classifySourceUrl` を選ぶ、`provisionalTitle` の種別分岐 | `REGISTRATIONS[registration].classify()`、`SOURCE_KINDS[kind].provisionalTitle()` |
| `app/features/sources/classify.ts` | URL → 種別の判定（Drive / Forms / その他） | `url` registration の `classify` の中身として移動（公開関数は `classifyCandidate` 1 本） |
| `app/features/sources/lifecycle.server.ts` | `conversation` は refresh 不可（2 箇所） | `SOURCE_KINDS[kind].refreshable` |
| `app/routes/api/sources/refresh.ts` | 同上 | 同上（`enqueueSourceRefresh` に一本化し、ルート側の分岐は消す） |
| `app/features/sources/staged-candidates.ts` | ステージング候補の JSON 検証を候補種別ごとに書き分け | `REGISTRATIONS[registration].parseCandidate()` |
| `app/features/sources/sources-page.server.ts` | 候補種別ごとに `createSource` の引数を組み替え | 候補 → `CreateSourceInput` の変換を `REGISTRATIONS[registration].toCreateInput()` に |
| `app/routes/sources/_components/use-source-staging.ts` | 登録済み判定のキー接頭辞（`chat:` / `discord:` / `drive:`）、候補種別で ID を集める | `SOURCE_KINDS[kind].candidateId(externalId)` |
| `app/routes/sources/_components/StagedCandidateList.tsx` | 候補種別ごとの表示（アイコン・補助テキスト） | `REGISTRATIONS[registration].CandidateRow` コンポーネント |
| `app/routes/sources/_components/AddSourceSection.tsx` | `url` 候補だけ URL 妥当性を見る | `REGISTRATIONS[registration].validate()` |

11 箇所、2 つの概念が混ざっている: **保存される種別** `SourceKind`（9 値）と **登録の入口** `StagedSource.kind`
（`url` / `google-drive` / `google-chat-space` / `discord-channel`）。後者は前者と 1 対 1 ではない（`url` → `website`、
`google-drive` → `google-doc|sheet|slides`）。この 2 つを明示的に分けて、それぞれ 1 表にする。

`app/features/sources/kinds.ts`（新規）:

```ts
export interface SourceKindSpec {
  kind: SourceKind;
  driver: SourceImportKind | null;         // null = リモート取得なし（upload / text / conversation）
  refreshable: boolean;                    // driver !== null と同値だが、意図を名前で持つ
  candidateId(externalId: string): string; // use-source-staging の登録済み判定キー
  provisionalTitle(c: ClassifiedSource): string;
  rawPath(doc): string;                    // R2 raw 配下の相対パス規則（§1）
  labelKey: string;                        // i18n
}
export const SOURCE_KINDS: Record<SourceKind, SourceKindSpec>;

export type RegistrationKind = "url" | "google-drive" | "google-chat-space" | "discord-channel" | "discord-guild";
export interface RegistrationSpec {
  registration: RegistrationKind;
  parseCandidate(raw: Record<string, unknown>): StagedSource | null;   // staged-candidates
  validate(c: StagedSource): string | null;                            // AddSourceSection
  classify(c: StagedSource): ClassifiedSource;                         // create.server
  toCreateInput(c: StagedSource): CreateSourceInput;                   // sources-page
  CandidateRow: React.ComponentType<{ candidate: StagedSource }>;      // StagedCandidateList（別ファイル kinds/<registration>.tsx）
  labelKey: string;
}
export const REGISTRATIONS: Record<RegistrationKind, RegistrationSpec>;
```

- 上の表の 11 箇所を **すべて**この 2 表経由に書き換える。残す分岐は `kinds.ts` / `kinds/<registration>.tsx` と `import/<kind>/` だけ。
- `discord-guild` は `RegistrationKind` と `SourceKind` の両方に 1 行足すだけで、UI・cron・API に差分が出ないことを本ステージの完了条件にする（§2 のドライバ本体は別）。
- `architecture` テスト `tests/architecture/source-kind-branches.test.ts`（新規）: `app/` と `workers/` の TS/TSX を走査し、
  `SourceKind` ∪ `RegistrationKind` のリテラルを `===` / `!==` / `case` で比較している行があれば、そのファイルが
  `app/features/sources/kinds.ts`、`app/features/sources/kinds/`、`workers/features/sources/import/<kind>/` のいずれかでない限り fail。
  **許可リストは持たない**（残す分岐は上の 3 箇所しかない）。
- `fetch-source.ts` の `conversation` 除外や `lifecycle.server.ts` の 409 は挙動を変えない（`refreshable: false` が同じ結果を返す）。既存テストはそのまま通ること。

人間が wiki で書くページはこのレジストリに乗らない。ソースではなく `pages`（`origin: human`）で、統合ではクローン内の
既存ページとして、検索では `pages/` レイヤーとして扱う（Stage 03 / 04）。

### 3. ジョブテーブルと統合済み時刻

```sql
CREATE TABLE "agent_jobs" (
  "id"           TEXT PRIMARY KEY,
  "type"         TEXT NOT NULL CHECK ("type" IN ('synthesize','answer','consolidate','translate')),
  "space_id"     TEXT NOT NULL REFERENCES "spaces"("id"),
  "status"       TEXT NOT NULL CHECK ("status" IN ('queued','leased','succeeded','failed','needs_review','expired')),
  "priority"     INTEGER NOT NULL DEFAULT 0,          -- answer = 10, synthesize = 0, consolidate = -10
  "payload"      TEXT NOT NULL DEFAULT '{}',          -- JSON。synthesize: { sourceIds, documentIds, requests? }（requests は Stage 04 §3-4 の「エージェントに依頼」）
  "result"       TEXT,                                -- JSON
  "error"        TEXT,
  "lease_owner"  TEXT, "lease_until" INTEGER,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "deadline_at"  INTEGER,                             -- answer のみ。超過で expired
  "created_at"   INTEGER NOT NULL DEFAULT (unixepoch()),
  "started_at"   INTEGER, "finished_at" INTEGER
);
CREATE INDEX "idx_agent_jobs_queue" ON "agent_jobs" ("status", "priority" DESC, "created_at");
```

`sources` に `last_integrated_at INTEGER`、`source_documents` に `integrated_hash TEXT` を追加する。

- `persist.ts` が `content_hash` の変化を検出した時点で `enqueueSynthesize(db, { spaceId, sourceId, documentIds, requests? })` を呼ぶ（`app/features/jobs/enqueue.server.ts`、新規）。**同スペースの `queued` な `synthesize` が既にあれば、その `payload.sourceIds` / `documentIds` / `requests` に合流**する（1 スペース = 1 クローンで統合するので、ジョブもスペース単位に束ねる）。`leased` 中なら新規に積む。**同スペースの `synthesize` は 1 時間に 1 本まで**（直前の `succeeded` から 60 分以内は `queued` 行の `run_after` を繰り下げる）。Discord の `hourly` refresh が 1 日 24 本の統合を起こすと個人 Pro の 5 時間枠（`00-overview.md` §8-3）を食い尽くすため。手動の「今すぐ統合」はこの制限を外す。
- `/s/:slug/sources` の一覧に「取得」「統合」の 2 列を出し、`integrated_hash != content_hash` の文書数を未統合として表示する。スペースの `queued` / `leased` ジョブ数と最古の `created_at` も出す。
- 統合が 24 時間以上滞っているソースは一覧の先頭に警告バッジ。

Cloudflare Queues ではなく D1 に置く理由: VM が pull する（Queues の push コンシューマは Worker 限定）、
合流とステータス表示に行が要る、件数が小さい（日に数十）。

### 制約

- `ImportKindDriver` の契約（`phases` / `step` / `complete`）と `tick.ts` の alarm ループは変えない。新ドライバを足すだけ。
- 種別の分岐は `kinds.ts` / `kinds/` と `import/<kind>/` にだけ書く（§2-b）。11 箇所の既存分岐を残したまま `discord-guild` を足さない。
- `discord-channel` ドライバは削除しない（既存行の refresh が動き続ける）。削除は Stage 07。
- R2 の旧キーを本ステージで消さない。`source_documents.r2_key` が正本。
- `audience` の値は必ず `sourceAudienceKey` から作る。別の文字列化を書くと Stage 03 のフィルタと食い違い、黒塗りが漏れる。
- `agent_jobs` への書き込みは `app/features/jobs/` の関数経由のみ（Stage 04 の `/api/runner/*` も同じ関数を使う）。

## Files to touch — 変更ファイル

### `apps/wiki/`

- `wrangler.toml` — cron `0 * * * *`。変更後 `cf-typegen`
- `migrations/00NN_sources_v2.sql`（新規）— `sources.config`、`sources.last_integrated_at`、`source_documents.integrated_hash`、CHECK に `discord-guild` と `hourly`、`agent_jobs`
- `app/db/schema/sources.ts`、`app/db/schema/jobs.ts`（新規）、`app/db/schema/index.ts`
- `app/features/jobs/`（新規）— `enqueue.server.ts`、`shared.ts`（型・payload スキーマ）、`*.test.ts`、`README.md`
- `app/features/sources/kinds.ts`（新規、`SOURCE_KINDS` / `REGISTRATIONS`）、`app/features/sources/kinds/{url,google-drive,google-chat-space,discord-channel,discord-guild}.tsx`（新規、`CandidateRow` と各 registration の関数）、`tests/architecture/source-kind-branches.test.ts`（新規）
- 分岐を消す側: `app/features/sources/{create.server,classify,lifecycle.server,sources-page.server,staged-candidates}.ts`、`app/routes/api/sources/refresh.ts`、`app/routes/sources/_components/{AddSourceSection,StagedCandidateList}.tsx`、`use-source-staging.ts`
- `app/features/sources/shared.ts`（`SourceKind` / `SourceRefreshPolicy` / `DiscordGuildConfig`）、`create.server.ts`、`sources.server.ts`（`updateSourceVisibility` → refresh 予約）、`sources-page.server.ts`、`components/`（ギルド選択 UI、取得/統合列、ジョブ滞留表示）
- `workers/features/sources/persist.ts`（`rawObjectKey`、カスタムメタデータ、`enqueueSynthesize`）
- `workers/features/sources/fetch-source.ts`、`import/run.ts`（許可リストと `driverKindForSource` を `SOURCE_KINDS` に委譲、`hourly` 判定）
- `workers/features/sources/import/discord-guild/`（新規: `phases.ts`、`discover.ts`、`shared.ts`、テスト）
- `workers/features/sources/import/tick.ts`（ドライバ登録）
- `workers/app.ts`（cron 分岐）
- `app/routes/api/admin/refresh-all-sources.ts`（新規）
- `ARCHITECTURE.md` の DB スキーマ表

## Verification — 完了条件と検証

### 完了条件

- 新規 fetch の raw が `spaces/<spaceId>/raw/...` に書かれ、`customMetadata.audience` がソースの visibility と一致する。
- `discord-guild` ソースを 1 件登録し、include したカテゴリ配下の全チャンネルが `channels/<cat>/<ch>/<yyyy-mm>.md` として `source_documents` に入る。カテゴリに新チャンネルを作って refresh すると自動で増える。
- `content_hash` が変わった文書について `agent_jobs` に `synthesize` 行ができ、同スペースの 2 件目は合流する。
- `/s/<slug>/sources` に未統合文書数とジョブ滞留が出る。
- `source-kind-branches.test.ts` が通る（`kinds.ts` / `kinds/` / `import/<kind>/` 以外にソース種別の分岐が無い）。

### コマンド

```sh
pnpm --filter @gdgjp/wiki cf-typegen
pnpm --filter @gdgjp/wiki migrate:local
pnpm --filter @gdgjp/wiki test
pnpm --filter @gdgjp/wiki test:e2e
```

### 回帰として固定すべきテスト

- **`content_hash` が変わらない再 fetch では `agent_jobs` に積まない**（`persist.test.ts`）。
- **visibility 変更後の再書き込みで `audience` が更新される** — 更新されないと権限を狭めた後も旧 audience で検索に出る（静かに漏れる）。
- **`exclude.channels` のチャンネルは `autoDiscover` でも復活しない**。
- **1 tick の subrequest 予算を超えるチャンネル数でも alarm 連鎖で完走する**。
- **`discord-channel` の既存ソースの refresh が引き続き成功する**。
- **`queued` への合流は同スペースのみ** — 別スペースのジョブに `documentIds` が混ざらない（混ざると別スペースのクローンに raw が入る）。

### 手動 E2E

1. Discord を連携し、`/s/gdg-jp/sources` で「Discord サーバ」を選び、1 カテゴリを include して `organizer` で登録。
2. 一覧で「取得」が進み `ready` になる。R2 のオブジェクトに `audience: organizer` が付いている。
3. visibility を `member` に変更。refresh 後、`audience: member` に変わる。
4. `/api/admin/refresh-all-sources` を叩き、`r2_key LIKE 'spaces/%'` の件数が全文書数に一致するまで進む。
