# Stage 08 — 履歴と巻き戻し

## Context — 背景とリポジトリ状況

### なぜやるか

生成と編集は何度も繰り返される。試しに動かして悪化することもある。
そのとき必要なのは「すぐ前の状態に戻す」ことである。

設計上の判断として、**シフト表はイベントごとに 1 つとし、複数案を並行して持たない**。
運用上は「今の 1 枚」が常に唯一の正であり、**「案を選ぶ」より「巻き戻せる」ほうが実態に合う**。
代わりに Google スプレッドシートのように操作の履歴を辿れ、任意の時点へ戻せるようにする。

各時点の評価指標も残すため、重みやシードを変えて再生成した結果の比較も履歴上で行える。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 07 完了が前提**（`assignments` と `writeAssignments` が存在する）。

対象は `revisions` テーブルと `/e/:id/roster` の履歴パネル、undo / redo、任意時点への復元。
**公開ビューは Stage 09 の担当。**

### 読むべきもの

- [`docs/roster/index.md`](index.md) §5.7（評価レポート）— 履歴に残す指標
- [`docs/roster/adr.md`](adr.md#adr-006-履歴を-json-スナップショットで持ち割当テーブルは現在の-1-枚だけにする) — **ADR-006。このステージの設計判断そのもの**
- `roster/app/features/roster/roster.server.ts` — Stage 07 の `writeAssignments`。
  **ここに履歴の記録を差し込む**
- `roster/app/features/solver/evaluate.ts` — 指標の算出

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/roster/roster.server.ts` の `writeAssignments`** —
  Stage 07 が「自動生成も手動編集もこの関数を通す」形に集約してある。
  **ここに履歴の記録を差し込むだけでよい。** 各ルートを個別に改造しない。
- **`roster/app/features/solver/evaluate.ts` の `evaluate`** — 指標。
  履歴用に別の集計を書かない。
- **`roster/app/features/roster/types.ts` の `Assignments`** — スナップショットの中身。

### 前提として確認済みの事実（再調査不要）

- 想定規模（スタッフ 100 名 × 時間枠 60）では 1 時点あたり最大 3,000 件程度の割当になる。
  **`assignments` 行を時点ごとに複製すると D1 の行数が急増する**
  （[ADR-006](adr.md#adr-006-履歴を-json-スナップショットで持ち割当テーブルは現在の-1-枚だけにする)）。
- `assignments` の主キーは `(application_id, time_slot_id)`。
- Stage 07 の生成は「全削除して入れ直す」形。復元も同じ形でよい。
- `evaluate` は `solve` から独立して呼べる（Stage 06 が保証）。

---

## Design — 設計

### 1. マイグレーション `0006_revisions.sql`

```sql
CREATE TABLE revisions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,          -- イベント内の連番。1 始まり
  label       TEXT NOT NULL,             -- 「自動生成 (シード 20261114)」「手動編集」
  actor       TEXT NOT NULL,             -- 表示名
  actor_id    TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('generate','edit','restore')),
  group_key   TEXT,                      -- 連続編集をまとめるキー。NULL ならまとめない
  snapshot    TEXT NOT NULL,             -- JSON。{ v: 1, items: [...] }
  metrics     TEXT NOT NULL,             -- JSON。evaluate の metrics
  created_at  TEXT NOT NULL,
  UNIQUE (event_id, seq)
);
CREATE INDEX revisions_event_seq ON revisions (event_id, seq);
```

**`snapshot` にバージョン列を持たせる。**

```json
{ "v": 1, "items": [{ "a": "app_1", "s": "slot_3", "t": "track_a", "r": "mc", "l": 0 }] }
```

キーを短くするのは 3,000 件 × 保持件数ぶんの JSON サイズが効くため。
`v` を持つのは、`assignments` の列が将来変わったときに読み出し側が分岐できるようにするため
（[ADR-006](adr.md#adr-006-履歴を-json-スナップショットで持ち割当テーブルは現在の-1-枚だけにする)
の Consequences）。

**`snapshot` は `assignments` の写しであり、スキーマの正本ではない。**

### 2. カーソル（今どの時点にいるか）

`events` に 1 列足す。

```sql
ALTER TABLE events ADD COLUMN revision_cursor INTEGER;
```

`revisions.seq` を指す。`NULL` は「まだ履歴なし」。

undo / redo はこのカーソルを動かして、その時点のスナップショットを `assignments` へ展開する操作。

**カーソルより後ろの履歴は捨てない。** redo できる必要がある。ただし
**カーソルを戻した状態で新しい編集をしたら、そこから先を切り捨てて新しい枝にする**
（一般的な undo/redo の挙動。分岐は持たない）。

### 3. 履歴の記録

`app/features/history/history.server.ts` に置き、`writeAssignments` から呼ぶ。

```ts
export async function recordRevision(
  db: D1Database,
  input: {
    eventId: string;
    assignments: Assignments;
    metrics: Metrics;
    label: string;
    actor: { id: string; name: string };
    kind: "generate" | "edit" | "restore";
    groupKey?: string | null;
  },
): Promise<void>;
```

**連続した手動編集は 1 件にまとめる。** 1 セル動かすたびに履歴が増えると読めない。

まとめる条件（すべて満たすとき、新規追加ではなく**現在の先頭を更新**する）:

- `kind === "edit"`
- 現在の先頭（`seq === revision_cursor`）も `kind === "edit"`
- `group_key` が一致する
- 先頭の `created_at` から**一定時間以内**

`group_key` は「同一ユーザー × 同一イベント × 一定時間窓」を表すキーにする。
**時間窓は 5 分**とし、定数として 1 箇所に置く。

まとめるときは `label` / `created_at` / `snapshot` / `metrics` を上書きする
（`seq` と `id` は保つ）。

### 4. 保持件数の上限

**上限を設け、古いものから削除する。** 3,000 件 × N 件の JSON が無限に増えるのを防ぐ。

- 上限は **50 件**。定数として 1 箇所に置く
- 追加時に超えたら `seq` の小さいものから削除する
- 削除で `revision_cursor` が指す行が消えることは無い（カーソルは常に新しい側にある）

削除は追加と同じ `db.batch` に入れて原子的に行う。

### 5. 復元

```ts
export async function restoreRevision(
  db: D1Database, eventId: string, seq: number, actor: Actor,
): Promise<void>;
```

1. `revisions` からスナップショットを読む
2. `assignments` を全削除して展開し直す
3. `events.revision_cursor` を `seq` にする

**復元そのものは新しい履歴を作らない。** カーソルを動かすだけ。作ると
「戻す → 戻したことが履歴に残る → さらに戻す」で履歴が汚れる。
`kind = 'restore'` は、カーソルを戻した状態から**新しい編集をした**ときの分岐記録用に予約しておく。

**スナップショットに存在しない `application_id` / `time_slot_id` を展開しない。**
履歴を取った後にスタッフが辞退したり時間枠が作り直されたりすると、外部キーが壊れる。
展開前に現存する id で絞り、**「N 件の割当は対象が存在しないため復元されませんでした」を表示する**。

### 6. 履歴パネル UI

`/e/:id/roster` の下部に置く（Stage 07 の画面に追加）。

- 新しい順に並べる
- 各行: ラベル、時刻、実行者、**指標のサマリ**（未充足 / 第1希望 / 負荷ばらつき）
- 現在のカーソル位置をマークする
- カーソル以外の行に「戻す」ボタン

**指標を各行に出すことが、重みやシードを変えた結果の比較を成立させている。**
出さないと「どの生成が良かったか」を思い出せない。

ビューの操作列に **undo / redo** ボタンを置く（`←元に戻す` / `やり直す→`）。
カーソルが端にあるときは disabled。

### 制約

- **`assignments` テーブルは現在の 1 枚だけを保持する。** 時点ごとに行を複製しない
  （[ADR-006](adr.md#adr-006-履歴を-json-スナップショットで持ち割当テーブルは現在の-1-枚だけにする)）。
- **`snapshot` に `v` を持たせる。** 将来の列変更で読めなくなるのを防ぐ。
- **復元は新しい履歴を作らない。** カーソルを動かすだけ。
- **カーソルを戻した状態で編集したら、そこから先を切り捨てる。** 分岐は持たない。
- **存在しない id を復元時に展開しない。** 落とした件数を必ず表示する。
- **連続編集をまとめる。** 5 分窓。1 セルごとに履歴を増やさない。
- **保持上限 50 件。** 超えたら古いものから消す。
- **指標は `evaluate` の戻り値をそのまま保存する。** 履歴用に別集計を書かない。
- **`writeAssignments` 以外の場所で `assignments` を書かない。** Stage 07 が集約した経路を守る。
- **複数案を並行して持つ機能を作らない。** PRD の意図的な非機能。
- **公開ビューを作らない。** Stage 09 の担当。
- **`schema.sql` は生成物。**

---

## Files to touch — 変更ファイル

### 新規

```
roster/migrations/0006_revisions.sql
roster/app/features/history/types.ts
roster/app/features/history/snapshot.ts          （Assignments ⇄ JSON の相互変換、v 対応）
roster/app/features/history/snapshot.test.ts
roster/app/features/history/grouping.ts          （連続編集をまとめる判定。純粋関数）
roster/app/features/history/grouping.test.ts
roster/app/features/history/retention.ts         （保持上限の判定。純粋関数）
roster/app/features/history/retention.test.ts
roster/app/features/history/history.server.ts
roster/app/features/history/components/HistoryPanel.tsx
roster/app/features/history/components/UndoRedoButtons.tsx
roster/app/features/history/README.md
```

### 変更

```
roster/app/features/roster/roster.server.ts   （writeAssignments から recordRevision を呼ぶ）
roster/app/routes/e.$id.roster.tsx            （履歴パネル、undo/redo、restore の action）
roster/schema.sql                             （生成物）
roster/ARCHITECTURE.md
roster/CLAUDE.md
```

ルートは増えない。`route-urls.test.ts` のスナップショットは**変わらないはず**。

---

## Verification — 完了条件と検証

### 完了条件

1. 生成と編集のたびに履歴が積まれ、いつ誰が何を変えたかが分かる
2. 任意の時点を選んで復元できる
3. 各時点の指標（未充足数、第1希望充足率、負荷のばらつき）を比較できる
4. **1 セル動かすたびに履歴が増えず、細かい操作が適度にまとめられる**
5. undo / redo が動き、端では disabled になる
6. カーソルを戻した状態で編集すると、そこから先が切り捨てられる
7. 保持件数の上限を超えると古いものから消える
8. 履歴を取った後に辞退したスタッフの割当は復元されず、件数が表示される

### コマンド

```sh
pnpm --filter @gdgjp/roster migrate:local
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster dev
```

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`snapshot.test.ts`: `Assignments` → JSON → `Assignments` が完全に往復する** —
  キーを短縮しているので、`locked` の欠落や `trackId` / `roleId` の取り違えが起きやすい。
  **壊れても保存時には気づかず、復元して初めて割当が壊れる**
- **`snapshot.test.ts`: `v` が未知の値のスナップショットで例外を投げる**（黙って壊れた割当を返さない）
- **`grouping.test.ts`: 5 分以内の連続編集が 1 件にまとまる / 5 分を超えると別件になる** —
  まとまらないと 1 セル動かすたびに履歴が増え、上限 50 件が数分で使い切られて
  **生成時点の履歴が押し出される**。これが最も実害の大きい退行
- **`grouping.test.ts`: `generate` は常に新規履歴になる**（`edit` とまとめない）
- **`retention.test.ts`: 上限超過時に `seq` の小さいものから消える。カーソルが指す行は消えない**
- **`history.server.test.ts`: 復元しても新しい履歴が増えない** —
  増えると undo を繰り返すたびに履歴が伸びて redo できなくなる
- **`history.server.test.ts`: 存在しない `application_id` を含むスナップショットの復元が
  外部キー違反で落ちず、件数を返す** — 辞退や時間枠の再生成の後に必ず通る経路
- **`writeAssignments` を通らない `assignments` への書き込みが無い** —
  grep で確認する。あると履歴が飛ぶ

### 手動 E2E

1. Stage 07 の状態から `/e/:id/roster` を開き、自動生成する
2. 履歴に「自動生成 (シード N)」が 1 件積まれ、指標が併記されることを確認
3. **セルを 5 回続けて編集する** → 履歴が **1 件**にまとまり、ラベルと時刻が更新されることを確認
4. 5 分以上空けて（または時刻を操作して）もう 1 回編集 → **別の履歴**になることを確認
5. 「← 元に戻す」を押す → 直前の状態に戻り、指標も戻る
6. 「やり直す →」で先に進める
7. **戻した状態でセルを編集する** → その先の履歴が切り捨てられ、redo が disabled になる
8. シードを変えて再生成 → 履歴に別の生成が積まれる。
   **2 つの生成の指標を履歴パネル上で比較できる**ことを確認
9. 古い時点の「戻す」を押して復元 → その時点の割当に戻る。履歴の件数は増えない
10. スタッフを 1 名辞退させてから古い時点を復元 →
    **「N 件の割当は対象が存在しないため復元されませんでした」**が出る
11. 51 件を超えるまで編集を繰り返し（時間窓を跨がせる）、古い履歴が消えることを確認
