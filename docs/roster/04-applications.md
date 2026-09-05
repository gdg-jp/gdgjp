# Stage 04 — 募集と公開登録フォーム

## Context — 背景とリポジトリ状況

### なぜやるか

シフト表の供給側。オーナーが公開 URL を配り、スタッフ希望者が自分で登録する。
募集の返信をスプレッドシートに人力で転記する作業をなくすのが、このプロダクトの出発点であり、
このステージがその中核。

設計の中心は、**稼働可能時間を自由入力ではなく、オーナーが定義した時間枠へのチェックボックスとして
受け取ること**。需要・供給・割当・表示がすべて同じ格子の上で完結するのはこのためで、
Stage 03 の需要と Stage 06 のソルバーがそのまま join できる。

**スタッフ登録には GDG アカウント（accounts.gdgs.jp）でのサインインを必須とする。** これにより
二重登録となりすましを防げ、端末を変えても自分の登録を編集でき、表示名とメールアドレスを
アカウントから引き継げる。ただし **Chapter 所属は要求しない** — Chapter 外の一般参加者も
スタッフになれる必要があるため。

全体計画は [`docs/roster/index.md`](index.md) にある。**着手前に必ず読むこと。**

### 依存と対象範囲

**Stage 02 完了が前提**（`events` / `time_slots` / `roles` / `event_roles` が存在する）。
Stage 03（需要）には依存しない — 並行して進んでいてよい。

対象は `roster/app/features/applications/` と公開ルート `/apply/:applyToken`、
およびオーナーの代理登録。**スタッフ一覧と需給ビューは Stage 05 の担当。**

### 読むべきもの

- [`docs/roster/index.md`](index.md) §3（用語と定数）と §4（ドメインモデル） — **仕様の正本**
- [`docs/roster/adr.md`](adr.md#adr-008-代理登録の本人紐付けを-email-突合で行う) — ADR-008（代理登録）
- `roster/app/features/events/status.ts` の `canApply` — 公開 URL の有効・無効
- `roster/app/features/auth/auth-redirect.server.ts` — `requireUserWithChapter` と
  `getOptionalUser` の使い分け
- `tinyurl/app/lib/permissions.ts` — **email-as-principal の先例**。
  「サインイン前に共有できるよう、メールアドレスを principal にする」考え方
- `tinyurl/CLAUDE.md` の Auth 節 — 同上の背景

### 再利用する既存実装 — 書き直さないこと

- **`roster/app/features/auth/auth.server.ts` の `getAuth(env)`** — セッション取得。
- **`roster/app/features/auth/auth-redirect.server.ts` の `getOptionalUser`** —
  未サインインを許すルートで使う。`/apply/:token` は**未サインインでも概要が見える**必要がある。
- **`roster/app/features/auth/auth-redirect.server.ts` の `requireUserWithChapter`** —
  オーナー側のルートだけに使う。**`/apply/:token` には使わない**（Chapter を要求しないため）。
- **`roster/app/lib/return-to.ts` の `safeReturnTo`** — サインイン後に元の画面へ戻す。
- **`roster/app/features/schedule/schedule.server.ts`** — 時間枠とイベント役割の読み出し。
- **`roster/app/features/events/status.ts` の `canApply`** — `open` のときだけ登録を受け付ける。

### 前提として確認済みの事実（再調査不要）

- **`accounts` に利用者検索 API は無い。** 公開されているのは自分自身のトークンで呼ぶ
  `/userinfo` のみ。したがって代理登録で「一覧から選ぶ」UI は作れない
  （[ADR-008](adr.md#adr-008-代理登録の本人紐付けを-email-突合で行う)）。
- `gdg-lib` の `RpAuthInstance` は `getSessionUser` / `requireUser` / `getFreshClaims` /
  `handleAuthRequest` / `handleSignOutRedirect` を持つ。`AuthUser` にはメールと表示名が入る。
- `events.apply_token` は Stage 02 が推測不可能なランダム値として生成済み。
- `time_slots.idx` は 0 始まりの連番で穴がない。

---

## Design — 設計

### 1. マイグレーション `0004_applications.sql`

```sql
CREATE TABLE applications (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT,                        -- NULL 許容。代理登録のみ NULL
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  contact      TEXT,                        -- 当日の連絡手段（任意）
  party        TEXT NOT NULL DEFAULT 'undecided'
                 CHECK (party IN ('yes','no','undecided')),
  note         TEXT,
  withdrawn    INTEGER NOT NULL DEFAULT 0,
  updated_by   TEXT NOT NULL DEFAULT 'self' CHECK (updated_by IN ('self','owner')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX applications_event_user ON applications (event_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX applications_event_email ON applications (event_id, email);

CREATE TABLE application_skills (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role_id        TEXT NOT NULL REFERENCES roles(id),
  level          TEXT NOT NULL DEFAULT 'new' CHECK (level IN ('lead','exp','new')),
  pref           INTEGER NOT NULL DEFAULT 2 CHECK (pref IN (1,2)),
  PRIMARY KEY (application_id, role_id)
);

CREATE TABLE availabilities (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  time_slot_id   TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  value          TEXT NOT NULL CHECK (value IN ('o','d','x')),
  PRIMARY KEY (application_id, time_slot_id)
);
```

**二重登録防止は 2 本の UNIQUE で行う。**

- `(event_id, user_id)` — **部分インデックス**（`WHERE user_id IS NOT NULL`）。
  SQLite の UNIQUE は NULL を重複と見なさないが、意図を明示するため部分インデックスにする。
  代理登録が複数あっても衝突しない
- `(event_id, email)` — 代理登録と本人登録が同じ人を指すことを防ぐ

**担当できない役割は `application_skills` に行を作らない。** `pref` に「担当不可」の値を持たせない。

### 2. 公開登録フォーム `/apply/:applyToken`

#### 未サインイン時

**イベント概要と募集中の役割を表示する。** ここで登録はできないが、
「何のイベントで、どんな役割を募集しているか」は見える必要がある
（見えないと、サインインするかどうかを判断できない）。

サインインボタンは `safeReturnTo` を使って `/apply/:applyToken` に戻す。

#### 募集中でないとき

`canApply(event.status)` が false なら、**「募集は終了しました」を表示する**。
404 にしない — URL が生きているのに 404 だと、配布した告知が壊れたように見える。

#### サインイン済みのとき

既に登録があればフォームを**編集モード**で開く（二重登録させない）。

入力項目:

| 項目 | 必須 | 挙動 |
|---|---|---|
| 表示名 | 必須 | アカウント名を初期値とし、変更可。シフト表に表示される |
| 当日の連絡手段 | 任意 | 未入力ならアカウントのメールを使う |
| 担当できる役割 | 必須 | イベントで選択済みの役割から複数選択。各役割に**経験レベルと希望度** |
| 稼働可能時間 | 必須 | 時間枠ごとに ○ / △ / × |
| 懇親会の参加可否 | 必須 | 参加 / 不参加 / 未定。`has_party` が false なら出さない |
| 備考 | 任意 | 自由記述 |

**入力負荷を上げすぎない工夫:**

- 経験レベルの既定は `new`（初参加）。**選択済みの役割にのみ追加で問う**
- 各レベルの意味を UI に併記する（`index.md` §3 の表の「意味」列）
- 稼働可能時間にショートカットを置く: 「終日 ○」「すべて ×」「午前のみ」「午後のみ」
- 稼働可能時間の各行にフェーズ名を併記する（「09:00–10:00 / 開場前」）

`△` の意味を明記する: 「**○ で埋まらない場合にだけ使われます**」。これを書かないと
全部 △ で出す人が出て、ソルバーのコストモデルが機能しなくなる。

#### 編集と辞退

サインインしていれば**どの端末からでも**自分の登録が編集モードで表示される。
辞退できる（`withdrawn = 1`）。**他人の登録は閲覧も編集もできない。**

辞退は削除ではない。行を残して `withdrawn` を立てる。これにより Stage 05 のオーナー一覧に
「辞退」として出せ、Stage 06 のソルバーは除外できる。

### 3. 代理登録（オーナー）

口頭で参加を伝えてきた人や当日の飛び入りに対応するため、オーナーは公開 URL を経由せず
スタッフを直接登録できる。

- **メールアドレスを指定して追加する**（[ADR-008](adr.md#adr-008-代理登録の本人紐付けを-email-突合で行う)）
- 本人が登録したのと同じ項目をすべて入力・上書きできる
- `user_id` は NULL、`updated_by = 'owner'`

**引き取り（claim）** — 代理登録された人が後からサインインして `/apply/:applyToken` を開いたとき、
`(event_id, email)` が一致する `user_id IS NULL` の行があれば、
**その行の `user_id` を埋めて自分のものとして引き取る。**

`app/features/applications/claim.ts` に純粋関数として判定を切り出す。

```ts
export function resolveApplication(
  existing: { id: string; userId: string | null; email: string }[],
  viewer: { userId: string; email: string },
): { kind: "own"; id: string } | { kind: "claimable"; id: string } | { kind: "new" };
```

**`userId` 一致を `email` 一致より優先する。** メールアドレスは accounts 側で変わりうるので、
一度紐付いた `user_id` のほうが強い。

**オーナーが上書きした値は本人の申告値と別に保持しない。最後に書いた側が勝つ。**
誰がいつ更新したか（`updated_by` / `updated_at`）だけを残す。マージ UI は作らない。

### 4. 権限

`app/features/auth/permissions.ts` に足す。

| 主体 | できること |
|---|---|
| 同一 Chapter のサインイン済みメンバー | そのイベントの全操作（代理登録・上書き・辞退の反映） |
| サインイン済みの誰でも（Chapter 不問） | `apply_token` を知っていれば**自分の**登録の作成・編集・辞退 |

**`/apply/:applyToken` に `requireUserWithChapter` を使わない。** Chapter を要求すると
Chapter 外の一般参加者が登録できなくなる。使うのは `getOptionalUser` と、
書き込み時のみ「サインイン済みであること」の確認。

**他人の `application` に書き込めないこと**をサーバ側で検証する。
フォームから送られてきた `applicationId` を信用しない — セッションの `user_id` から引き直す。

### 5. トークンの扱い

- `apply_token` で `events` を引く。**Event ID を URL に出さない**
- トークンが存在しなければ 404
- `canApply` が false なら「募集は終了しました」（200 で表示）
- **公開ルートで他のスタッフの氏名・連絡先を返さない。** ローダーが返すのはイベント概要、
  募集中の役割、時間枠、そして**自分の登録だけ**

### 制約

- **`/apply/:applyToken` で Chapter を要求しない。** Chapter 外の一般参加者がスタッフになれる
  必要がある。`requireUserWithChapter` をここに使わない。
- **公開ルートのローダーが他人の個人情報を返さない。** 氏名も連絡先も。
  Stage 09 の公開シフト表とは要件が違う（あちらは氏名を出す）。
- **辞退は物理削除しない。** `withdrawn` を立てる。履歴と一覧の整合のため。
- **担当できない役割に `application_skills` の行を作らない。** 「担当不可」を表す値を導入しない。
- **`applicationId` をフォーム入力から信用しない。** セッションから引き直す。
- **代理登録に `user_id` を推測して埋めない。** `accounts` に検索 API が無い以上、
  email 突合以外の方法はない。
- **オーナーの上書き値と本人の申告値を別々に保持しない。** 最後に書いた側が勝つ。
- **需要（Stage 03）に触らない。ソルバー（Stage 06）を呼ばない。**
- **オーナー向けのスタッフ一覧・需給ビューを作らない。** Stage 05 の担当。
  このステージで作るオーナー側の画面は代理登録の導線だけでよい。
- **`schema.sql` は生成物。**

---

## Files to touch — 変更ファイル

### 新規

```
roster/migrations/0004_applications.sql
roster/app/features/applications/types.ts
roster/app/features/applications/applications.server.ts
roster/app/features/applications/skills.server.ts
roster/app/features/applications/availability.server.ts
roster/app/features/applications/claim.ts
roster/app/features/applications/claim.test.ts
roster/app/features/applications/validate.ts
roster/app/features/applications/validate.test.ts
roster/app/features/applications/components/ApplyForm.tsx
roster/app/features/applications/components/RoleSkillRow.tsx
roster/app/features/applications/components/AvailabilityGrid.tsx
roster/app/features/applications/components/ProxyAddDialog.tsx
roster/app/features/applications/README.md
roster/app/routes/apply.$token.tsx
roster/e2e/apply.spec.ts
```

### 変更

```
roster/app/routes.ts                       （apply/:token を追加）
roster/app/routes/e.$id.staff.tsx          （新規。代理登録の導線だけ。一覧は Stage 05）
roster/app/features/auth/permissions.ts    （canEditApplication を追加）
roster/schema.sql                          （生成物）
roster/ARCHITECTURE.md
roster/CLAUDE.md
roster/tests/architecture/__snapshots__/route-urls.test.ts.snap
```

---

## Verification — 完了条件と検証

### 完了条件

1. 未サインインで `/apply/:token` を開くと、イベント概要と募集中の役割が見え、
   サインイン後に元の画面へ戻る
2. Chapter に所属していないアカウントでも登録できる
3. 同じイベントに二重登録できない（既存があれば編集画面になる）
4. 役割ごとに経験レベルを選べ、既定が「初参加」になっている
5. 稼働可能時間を ○ / △ / × の格子で選べ、ショートカットで一括入力できる
6. 辞退でき、行は残る
7. オーナーがメールアドレス指定で代理登録でき、同じアドレスの人がサインインすると引き取れる
8. `status` を `closed` にすると `/apply/:token` が「募集は終了しました」を出す
9. 他人の登録を編集できない

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

- **`/apply/:token` のローダーが他のスタッフの氏名・メールを返さない** —
  ローダーの戻り値を直接アサートする。UI に出していなくても JSON に載れば漏れている。
  **公開ルートなので実害が大きい**
- **`claim.test.ts`: `userId` 一致が `email` 一致より優先される** —
  逆になると、accounts 側でメールを変えた人が他人の登録を引き取る経路ができる
- **`claim.test.ts`: `user_id` が既に埋まっている行は claimable にならない** —
  なると他人の登録を乗っ取れる
- **`applications.server.test.ts`: 同一 `(event_id, email)` の 2 件目が UNIQUE で弾かれる**
- **`e2e/apply.spec.ts`: `status = closed` で登録フォームが出ない** —
  `canApply` が緩むと締切後に登録が入り、シフトが確定できなくなる
- **他人の `applicationId` を POST しても自分の登録が更新されるだけで、他人の行が変わらない** —
  フォーム入力を信用した実装になっていないことの確認

### 手動 E2E

1. Stage 02 / 03 のイベントを `status = open` にする
2. `/e/:id/staff` で公開 URL をコピーする
3. **シークレットウィンドウ**でその URL を開く → 未サインインでイベント概要と募集役割が見える
4. サインインする → `/apply/:token` に戻り、登録フォームが出る
5. 表示名がアカウント名で初期入力されていることを確認
6. 役割を 2 つ選び、片方を「リード / 第1希望」、もう片方を「初参加 / 可」にする
7. 稼働可能時間で「終日 ○」を押し、1 枠だけ △、1 枠だけ × に変える
8. 懇親会「参加」、備考を入れて登録
9. **同じ URL を再度開く** → 編集モードで自分の内容が出る（二重登録にならない）
10. 辞退する → オーナー側の `/e/:id/staff` に反映される
11. オーナーで `/e/:id/staff` からメールアドレス指定で代理登録し、役割・レベル・稼働を入力
12. **そのメールアドレスのアカウント**でサインインして `/apply/:token` を開く →
    代理登録の内容が自分のものとして出る（引き取り成功）
13. イベントを `status = closed` にして `/apply/:token` を開く →
    「募集は終了しました」が出る（404 ではない）
