# Stage 03 db-schema-split — Drizzle スキーマのドメイン別分割

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は `docs/wiki-refactoring/index.md`。**着手前に必ず読むこと。**
このステージは Stage 01（`01-code-map.md`）の完了後に実行する。Stage 02 とは独立で、並行可。

`wiki/app/db/schema.ts` は 623 行 / 35 テーブルの単一ファイル。
fan-in が非常に高く（`~/db/schema` は実質すべてのサーバコードから import される）、
エージェントが「`sources` テーブルの列は何か」を知りたいだけでも 623 行を読む。
1 回あたり 8〜10k トークン。

このステージは**呼び出し側の変更がゼロ**という珍しい性質を持つ。
`app/db/schema.ts` を `app/db/schema/` ディレクトリ + `index.ts` に変えると、
`~/db/schema` という import 指定子が変わらないため、162 ファイルのどれも触らずに済む。
リスクが極めて低い割に効果が大きいので、大きな移動を始める前に片付ける。

### 対象範囲

`wiki/app/db/` のみ。migrations・`schema.sql`・呼び出し側は触らない。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画
- `wiki/CLAUDE.md` の「Drizzle (not Kysely)」節 — マイグレーションは手書き SQL、
  `schema.sql` は生成ダンプであるという前提
- `wiki/drizzle.config.ts` — `schema` の指すパス

### 再利用する既存実装 — 書き直さないこと

- **`app/db/schema.ts` のテーブル定義そのもの。** 列名・型・制約・`references` の書き方を
  1 文字も変えない。このステージは**行の切り貼りだけ**である
- ファイル先頭のコメントブロック（`// ---` で囲まれた各テーブルの説明）は、
  該当テーブルと一緒に移す。捨てない

### 前提として確認済みの事実（再調査不要）

- `schema.ts` に `relations()` の宣言は**存在しない**。外部キーは
  `references(() => table.column)` の遅延アロー関数のみ
- テーブル間の参照グラフに**循環はない**。依存順は
  `user` / `chapters` / `tags` / `ingestion` → `sources` → `pages` →
  `google` / `discord` / `notifications` / `tasks`
- `drizzle.config.ts` は 5 行程度の小さいファイル。`schema` のパス指定を確認すること

---

## Design — 設計

### 1. `app/db/schema.ts` を `app/db/schema/` に分割する

35 テーブルを 10 モジュールに割る。各モジュールは 300 行を超えない。

| モジュール | テーブル |
|---|---|
| `user.ts` | `user`, `userPreferences` |
| `chapters.ts` | `chapters` |
| `tags.ts` | `tags` |
| `ingestion.ts` | `ingestionSessions` |
| `sources.ts` | `sources`, `sourceDocuments`, `sourceAssets`, `sourceImportRuns`, `googleChatSenderProfiles`, `googleChatSenderSamples` |
| `pages.ts` | `pages`, `wikiAgentInstructions`, `pageTags`, `pageAttachments`, `pageVersions`, `pageFavorites`, `pageSources`, `pageComments`, `commentReactions`, `pageEmbeddingStatus`, `pageViews`, `pageAccess` |
| `google.ts` | `googleDriveTokens`, `googleDocumentImports`, `googleDocumentImportNodes`, `googleDocumentImportJobs` |
| `discord.ts` | `discordOauthTokens`, `discordGuildSettings` |
| `notifications.ts` | `notifications`, `fcmTokens` |
| `tasks.ts` | `taskLists`, `taskListTeams`, `tasks`, `taskDependencies` |

`googleChatSenderProfiles` / `googleChatSenderSamples` は名前に google が付くが、
`sources` を参照する取り込み側のテーブルなので `sources.ts` に置く
（`google.ts` は OAuth トークンと Docs インポートの管理テーブル）。

各モジュールは `drizzle-orm/sqlite-core` から必要なものだけ import し、
参照先テーブルを相対パスで import する。例:

```ts
// app/db/schema/pages.ts
import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { chapters } from "./chapters";
import { ingestionSessions } from "./ingestion";
import { sources } from "./sources";
import { tags } from "./tags";
import { user } from "./user";
```

### 2. `app/db/schema/index.ts` で再エクスポートする

```ts
export * from "./chapters";
export * from "./discord";
export * from "./google";
export * from "./ingestion";
export * from "./notifications";
export * from "./pages";
export * from "./sources";
export * from "./tags";
export * from "./tasks";
export * from "./user";
```

これで `import * as schema from "~/db/schema"` と
`import { pages } from "~/db/schema"` の**両方が現状どおり動く**。
呼び出し側の変更は 1 行も発生しない。

`index.ts` に**テーブル定義を書かない**。再エクスポートだけの 10 行に保つ。

### 3. `drizzle.config.ts` を確認する

`schema` が `./app/db/schema.ts` を指しているなら `./app/db/schema/index.ts`
（または `./app/db/schema`）に変える。drizzle-kit はディレクトリ指定にも対応するが、
**このリポジトリのマイグレーションは手書き SQL で drizzle-kit が生成していない**ため、
実害は出にくい。それでも指定は正しく直す。

### 4. `ARCHITECTURE.md` / `CLAUDE.md` を更新する

Code map の「DB スキーマ」行を `app/db/schema.ts` から `app/db/schema/` に変える。
`ARCHITECTURE.md` には上の 1. のテーブル割り当て表をそのまま置く。
これがあると「`page_access` はどのファイル？」が grep なしで解決する。

### 制約

- **テーブル定義を 1 文字も変えない。** 列名・型・デフォルト・制約・インデックス・
  `primaryKey()` / `unique()` の複合キー定義をすべてそのまま移す。
  このステージで DB スキーマが変わったら事故である
- **`schema.sql` を触らない。** 生成物。今回 SQL は変わらないので再生成も不要
- **`migrations/` を触らない。** 適用済みの SQL
- **`index.ts` に定義を書かない。** 再エクスポートのみ
- **循環 import を作らない。** 依存順は上の DAG に従う。
  `user.ts` `chapters.ts` `tags.ts` `ingestion.ts` は他のモジュールを import してはならない
- **スコープ境界。** 呼び出し側（162 ファイル）を 1 つも変更しない。
  変更が必要になったら `index.ts` の再エクスポートが不足している

---

## Files to touch — 変更ファイル

### 新規

- `wiki/app/db/schema/index.ts`
- `wiki/app/db/schema/user.ts`
- `wiki/app/db/schema/chapters.ts`
- `wiki/app/db/schema/tags.ts`
- `wiki/app/db/schema/ingestion.ts`
- `wiki/app/db/schema/sources.ts`
- `wiki/app/db/schema/pages.ts`
- `wiki/app/db/schema/google.ts`
- `wiki/app/db/schema/discord.ts`
- `wiki/app/db/schema/notifications.ts`
- `wiki/app/db/schema/tasks.ts`

### 削除

- `wiki/app/db/schema.ts`（内容はすべて上のモジュールへ移る）

### 変更

- `wiki/drizzle.config.ts` — `schema` パス
- `wiki/ARCHITECTURE.md` — テーブル割り当て表を追加、Code map の DB 行を更新
- `wiki/CLAUDE.md` — Code map の DB 行を更新。「Drizzle (not Kysely)」節の
  「Schema in `app/db/schema.ts`」を `app/db/schema/` に更新

### 変更しない

- 呼び出し側 162 ファイル（`~/db/schema` の指定子が不変のため）

---

## Verification — 完了条件と検証

### 完了条件

- `app/db/schema.ts` が消え、`app/db/schema/` に 11 ファイルがある
- 各モジュールが 300 行以下
- **`~/db/schema` を import しているファイルの差分がゼロ**
- テーブル定義の内容が移動前と同一

### コマンド

```bash
pnpm --filter @gdgjp/wiki typecheck
```

```bash
pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

```bash
pnpm --filter @gdgjp/wiki build
```

呼び出し側が 1 つも変わっていないことの確認（`app/db/` 以外に差分が出ないこと）:

```bash
cd wiki && git diff --name-only | grep -v '^wiki/app/db/' | grep -v 'ARCHITECTURE.md\|CLAUDE.md\|drizzle.config.ts'
```

エクスポート集合が移動前と一致することの確認（**これが本命の検証**）:

```bash
cd wiki && git show HEAD:app/db/schema.ts | grep -oE '^export const \w+' | sort > /tmp/schema-before.txt && cat app/db/schema/*.ts | grep -oE '^export const \w+' | sort > /tmp/schema-after.txt && diff /tmp/schema-before.txt /tmp/schema-after.txt && echo "exports identical"
```

行数の確認:

```bash
wc -l wiki/app/db/schema/*.ts
```

### 回帰として固定すべきテスト — 静かに壊れる経路

型検査もビルドも通るのに壊れる経路が 3 つある。

- **テーブルを 1 つ移し忘れた／二重に定義した。** `index.ts` の `export *` は
  名前が衝突しなければ黙って通る。移し忘れると、そのテーブルを使う箇所が
  `undefined` を Drizzle に渡し、**実行時にクエリが壊れる**。
  上の「エクスポート集合の diff」が唯一の機械的な検出手段。省略しないこと
- **列名（SQL 側の名前）を書き換えた。** `text("page_id")` の文字列は型検査に出ない。
  `pageId: text("pageId")` のようなタイポは typecheck も build も通り、
  **D1 のクエリが実行時に `no such column` で落ちる**。
  移動後に `git show HEAD:app/db/schema.ts` と結合後のファイルで、
  `text("..." )` / `integer("...")` の第 1 引数の集合を比較する:

  ```bash
  cd wiki && git show HEAD:app/db/schema.ts | grep -oE '(text|integer)\("[a-z0-9_]+"' | sort | uniq -c > /tmp/cols-before.txt && cat app/db/schema/*.ts | grep -oE '(text|integer)\("[a-z0-9_]+"' | sort | uniq -c > /tmp/cols-after.txt && diff /tmp/cols-before.txt /tmp/cols-after.txt && echo "columns identical"
  ```

- **複合主キー・ユニーク制約の定義を落とした。** `(t) => [primaryKey({ columns: [...] })]`
  の第 2 引数は、移動時に見落としやすい。落としても型検査は通る。
  上の列比較では検出できないので、`primaryKey(` と `unique(` の出現回数を前後で比較する

E2E は不要。上の 3 つの機械的比較が通り、`pnpm test` と `pnpm build` が緑なら十分。

### 手動 E2E

スキーマの実行時経路を 1 回だけ通す。

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/wiki/<既存ページ>` を開き、本文・コメント・タグが表示される（`pages` 系）
3. `/sources` でソース一覧が表示される（`sources` 系）
4. `/tasks/<slug>` でタスク一覧が表示される（`tasks` 系）
5. `/settings` で言語設定が表示される（`user_preferences`）

4 ドメインすべてが読めれば、分割で参照が壊れていないことが確認できる。
