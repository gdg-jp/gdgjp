# Stage 02 — ドメインスキーマと時間枠の格子

## Context — 背景とリポジトリ状況

### なぜやるか

roster のあらゆる機能（需要入力・スタッフ登録・自動生成・シフト表表示・公開ビュー）は、
**同じ時間枠の格子の上で完結する**ように設計されている。需要は (時間枠 × トラック × 役割)、
供給は (スタッフ × 時間枠)、割当は (スタッフ × 時間枠) → (トラック, 役割)。
どれも `time_slots` を共通軸に持つため、集計・最適化・グリッド表示が同じ join で済む。

このステージはその格子そのものを作る。**ここでテーブルの形を間違えると後続 7 ステージが全部歪む。**

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**
特に §3（用語と定数）と §4（ドメインモデル）がこのステージの仕様である。

### 依存と対象範囲

**Stage 01 完了が前提**（`roster/` が存在し、サインインできる）。

対象は `roster/` のみ。このステージが作るのは「イベントを作り、時間枠に分割し、トラックと役割を
選ぶ」までで、**需要の入力は Stage 03、スタッフ登録は Stage 04 の担当**。

### 読むべきもの

- [`docs/roster/index.md`](index.md) §3（用語と定数）と §4（ドメインモデル） — **このステージの仕様**
- `roster/CLAUDE.md` / `roster/ARCHITECTURE.md` — Stage 01 が書いた前提
- `scheduler/app/lib/db.ts` — **無 ORM のデータ層の手本**。`*Row` 型 → `to*()` マッパ →
  カラムリスト定数 → `RETURNING <COLS>` の書き方
- `scheduler/app/lib/slots.ts` — 時間枠を扱う純粋関数の手本。特に `deriveDayRanges` の
  「連続性 = 開始が `slotMinutes` ちょうど離れている」判定
- `scheduler/CLAUDE.md` の「Slot model」節 — 時刻の扱いで踏んだ地雷が書いてある
- `ost/migrations/0001_init.sql` — マイグレーションの書き方

### 再利用する既存実装 — 書き直さないこと

- **`scheduler/app/lib/db.ts` のデータ層パターン** — `EVENT_COLS` のようなカラムリスト定数を
  すべてのクエリで再利用し、書き込みは `RETURNING <COLS>` して同じマッパに通す。
  **この形をそのまま踏襲する。** 独自の書き方を発明しない。
- **`scheduler/app/lib/slots.ts` の時刻ヘルパ** — `HH:MM` ⇄ 分の変換と連続性判定。
  ロジックを読んで同等のものを `app/features/schedule/` に置く。
- **`roster/app/features/auth/permissions.ts`**（Stage 01 が作った） — 権限判定はここに足す。
  ルートに直接 chapter 比較を書かない。
- **`roster/app/features/auth/auth-redirect.server.ts` の `requireUserWithChapter`** —
  すべての保護ルートのゲート。新しく書かない。

### 前提として確認済みの事実（再調査不要）

- `scheduler/` の `day_of_week` は `0=Mon..6=Sun`（ISO）で JS の `Date.getDay()` とは違う。
  **roster は単日イベントなので曜日の概念を持たない。** この地雷は踏まない。
- `scheduler/` の `event_slots.start_time` は `HH:MM` で DB CHECK が長さ 5 を強制している。
  roster も同じ表現を使う。
- roster のイベントは**単日**（PRD の Non-Goal に複数日運用はない）。`date` 1 列 +
  `start_time` / `end_time` で表現でき、日跨ぎを考えなくてよい。
- タイムゾーンは `events.tz` に持つが、MVP では `Asia/Tokyo` 固定でよい。時刻はすべて
  「その日のローカル `HH:MM`」として扱い、UTC 変換をしない。**これが単日イベントで成立する理由**は、
  需要も稼働も割当も同じ `time_slots` の id を参照するだけで、絶対時刻の比較が要らないため。

---

## Design — 設計

### 1. マイグレーション `0002_domain.sql`

[`index.md`](index.md) §4 の表に従って 6 テーブルを作る。

#### `events`

```sql
CREATE TABLE events (
  id                TEXT PRIMARY KEY,
  chapter_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  date              TEXT NOT NULL,               -- YYYY-MM-DD
  start_time        TEXT NOT NULL CHECK (length(start_time) = 5),
  end_time          TEXT NOT NULL CHECK (length(end_time) = 5),
  step_min          INTEGER NOT NULL DEFAULT 60, -- 15 | 30 | 60
  tz                TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','open','closed','published','ended')),
  has_party         INTEGER NOT NULL DEFAULT 0,
  no_solo_newcomer  INTEGER NOT NULL DEFAULT 1,
  max_consecutive   INTEGER NOT NULL DEFAULT 4,
  seed              INTEGER NOT NULL,
  apply_token       TEXT NOT NULL UNIQUE,
  view_token        TEXT NOT NULL UNIQUE,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
```

- **`apply_token` / `view_token` は推測不可能なランダム値**にする。`crypto.getRandomValues` から
  作り、`id` とは独立させる。**URL から Event ID が推測できてはならない。**
- `seed` はイベント作成時に一度決めて保存する。ソルバーの再現性の根拠（[ADR-004](adr.md)）。
- 読み取りは常に `deleted_at IS NULL` で絞る。

#### `phases` / `time_slots`

```sql
CREATE TABLE phases (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  from_time  TEXT NOT NULL,
  to_time    TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE time_slots (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,          -- 0 始まり、連続
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  phase_id   TEXT REFERENCES phases(id) ON DELETE SET NULL,
  UNIQUE (event_id, idx)
);
```

**`idx` の連続性はソルバーと公開ビューの前提**である（「直前の枠」判定、連続枠のまとめ）。
再生成時に穴を開けないこと。`index` は SQL の予約語に近いので列名は `idx` にする。

#### `tracks` / `roles` / `event_roles`

```sql
CREATE TABLE tracks (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  shared     INTEGER NOT NULL DEFAULT 0,   -- 「全体」トラック
  sort_order INTEGER NOT NULL
);

CREATE TABLE roles (
  id         TEXT PRIMARY KEY,            -- 'reception' 等の文字列 ID
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE event_roles (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role_id  TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (event_id, role_id)
);
```

`roles` は同じマイグレーションで 6 件シードする（[ADR-007](adr.md#adr-007-役割マスタをマイグレーションでシードする)）。

```sql
INSERT INTO roles (id, name, sort_order) VALUES
  ('reception','受付',1), ('guide','誘導',2), ('mc','司会',3),
  ('stream','配信',4), ('photo','記録',5), ('setup','設営',6);
```

`tracks.shared` が立つ「全体」トラックは、受付や誘導のように全体で 1 セットあればよい役割を
置く場所。イベント作成時に 1 件自動生成する。

### 2. 時間枠の生成（純粋関数）

`app/features/schedule/slots.ts` に、DB に触らない純粋関数として置く。

```ts
export const toMin = (hhmm: string): number => ...;      // "09:30" -> 570
export const toHHMM = (min: number): string => ...;      // 570 -> "09:30"

/** 開始〜終了を stepMin で割り、各枠にフェーズを対応づける。 */
export function buildSlots(
  input: { start: string; end: string; stepMin: number },
  phases: { id: string; from: string; to: string }[],
): { idx: number; start: string; end: string; phaseId: string | null }[];
```

`buildSlots` の規約:

- `start` から `stepMin` 刻みで `end` **未満**まで進む。最後の枠の `end` が `end` を超えない
- 各枠のフェーズは `from <= start < to` で決める。該当なしは `null`
- `idx` は 0 始まりの連番

**ユニットテストを書く**（`slots.test.ts`）。境界（`stepMin` で割り切れない範囲、フェーズの隙間、
フェーズ未設定）を押さえる。

### 3. 時間枠の再生成（スロット照合）

イベントの開始・終了・刻み幅を変えると時間枠を作り直すことになる。単純に全削除して作り直すと、
**Stage 03 の `demands` と Stage 04 の `availabilities` が巻き添えで消える**。

`scheduler/` の `updateEventForOwner` が同じ問題を「`(dayOfWeek, startTime)` のキーが一致する
スロットは残し、差分だけ削除・挿入する」ことで解いている。roster も同じ考え方を採る。

```ts
/** 純粋関数。既存キーと新キーから keep / remove / insert を返す。 */
export function reconcileSlotKeys(
  existing: { id: string; start: string; end: string }[],
  next: { start: string; end: string }[],
): { keep: ...; remove: string[]; insert: ... };
```

**キーは `(start_time, end_time)`。** 一致するものは `id` を保つ（＝そこにぶら下がる需要と稼働が
生き残る）。**純粋関数として切り出し、ユニットテストを書くこと。** DB 操作と混ぜない。

`idx` は再生成のたびに詰め直す（穴を開けない）。

### 4. データ層 `app/lib/db.server.ts` と feature の server モジュール

- `app/lib/db.server.ts` — D1 ハンドルの取得だけ。横断プリミティブ。
- `app/features/events/events.server.ts` — `events` の CRUD。
- `app/features/schedule/schedule.server.ts` — `phases` / `time_slots` / `tracks` /
  `event_roles` の読み書き。

`scheduler/app/lib/db.ts` の規約をそのまま踏襲する。

- `EventRow` のような **snake_case の Row 型**を定義する
- `toEvent(row)` のような**マッパ**で camelCase のドメイン型に変換する
- `EVENT_COLS` / `SLOT_COLS` / `TRACK_COLS` のような**カラムリスト定数**を全クエリで再利用する
- 書き込みは `RETURNING <COLS>` して同じマッパに通す
- 複数文の書き込みは `db.batch([...])` で原子的に行う

**1 ファイル 400 行以下**（`file-size.test.ts`）。超えるなら `events.server.ts` を
`events-read.server.ts` / `events-write.server.ts` に割る、ではなく、
**ドメインで割る**（`events/` と `schedule/` を分けているのが既にその適用）。

### 5. ステータス遷移

`app/features/events/status.ts` に純粋関数として置く。

```ts
export const STATUSES = ["draft", "open", "closed", "published", "ended"] as const;
export const canApply = (status: EventStatus): boolean => status === "open";
export const canView  = (status: EventStatus): boolean => status === "published";
```

**前後どちらにも遷移可能**（再募集できる）。遷移の可否を制限するテーブルは作らない。
`canApply` / `canView` の 2 つだけが機能に効く述語で、Stage 04 と Stage 09 がこれを使う。

**ユニットテストを書く。** 全 5 ステータス × 2 述語を固定する。この 2 関数が公開 URL の
有効・無効を決めているため、静かに壊れると公開すべきでないものが公開される。

### 6. 画面

| 画面 | パス | 内容 |
|---|---|---|
| イベント一覧 | `/` | 自分の Chapter のイベント。作成ボタン。開催日の新しい順 |
| イベント作成 | `/events/new` | 名称・開催日・開始終了・刻み幅 |
| 設計 | `/e/:id/design` | イベント設定、フェーズと時間枠の一覧、トラックの追加・並べ替え・削除、使う役割の選択 |

**`/e/:id/design` の需要マトリクスは Stage 03 の担当。** このステージでは
「イベント」「フェーズと時間枠」「トラック」「役割」の 4 カードまで。

イベント設定カードに置くもの: 刻み幅、ステータス（`select`）、連続稼働の上限（3〜6 枠）、
初参加者の単独配置（禁止する / 許可する）。

ルートモジュールは「引数を読む → feature を呼ぶ → レスポンスを組む」に留める
（`layering.test.ts` が強制）。ビジネスロジックは `*.server.ts` へ。

### 制約

- **`time_slots.idx` の連続性を壊さない。** ソルバーの「直前の枠」判定と公開ビューの連続枠まとめが
  これに依存している。
- **時間枠の再生成でキーが一致するスロットの `id` を変えない。** 変えると Stage 03 の需要と
  Stage 04 の稼働可能時間が消える。`reconcileSlotKeys` を通すこと。
- **`apply_token` / `view_token` を `id` から導出しない。** 推測不可能なランダム値であること。
- **`roles` にイベント固有の役割を追加する経路を作らない。** カスタム Role は PRD の Non-Goal。
- **需要（`demands`）テーブルを作らない。** Stage 03 の担当。
- **スタッフ関連（`applications` / `application_skills` / `availabilities`）を作らない。**
  Stage 04 の担当。
- **`schema.sql` は生成物。** マイグレーションを直して `migrate:local` で再生成する。
- **UTC 変換をしない。** 時刻は「その日のローカル `HH:MM`」。単日イベントなので成立する。

---

## Files to touch — 変更ファイル

### 新規

```
roster/migrations/0002_domain.sql
roster/app/lib/db.server.ts
roster/app/features/events/events.server.ts
roster/app/features/events/events.server.test.ts
roster/app/features/events/status.ts
roster/app/features/events/status.test.ts
roster/app/features/events/components/EventCard.tsx
roster/app/features/events/components/EventForm.tsx
roster/app/features/schedule/slots.ts
roster/app/features/schedule/slots.test.ts
roster/app/features/schedule/reconcile.ts
roster/app/features/schedule/reconcile.test.ts
roster/app/features/schedule/schedule.server.ts
roster/app/features/schedule/components/PhaseList.tsx
roster/app/features/schedule/components/TrackEditor.tsx
roster/app/features/schedule/components/RolePicker.tsx
roster/app/routes/events.new.tsx
roster/app/routes/e.$id.design.tsx
roster/app/features/events/README.md
roster/app/features/schedule/README.md
```

### 変更

```
roster/app/routes.ts                       （3 ルート追加）
roster/app/routes/home.tsx                 （イベント一覧の中身を入れる）
roster/app/features/auth/permissions.ts    （canManageEvent の実装）
roster/schema.sql                          （生成物。migrate:local が更新）
roster/ARCHITECTURE.md                     （コードマップに events / schedule を追記）
roster/CLAUDE.md                           （Code map の表に追記）
roster/tests/architecture/__snapshots__/route-urls.test.ts.snap   （ルート追加で更新）
```

---

## Verification — 完了条件と検証

### 完了条件

1. `/events/new` からイベントを作れ、`/` の一覧に開催日の新しい順で出る
2. イベントを作ると時間枠が刻み幅どおりに生成され、`/e/:id/design` に一覧される
3. 開始・終了・刻み幅を変えると時間枠が作り直され、**キーが一致するスロットの `id` は保たれる**
4. トラックを追加・並べ替え・削除でき、使う役割を選べる
5. 別 Chapter のユーザーが `/e/:id/design` にアクセスすると 403 になる
6. `roles` が 6 件シードされている

### コマンド

```sh
pnpm --filter @gdgjp/roster migrate:local     # schema.sql も再生成される
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster dev               # :5186
```

`migrate:local` を忘れると型は通るのに実行時に `no such table` で落ちる。

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`reconcile.test.ts`: 刻み幅を 60→30 に変えても、開始・終了が一致する枠の `id` が変わらない** —
  これが壊れると、後続ステージで「イベント設定をちょっと直したらスタッフの稼働可能時間が全部消えた」
  という形で初めて気づく。実害が出るのが Stage 04 以降なので、ここで固定する
- **`slots.test.ts`: `stepMin` で割り切れない範囲で最後の枠が `end` を超えない** —
  超えると存在しない時間の需要が作れてしまう
- **`status.test.ts`: `canApply` が `open` のときだけ true、`canView` が `published` のときだけ true** —
  この 2 関数が公開 URL の有効・無効そのもの。緩むと未公開のシフト表が見える
- **`events.server.test.ts`: すべての読み取りが `deleted_at IS NULL` で絞られている** —
  削除したイベントが一覧に復活する経路
- **`route-urls.test.ts` のスナップショット更新が意図した 3 ルートだけであること**

### 手動 E2E

1. `pnpm --filter @gdgjp/roster dev`、`/dev/login?as=owner&chapter=1:x` でサインイン
2. `/events/new` → 名称「DevFest 2026」、開催日、09:00–19:00、刻み幅 60 分で作成
3. `/e/:id/design` に 10 枠（09:00–10:00 … 18:00–19:00）が並ぶことを確認
4. フェーズを 2 つ作り（「開場前」09:00–10:00、「セッション」10:00–17:00）、
   各時間枠にフェーズ名が付くことを確認
5. トラックを 3 つ作る（全体 / Track A / Track B）。「全体」に `shared` が立つことを確認
6. 使う役割で「受付」「司会」「配信」を選ぶ
7. **刻み幅を 30 分に変える** → 枠が 20 個になる。09:00–09:30 のような新しい枠が増え、
   元の 09:00–10:00 は消える（キーが変わるため）。これは想定どおり
8. **刻み幅を 60 分に戻す** → 10 枠に戻る
9. 別 Chapter のアカウント（`/dev/login?as=owner&chapter=2:y`）で同じ `/e/:id/design` を開き、
   403 になることを確認
