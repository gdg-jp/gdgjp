# Stage 07 — シフト表と手動編集

## Context — 背景とリポジトリ状況

### なぜやるか

ここまでの 6 ステージが揃って、初めてシフト表が画面に出る。需要（Stage 03）と供給（Stage 04）を
ソルバー（Stage 06）に渡して割当を作り、それを人が読める形にして、**手で直せるようにする**。

「手で直せる」ことは付け足しではない。システムは「この人はこのトラックに慣れている」「あの二人は
相性が悪い」「当日の朝に急用が入った」といった文脈を持たない。だから
**自動生成は最終解ではなく「編集可能なたたき台」**であり、手動編集はこのプロダクトの一級機能である。

そこから帰結する重要な非対称がある。**自動生成はハード制約を絶対に破らないが、手動編集では
警告したうえで破らせる。** 当日の例外運用があるため禁止はしない。実装中に「一貫性のため」と称して
手動編集側を禁止に倒さないこと。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 05（スタッフ一覧・需給ビュー）と Stage 06（ソルバー）の両方の完了が前提。**

対象は `assignments` テーブル、`/e/:id/roster` の 3 ビュー、セル編集ドロワー、生成の実行。
**履歴・undo/redo は Stage 08、公開ビューは Stage 09 の担当。**

### 読むべきもの

- [`docs/roster/index.md`](index.md) §5（ソルバー仕様）と §6（画面）— **シフト表の見せ方の仕様**
- [`docs/roster/adr.md`](adr.md#adr-004-ソルバーを-worker-の-action-内で実行する) — ADR-004（Worker 内実行）
- [`docs/roster/adr.md`](adr.md#adr-005-経験レベルを公開ビューに出さない) — ADR-005（経験レベルの露出）
- `roster/app/features/solver/README.md` — Stage 06 が書いたソルバーの使い方
- `roster/app/features/supply/supply.ts` — Stage 05 の需給判定。**役割が違う**（下記）

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/solver/solve.ts` の `solve`** — 自動生成。**呼ぶだけ。**
  ロジックをルートに書き写さない。
- **`roster/app/features/solver/evaluate.ts` の `evaluate`** — 評価。
  **手動編集のたびにこれを呼ぶ。** 別の評価ロジックを書かない。
- **`roster/app/features/solver/constraints.ts` の `hardViolations`** —
  手動編集の警告に使う。**Stage 06 が「警告メッセージのリストを返す」形で設計している。**
  ここで禁止に変えない。
- **`roster/app/features/solver/suggest.ts` の `suggestFor`** — 空きセルの候補提示。
- **`roster/app/features/demand/` / `applications/` / `schedule/`** の server モジュール —
  ソルバー入力の組み立てに使う。自前で引き直さない。

### 前提として確認済みの事実（再調査不要）

- ソルバーは D1 に触らない。**入力の組み立てと結果の永続化はこのステージの仕事。**
- ソルバーの割当キーは `${applicationId}|${slotId}`。`assignments` テーブルの主キーも
  `(application_id, time_slot_id)` にすることで、同一枠 2 箇所が構造的に作れない。
- Stage 06 のベンチで、想定規模の実行時間は実測済み。**Worker の CPU 時間に収まることは確認されている**
  （収まらなければ Stage 06 が止まっているはず）。
- Stage 05 の `supply.ts` は「そもそも候補がいるか」の粗い判定。
  **このステージの `evaluate` は「実際に割り当てた結果どうか」**。**別物なので統合しない。**
  前者は募集期間中、後者は生成後に使う。

---

## Design — 設計

### 1. マイグレーション `0005_assignments.sql`

```sql
CREATE TABLE assignments (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  time_slot_id   TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  track_id       TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  role_id        TEXT NOT NULL REFERENCES roles(id),
  locked         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, time_slot_id)
);
CREATE INDEX assignments_event_idx ON assignments (event_id);
```

**主キー `(application_id, time_slot_id)` を変えない。** これが「同一スタッフを同一時間枠に
2 箇所へ割り当てない」というハード制約の実装本体である（[`index.md`](index.md) §4）。

`event_id` は辿れるが、イベント単位の一括読み書きのために非正規化して持つ。

`locked` 列は用意するが、**ロックの UI は作らない**（P1）。ソルバーの `keepLocked` が
既に受け口を持っているので、列だけ先に置く。

### 2. 生成の実行（Worker の action 内）

`/e/:id/roster` の action として実装する（[ADR-004](adr.md#adr-004-ソルバーを-worker-の-action-内で実行する)）。

1. D1 から需要・スタッフ・スキル・稼働・時間枠・トラック・役割を読む
2. `SolverInput` に組み立てる
3. `solve(input, { seed: event.seed })` を呼ぶ
4. `assignments` を**全削除して入れ直す**（`db.batch` で原子的に）
5. 実行時間と評価レポートを返す

**組み立ては `app/features/roster/solver-input.server.ts` に切り出す。** ルートに書かない。
この関数は「D1 の行 → `SolverInput`」の変換だけを行い、テストできる形にする。

シードは `events.seed` を使う。**UI からシードを変更できるようにする**（数値入力）。
変えて再生成すると別の解が出る。前回の実行の `ms` とシードを画面に出し、
「同じ入力とシードなら同じ結果になる」ことを明示する。

**進捗表示** — US-14 が求めているが、Worker の action は途中経過を返せない。
MVP ではボタンを disabled にしてスピナーを出すまでとする。実測が数百 ms〜数秒なら十分。

### 3. 3 つのビュー

セグメントコントロールで切り替える。

#### (a) スタッフ別（既定）

**縦軸に時間、横軸にスタッフ。** 1 列が 1 人のその日の動きになり、横に読めば
「今この時間、誰がどこにいるか」が分かる。

- **セルの中身** — 役割名。担当がない時間は**空欄**で、休憩として読める
- **セルの色** — トラックを区別する。縦に色が続けば同じ場所に留まっており、
  色が変わればトラック間の移動が発生していると分かる
- **色だけに頼らず、セル内にトラック名も併記する**（アクセシビリティ）
- **経験レベルは列ヘッダに示し、セル内には出さない**（情報量を抑えるため）
- 稼働 `d`（△）を使ったセルと、制約違反のセルを枠線で区別する
- 稼働 `x` なのに割当があるセル（手動編集の結果）は違反として強調する

**列ヘッダに経験レベルを出すのはオーナー画面だから。** 公開ビュー（Stage 09）では出さない
（[ADR-005](adr.md#adr-005-経験レベルを公開ビューに出さない)）。

#### (b) 役割別

**縦軸に時間、横軸に (トラック × 役割)。** 「受付は何時から何時まで誰が入っているか」を読む向き。
顔ぶれと需要が変わらない限り縦に結合し、時間帯として読めるようにする。

#### (c) 充足状況

同じく縦が時間、横が (トラック × 役割)。各セルに `現在 / 理想` と経験構成の充足を色で示す。
**縦軸を時間に揃えることで (a) と並べて読める。**

いずれも横スクロールコンテナに入れる（`overflow-x: auto`）。

### 4. 指標と不足レポート

ビューの上に常時表示する。

| 指標 | 表示 |
|---|---|
| 未充足 | `N 名`（頭数 `x` / 経験者 `y` の内訳を併記） |
| 理想充足率 | `NN%`（`filled / demandIdeal`） |
| 第1希望の役割 | `NN%` |
| 負荷のばらつき | 標準偏差（最大 / 最小の枠数を併記） |
| 条件違反 | `N 件`（△使用 / 連続超過の人数を併記） |

不足があるときは、**3 列に分けたレポート**を出す。

1. **頭数の不足** — 「10:00–11:00 · Track A / 配信 — 2名不足 (0/2)」
2. **経験者の不足** — 同上 + 「→ 募集告知に反映する: 『この役割の経験者を募集中』」
3. **経験構成の違反** — 初参加者だけの枠 / 初参加者が上限超過
   + 「→ 同時間帯に回せる経験者がいないため入れ替えられなかった枠」

**「解なし」と表示しない。** 何が足りないかを示すのがこの画面の価値
（[`index.md`](index.md) §5.8）。各項目は 8 件まで出し、残りは「ほか N 件」。

### 5. 手動編集

セルをクリックするとドロワーが開く。**2 種類ある。**

#### (a) スタッフ × 時間枠のセル（スタッフ別ビュー）

そのスタッフのその枠をどこに割り当てるか。

- 現在の割当（あれば）と「外す」
- 割り当て先の候補 = その枠で需要がある (トラック × 役割) の一覧。
  各項目に現在の人数 / 理想、リード充足、初参加者数を出す

#### (b) 需要セル（役割別・充足状況ビュー）

その (時間枠 × トラック × 役割) に誰を入れるか。

- 人数 / リード / 初参加の充足バッジ
- **現在の担当**（外せる）
- **ここに入れられる人** — `suggestFor` の結果。各候補に経験レベル、第1希望かどうか、
  範囲全体の稼働（`○○△` のように連続表示）、この日の担当枠数を出す

**役割別ビューで縦に結合された範囲を選んだ場合、範囲全体（N 枠）に一括で配置する。**
1 枠ずつクリックさせない。

#### 警告して許可する

`hardViolations` を呼び、違反があれば候補に**警告文を添えて薄く表示する**が、
**選択は許可する**。警告の例:

- 「全時間帯で稼働不可」/「一部の時間帯が稼働不可」
- 「N 枠で別の担当があり、置き換わります」
- 「理想人数を超過」

**確認のうえ強行できる。** ダイアログでもう一段確認するかは実装者の判断でよいが、
**禁止はしない**。

編集のたびに `evaluate` を再実行し、指標と不足レポートを更新する。

### 6. Stage 08 への受け渡し

このステージでは履歴を作らない。ただし**書き込みの経路を 1 箇所に集約しておく**こと。

```ts
// app/features/roster/roster.server.ts
export async function writeAssignments(
  db: D1Database, eventId: string, next: Assignments,
): Promise<void>;
```

自動生成も手動編集もこの関数を通す。Stage 08 はここに履歴の記録を差し込むだけで済む。
**各ルートが直接 `INSERT` / `DELETE` を書くと、Stage 08 で全部を洗い出す羽目になる。**

### 制約

- **`assignments` の主キー `(application_id, time_slot_id)` を変えない。** ハード制約の実装本体。
- **手動編集でハード制約を禁止しない。** 警告して続行させる。当日の例外運用がある。
  自動生成が破らないことと、手動編集で破れることは**意図した非対称**。
- **`evaluate` を再実装しない。** Stage 06 のものを呼ぶ。指標が 2 系統になると
  「画面の数字とレポートの数字が合わない」が起きる。
- **Stage 05 の `supply.ts` と統合しない。** 粗い候補判定（募集期間中）と
  実割当の評価（生成後）は別物。
- **経験レベルはオーナー画面の列ヘッダにのみ出す。** セル内には出さない。
- **書き込みは `writeAssignments` に集約する。** Stage 08 が履歴を差し込む地点。
- **履歴・undo/redo を作らない。** Stage 08 の担当。
- **公開ビュー（`/r/:viewToken`）を作らない。** Stage 09 の担当。
- **ロックの UI を作らない。** 列と `keepLocked` の受け口だけ。P1。
- **1 ファイル 400 行以下。** 3 ビュー + 2 ドロワー + 指標 + レポートは必ず超える。
  `components/` 配下に細かく割る。
- **`schema.sql` は生成物。**

---

## Files to touch — 変更ファイル

### 新規

```
roster/migrations/0005_assignments.sql
roster/app/features/roster/types.ts
roster/app/features/roster/roster.server.ts          （writeAssignments / readAssignments）
roster/app/features/roster/solver-input.server.ts
roster/app/features/roster/solver-input.server.test.ts
roster/app/features/roster/grid.ts                   （役割別ビューの縦結合など純粋ロジック）
roster/app/features/roster/grid.test.ts
roster/app/features/roster/components/StaffGrid.tsx
roster/app/features/roster/components/RoleGrid.tsx
roster/app/features/roster/components/DemandCoverageGrid.tsx
roster/app/features/roster/components/MetricsRow.tsx
roster/app/features/roster/components/ShortageReport.tsx
roster/app/features/roster/components/CellDrawer.tsx
roster/app/features/roster/components/DemandCellDrawer.tsx
roster/app/features/roster/components/GeneratePanel.tsx
roster/app/features/roster/README.md
roster/app/routes/e.$id.roster.tsx
roster/e2e/roster.spec.ts
```

### 変更

```
roster/app/routes.ts                       （e/:id/roster を追加）
roster/schema.sql                          （生成物）
roster/ARCHITECTURE.md
roster/CLAUDE.md
roster/tests/architecture/__snapshots__/route-urls.test.ts.snap
```

---

## Verification — 完了条件と検証

### 完了条件

1. 「自動生成」ボタンで生成され、進捗（スピナー）が出て、完了後に指標が表示される
2. **絶対に破らない条件に反する割当が自動生成では発生しない**
3. 未充足の需要・第1希望の充足率・スタッフごとの稼働枠数が結果に表示される
4. **条件を変えずに再実行すれば同じ結果になる**
5. 3 ビュー（スタッフ別 / 役割別 / 充足状況）が切り替えられる
6. セルをクリックして割当の追加・変更・削除ができ、空きセルには候補が提示される
7. **条件に反する割当は警告が出るが、確認の上で強行できる**
8. 未充足と条件違反の件数が常に表示される
9. 解が無いとき「解なし」ではなく、頭数 / 経験者 / 経験構成に分けた内訳が出る

### コマンド

```sh
pnpm --filter @gdgjp/roster migrate:local
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster test:e2e
pnpm --filter @gdgjp/roster dev
```

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **同じシードで 2 回生成すると `assignments` テーブルの内容が完全一致する** —
  Stage 06 の単体テストは通っていても、**`solver-input.server.ts` の組み立てが
  D1 の行順に依存していると、ここで初めて非決定になる**。
  `ORDER BY` を付け忘れた `SELECT` がこの経路を作る。Stage 08 の履歴比較が無意味になるので必ず固定する
- **`solver-input.server.test.ts`: 辞退者が `SolverInput` に含まれない** —
  含まれると辞退した人がシフトに入る
- **`solver-input.server.test.ts`: `ideal = 0` の需要が `SolverInput` に含まれない**
- **生成後に `assignments` の古い行が残っていない** — 全削除して入れ直す実装が
  部分更新に変わると、前回の割当が混ざる
- **手動編集で稼働 `x` の枠に配置でき、警告が出る** — **禁止に倒れていないことの確認**。
  「一貫性のため」と称して塞がれやすい経路なので、テストで開いていることを固定する
- **手動編集後の指標が `evaluate` の戻り値と一致する** — 画面用に別集計を書いていないことの確認
- **`grid.test.ts`: 役割別ビューで顔ぶれか需要が変われば縦結合が切れる** —
  切れないと、実際は交代しているのに連続しているように見える

### 手動 E2E

1. Stage 03〜05 のデータが揃ったイベントを `status = closed` にする
2. `/e/:id/roster` を開く → 「まだ生成していません」が出る
3. **「自動生成」** → 数秒以内に完了し、指標 5 つと実行時間・シードが出る
4. スタッフ別ビューを目視する:
   - 空欄（休憩）が入っている
   - 同じ色（トラック）が縦に続く箇所がある
   - セル内にトラック名が併記されている
   - 列ヘッダに経験レベルが出ている
5. **もう一度「再生成」** → 指標が 3 と完全に同じであることを確認
6. **シードを変えて再生成** → 別の割当になることを確認。元に戻す
7. 役割別ビュー・充足状況ビューに切り替え、縦軸の時間が 3 ビューで揃っていることを確認
8. 空きセルをクリック → 候補が経験レベル付きで出る。第1希望の人が上に来る
9. **稼働が × の人を選ぶ** → 警告が出るが、確認して配置できる。
   配置後、そのセルが違反として強調され、違反件数が増える
10. 役割別ビューで縦に結合された範囲のセルをクリック →
    「選ぶと HH:MM–HH:MM の N 枠すべてに配置します」が出て、一括配置される
11. 需要を意図的に増やして再生成し、**不足レポートが 3 列に分かれて出る**ことを確認
12. リードを全員「初参加」に補正して再生成し、**経験者の不足**に募集告知の示唆が出ることを確認
