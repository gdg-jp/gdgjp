# Stage 03 — 需要（Demand）入力

## Context — 背景とリポジトリ状況

### なぜやるか

このプロダクトが解いているのは「人数」ではなく「**人数 × 経験の組み合わせ**」の制約充足である。
受付や配信には少なくとも 1 名の経験者が必要な枠があり、初参加者だけを配置すると当日破綻する。
必要人数と経験構成がなければ最適化の目的関数そのものが定義できないため、需要の入力は MVP の必須要素。

さらに**必要な体制は時間帯で変わる**。開場前は受付に 4 名要るが撤収時には 0 名でよく、
懇親会設営は撤収時にだけ現れる。したがって需要は (時間枠 × トラック × 役割) ごとに持ち、
**ある役割が必要ない時間帯は 0 として表現する**。

| 時間帯 | 受付 | 誘導 | 司会 (Track A) | 配信 (Track A) | 懇親会設営 |
|---|---|---|---|---|---|
| 09:00–10:00（開場前） | 4 | 2 | 0 | 1 | 0 |
| 10:00–12:00（セッション） | 1 | 1 | 1 | 2 | 0 |
| 12:00–13:00（昼休み） | 1 | 2 | 0 | 0 | 0 |
| 17:00–18:00（撤収・懇親会準備） | 0 | 0 | 0 | 0 | 3 |

問題は、3 次元の格子をセルごとに手で埋めるのが現実的でないこと。10 枠 × 4 トラック × 6 役割 =
240 セル。**このステージの主題は、入力をどう軽くするか**である。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 02 完了が前提**（`events` / `phases` / `time_slots` / `tracks` / `event_roles` が存在する）。

対象は `roster/app/features/demand/` と `/e/:id/design` の需要カード。
**スタッフ登録（Stage 04）とソルバー（Stage 06）には触らない。**

### 読むべきもの

- [`docs/roster/index.md`](index.md) §3（用語と定数）と §4（ドメインモデル）
- `roster/app/features/schedule/` — Stage 02 が作ったフェーズと時間枠。**再利用する**
- `roster/app/features/events/events.server.ts` — データ層の書き方の実例
- `roster/ARCHITECTURE.md` — 配置ルール

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/schedule/schedule.server.ts`** — フェーズ・時間枠・トラック・
  イベント役割の読み出し。**需要マトリクスの行と列はここから取る。** 自前で引き直さない。
- **`roster/app/lib/db.server.ts`** — D1 ハンドル。
- **`roster/app/features/auth/permissions.ts` の `canManageEvent`** — 権限判定。
- **`roster/app/features/events/status.ts`** — ステータス述語。

### 前提として確認済みの事実（再調査不要）

- `time_slots.idx` は 0 始まりの連番で穴がない（Stage 02 が保証）。
- `time_slots.phase_id` は NULL 許容。フェーズ未設定の枠が存在しうる。
- `tracks.shared` が立つ「全体」トラックが 1 件は必ず存在する（Stage 02 がイベント作成時に作る）。
- Stage 02 の `reconcileSlotKeys` により、イベント設定の変更で `time_slots.id` は
  可能な限り保たれる。ただし**保たれなかった枠にぶら下がる需要は消える**。これは想定内で、
  UI で「時間枠の変更で N 件の需要が失われます」と警告するのはこのステージの仕事。

---

## Design — 設計

### 1. マイグレーション `0003_demands.sql`

```sql
CREATE TABLE demands (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time_slot_id TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  track_id     TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  min_count    INTEGER NOT NULL DEFAULT 0,
  ideal_count  INTEGER NOT NULL DEFAULT 0,
  lead_min     INTEGER NOT NULL DEFAULT 0,
  new_max      INTEGER NOT NULL DEFAULT 99,
  PRIMARY KEY (time_slot_id, track_id, role_id)
);
CREATE INDEX demands_event_idx ON demands (event_id);
```

- `min` / `ideal` は SQL の予約語と紛らわしいので `min_count` / `ideal_count`。
  ドメイン型では `min` / `ideal`（[`index.md`](index.md) §5 の仕様名に合わせる）。
- `event_id` は `time_slot_id` から辿れるが、**イベント単位の一括読み出しのために非正規化して持つ**。
  ソルバーとマトリクス表示が毎回イベント全体の需要を引くため。
- **`ideal_count = 0` は「この枠にこの役割は不要」を意味する。** 行を消しても同義。
  読み出し側は「行が無い」と「`ideal = 0`」を同じに扱うこと。

### 2. ドメイン型と不変条件

```ts
export type Demand = {
  timeSlotId: string;
  trackId: string;
  roleId: string;
  min: number;      // 最小必要人数
  ideal: number;    // 理想人数
  leadMin: number;  // リードの最小人数
  newMax: number;   // 初参加者の上限
};
```

`app/features/demand/validate.ts` に純粋関数として置き、**ユニットテストを書く**。

| 不変条件 | 理由 |
|---|---|
| `0 <= min <= ideal` | 最小が理想を超えると充足の定義が壊れる |
| `0 <= leadMin <= ideal` | 埋められないリード条件は永久に未充足になる |
| `0 <= newMax` | |
| `leadMin + (ideal - newMax) <= ideal` を満たす必要はない | リード条件と初参加者上限は独立に評価される |
| `ideal === 0` なら他は全部 0 | 需要のない枠に条件は意味を持たない |

**`leadMin > ideal` を弾くこと**が特に効く。弾かないとソルバーが「絶対に埋まらない枠」を
延々と希少度 1 位に置き続け、他の枠の充足を圧迫する。

### 3. 入力を軽くする 3 つの仕掛け

240 セルを手で埋めさせないための設計。**これがこのステージの主題。**

#### (a) フェーズ単位の入力

需要マトリクスの行を「フェーズ」と「時間枠」で切り替えられるようにする。

- **フェーズ単位**（既定）— 1 行が 1 フェーズ。書き込むとそのフェーズに属する**全時間枠**に
  同じ値を書く
- **時間枠単位** — 1 行が 1 時間枠。個別の枠だけを上書きできる

フェーズ単位の行を表示するとき、そのフェーズ内の時間枠で値が揃っていない場合は
**`*` を付けて「個別の時間枠を上書きしている」ことを示す**。揃っている判定は
`min` / `ideal` / `leadMin` / `newMax` の 4 つすべてが一致することとする。

#### (b) 一括コピー

ある行の需要を、他のフェーズ・他のトラックへ複製する。UI はドロワーに
「この需要を他へコピー」を置き、コピー先を複数選択させる。

#### (c) トラック共通の需要

受付や誘導のように全体で 1 セットあればよい役割は、`tracks.shared` が立つ「全体」トラックに置く。
これによりトラックごとに重複入力しなくてよい。**マトリクスの列は
「需要が 1 つでも定義されている (トラック × 役割) の組み合わせ」だけ**を出す。
6 役割 × 4 トラック = 24 列を全部出すと読めない。

### 4. 需要マトリクス UI

`/e/:id/design` の需要カードとして置く。

- 行 = フェーズ または 時間枠（セグメントコントロールで切替）
- 列 = 需要が定義済みの (トラック × 役割)。ヘッダは 2 段（上にトラック名、下に役割名）
- セル = `最小 / 理想` と、経験構成のバッジ（`L≥1`、`新≤2`）
- 需要のないセルは `–` を出し、クリックで追加できる
- 横スクロールコンテナに入れる（`overflow-x: auto`）

セルをクリックするとドロワーが開き、`min` / `ideal` / `leadMin` / `newMax` を編集できる。
ドロワーには一括コピーも置く。

**列の追加**（まだ需要が 1 つもない (トラック × 役割) を足す）導線を別途用意する。
「役割を追加」ボタンから、イベントで選択済みの役割 × トラックの組み合わせを選ばせる。

### 5. イベント全体の既定

Stage 02 が作ったイベント設定カードに既にある 2 項目が、需要の解釈に効く。
このステージで意味づけを完成させる。

- **`no_solo_newcomer`（既定 true）** — 「初参加者を単独で配置しない」。
  同じ枠にリードまたは経験ありが同席することとして表現し、OJT ペアリングとして扱う。
  ソルバー（Stage 06）と評価が参照する
- **`max_consecutive`（既定 4）** — 連続稼働の上限。休憩枠の確保に使う

MVP ではスキルミックス条件を**必須条件**として扱う。必須 / 推奨の切替は P1
（[`index.md`](index.md) §1 の P1 リスト）なので**作らない**。

### 6. 時間枠変更時の警告

Stage 02 の設定変更で時間枠が作り直されると、キーが一致しなかった枠の需要は消える。
保存前に「時間枠の変更により N 件の需要が失われます」を出す。

`app/features/demand/impact.ts` に純粋関数として置く。

```ts
export function demandLossOnSlotChange(
  existingSlots: { id: string; start: string; end: string }[],
  nextSlots: { start: string; end: string }[],
  demands: Demand[],
): { lostCount: number; lostSlotIds: string[] };
```

Stage 02 の `reconcileSlotKeys` の結果を入力にする。**再実装しない。**

### 制約

- **需要の主キー `(time_slot_id, track_id, role_id)` を変えない。** ソルバーがこのキーで引く。
- **`ideal = 0` と「行が無い」を同義に扱う。** 片方だけを見る読み出しを書かない。
- **`leadMin > ideal` を保存させない。** 絶対に埋まらない枠はソルバーの希少度を汚染する。
- **必須 / 推奨の切替（P1）を作らない。** MVP は全部必須条件。
- **スタッフ登録・稼働可能時間に触らない。** Stage 04 の担当。
- **ソルバーを呼ばない。** このステージに自動生成は無い。Stage 06 / 07 の担当。
- **マトリクスの列を全組み合わせで出さない。** 需要が定義済みの組み合わせだけ。
- **`schema.sql` は生成物。** マイグレーションを直して `migrate:local` で再生成する。
- **1 ファイル 400 行以下。** マトリクスの UI は素直に書くと超える。
  `DemandMatrix.tsx` / `DemandCell.tsx` / `DemandDrawer.tsx` に割る。

---

## Files to touch — 変更ファイル

### 新規

```
roster/migrations/0003_demands.sql
roster/app/features/demand/demand.server.ts
roster/app/features/demand/types.ts
roster/app/features/demand/validate.ts
roster/app/features/demand/validate.test.ts
roster/app/features/demand/impact.ts
roster/app/features/demand/impact.test.ts
roster/app/features/demand/matrix.ts            （行・列の組み立てと「揃っているか」判定）
roster/app/features/demand/matrix.test.ts
roster/app/features/demand/components/DemandMatrix.tsx
roster/app/features/demand/components/DemandCell.tsx
roster/app/features/demand/components/DemandDrawer.tsx
roster/app/features/demand/README.md
```

### 変更

```
roster/app/routes/e.$id.design.tsx        （需要カードを追加。action に需要の保存を足す）
roster/schema.sql                         （生成物）
roster/ARCHITECTURE.md                    （コードマップに demand を追記）
roster/CLAUDE.md                          （Code map の表に追記）
```

ルートは増えないので `route-urls.test.ts` のスナップショットは変わらない。**変わったら
ルートを足している** — このステージの範囲外なので見直すこと。

---

## Verification — 完了条件と検証

### 完了条件

1. `/e/:id/design` の需要マトリクスで、フェーズ単位・時間枠単位を切り替えられる
2. フェーズ単位で入力すると、そのフェーズの全時間枠に同じ値が書かれる
3. 時間枠単位で 1 枠だけ上書きすると、フェーズ単位の表示で `*` が付く
4. 一括コピーで、ある需要を他のフェーズ・他のトラックへ複製できる
5. `leadMin > ideal` を保存しようとするとエラーになる
6. 「全体」トラックに置いた受付の需要が、トラックごとに重複入力されていない
7. イベントの刻み幅を変えると「N 件の需要が失われます」の警告が出る

### コマンド

```sh
pnpm --filter @gdgjp/roster migrate:local
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster dev
```

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`validate.test.ts`: `leadMin > ideal` が拒否される** — 通ると Stage 06 のソルバーが
  「絶対に埋まらない枠」を希少度 1 位に置き続け、**他の枠の充足が静かに悪化する**。
  症状が出るのがソルバー実装後なので、ここで止める
- **`matrix.test.ts`: フェーズ内で 1 枠だけ値が違うとき `uniform === false` になる** —
  ここが甘いと、上書きしたはずの個別設定がフェーズ単位の再入力で気づかず消える
- **`matrix.test.ts`: 需要が 1 つも無い (トラック × 役割) が列に現れない** —
  現れると 24 列出て読めなくなる
- **`impact.test.ts`: 刻み幅を変えたときの `lostCount` が実際に消える件数と一致する** —
  過少に出ると、警告を信じたオーナーが黙って需要を失う
- **`demand.server.test.ts`: `ideal = 0` の行と行なしが同じ結果を返す**

### 手動 E2E

1. Stage 02 の手動 E2E でイベントを作った状態から始める
   （10 枠、フェーズ 2 つ、トラック 3 つ、役割 3 つ）
2. `/e/:id/design` の需要カードで「フェーズ単位」を選ぶ
3. 「開場前 × 全体 / 受付」に `最小 3 / 理想 4`、`L≥1`、`新≤2` を入力
4. 「時間枠単位」に切り替え、開場前の全時間枠に同じ値が入っていることを確認
5. 時間枠単位で 1 枠だけ `最小 1 / 理想 2` に変更
6. 「フェーズ単位」に戻し、そのセルに **`*` が付いている**ことを確認
7. 「セッション × Track A / 配信」に `最小 2 / 理想 2`、`L≥1`、`新≤1` を入力
8. ドロワーの一括コピーで、それを「Track B / 配信」へ複製
9. `L≥3 / 理想 2` を保存しようとして**エラーになる**ことを確認
10. イベント設定で刻み幅を 30 分に変更しようとすると、
    **「N 件の需要が失われます」の警告**が出ることを確認（実行はしない）
