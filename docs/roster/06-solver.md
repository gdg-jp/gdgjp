# Stage 06 — ソルバー（貪欲法 + 局所探索）

## Context — 背景とリポジトリ状況

### なぜやるか

シフト表の自動生成そのもの。ただし**自動生成は最終解ではなく「編集可能なたたき台」**であり、
厳密解は狙わない。数百ミリ秒で「だいたい妥当な 1 枚」を出し、あとは人間が直す、という分業が
このプロダクトの基本方針。

もう一つの価値が**充足不可能性の検出**である。条件を満たす解が存在しないとき「解なし」と言うのではなく、
**どの時間枠のどのトラック・役割で、頭数が足りないのか経験者が足りないのか**を返す。
これが募集告知（「配信経験者を募集中」）に直結する。

このステージは **UI にも D1 にも触らない**。入力はプレーンなオブジェクト、出力は割当と評価レポート。
純粋な計算モジュールとして単体で完成させ、Stage 07 が Worker の action から呼ぶ。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**
**§5（ソルバー仕様）がこのステージの仕様の正本である。** 以下は要点の再掲であり、
矛盾があれば `index.md` §5 を正とする。

### 依存と対象範囲

**Stage 02 完了が前提**（ドメインの型が定まっている）。
**Stage 03〜05 には依存しない。並行して実装できる。**

対象は `roster/app/features/solver/` のみ。**ルートもコンポーネントも作らない。**
D1 から値を読んで渡す配線は Stage 07 の担当。

### 読むべきもの

- [`docs/roster/index.md`](index.md) **§5 全体** — **仕様の正本**
- [`docs/roster/index.md`](index.md) §3（用語と定数） — `level` / `pref` / `availability` の値
- [`docs/roster/adr.md`](adr.md#adr-004-ソルバーを-worker-の-action-内で実行する) — ADR-004
- `roster/app/features/demand/types.ts` — `Demand` 型（Stage 03。**未完了なら型だけ先に定義する**）
- `roster/app/features/applications/types.ts` — スタッフ型（Stage 04。同上）
- `roster/ARCHITECTURE.md` — 配置ルールと 400 行上限

### 再利用する既存実装 — 書き直さないこと

このステージは新規実装がほとんどだが、以下は既存のものを使う。

- **`roster/app/features/demand/types.ts` の `Demand`** — 需要の型。ソルバー用に再定義しない。
  Stage 03 が未完了なら、`index.md` §4 の仕様に沿って型だけ先に置き、Stage 03 がそれを使う。
- **`roster/app/features/applications/types.ts`** — スタッフ・スキル・稼働の型。同上。

**ソルバーは自分用の入力型 `SolverInput` を定義してよい**（DB の行そのままではなく、
計算に必要な形に整えたもの）。ただしドメイン型を再発明しない。

### 前提として確認済みの事実（再調査不要）

- `time_slots.idx` は 0 始まりの連番で穴がない（Stage 02 が保証）。
  「直前の枠」は `idx - 1` で引ける。
- `application_skills` に行が無い役割は「担当できない」。
- 需要は `ideal = 0` と行なしが同義。
- 割当のキーは `(applicationId, timeSlotId)`。**この形が「同一スタッフを同一時間枠に 2 箇所へ
  割り当てない」というハード制約の実装本体**である（[`index.md`](index.md) §4）。

---

## Design — 設計

### 1. 入出力の形

```ts
export type SolverInput = {
  slots: { id: string; idx: number }[];              // idx 昇順
  tracks: { id: string }[];
  roles: { id: string }[];
  demands: Map<string, Demand>;                      // key = `${slotId}|${trackId}|${roleId}`
  applications: SolverApplication[];
  options: { noSoloNewcomer: boolean; maxConsecutive: number; seed: number };
};

export type SolverApplication = {
  id: string;
  withdrawn: boolean;
  skills: Record<string, { level: Level; pref: 1 | 2 }>;  // 担当できる役割のみ
  availability: Record<string, "o" | "d" | "x">;          // slotId -> 値
};

export type Assignments = Map<string, { trackId: string; roleId: string; locked: boolean }>;
// key = `${applicationId}|${slotId}`

export function solve(
  input: SolverInput,
  opts?: { keepLocked?: boolean; seed?: number },
): { assignments: Assignments; report: Report };
```

**`Map` と文字列キーで持つ。** `(applicationId, slotId)` を 1 つのキーにすることで、
同一スタッフの同一枠 2 箇所が構造的に作れなくなる。オブジェクトの配列で持つとこの保証が消える。

### 2. 絶対に破らない条件（ハード制約）

`hardViolations(input, app, slot, trackId, roleId, assignments): string[]` として実装し、
空配列のときだけ配置する。

1. その `(app, slot)` に既に割当がある
2. その役割を担当できない（`skills[roleId]` が無い）
3. その枠の稼働が `x`
4. 辞退している（`withdrawn`）
5. 需要が無い、または `ideal === 0`

スキルミックス（`leadMin` / `newMax` / 初参加者の単独配置禁止）は候補フィルタ側で担保する
（下記 4）。

**この関数は Stage 07 の手動編集からも呼ばれる。** ただし手動編集では**警告して続行させる**。
戻り値を「禁止」ではなく「警告メッセージのリスト」として設計すること。
**一貫性のためと称して手動編集側を禁止に倒さない** — 当日の例外運用がある。

### 3. 決定的乱数

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**`Math.random()` を一切使わない。** 同じ入力と同じシードで同じ結果を返すことが必須要件。

### 4. 生成フロー（7 段）

#### ① 需要セルを希少度順に並べる

```
希少度 = eligible − demand.min + leadPressure
  eligible     = 辞退しておらず、その役割を担当でき、その枠が x でない人数
  leadPressure = demand.leadMin > 0 ? (leads − demand.leadMin) * 0.5 : 5
  leads        = eligible のうち level === "lead" の人数
```

昇順（希少なものが先）。同値なら `slot.idx` 昇順。`ideal === 0` のセルは対象外。

`leadMin === 0` のとき `leadPressure = 5` にしているのは、**リード条件のない枠を後回しにする**ため。
条件が厳しい枠から埋めないと、経験者が先に消費されて詰む。

#### ② リードの最小人数を先に確保

`level === "lead"` の候補だけを対象に、`leadMin` に達するまで、または目標人数に達するまで配置する。

#### ③ 最小必要人数まで充足（第1パス、目標 = `min`）
#### ④ 理想人数へ近づける（第2パス、目標 = `ideal`）

③④ で初参加者を追加するときの候補フィルタ:

- `level !== "new"` なら常に候補
- `level === "new"` のとき:
  - 現在の枠の `new` 人数が `newMax` 以上なら**除外**
  - `noSoloNewcomer` が有効で、**経験者が 1 人もおらず、かつ今が最後の 1 席**（`members.length === target - 1`）なら**除外**

「最後の 1 席」で判定するのは、途中の席で初参加者を弾くと埋まらなくなるため。
最後まで経験者が来なかった枠だけを空けておき、⑥ で入れ替えを試みる。

#### ⑤ 局所探索で負荷を均す

- 最大 40 パス。`max(load) − min(load) <= 2` で打ち切る
- 最も重いスタッフを乱数で 1 人選び、その `locked` でない割当を 1 つ、
  `load <= min` かつその枠の稼働が **`o`**（`d` は使わない）のスタッフへ移す
- **移した結果 `leadMin` を割る、または `newMax` を超える場合は移さない**
- 1 パスで 1 件も移せなければ打ち切る

#### ⑥ OJT スワップ

初参加者だけで構成された枠 A を、同じ時間帯の別の枠 B にいる経験者と入れ替える。

条件（すべて満たすときだけ入れ替える）:

- B の経験者が A の役割を担当でき、A の役割で `level !== "new"`
- **入れ替え後も B に経験者が残る**
- 入れ替え後の B が `leadMin` を割らない
- A の初参加者が B の役割を担当でき、入れ替え後の B が `newMax` を超えない

**崩せない場合は入れ替えない。** 無理に動かすより、違反として報告するほうが役に立つ。

#### ⑦ 評価

`evaluate(input, assignments)` を呼んでレポートを返す（下記 6）。

### 5. 候補コスト

`candidateCost(ctx, app, slot, trackId, roleId): number`。**低いほど先に配置する。**

加点方式ではなく、**「不満のコスト」を最小化する減点方式**で書く。

| 項目 | コスト |
|---|---|
| 稼働 `o` | `0` |
| 稼働 `d`（△） | `+4.5` |
| 稼働 `x`（×） | `+Infinity` |
| `pref === 1`（第1希望） | `−6` |
| `pref === 2`（可） | `0` |
| `pref` なし | `+3` |
| 総稼働枠数 | `+1.6 × load[app.id]` |
| 直前の枠と同じトラック・役割 | `−3.5` |
| 直前の枠と別トラック | `+1.2` |
| 連続稼働が `maxConsecutive` に到達 | `+12` |
| 連続稼働が `maxConsecutive − 1` | `+4` |
| その役割で `level === "lead"` | `+0.8` |
| タイブレーク | `+ rng() * 0.4` |

**この数値をそのまま使う。** 「だいたい同じ」で実装すると、比較対象がないまま挙動がずれる。
プロトタイプは既に削除されているため復旧できない
（[ADR-009](adr.md#adr-009-prd-とプロトタイプをリポジトリに置かない)）。

「直前の枠」は `slot.idx > 0` のときだけ見る。連続稼働は `idx` を遡って割当が途切れるまで数える。

各コストの理由（コメントに残すこと）:

- 第1希望 −6 — 希望しない役割ばかりでは次回の募集に応じてもらえない
- 稼働 △ +4.5 — `o` で埋まらない場合にだけ使う
- 総稼働枠数 +1.6 — 負荷の公平性
- 同じトラック・役割 −3.5 — 引き継ぎ回数を減らす
- トラック間移動 +1.2 — 移動時間を減らす
- 連続稼働 +12 — 休憩枠を確保する
- リード +0.8 — 経験者を一箇所に集めず、トラック間に散らす

### 6. 評価レポート

```ts
export type Report = {
  shortages: Shortage[];   // kind: "headcount" | "lead"
  violations: Violation[]; // kind: "newcomerOver" | "soloNewcomer" | "over"
  metrics: Metrics;
};
```

**不足と違反を分ける。** 不足は「埋まっていない」、違反は「埋まっているが条件を破っている」。
`over`（`ideal` 超過）は手動編集の結果としてしか起きないので、不足とは別枠にする。

`metrics`:

| 項目 | 内容 |
|---|---|
| `demandMin` / `demandIdeal` | 需要の合計 |
| `filled` | 充足数（各セルで `min(members, ideal)` の合計） |
| `idealRate` | `filled / demandIdeal` |
| `minShortage` | `headcount` 不足の合計 |
| `leadShortage` | `lead` 不足の合計 |
| `assigned` | 割当の総数 |
| `firstChoiceRate` | 第1希望の役割に割り当てられた割合 |
| `loadStdev` / `loadMax` / `loadMin` | 負荷のばらつき |
| `softUsed` | `d`（△）を使った枠数 |
| `overwork` | 連続稼働が `maxConsecutive` を**超えた**スタッフ |
| `violationCount` | 違反の件数 |

**`evaluate` は `solve` から独立して呼べること。** Stage 07 の手動編集後と Stage 08 の履歴で
同じ関数を使う。

### 7. 手動編集の候補提示

```ts
export function suggestFor(
  input: SolverInput, assignments: Assignments,
  slotId: string, trackId: string, roleId: string,
): Suggestion[];
```

その枠に入れられる候補を返す。並び順は「空いていて `o`」→「空いていて `d`」→「他に担当がある」→
「稼働不可」。同順位は `pref` 昇順。

**稼働不可の人も返す**（除外しない）。手動編集では警告のうえ配置できるため、
候補から消すと「なぜこの人が出ないのか」が分からなくなる。警告文を添えて返す。

### 8. 規模ベンチ（このステージの必須成果物）

[ADR-004](adr.md#adr-004-ソルバーを-worker-の-action-内で実行する) で Worker 内実行を選んだ根拠が
「数秒以内で終わる」であり、**これを実測せずに Stage 07 へ進まない。**

`solver.bench.test.ts` を書く。

- **スタッフ 100 名 × 時間枠 60 × 役割 10 × トラック 4**
- 決定的に生成した入力（シード固定）で `solve` を回す
- 実行時間を測り、**明らかに劣化したら落ちる上限**をアサートする
  （CI マシンの速度差を考え、余裕を持った値。例: 10 秒）
- 結果として、この規模で何ミリ秒かかったかを**計画の完了報告に書く**

刻み幅を細かくすると時間枠数に比例して探索空間が増える。実測値を
[`index.md`](index.md) §9 の未決定事項 4（刻み幅の既定値と想定最大規模）に反映する。

**10 秒を超えるようなら Stage 07 へ進む前に報告して止まる。** クライアント実行への移行や
アルゴリズムの見直しが要る。

### 制約

- **D1 にも React にも `fetch` にも `window` にも依存しない。** 入出力はプレーンなオブジェクト。
  これが単体テストと再現性検証を成立させている唯一の条件。
- **`Math.random()` を使わない。** `mulberry32` のみ。
- **`index.md` §5.3 のコスト定数をそのまま使う。** 独自に調整しない。
- **割当のキー `${applicationId}|${slotId}` を変えない。** ハード制約の実装本体。
- **`hardViolations` を「禁止」として設計しない。** 警告メッセージのリストを返す。
  Stage 07 の手動編集がこれを警告として使う。
- **`suggestFor` から稼働不可の候補を除外しない。** 警告付きで返す。
- **UI を作らない。ルートを作らない。D1 を読まない。** Stage 07 の担当。
- **`keepLocked` オプションは実装するが UI は作らない。** ロック UI は P1
  （[`index.md`](index.md) §1）。ソルバー側の受け口だけ用意しておく。
- **1 ファイル 400 行以下。** `solve.ts` / `cost.ts` / `constraints.ts` / `evaluate.ts` /
  `local-search.ts` / `ojt-swap.ts` / `suggest.ts` / `random.ts` に割る。
  1 ファイルに詰めると必ず超える。

---

## Files to touch — 変更ファイル

### 新規

```
roster/app/features/solver/types.ts
roster/app/features/solver/random.ts
roster/app/features/solver/random.test.ts
roster/app/features/solver/constraints.ts
roster/app/features/solver/constraints.test.ts
roster/app/features/solver/cost.ts
roster/app/features/solver/cost.test.ts
roster/app/features/solver/scarcity.ts
roster/app/features/solver/scarcity.test.ts
roster/app/features/solver/local-search.ts
roster/app/features/solver/local-search.test.ts
roster/app/features/solver/ojt-swap.ts
roster/app/features/solver/ojt-swap.test.ts
roster/app/features/solver/evaluate.ts
roster/app/features/solver/evaluate.test.ts
roster/app/features/solver/suggest.ts
roster/app/features/solver/suggest.test.ts
roster/app/features/solver/solve.ts
roster/app/features/solver/solve.test.ts
roster/app/features/solver/solver.bench.test.ts
roster/app/features/solver/fixtures.ts          （決定的なテスト入力の生成）
roster/app/features/solver/README.md
```

### 変更

```
roster/ARCHITECTURE.md      （コードマップに solver を追記）
roster/CLAUDE.md            （Code map の表に追記）
```

Stage 03 / 04 が未完了の場合のみ、以下を先行して作る（それぞれのステージがこれを使う）。

```
roster/app/features/demand/types.ts
roster/app/features/applications/types.ts
```

---

## Verification — 完了条件と検証

### 完了条件

1. `solve` が `index.md` §5 の 7 段フローどおりに動く
2. **同じ入力と同じシードで、何度呼んでも完全に同じ割当が返る**
3. ハード制約を破る割当が自動生成では 1 件も作られない
4. 解が無い入力に対して「解なし」ではなく、**頭数の不足と経験者の不足を区別した内訳**が返る
5. **規模ベンチ（100 名 × 60 枠 × 10 役割 × 4 トラック）の実測値が記録されている**
6. `app/features/solver/` の全ファイルが 400 行以下

### コマンド

```sh
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster typecheck

# 単一ファイル
pnpm --filter @gdgjp/roster exec vitest run app/features/solver/solve.test.ts

# ベンチだけ
pnpm --filter @gdgjp/roster exec vitest run app/features/solver/solver.bench.test.ts
```

D1 に触らないので `migrate:local` も `dev` も不要。**これがこのステージの設計目標**でもある。

### 回帰として固定すべきテスト

**静かに壊れる経路を名指しで押さえる。**

- **`solve.test.ts`: 同じ入力・同じシードで 2 回呼ぶと `assignments` が完全一致する** —
  **このステージ最重要の回帰**。`Math.random()` の混入、`Object.keys` の順序依存、
  `Set` / `Map` の反復順への依存はどれもここでしか捕まらない。壊れると
  「再生成のたびに結果が変わる」という形で Stage 08 の履歴比較が無意味になる
- **`solve.test.ts`: シードを変えると結果が変わる** — 上の裏返し。
  乱数が効いていないと固定されたように見えて実は選択肢を探索していない
- **`constraints.test.ts`: 自動生成の結果に「同一スタッフが同一枠に 2 箇所」が存在しない** —
  `Map` のキー設計が守っているが、キーを変えた瞬間に壊れる
- **`constraints.test.ts`: 稼働 `x` の枠に自動生成では配置されない**
- **`local-search.test.ts`: 入れ替えで `leadMin` を割らない / `newMax` を超えない** —
  ここが甘いと、①〜④ で正しく組んだ経験構成を⑤が静かに壊す。
  評価は通ってしまう（違反として報告されるだけ）ので気づきにくい
- **`ojt-swap.test.ts`: 入れ替え先に経験者が残らない場合は入れ替えない** —
  同上。片方を直して他方を壊す
- **`evaluate.test.ts`: 頭数の不足と経験者の不足が別々に集計される** —
  混ざると募集告知の打ち手が決められない
- **`evaluate.test.ts`: `soloNewcomer` が `noSoloNewcomer` 有効時にのみ違反になる**
- **`cost.test.ts`: 稼働 `x` のコストが `Infinity`** — 有限値だと極端な状況で
  稼働不可の人が選ばれる
- **`suggest.test.ts`: 稼働不可の候補も警告付きで返る**（除外されない）
- **`solver.bench.test.ts`: 想定規模が上限時間内に終わる**

### 手動 E2E

このステージは UI を持たないため、画面操作の手順は無い。代わりに以下を実施する。

1. `fixtures.ts` に、`index.md` の例に近い規模の入力を作る
   （10 枠 / 4 トラック / 6 役割 / 16 名。うち初参加者を数名、リードを役割ごとに 1〜2 名）
2. `solve` を実行し、返ってきた割当を**コンソールに表を出して目視する**
   （縦が時間、横がスタッフ）
3. 目視で確認する:
   - 空欄（休憩）が適度に入っており、誰も全枠連続で埋まっていない
   - 第1希望の役割に入っている人が多い
   - 初参加者だけの枠が無い
   - 同じ人が連続する枠で同じ役割・トラックに留まる傾向がある
4. **リードを全員外した入力**で実行し、`leadShortage` に該当の枠が並ぶことを確認
5. **需要を供給の 2 倍にした入力**で実行し、`minShortage` に頭数不足が並ぶことを確認
6. 4 と 5 を同時に起こした入力で、**両者が混ざらず別々に報告される**ことを確認
7. ベンチの実測値を記録し、完了報告に書く
