# Chat sender samples hotfix — import を落とさなくする

> Generated from Claude Code plan: `/Users/hari/proj/gdgjp/.claude/worktrees/wiki-layer-agents-design-6075f9/docs/plans/06-chat-sender-samples-hotfix.md`

## Goal

Chat sender samples hotfix — import を落とさなくする

## Repo context

対象ワークスペースは `wiki/` のみ。Go CLI (`cli/`) は触らない。
これは 3 段構成の 1 段目で、単独でデプロイ可能な止血。後続は
`docs/plans/07-chat-sender-placeholder-worker.md` と
`docs/plans/08-chat-sender-cli-resolution.md`。

### 何が起きているか

`feat(wiki): configure Google Chat sender names` (907b1ba) 以降、新しい Google Chat space を
import すると 2 つの障害が出る。

1. `delete from "google_chat_sender_samples" where id in (?, ?, ...)` の bind parameter が
   250 個以上になりクエリが失敗する。
2. import 中に `Worker exceeded resource limits` が出る。

原因はどちらも `wiki/workers/features/sources/chat-sender-registry.ts` の
`captureChatSenderData`（31 行目）1 箇所。これは `stepFinalizing` が週ドキュメントを永続化する
たびに呼ばれ、

- 送信者ごとに **その週の全メッセージを 1 件ずつ D1 に INSERT** し（72-94 行目）、
- そのあと全行を SELECT して 10 件目以降を **1 本の `inArray`** で DELETE し（96-110 行目）、
- `ctx.budget` を一切消費しない。

`stepFinalizing` の週あたり予約は `1 + persistCost` だけ
(`wiki/workers/features/sources/google-chat-import.ts:524`)、`SUBREQUEST_BUDGET_LIMIT` は 40
(`wiki/workers/features/sources/subrequest-budget.ts:2`)。つまり 1 週に 40 通以上あると
実際の Workers subrequest 上限を budget オブジェクトが気づかないまま突破する。

profile が既に設定済みの送信者にも同じ収集が走るのが、報告された再現条件
（「sender name を設定済みのユーザーがチャットに現れたとき」）そのもの。

### 読むべきもの

- `CLAUDE.md`（リポジトリ規約）と `wiki/CLAUDE.md`（Drizzle、migration、DO の構成）
- `wiki/workers/features/sources/chat-sender-registry.ts` 全体
- `wiki/workers/features/sources/subrequest-budget.ts`（32 行、全部読む）

### 再利用する既存実装

- `wiki/app/lib/db.server.ts` の `getDb(env)` — Drizzle インスタンス。**新しく作らない**
- `wiki/workers/features/sources/subrequest-budget.ts` の `SubrequestBudget`
  — `canSpend` / `spend` はこれを使う。独自のカウンタを作らない
- `wiki/app/db/schema.ts` の `googleChatSenderSamples`(558) / `googleChatSenderProfiles`(550)
  — スキーマ定義は既にある

## Acceptance criteria

### 1. `captureChatSenderData` を有界にする

`wiki/workers/features/sources/chat-sender-registry.ts`

シグネチャに 2 つ足す。

- `configuredSenders: ReadonlySet<string>` — **profile が既にある送信者はサンプル収集を完全に
  スキップする**。名前が判明済みの送信者にサンプルは要らない。これで報告された再現条件が直接消える。
- `budget: SubrequestBudget` — D1 に触る前に `spend()` する。

処理順を「全件 INSERT してから削る」から「絞ってから書く」に反転させる。

1. `input.messages` を送信者ごとにまとめる（既存の `latestBySender`、62-69 行目）。
2. `configuredSenders.has(resourceName)` な送信者を落とす。
3. 各送信者について、本文（`senderMessageText`）が空でないものを `createTime` 降順に並べ、
   **メモリ上で上位 `MAX_SENDER_SAMPLES`(=10) 件に切る**。
   これで D1 書き込みは「週あたり 10 × 未設定送信者数」で有界になる。
4. INSERT 群を `db.batch([...])` 1 回にまとめる。drizzle-orm 0.45.1 の D1 driver が対応している。
   `D1Database.batch()` は 1 subrequest なので、budget の消費も 1 で済む。
   リポジトリ内に `db.batch` の前例はないため、これが最初の使用箇所になる。

### 2. prune を bind parameter 非依存にする

96-110 行目の「SELECT して `inArray` で DELETE」を捨て、**パラメータ数が固定の 1 文**にする。

```sql
DELETE FROM google_chat_sender_samples
WHERE resource_name = ?1
  AND id NOT IN (
    SELECT id FROM google_chat_sender_samples
    WHERE resource_name = ?1
    ORDER BY created_at DESC, id DESC
    LIMIT 10
  )
```

送信者数に関わらずパラメータは常に 1 個。これを手順 4 の同じ `db.batch` に含める。

なお現行の retention は `resource_name` 単位（source をまたぐ）。**この意味論は変えない**。

### 3. 呼び出し側の budget 予約

`wiki/workers/features/sources/google-chat-import.ts` の `stepFinalizing`。

- 526-541 行目で既に `googleChatSenderProfiles` を全件 select しているので、
  そこから `configuredSenders` の `Set` を作って `captureChatSenderData` に渡す。**追加の D1 呼び出しは不要**。
- `weekUnitCost`(524 行目) にサンプル書き込み分を加算し、`canSpend(weekUnitCost)` に反映させる。
  `captureChatSenderData` が消費する subrequest 数（renders の upsert 1 + batch 1）を定数で定義し、
  同じ定数を予約と実消費の両方で使う。

### 4. 既存の肥大化した行を刈る migration

`wiki/migrations/` に新規 SQL を追加する。番号は既存の最大値 +1（`0049_google_chat_sender_registry.sql`
の次なので `0050_`）。

```sql
DELETE FROM google_chat_sender_samples
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY resource_name ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM google_chat_sender_samples
  ) WHERE rn <= 10
);
```

### 5. sources 画面の同種のハザード

`wiki/app/routes/sources.tsx` の loader（172-198 行目）は samples 全件を `.all()` し、
`visibleSenderIds` に対して `inArray` を張っている。送信者が 100 人を超えれば同じ形で壊れる。

`googleChatSenderProfiles` は送信者あたり 1 行の小さなテーブルなので、
**`inArray` をやめて profiles を無条件に全件 select する**（189-198 行目）。
samples 側は手順 1-4 のあと送信者あたり 10 件で有界なので `.all()` のままでよい。

### 制約

- **`wiki/schema.sql` は生成物。手で編集しない。** migration を書いたあと
  `pnpm --filter @gdgjp/wiki migrate:local` で再生成する（`wiki/CLAUDE.md` 参照）。
- migration は手書き SQL。Drizzle の generate は使わない（`wiki/CLAUDE.md`）。
- **`google_chat_document_renders` と `rewriteChatSenderDocuments` はこの段では触らない。**
  どちらも別の性能問題を抱えているが、07 の担当。ここで手を入れると 07 と衝突する。
- **プレースホルダのレンダリング挙動を変えない。** この段では import 時に表示名を焼き込む
  現行動作をそのまま維持する。焼き込みをやめるのは 07 の担当。
- `MAX_SENDER_SAMPLES` の値 (10) と retention の単位（`resource_name` 単位）を変えない。

## Files to touch

### wiki/

- `wiki/workers/features/sources/chat-sender-registry.ts` — `captureChatSenderData` の書き換え
- `wiki/workers/features/sources/google-chat-import.ts` — `stepFinalizing` の呼び出しと budget 予約
- `wiki/app/routes/sources.tsx` — loader の `inArray` 除去
- `wiki/migrations/0050_prune_google_chat_sender_samples.sql`（新規）
- `wiki/schema.sql` — `migrate:local` による再生成のみ
- `wiki/workers/features/sources/google-chat-import.test.ts` — 回帰テスト追加

## How to verify

### 完了条件

- 1 送信者から 300 通あるフィクスチャで full import が完走する（現行コードは `inArray` で落ちる）。
- import 全体を通して `SubrequestBudget` の超過が起きない。
- profile 設定済みの送信者からは sample 行が 1 件も作られない。
- `google_chat_sender_samples` は `resource_name` あたり最大 10 行に収まる。

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

`migrate:local` は `schema.sql` を再生成する。差分が migration と一致しているか確認する。

### 回帰として固定すべきテスト

`wiki/workers/features/sources/google-chat-import.test.ts` に追加する。

- **1 送信者 300 通の import が完走し、その送信者の sample が 10 行に収まる。**
  現行コードならここで bind parameter 超過で落ちる = 回帰テストとして機能する。
- **同じ import 中に `SubrequestBudget` が一度も超過しない。**
  budget を消費し忘れると静かに壊れて本番でだけ落ちるため、テストで固定する。
- **profile 済み送信者のメッセージから sample 行が作られない。**
- 既存テスト（528 行目「identity API を呼ばず sender resource ID を保持する」）が通り続けること。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev` を起動する。
2. `/sources` から Chat space を 1 件登録し、import を完走させる。
3. sender 名を 1 件設定する。
4. 同じ space を refresh して再 import し、エラーが出ないことと
   設定済み送信者の sample が増えないことを確認する。

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
