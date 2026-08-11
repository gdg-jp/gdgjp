# Stage 9 — Source visibility ACL

## Context — 背景とリポジトリ状況

### なぜやるか

`wiki/` の `/sources` は Google Docs / Sheets / Slides / Chat Space を取り込むが、権限管理が
**チャプター単位の一段階しかない**。`sources.chapter_id` が `NULL` なら「サインイン済み全員が読める」、
非 NULL なら「そのチャプター所属者が読める」だけで、Organizer 限定も Private も表現できない。
インポート自体は誰でもできてよいが、取り込んだ raw の閲覧範囲は登録者が選べる必要がある。

このステージで実現する権限レベル:

- **Private** — 自分だけ
- **Member** — いずれかのチャプターの Member 以上
- **Organizer** — いずれかのチャプターの Organizer
- **チャプター別 Member** — GDG Tokyo / GDG Osaka などの Member
- **チャプター別 Organizer** — 同じくその Organizer

登録時に選べることに加え、**既存ソースの権限も後から変更できる**ようにする。

### 依存と対象範囲

- 対象ワークスペースは `wiki/` のみ。`cli/` と `accounts/` は触らない。
- 先行ステージ: `01-sources-raw-layer.md`（`sources` / `source_documents` / R2 raw レイヤ）。
- **後続の [10-page-acl-spans.md](10-page-acl-spans.md) が本ステージの `sources.visibility` に依存する。**
  ページ本文の部分黒塗り（`<acl>` スパン）は次ステージの担当。**本ステージでは扱わない。**
- Agent (`workers/agents/`, `WikiGenerationAgent`, `/agents/*`) の権限まわりは**触らない**。

### 読むべきもの

- `wiki/CLAUDE.md` — Worker の 3 ハンドラ、bindings、Drizzle 運用、`schema.sql` が生成物であること
- `CLAUDE.md`（リポジトリ直下）— Biome 設定、migrations の運用、E2E コマンド
- `docs/plans/01-sources-raw-layer.md` — `sources` テーブルと fetch パイプラインの前提

### 再利用する既存実装（書き直さない）

- `wiki/app/lib/sources.server.ts`
  — `createSource` / `canAccessSource` / `canAssignChapter` / `parseChapterSelection`。
  **フォームと JSON API の両方がここを通る唯一の窓口という構造をそのまま保つ**
  （コード内コメント「a second copy of this would be a second place for the chapter check to drift out of」）
- `wiki/app/lib/sources-shared.ts` — `SourceKind` / `SourceRefreshPolicy` / `ALL_CHAPTERS`。
  `/sources` のフォームコンポーネントが import するため**サーバ専用にできない**分離。この境界を守る
- `wiki/app/lib/auth-utils.server.ts` の `getAccessIdentity(request, env)`
  — `{ user, chapterIds, chapters: { chapterId, role }[], claimsAvailable }` を返す。
  **role 付きの `chapters` は既にあるので `gdg-lib` / `accounts` 側の変更は不要**
- `wiki/app/lib/cli-identity.server.ts` の `getCliIdentity` — CLI/Agent 用に同じ形を返す
- `wiki/migrations/0047_source_kinds.sql`
  — SQLite で CHECK 制約を変えるための 12-step 再構築の手本。
  **`sources` の CHECK を触る移行はこのファイルの形をそのまま踏襲する**
- `wiki/app/routes/api.sources.$id.refresh.ts` — 単一ソースに対する POST ルートの雛形
- `wiki/app/lib/page-access.server.ts` / `page-visibility.server.ts`
  — ページ側の ACL。**本ステージでは変更しない**（ソース ACL とは別レイヤ）

---

## Design — 設計

### 1. データモデル

`sources` に `visibility` を追加する。チャプター指定が要る 2 値は既存の `chapter_id` を再利用する。

| `visibility` | 意味 | `chapter_id` |
|---|---|---|
| `private` | 登録者本人 + 管理者のみ | NULL |
| `member` | いずれかのチャプターの Member 以上 | NULL |
| `organizer` | いずれかのチャプターの Organizer | NULL |
| `chapter-member` | 指定チャプターの Member 以上 | 必須 |
| `chapter-organizer` | 指定チャプターの Organizer | 必須 |

移行 `wiki/migrations/0054_add_source_visibility.sql` を新規作成する。
`0047_source_kinds.sql` と同じ 12-step 再構築（`sources_replacement` を作って
`INSERT ... SELECT` → `DROP` → `RENAME` → インデックス再作成）で列と CHECK を足す。

CHECK は値だけでなく整合性も見る:

```sql
"visibility" TEXT NOT NULL DEFAULT 'member'
  CHECK ("visibility" IN ('private','member','organizer','chapter-member','chapter-organizer')),
CHECK (
  ("visibility" IN ('chapter-member','chapter-organizer')) = ("chapter_id" IS NOT NULL)
)
```

**既存の意味を厳密に保つバックフィル**を同じ移行の中で行う:

```sql
UPDATE "sources" SET "visibility" =
  CASE WHEN "chapter_id" IS NULL THEN 'member' ELSE 'chapter-member' END;
```

`0047` が再作成しているインデックス 4 本をそのまま維持し、
`CREATE INDEX "idx_sources_visibility" ON "sources" ("visibility", "chapter_id");` を追加する。

`wiki/app/db/schema.ts` の `sources` に
`visibility: text("visibility").notNull().default("member")` を追加し、
`pnpm --filter @gdgjp/wiki migrate:local` で `schema.sql` を再生成する。

### 2. 共有型と定数

`wiki/app/lib/sources-shared.ts` に置く（フォームが import するのでサーバ専用にできない）:

```ts
export type SourceVisibility =
  | "private" | "member" | "organizer" | "chapter-member" | "chapter-organizer";

export const SOURCE_VISIBILITIES: readonly SourceVisibility[] = [
  "private", "member", "organizer", "chapter-member", "chapter-organizer",
];

export function isSourceVisibility(value: unknown): value is SourceVisibility;
export function sourceVisibilityNeedsChapter(value: SourceVisibility): boolean;
```

`ALL_CHAPTERS` センチネルは `visibility: "member"` に置き換わるので **削除する**
（`sources-shared.ts` の export、`sources.server.ts` の re-export、`sources.tsx` の
`<SelectItem value={ALL_CHAPTERS}>` をすべて消す）。

### 3. 判定ロジック — `wiki/app/lib/sources.server.ts`

#### 3-1. `canAccessSource` を role を見る形に置き換える

現行シグネチャは `chapterIds: readonly string[]` だが、Organizer 判定には role が要る。

```ts
type SourceSubject = { addedBy: string; chapterId: string | null; visibility: string };
type Membership = { chapterId: string | number; role: string };

export function canAccessSource(
  source: SourceSubject,
  user: AuthUser,
  chapters: readonly Membership[],
): boolean
```

判定順（fail closed）:

1. `user.isAdmin` → `true`
2. `source.addedBy === user.id` → `true`（オーナーは常に読める）
3. `visibility` が `SourceVisibility` でない → **`false`**
   （新しい値を足したとき古い分岐が素通りする事故を防ぐ）
4. `private` → `false`
5. `member` → `chapters.length > 0`
6. `organizer` → `chapters.some(c => c.role === "organizer")`
7. `chapter-member` → `chapters.some(c => String(c.chapterId) === source.chapterId)`
8. `chapter-organizer` → 7 に加えて `c.role === "organizer"`

`chapterId` は claims 側が number、`sources.chapter_id` は TEXT なので**必ず `String()` で正規化**する
（`wiki` のローカル `chapters.id` は accounts のチャプター ID を文字列で持っている）。

`getAccessIdentity` は claims 取得に失敗すると空の `chapters` を返すので、
**この判定順のままで自動的に fail closed になる**。呼び出し側に特別扱いを足さない。

呼び出し側 6 箇所を `identity.chapterIds` から `identity.chapters` に変える:
`app/routes/sources.tsx`（3 箇所）、`api.sources.ts`、`api.cli.wiki.sources.ts`、
`api.cli.wiki.sources.$documentId.content.ts`、`api.agent.sources.ts`。

#### 3-2. 割り当て可否

`canAssignChapter` を置き換える:

```ts
export function canAssignSourceVisibility(
  visibility: SourceVisibility,
  chapterId: string | null,
  user: AuthUser,
  chapters: readonly Membership[],
): boolean
```

- `private` / `member` / `organizer` は誰でも選べる。
  （Organizer でない人が `organizer` を選んでも自分をロックアウトしない。オーナーは常に読めるため）
- `chapter-member` / `chapter-organizer` は `user.isAdmin` か、そのチャプターに所属している場合のみ。
- `chapter_id` の有無が `visibility` と食い違う場合は `false`。

#### 3-3. 入力パース

`parseChapterSelection` を置き換える:

```ts
export function parseSourceVisibilitySelection(
  rawVisibility: unknown,
  rawChapter: unknown,
): { ok: true; visibility: SourceVisibility; chapterId: string | null }
  | { ok: false; error: string }
```

既存コメントの意図（「省略で全体公開に落ちない。明示的に選ばせる」）をそのまま引き継ぐ。
`visibility` が空/未知なら `invalid_visibility`、チャプターが必要なのに空なら `chapter_required`。

#### 3-4. 登録

`CreateSourceInput` の `chapter: unknown` を `visibility: unknown` + `chapter: unknown` に置き換え、
`chapterIds: readonly string[]` を `chapters: readonly Membership[]` に置き換える。
`createSource` の中で `parseSourceVisibilitySelection` → `canAssignSourceVisibility` の順に検証し、
`sources` 行に `visibility` を書く。エラーは既存どおり `{ ok: false, error, status }` で返す。

フォーム側の 3 つの intent（`create` / `create-chat-space` / `create-batch`）と
`POST /api/sources` の**すべてが同じ検証を通ること**。ここが分岐したら設計が壊れる。

#### 3-5. 権限変更（新規）

```ts
export async function updateSourceVisibility(
  env: Env,
  sourceId: string,
  input: { visibility: unknown; chapter: unknown;
           user: AuthUser; chapters: readonly Membership[] },
): Promise<{ ok: true } | { ok: false; error: string; status: number }>
```

- 変更できるのは **`source.addedBy === user.id` または `user.isAdmin` のみ**。
  それ以外は `{ error: "forbidden", status: 403 }`。
- `canAssignSourceVisibility` を再度通す（オーナーでも所属外チャプターは指定できない）。
- `archived` なソースも変更できる（読める人を絞る操作は常に許す）。
- `chapter_id` は `visibility` に合わせて更新する。
  `chapter-*` 以外へ変えたときは `chapter_id` を `NULL` に落とす（CHECK 制約を満たすため）。
- `updated_at` を更新する。再取得はしない。

### 4. API と UI

#### 4-1. ルート

- 新規 `wiki/app/routes/api.sources.$id.visibility.ts`（`POST`）。
  `api.sources.$id.refresh.ts` の構造をそのまま真似る
  （`getAccessIdentity` → ソース取得 → `canAccessSource` で 404 → `updateSourceVisibility`）。
  **存在しない・読めないソースは 403 ではなく 404 を返す**（存在を漏らさない）。
- `wiki/app/routes.ts` にルート登録を追加する。
- `wiki/app/routes/sources.tsx` の action に `intent=update-visibility` を追加し、
  同じ `updateSourceVisibility` を呼ぶ。

#### 4-2. `/sources` の画面

`wiki/app/routes/sources.tsx` は行を展開する単一ページ。

- インポートフォームのチャプター `<Select>` を **visibility セレクタ**に置き換える。
  `chapter-member` / `chapter-organizer` を選んだときだけチャプター `<Select>` を出す。
  必須項目が埋まるまで送信ボタンは disabled（既存の `!chapter` 判定を移植する）。
- チャプター候補は現状どおり `identity.chapterIds` で絞る
  （`sources.tsx:157` のコメント「選べないスコープを picker に出さない」を維持）。
  管理者には全チャプターを出す。
- 一覧の各行に現在の visibility をバッジ表示する。
  `addedBy === user.id || user.isAdmin` の行にだけインラインの変更コントロールを出す。
- i18n 文字列を `wiki/app/locales/{ja,en}/*.json` に追加する。
  `sources.chapter_all` は削除し、`sources.visibility.*` を新設する。

#### 4-3. OpenAPI

`wiki/openapi/paths/sources.yaml` と新規ルートのスキーマを更新し、
`wiki/openapi/types.generated.ts` を再生成する。
CLI マニフェスト (`GET /api/cli/wiki/sources`) のレスポンスは**このステージでは変えない**
（`visibility` の露出は次ステージの担当）。

### 制約

- `wiki/schema.sql` は生成物。**手編集せず `pnpm --filter @gdgjp/wiki migrate:local` で再生成する。**
- `wiki/worker-configuration.d.ts` も生成物。`wrangler.toml` を触ったら `cf-typegen`。
- **`createSource` を唯一の登録窓口に保つ。** フォーム用と API 用に分岐を作らない。
  raw はチャプター間で漏れてはいけないものなので、権限チェックが二重化すると必ず片方が腐る。
- `getAccessIdentity` の「claims 取得失敗時は空 chapters = fail closed」の既存挙動を守る。
- `page-access.server.ts` / `page-visibility.server.ts` のページ ACL は**弱めない・触らない**。
- **`<acl>` スパン、ページ本文の黒塗り、`AGENTS.md` の更新は次ステージ (10) の担当。触らない。**
- Biome（2 スペース・ダブルクォート・セミコロン・100 桁）。`import type` を使う。
- `.dev.vars*` / secrets / 生成物をコミットしない。

---

## Files to touch — 変更ファイル

すべて `wiki/` 配下。

- `migrations/0054_add_source_visibility.sql`（新規）
- `schema.sql`（`migrate:local` による再生成。手編集しない）
- `app/db/schema.ts` — `sources.visibility`
- `app/lib/sources-shared.ts` — `SourceVisibility` 型・定数・ヘルパ、`ALL_CHAPTERS` 削除
- `app/lib/sources.server.ts` — `canAccessSource` / `canAssignSourceVisibility` /
  `parseSourceVisibilitySelection` / `createSource` / `updateSourceVisibility`（新規）
- `app/lib/sources.server.test.ts`（新規）
- `app/routes/sources.tsx` — visibility セレクタ、行内バッジ、`intent=update-visibility`
- `app/routes/api.sources.ts` — 作成時の visibility 受理
- `app/routes/api.sources.$id.visibility.ts`（新規）
- `app/routes.ts` — 新規ルート登録
- `app/routes/api.cli.wiki.sources.ts` — `canAccessSource` 呼び出しを `identity.chapters` に
- `app/routes/api.cli.wiki.sources.$documentId.content.ts` — 同上
- `app/routes/api.agent.sources.ts` — 同上
- `app/locales/ja/*.json`, `app/locales/en/*.json`
- `openapi/paths/sources.yaml` ほか + `openapi/types.generated.ts`（再生成）

---

## Verification — 完了条件と検証

### 完了条件

1. `/sources` で Private / Member / Organizer / チャプター別 Member / チャプター別 Organizer を
   選んでインポートできる。インポート操作自体はサインイン済みなら誰でもできる。
2. 登録済みソースの権限をオーナーと管理者だけが変更でき、それ以外は 403、
   読めないソースへの操作は 404。
3. Member しか持たない利用者に、`organizer` のソースが `/sources` にも
   `GET /api/cli/wiki/sources` のマニフェストにも `GET /api/sources` にも出ない。
4. 移行の前後で既存ソースの見え方が一切変わらない
   （`chapter_id IS NULL` → `member`、非 NULL → `chapter-member`）。
   **例外（レビューで決定済み）**: `member` は §3-1(5) どおり `chapters.length > 0`
   （fail-closed）を採用する。IdP 障害時に空 `chapters` が返る利用者、および
   どのチャプターにも属さない signed-in アカウントは、移行前は無条件に読めた
   `chapter_id IS NULL` ソースが読めなくなる。これは意図した仕様変更であり、
   等価性はそれ以外の全ケース（admin / owner / 所属チャプターあり）でのみ成立する。

### コマンド

```bash
pnpm --filter @gdgjp/wiki migrate:local
```

```bash
pnpm --filter @gdgjp/wiki typecheck
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

`migrate:local` は `wiki/schema.sql` を再生成する。その差分をコミットに含めること。
`openapi/*.yaml` を触ったら `openapi/types.generated.ts` の再生成を必ず行う
（型だけ古いとフィールドが静かに落ちる）。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **未知の `visibility` 文字列で `canAccessSource` が `false` を返す。**
  将来値を足したときに、古い分岐が「該当なし = 通す」に落ちる事故を防ぐ。
- **`claimsAvailable === false`（IdP 障害）で `organizer` / `chapter-*` のソースが読めない。**
  空 `chapters` が「全部読める」に反転しないこと。ここは反転しても画面上は正常に見える。
- **移行バックフィルの等価性** — 移行前の `canAccessSource(chapterIds)` と
  移行後の `canAccessSource(chapters)` が、`{admin, owner, 所属あり} ×
  {chapter_id NULL, 非 NULL}` の組み合わせで一致する。
  `所属なし`（`chapters = []`）は対象外 — `member` は fail-closed
  （`chapters.length > 0`）なので、`chapter_id IS NULL` → `member` に
  バックフィルされたソースは所属なし利用者から見えなくなる（上記 Verification #4 参照）。
- **`chapterId` の型混在** — claims の `chapterId: number` と `sources.chapter_id: TEXT` が
  `String()` 正規化を通して一致する（正規化を落とすと全チャプター判定が黙って `false` になる）。
- **`createSource` の 4 経路が同じ検証を通る** — `intent=create` / `create-chat-space` /
  `create-batch` / `POST /api/sources` のいずれからも所属外チャプターを割り当てられない。
- **`updateSourceVisibility` で他人のソースを変更できない**（403）、
  **読めないソースの存在が漏れない**（404 であって 403 でない）。
- **`chapter-*` 以外へ変更したとき `chapter_id` が NULL に落ちる**
  （落とし忘れると CHECK 制約違反で本番の更新だけが失敗する）。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）を起動する。
   `tests/e2e/global-setup.ts` が用意する `admin` / `author` / `member` の 3 セッションを使う。
2. `author` セッションで `/sources` を開き、Google Doc を **Organizer** 権限で 1 件登録する。
3. `member` セッションで `/sources` を開き、その行が**見えない**ことを確認する。
   `GET /api/sources` を直接叩いても含まれないことを確認する。
4. `author` でその行の権限を **Member** に変更する。`member` で再読み込みして見えることを確認する。
5. `author` でさらに **Private** に変更し、`member` から見えなくなること、
   `admin` からは見えることを確認する。
6. `member` セッションから同じソースの `POST /api/sources/:id/visibility` を叩き、
   **404** が返る（403 ではない）ことを確認する。
7. `member` の CLI トークンで `gdg wiki raw pull` を実行し、
   `organizer` / `private` のソースが `raw/` に落ちてこないことを確認する。
