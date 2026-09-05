# Stage 05 — スタッフ一覧と需給ビュー

## Context — 背景とリポジトリ状況

### なぜやるか

募集期間中にオーナーが知りたいのは「あと何人来れば足りるか」ではない。
**「どの時間帯の、どの役割が、頭数で足りないのか、経験者で足りないのか」**である。

合計人数だけを見ていると「20 名集まったから大丈夫」と判断してしまうが、実際には
配信ができる人が 1 人もいない時間帯があり、当日になって破綻する。頭数の不足と経験者の不足を
分けて早期に見せることが、募集の告知内容（「配信経験者を募集中」）に直接つながる。

このステージは Stage 03 の需要と Stage 04 の供給を初めて突き合わせる。**ソルバーはまだ使わない。**
「割り当てたら足りるか」ではなく「そもそも候補がいるか」を見る、より粗くて早い判定である。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 03（需要）と Stage 04（スタッフ登録）の両方の完了が前提。**

対象は `/e/:id/staff` の一覧と需給ビュー、およびオーナーによるスタッフ情報の補正。
**シフト表と割当は Stage 07 の担当。ソルバーは Stage 06 の担当。**

### 読むべきもの

- [`docs/roster/index.md`](index.md) §3（用語と定数）と §5.8（充足不可能性の検出）
- `roster/app/features/demand/` — Stage 03 が作った需要。**再利用する**
- `roster/app/features/applications/` — Stage 04 が作ったスタッフ登録。**再利用する**
- `roster/app/features/schedule/schedule.server.ts` — 時間枠の読み出し

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/demand/demand.server.ts`** — 需要の読み出し。自前で引き直さない。
- **`roster/app/features/applications/applications.server.ts`** /
  `skills.server.ts` / `availability.server.ts` — スタッフの読み出し。
- **`roster/app/features/applications/components/RoleSkillRow.tsx` と
  `AvailabilityGrid.tsx`** — Stage 04 の入力 UI。**オーナーの補正画面で再利用する。**
  同じ入力を 2 度実装しない。
- **`roster/app/features/auth/permissions.ts`** — 権限判定。

### 前提として確認済みの事実（再調査不要）

- `applications.withdrawn` が立つ行は「辞退」。**集計から除外する**。行は残っている。
- `application_skills` に行が無い役割は「担当できない」。`pref` に担当不可の値は無い。
- `availabilities.value` は `o` / `d` / `x` の 3 値。**`x` は稼働不可**。
- 需要は `(time_slot_id, track_id, role_id)` が主キー。`ideal = 0` と行なしは同義。
- `tracks.shared` が立つ「全体」トラックがあるため、**同じ役割の需要が複数トラックに分かれて
  存在しうる**。役割単位の需給を見るには**トラックを横断して合算する**必要がある。

---

## Design — 設計

### 1. 需給の突合（純粋関数）

`app/features/supply/supply.ts` に置く。**DB に触らない純粋関数**にし、ユニットテストを書く。

```ts
export type SlotSupplyDemand = {
  timeSlotId: string;
  need: number;          // その枠の min の合計（全トラック・全役割）
  available: number;     // その枠で稼働可能（x でない）なスタッフ数
  tight: RoleShortage[]; // 役割単位の不足
};

export type RoleShortage =
  | { roleId: string; kind: "head"; lack: number }   // 担当できる人が頭数で足りない
  | { roleId: string; kind: "lead"; lack: number };  // リードが足りない
```

判定ロジック（役割ごと、時間枠ごと）:

1. その枠・その役割の需要を**全トラックで合算**する → `roleMin`、`roleLeadMin`
2. `roleMin === 0` ならスキップ
3. その枠で稼働可能（`x` でない）かつ**その役割を担当できる**スタッフ数を数える → `can`
4. `can < roleMin` なら `{ kind: "head", lack: roleMin - can }`
5. そうでなく、そのうち `level === "lead"` の人数 `canLead` が `canLead < roleLeadMin` なら
   `{ kind: "lead", lack: roleLeadMin - canLead }`

**`head` と `lead` を同時に出さない。** 頭数が足りていない枠で「リードも足りない」と言っても
募集の打ち手は変わらない。頭数が埋まってから経験者の話をする。

**これは上限の見積もりであって割当可能性の保証ではない。** 同じ人が複数の役割を担当できるため、
「受付に 3 人、配信に 2 人の候補がいる」は「同時に 5 人配置できる」を意味しない。
実際に割り当てられるかは Stage 06 のソルバーが判定する。
**UI にこの但し書きを出すこと** — 出さないと「候補はいるのに生成が失敗した」と読まれる。

### 2. スタッフ一覧

`/e/:id/staff` に置く。列は以下。

| 列 | 内容 |
|---|---|
| 氏名 | 表示名。辞退者は取り消し線 + バッジ |
| 担当可能役割 | 役割名 + 経験レベルのタグ。第1希望にマーク |
| 稼働可能な枠数 | `o` の数 / `d` の数を分けて出す |
| 懇親会 | 参加 / 不参加 / 未定。`has_party` が false なら列ごと出さない |
| 最終更新 | `updated_at` と `updated_by`（本人 / オーナー） |

**`updated_by` を出すこと。** オーナーが補正した値なのか本人の申告なのかが分かると、
過大・過小申告の疑いを追える（[ADR-008](adr.md#adr-008-代理登録の本人紐付けを-email-突合で行う)
で「最後に書いた側が勝つ」と決めた代償をここで回収する）。

行をクリックするとドロワーが開き、オーナーが補正できる。

- **経験レベルの補正** — 役割ごとに lead / exp / new を変える
- **稼働可能時間の編集** — Stage 04 の `AvailabilityGrid` を再利用
- **担当役割の追加・削除**
- **辞退の反映**（オーナーが代理で `withdrawn` を立てる）

補正すると `updated_by = 'owner'`、`updated_at` が更新される。

### 3. 需給ビュー

一覧の上に置く。**時間帯ごとに 1 行**、以下を出す。

- 時間枠のラベルとフェーズ名
- 必要人数（`min` の合計）と稼働可能人数
- **不足のバッジ** — `頭数: 配信 2名不足` / `経験者: 配信 リード1名不足`

不足があるときは色で示し、**頭数の不足と経験者の不足を視覚的に分ける**。
バッジをクリックするとその役割・時間帯にフォーカスできると良いが、MVP では表示だけでよい。

さらに一覧の最上部にサマリを置く。

- 登録スタッフ数（辞退を除く）
- **不足している役割の一覧** — 「配信の経験者」「受付の頭数」のように、
  募集告知にそのまま貼れる粒度で出す

### 4. 公開 URL の管理

Stage 04 で `/e/:id/staff` に代理登録の導線だけ置いた。このステージで募集の管理を足す。

- 公開登録 URL の表示と**ワンクリックコピー**
- ステータスの切替（`draft` / `open` / `closed` / …）。`canApply` が false なら
  URL が無効であることを明示する

**URL の再発行（トークンのローテート）は P1 なので作らない。**

### 5. 配置

需給の判定は `app/features/supply/`（新規 feature）に置く。
`demand/` に置くと「需要の入力」と「需給の突合」が混ざり、
`applications/` に置くと需要への依存が逆流する。

**`supply/` が `demand/` と `applications/` の両方を import するのは正しい向き。**
逆（`demand/` が `supply/` を import する）は作らない。

### 制約

- **辞退者（`withdrawn`）を集計から除外する。** 一覧には出す（取り消し線）が、
  需給の数には入れない。
- **`head` と `lead` の不足を同時に出さない。** 頭数が埋まってから経験者の話をする。
- **需給の数字を「割り当て可能性の保証」として書かない。** UI に但し書きを出す。
  同じ人が複数役割を担当できるため、候補数の合計は同時配置可能数ではない。
- **役割単位の需給はトラックを横断して合算する。** 「全体」トラックの受付と
  「懇親会」トラックの受付は同じ役割の需要。
- **ソルバーを呼ばない。** 自動生成は Stage 07 で初めて画面に出る。
- **割当（`assignments`）テーブルを作らない・読まない。** Stage 07 の担当。
- **入力 UI を再実装しない。** Stage 04 の `AvailabilityGrid` / `RoleSkillRow` を再利用する。
  オーナー補正と本人入力で見た目が違うと、どちらが正か分からなくなる。
- **公開 URL のトークンをローテートする機能を作らない。** P1。
- **1 ファイル 400 行以下。** 一覧 + ドロワー + 需給ビューは素直に書くと超える。分割する。

---

## Files to touch — 変更ファイル

### 新規

```
roster/app/features/supply/supply.ts
roster/app/features/supply/supply.test.ts
roster/app/features/supply/supply.server.ts
roster/app/features/supply/components/SupplyDemandRow.tsx
roster/app/features/supply/components/ShortageSummary.tsx
roster/app/features/supply/README.md
roster/app/features/applications/components/StaffTable.tsx
roster/app/features/applications/components/StaffDrawer.tsx
roster/app/features/events/components/ApplyLinkCard.tsx
```

### 変更

```
roster/app/routes/e.$id.staff.tsx          （一覧・需給ビュー・ステータス切替を追加）
roster/app/features/applications/applications.server.ts  （オーナー補正の書き込みを追加）
roster/ARCHITECTURE.md
roster/CLAUDE.md
```

ルートは増えない。`route-urls.test.ts` のスナップショットは**変わらないはず**。

---

## Verification — 完了条件と検証

### 完了条件

1. `/e/:id/staff` に登録スタッフが一覧され、氏名・担当可能役割と経験レベル・稼働可能な枠数・
   懇親会参加可否・最終更新者が見える
2. 時間帯ごとに「必要人数 vs 稼働可能人数」が出る
3. **頭数は足りているが経験者が不足している役割・時間帯に警告が出る**
4. 不足している役割が、募集告知に貼れる粒度でサマリに出る
5. オーナーがドロワーから経験レベル・稼働可能時間・担当役割を補正でき、
   `updated_by` が `owner` になる
6. 辞退したスタッフが集計から外れ、一覧には辞退として残る
7. 公開登録 URL をワンクリックでコピーできる

### コマンド

```sh
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster dev
```

マイグレーションは増えないので `migrate:local` は不要。

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`supply.test.ts`: 頭数が足りているのにリードが 0 の枠で `lead` の不足が出る** —
  **これがこのステージの存在理由そのもの**。ここが出ないと「20 名集まったから大丈夫」で
  当日破綻するという、プロダクトが解こうとしている問題がそのまま残る
- **`supply.test.ts`: 頭数が足りない枠では `head` だけが出て `lead` は出ない** —
  両方出ると募集の打ち手がぼやける
- **`supply.test.ts`: 辞退者が `available` と `can` に数えられない** —
  数えると「足りている」と誤表示され、辞退の影響が見えなくなる
- **`supply.test.ts`: 同じ役割の需要が複数トラックにあるとき合算される** —
  合算しないと「全体の受付」と「懇親会の受付」が別物として扱われ、不足を過小評価する
- **`supply.test.ts`: `x` の枠が `available` に数えられない**
- **オーナー補正で `updated_by` が `owner` になる** — ならないと、
  「最後に書いた側が勝つ」方式で誰が書いたか追えなくなる

### 手動 E2E

1. Stage 03 の需要と Stage 04 の登録がある状態から始める
2. `/e/:id/staff` を開く → スタッフ一覧と需給ビューが出る
3. **配信を担当できるスタッフを全員辞退させる** → 需給ビューの該当時間帯に
   「頭数: 配信 N名不足」が出ることを確認
4. 辞退を戻し、**配信担当者を全員「初参加」に補正する** → 今度は
   「経験者: 配信 リード1名不足」が出る（頭数は足りているので `head` は出ない）ことを確認
5. サマリに「配信の経験者」が不足として挙がっていることを確認
6. ドロワーで 1 名を「リード」に補正 → 警告が消える。`updated_by` が「オーナー」になる
7. 公開登録 URL をコピーし、ステータスを `closed` にすると
   「この URL は現在無効です」が出ることを確認
8. 需給ビューの但し書き（候補数は同時配置可能数ではない旨）が表示されていることを確認
