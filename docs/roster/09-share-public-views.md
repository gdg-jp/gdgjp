# Stage 09 — 共有と公開ビュー

## Context — 背景とリポジトリ状況

### なぜやるか

確定したシフト表をスタッフに配る。ここまでのすべてが、この 1 画面のために作られている。

当日スタッフが実際に見るのは**スマートフォン**であり、全体表は見づらい。初参加者が知りたいのは
「自分は何時から何時まで、どこで、何をするのか」と「困ったら誰に聞けばいいのか」の 2 つだけ。
したがって全体表と**個人ビュー**の両方を用意する。

このステージには**このプロダクトで唯一の完全な公開面**がある。認証なしで誰でも見られる URL なので、
何を出して何を出さないかが最も重要な設計判断になる。**連絡先などの個人情報は含めない。**
**経験レベルも出さない**（[ADR-005](adr.md#adr-005-経験レベルを公開ビューに出さない)）。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 07 完了が前提**（`assignments` が存在し、シフト表が作れる）。
Stage 08（履歴）には依存しない。

対象は `/r/:viewToken` の公開ビュー 4 種と、`/e/:id/share` の共有管理。

### 読むべきもの

- [`docs/roster/index.md`](index.md) §6（画面）— 公開ビューの要件
- [`docs/roster/adr.md`](adr.md#adr-005-経験レベルを公開ビューに出さない) — **ADR-005。このステージの制約の根拠**
- `roster/app/features/events/status.ts` の `canView` — `published` のときだけ公開
- `roster/app/features/roster/components/RoleGrid.tsx` — Stage 07 の役割別ビュー。**再利用する**
- `roster/app/routes/apply.$token.tsx` — Stage 04 の公開ルート。**トークンの扱いの先例**

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/roster/components/RoleGrid.tsx`** — Stage 07 の役割別ビュー。
  **`readOnly` プロパティを足して公開ビューでも使う。** 作り直さない。
- **`roster/app/features/roster/grid.ts`** — 縦結合などの純粋ロジック。
- **`roster/app/features/events/status.ts` の `canView`** — 公開判定。
- **`roster/app/features/roster/roster.server.ts` の `readAssignments`** — 割当の読み出し。
- **`roster/app/features/auth/auth-redirect.server.ts` の `requireUserWithChapter`** —
  `/e/:id/share` 側のゲート。**`/r/:viewToken` には使わない**（認証不要のため）。

### 前提として確認済みの事実（再調査不要）

- `events.view_token` は Stage 02 が推測不可能なランダム値として生成済み。Event ID とは独立。
- `canView(status)` は `published` のときだけ true（Stage 02）。
- `time_slots.idx` は 0 始まりの連番で穴がない。**連続する枠をまとめられる**。
- Stage 07 の `RoleGrid` は既に「顔ぶれか需要が変われば縦結合が切れる」ロジックを持つ。
- スタッフ登録（Stage 04）の公開ルートは、他人の氏名・連絡先をローダーで返していない。
  **このステージの要件は違う** — 公開シフト表は**氏名を出す**（誰と組むか分かる必要がある）。
  出さないのは**連絡先とメールアドレスと経験レベル**。

---

## Design — 設計

### 1. `/e/:id/share`（オーナー側）

- **閲覧専用 URL の表示とワンクリックコピー**
- 現在のステータスと、`published` でなければ「まだ公開されていません」の明示
- **公開されるものの一覧**（何が見えて何が見えないかを、オーナーが配る前に確認できる）

「公開されるもの」に書く内容:

| 公開する | 公開しない |
|---|---|
| イベント名・日付・時間 | メールアドレス・連絡先 |
| スタッフの表示名 | **経験レベル（リード / 経験あり / 初参加）** |
| 役割・トラック・時間 | 備考 |
| 懇親会の参加可否と人数 | 稼働可能時間の申告内容 |

**URL の再発行は P1 なので作らない。**

`published` にすると公開される。公開後にオーナーが編集すると**共有ページにも即座に反映される**
（スナップショットを取らない。常に現在の 1 枚を出す）。

### 2. `/r/:viewToken`（公開）

**認証不要。** `requireUserWithChapter` も `getOptionalUser` も使わない。

- `view_token` で `events` を引く。存在しなければ 404
- `canView(status)` が false なら「シフト表はまだ公開されていません」（**200 で表示**。404 にしない）
- タブで 4 つのビューを切り替える

#### (a) スタッフ別（既定）

縦が時間、横がスタッフ。Stage 07 のスタッフ別ビューと同じ形だが、**列ヘッダに経験レベルを出さない**。
セルは役割名 + トラック名、色でトラックを区別する。担当がない時間は空欄。

#### (b) 役割別

Stage 07 の `RoleGrid` を `readOnly` で使う。

#### (c) 個人ビュー ★

**当日スマートフォンで見るのはこれ。** スタッフを選ぶと、その人の 1 日が時系列で並ぶ。

- **連続する枠をまとめる。** 同じトラック・役割が続く間は 1 項目にし、
  「10:00–12:00 司会 (Track A)」のように出す。1 時間ごとに 10 行出さない
- **担当のない範囲は「休憩 / 担当なし」として明示的に出す**。空白にしない。
  休憩がどこにあるかを知りたいのが当日の関心事
- 各項目に**同じ枠を担当する人の氏名**を出す（「一緒に: 田中さん、佐藤さん」）。
  ひとりの枠は「この枠はひとりです」と明示する
- **連続枠をまとめている場合、同席者は範囲全体の和を取る**。途中で交代した人も含める
- **スマートフォンで見やすいレイアウト**にする。これがこのビューの存在理由

「同席者の氏名」が US-22 の「初参加者が誰に聞けばよいか分かる」を満たす。
**経験レベルのラベルでは満たさない**（[ADR-005](adr.md#adr-005-経験レベルを公開ビューに出さない)）。

#### (d) 懇親会

参加 / 未定 / 不参加の 3 グループに分け、それぞれ人数と氏名を出す。
`events.has_party` が false なら**タブごと出さない**。

### 3. 公開ローダーが返してよいもの

**ローダーの戻り値を明示的に組み立てる。** D1 の行をそのまま返さない。

```ts
type PublicRosterData = {
  event: { name: string; date: string; startTime: string; endTime: string; hasParty: boolean };
  slots: { id: string; idx: number; startTime: string; endTime: string }[];
  tracks: { id: string; name: string; color: string }[];
  roles: { id: string; name: string }[];
  staff: { id: string; name: string; party: PartyValue }[];   // ← name と party だけ
  assignments: { applicationId: string; timeSlotId: string; trackId: string; roleId: string }[];
};
```

**`staff` に含めてよいのは `id` / `name` / `party` の 3 つだけ。**
`email` / `contact` / `note` / `skills` / `availability` を含めない。
`locked` も出さない（オーナーの内部状態）。

辞退者（`withdrawn`）は含めない。

### 4. アーキテクチャテストで固定する ★

[ADR-005](adr.md#adr-005-経験レベルを公開ビューに出さない) は
「UI の見た目だけで担保すると、後から『便利だから』と復活する」と述べている。
**テストで固定する。**

`roster/tests/architecture/public-view-exposure.test.ts` を追加する。

1. `app/features/public-roster/` 配下のソースが、経験レベルを表す型・定数
   （`Level` / `LEVELS` / `"lead"` / `"exp"`）を import・参照していないこと
2. `app/routes/r.$token.tsx` のローダーが返す型に `email` / `contact` / `note` /
   `skills` / `availability` が現れないこと

1 は import 解析、2 は型の構造検査が難しいので、**ローダーの戻り値を実際に呼び出して
キーを検査するユニットテスト**で代替してよい。`wiki/tests/architecture/` の
`readFileSync` + 正規表現でソースを走査するパターンが既存の手本になる。

`route-urls.test.ts` のスナップショットにも `/r/:viewToken` が入る。
**公開 URL が増えたことがレビューで必ず目に入る**という、このテストの本来の目的が効く場面。

### 5. E2E

**このステージの E2E が最も重要。** 公開面なので実害が直接的。

`roster/e2e/public-roster.spec.ts`:

1. `status = closed` のイベントの `/r/:token` が「まだ公開されていません」を出す
2. `published` にすると全体表が見える
3. **ページの HTML にスタッフのメールアドレスが 1 つも含まれない**
4. **ページの HTML に「リード」「経験あり」「初参加」の文字列が含まれない**
5. 個人ビューで連続枠がまとまり、休憩が明示される
6. 存在しないトークンが 404

3 と 4 は `page.content()` に対する文字列検査でよい。**素朴だが確実**で、
ローダーが余計なものを返していれば SSR の HTML に載る。

### 制約

- **`/r/:viewToken` に認証を要求しない。** 誰でも見られる URL。
- **公開ローダーが `email` / `contact` / `note` / `skills` / `availability` / `locked` を返さない。**
  UI に出していなくても JSON に載れば漏れている。
- **経験レベルを公開ビューに出さない。** ラベルでも色でも並び順でも。
  ADR-005 の決定であり、architecture テストで固定する。
- **辞退者を公開ビューに出さない。**
- **`canView` が false のとき 404 にしない。** 200 で「まだ公開されていません」。
  URL を配った後に 404 だと壊れたように見える。
- **公開時にスナップショットを取らない。** 常に現在の 1 枚を出す。
  公開後にオーナーが編集したら即座に反映される。
- **個人ビューで連続枠をまとめる。** 1 時間ごとに 10 行出さない。
- **個人ビューで担当のない範囲を明示的に出す。** 空白にしない。
- **`RoleGrid` を作り直さない。** `readOnly` を足して再利用する。
- **URL の再発行（トークンのローテート）を作らない。** P1。
- **印刷向けレイアウトを作らない。** P1。
- **1 ファイル 400 行以下。**

---

## Files to touch — 変更ファイル

### 新規

```
roster/app/features/public-roster/types.ts
roster/app/features/public-roster/public-roster.server.ts   （公開ローダーのデータ組み立て）
roster/app/features/public-roster/public-roster.server.test.ts
roster/app/features/public-roster/timeline.ts               （個人ビューの連続枠まとめ。純粋関数）
roster/app/features/public-roster/timeline.test.ts
roster/app/features/public-roster/components/PublicStaffGrid.tsx
roster/app/features/public-roster/components/PersonTimeline.tsx
roster/app/features/public-roster/components/PartyList.tsx
roster/app/features/public-roster/README.md
roster/app/routes/r.$token.tsx
roster/app/routes/e.$id.share.tsx
roster/app/features/events/components/ShareCard.tsx
roster/tests/architecture/public-view-exposure.test.ts
roster/e2e/public-roster.spec.ts
```

### 変更

```
roster/app/routes.ts                       （r/:token と e/:id/share を追加）
roster/app/features/roster/components/RoleGrid.tsx   （readOnly プロパティを追加）
roster/ARCHITECTURE.md                     （「規約を強制しているテスト」に 1 本追加）
roster/CLAUDE.md
roster/README.md                           （画面一覧を完成させる）
roster/tests/architecture/__snapshots__/route-urls.test.ts.snap
```

---

## Verification — 完了条件と検証

### 完了条件

1. `/e/:id/share` で閲覧専用 URL をコピーでき、公開されるものの一覧が見える
2. `published` にすると `/r/:viewToken` が認証なしで見られる
3. 閲覧者は編集できず、**連絡先などの個人情報も見えない**
4. **経験レベルがどこにも表示されない**
5. 個人ビューで、開始・終了時刻・役割・トラックが時系列に並び、**休憩時間が明示される**
6. 個人ビューで**同じ枠を担当する人が分かる**
7. **スマートフォンで見やすい**レイアウトになっている
8. 公開後にオーナーが編集すると共有ページにも反映される
9. 懇親会タブに参加 / 不参加 / 未定の人数と氏名が出る（`has_party` が false なら出ない）

### コマンド

```sh
pnpm --filter @gdgjp/roster typecheck
pnpm --filter @gdgjp/roster test
pnpm --filter @gdgjp/roster test:e2e
pnpm --filter @gdgjp/roster dev
```

マイグレーションは増えないので `migrate:local` は不要。

### 回帰として固定すべきテスト

**このステージは公開面なので、漏洩の経路を最優先で押さえる。**

- **`e2e/public-roster.spec.ts`: 公開ページの HTML にメールアドレスが 1 つも含まれない** —
  **最重要。** ローダーが `staff` の行をそのまま返すように書き換わった瞬間に落ちる。
  UI に出していなくても SSR の HTML に載るので、この素朴な文字列検査が確実に効く
- **`e2e/public-roster.spec.ts`: 公開ページの HTML に「リード」「経験あり」「初参加」が
  含まれない** — ADR-005 の決定を実効化する。「便利だから」で復活する経路を塞ぐ
- **`public-view-exposure.test.ts`: 公開ビューのソースが経験レベルの型・定数を参照しない** —
  上の E2E は「たまたま今のデータに lead がいない」で通ってしまう可能性があるので、
  ソース側からも固定する
- **`public-roster.server.test.ts`: ローダーの戻り値のキーに `email` / `contact` / `note` /
  `skills` / `availability` / `locked` が現れない** — 戻り値を実際に呼んでキーを検査する
- **`public-roster.server.test.ts`: 辞退者が含まれない**
- **`public-roster.server.test.ts`: `canView` が false のとき割当を返さない** —
  「まだ公開されていません」の表示だけでは不十分。**データ自体を返してはならない**。
  返していると、HTML に載らなくても RR の hydration データから読める
- **`timeline.test.ts`: 連続する同一トラック・役割の枠が 1 項目にまとまる**
- **`timeline.test.ts`: 担当のない範囲が「休憩」項目として出る**（欠落しない）
- **`timeline.test.ts`: まとめた範囲の同席者が範囲全体の和になる** —
  最初の枠だけ見ていると、途中で交代した人が抜ける
- **`route-urls.test.ts`: 公開 URL が 2 つ（`/apply/:token` と `/r/:token`）であること**

### 手動 E2E

1. Stage 07 でシフト表を作ったイベントを用意する
2. `/e/:id/share` を開く → まだ `closed` なので「まだ公開されていません」
3. 「公開されるもの」の一覧に、経験レベルと連絡先が**公開しない側**に列挙されていることを確認
4. ステータスを `published` にし、閲覧 URL をコピー
5. **シークレットウィンドウ**でその URL を開く → **サインインを求められずに**全体表が見える
6. ブラウザの「ページのソースを表示」で、**メールアドレスと「初参加」の文字列を検索し、
   0 件であること**を確認
7. 個人ビューに切り替え、スタッフを選ぶ →
   - 連続する枠が「10:00–12:00 司会 (Track A)」のようにまとまっている
   - 担当のない範囲が「休憩 / 担当なし」として出ている
   - 各項目に同席者の氏名が出ている。ひとりの枠は「この枠はひとりです」
8. **ブラウザの開発者ツールでモバイル表示（375px 幅）にし**、個人ビューが読めることを確認
9. 懇親会タブで参加 / 未定 / 不参加の人数と氏名が出ることを確認
10. オーナー側でシフトを 1 箇所編集 → シークレットウィンドウを再読み込みして**反映される**ことを確認
11. `view_token` を 1 文字変えた URL を開く → **404**
12. ステータスを `closed` に戻す → 公開ページが「まだ公開されていません」に変わる
