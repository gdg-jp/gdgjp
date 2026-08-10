# Chat sender placeholder — Worker 側で名前を焼き込むのをやめる

> Generated from Claude Code plan: `/Users/hari/proj/gdgjp/.claude/worktrees/wiki-layer-agents-design-6075f9/docs/plans/07-chat-sender-placeholder-worker.md`

## Goal

Chat sender placeholder — Worker 側で名前を焼き込むのをやめる

## Repo context

対象ワークスペースは `wiki/` のみ。Go CLI (`cli/`) は触らない。
3 段構成の 2 段目。**先行して `docs/plans/06-chat-sender-samples-hotfix.md` が
マージされている前提**で書かれている。06 は `captureChatSenderData` を有界にする止血で、
この段はその構造そのものを置き換える。

後続の `docs/plans/08-chat-sender-cli-resolution.md`（Go CLI 側）とこの段で 1 コミットを成す。
**この段だけを本番に出すと、クローンの Markdown から表示名が消える期間ができる**ため、
08 と一緒にリリースすること。

### なぜやるか

06 で止血した `captureChatSenderData` は「1 週ごとに D1 へ書く」構造自体が残っており、
書き込み量は依然としてメッセージ数に比例する。同じ feature にはまだ顕在化していない
地雷が 2 つある。

- `google_chat_document_renders.render_data` に **週まるごとのメッセージ JSON** を D1 の TEXT で
  保存している (`wiki/app/db/schema.ts:575`)。週あたり 1 行、行サイズは無制限。
- `rewriteChatSenderDocuments` (`wiki/workers/features/sources/chat-sender-registry.ts:149`) が
  `save-chat-sender` action の **リクエスト処理中に同期実行**され、全 render 行と全 Chat ドキュメントを
  R2 から読み直す。ページネーションも budget もない。

どちらも「表示名を Markdown に焼き込んでいる」ことが原因。焼き込むから、
名前を変えたときに全ドキュメントを再レンダリングする必要があり、そのために元データを
D1 に溜め込む必要が出ている。

### 設計上の当たり（調査済み）

- `stepSenders` (`wiki/workers/features/sources/google-chat-import.ts:246`) は
  **現状ログを出すだけの no-op**。flush の置き場所として空いている。
- **DO ローカル SQLite は subrequest budget を消費しない**
  (`wiki/workers/features/sources/subrequest-budget.ts:9` のコメント)。
  `indexMessage` (`google-chat-import.ts:149`) は既に全メッセージを走査して
  DO ローカルの `senders` テーブルを書いている。サンプル収集はここに相乗りできる。
- raw Markdown の読み手は **CLI の content endpoint 1 箇所だけ**
  (`wiki/app/routes/api.cli.wiki.sources.$documentId.content.ts:178`)。
  wiki generation (`wiki/workers/features/ingestion/`) も AI search も `source_documents` を読まない。
  後者は `wiki/app/features/ai-search/sources-exclusion.test.ts:10` のテストで固定されている。

### 読むべきもの

- `wiki/CLAUDE.md`（Worker の 3 ハンドラ、bindings、Drizzle と migration の扱い）
- `wiki/workers/features/sources/import/do-store.ts`（DO ローカルスキーマ、81 行）
- `wiki/workers/features/sources/google-chat-import.ts` の `indexMessage` / `stepIndexing` /
  `stepSenders` / `stepFinalizing`
- `wiki/workers/features/sources/import/tick.ts` の `advanceSourceImportTick`（phase 駆動）

### 再利用する既存実装

- `wiki/workers/features/sources/import/do-store.ts` の `ensureSourceImportDoSchema`
  — DO ローカルテーブルはここに足す。別ファイルを作らない
- `google-chat-import.ts` の `metaSet` / `metaGet` — tick をまたぐ再開カーソル。
  `stepListing` / `stepIndexing` が既にこのパターンを使っている。**同じ書き方に揃える**
- `wiki/workers/features/sources/google-chat.ts:179` の `defaultSenderName`
  — プレースホルダ生成はこれが既にやっている
- `wiki/app/routes.ts:55-59` の CLI ルート群と `getCliIdentity` — 新エンドポイントの認証はこれに合わせる

## Acceptance criteria

### 1. import は表示名を焼き込まない

`wiki/workers/features/sources/google-chat-import.ts` の `stepFinalizing`。

534-541 行目の `googleChatSenderProfiles` の select を削除し、`resolveSenderName` を
DO ローカル `senders`（BOT 判定のみ）+ `defaultSenderName` に戻す。
結果、見出しは人間の送信者なら `### [time] Unknown user (users/123)`、BOT なら `Bot` になる。

**プレースホルダのリテラルは現行の `Unknown user (users/123)` をそのまま正式仕様とする。**
新しいトークンに変えると既存の全ドキュメントの `content_hash` が変わり、
全クローンで再ダウンロードと再 ingest が走るため。

**既に実名が焼き込まれている過去のドキュメントはそのまま放置する。** 表示は正しいままで、
次回のフル import でプレースホルダに収束する。移行スクリプトは書かない。

### 2. サンプル収集を DO ローカル SQLite に移す

`wiki/workers/features/sources/import/do-store.ts` の `ensureSourceImportDoSchema` にテーブルを足す。

```sql
CREATE TABLE IF NOT EXISTS sender_samples (
  resource_name TEXT NOT NULL,
  message_name  TEXT NOT NULL,
  create_time   TEXT NOT NULL,
  message_text  TEXT NOT NULL,
  PRIMARY KEY (resource_name, message_name)
);
```

`indexMessage` (`google-chat-import.ts:149`) が `senders` を書いている箇所（168-179 行目）の隣で、

- 本文（`message.text ?? message.argumentText`、trim 後に空でないもの）を upsert する。
- 送信者ごとに `create_time` 降順で 10 件を超えた分をその場で削除する。
  DO ローカルなので budget も bind parameter 上限も関係ない。
  ここでも 06 と同じ「`id NOT IN (SELECT ... LIMIT 10)`」形にしてパラメータ数を固定する。

### 3. `stepSenders` を flush 実装にする

no-op の `stepSenders`（246-261 行目）に処理を入れる。既存のログ出力は残す。

1. `googleChatSenderProfiles` を 1 回 select する（送信者あたり 1 行の小さなテーブル、1 subrequest）。
2. profile が既にある送信者を除外する。
3. 残りを `db.batch()` で D1 の `google_chat_sender_samples` に書く。
   送信者ごとの prune 文（06 で導入したパラメータ固定の `NOT IN` 形）を同じ batch に含める。
4. batch は固定サイズ（送信者 20 人ぶん程度）で分割し、**1 バッチ = `budget.spend(1)`**。
5. 進捗を `metaSet` のカーソルに持たせ、**alarm tick をまたいで再開可能**にする。
   `stepListing` / `stepIndexing` のカーソルの書き方に揃える。

これで import 全体の D1 書き込みが O(メッセージ数) から O(未設定送信者数) になる。

### 4. render data と再レンダリングを削除する

`wiki/workers/features/sources/chat-sender-registry.ts`

- `rewriteChatSenderDocuments`(149)、`renderMarkdown`(114)、legacy backfill パス(188-219) を削除する。
- `saveChatSenderName`(222) は `googleChatSenderProfiles` の upsert だけにする。
- `captureChatSenderData` 自体を削除する。手順 2-3 が置き換える。
  `wiki/workers/features/sources/google-chat-import.ts:632-641` の呼び出しも消える。
- `google_chat_document_renders` を drop する migration を追加する（番号は既存の最大値 +1）。
  `wiki/app/db/schema.ts:575` の `googleChatDocumentRenders` 定義と、
  `wiki/workers/features/sources/test-db.ts` の登録も消す。

`isChatSenderResourceName`(22) は `sources.tsx` の action が使っているので**残す**。

`save-chat-sender` の認可（`wiki/app/routes/sources.tsx:283-291`）は samples 経由の join のままでよい。
samples テーブルは残り、書かれ方が変わるだけ。

### 5. sender マップを配る CLI エンドポイント

`wiki/app/routes/api.cli.wiki.chat-senders.ts` を新設し、`wiki/app/routes.ts:55-59` の
既存 CLI ルート群の隣に登録する。認証は兄弟ルートと同じ `getCliIdentity(request, env)`。

```json
{ "senders": [{ "resourceName": "users/123", "displayName": "..." }] }
```

これを 08 の Go CLI が読む。**この段では CLI 側は実装しない。**

### 制約

- **`wiki/schema.sql` は生成物。手で編集せず `pnpm --filter @gdgjp/wiki migrate:local` で更新する。**
- migration は手書き SQL。Drizzle の generate は使わない。
- **`cli/` を触らない。** 置換ロジックと `raw.go` の変更は 08 の担当。
  ここで先回りして Go を書くと 08 と衝突する。
- **プレースホルダのリテラル `Unknown user (users/123)` を変えない。** 理由は手順 1 のとおり
  content hash の全面変更を避けるため。`defaultSenderName` の出力形式も変えない。
- **`source_documents` の読み手を増やさない。** wiki generation と AI search が
  raw layer を読まないことは `wiki/app/features/ai-search/sources-exclusion.test.ts` で
  固定されている。この不変条件を壊さない。
- DO ローカル SQLite の操作で `budget.spend()` を呼ばない。消費しないのが前提。
  逆に D1 / R2 / fetch は必ず `spend()` を通す。

## Files to touch

### wiki/ — import 側

- `wiki/workers/features/sources/import/do-store.ts` — `sender_samples` テーブル追加
- `wiki/workers/features/sources/google-chat-import.ts` — `indexMessage` / `stepSenders` /
  `stepFinalizing`
- `wiki/workers/features/sources/chat-sender-registry.ts` — 大幅削除
- `wiki/workers/features/sources/test-db.ts` — 削除テーブルの登録解除

### wiki/ — スキーマ

- `wiki/app/db/schema.ts` — `googleChatDocumentRenders` 削除
- `wiki/migrations/00NN_drop_google_chat_document_renders.sql`（新規、番号は最大値 +1）
- `wiki/schema.sql` — `migrate:local` による再生成のみ

### wiki/ — API

- `wiki/app/routes/api.cli.wiki.chat-senders.ts`（新規）
- `wiki/app/routes.ts` — ルート登録

### wiki/ — テスト

- `wiki/workers/features/sources/google-chat-import.test.ts`

## How to verify

### 完了条件

- import が生成する Markdown の見出しが、profile の有無に関わらず
  `### [time] Unknown user (users/123)` のままである。
- import 全体の D1 書き込み回数が送信者数のオーダーで、メッセージ数に比例しない。
- `google_chat_document_renders` テーブルとその参照コードがリポジトリから消えている。
- sender 名の保存が D1 の upsert 1 回で終わり、R2 への書き込みが 0 回である。
- `GET /api/cli/wiki/chat-senders` が Bearer トークンで sender マップを返す。

### コマンド

```bash
pnpm --filter @gdgjp/wiki migrate:local
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト

`wiki/workers/features/sources/google-chat-import.test.ts` に追加する。

- **profile が設定済みの送信者がいても、生成 Markdown にはプレースホルダが入る。**
  既存の 528 行目「identity API を呼ばず sender resource ID を保持する」テストの隣に置く。
- **1 送信者 300 通の import で、D1 への sample 書き込みが定数回に収まる。**
  メッセージ数に比例して増える実装に戻ると静かに本番だけ落ちるため、回数そのものを固定する。
- **`stepSenders` の flush が tick をまたいで再開できる。**
  budget を使い切った状態から次の tick で続きを書き、重複行が出ないこと。
  再開に失敗しても import は「完了」扱いになりうるので、テストがないと気づけない。
- **sender 名を保存しても `source_documents` の `content_hash` と `captured_at` が変わらない。**
  これが 08 の前提条件。ここが崩れると CLI 側のハッシュ検証が壊れる。
- 既存の Chat import テストが全て通り続けること。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev` を起動する。
2. `/sources` から Chat space を登録し、import を完走させる。
3. `/sources` の sender ダイアログにサンプルが表示されることを確認する。
4. sender 名を設定し、レスポンスが即座に返ること（R2 の再書き込みが走らないこと）を確認する。
5. `curl -H "Authorization: Bearer <token>" http://localhost:5177/api/cli/wiki/chat-senders`
   で設定した名前が返ることを確認する。

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
