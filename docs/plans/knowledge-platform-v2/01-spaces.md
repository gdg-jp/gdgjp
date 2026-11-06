# Stage 01 — Spaces: テナント単位の外側 ACL とメンバーシップ

## Context — 背景とリポジトリ状況

### なぜやるか

v1 の wiki は「サインイン済み全員」を母集団に、ソースは 5 値の `visibility`、ページは
`visibility` + `page_access` + 本文内 `<acl src>` スパンで権限を表している。この内側の ACL は
**v2 でもそのまま使う**（`00-overview.md` §2-1）。足りないのは母集団を分ける単位で、
「GDG 全体」以外のコミュニティ（特定 Discord サーバ、チャプター単独、個人）を持てず、
Discord bot が「このサーバで参照してよい範囲」を選べない。

このステージで **スペース**（テナント）を導入し、ソースとページがちょうど 1 つのスペースに属する
状態にする。閲覧の前提はスペースのメンバーシップ、その内側は既存 ACL、という 2 層にする。

### 依存と対象範囲

- 依存: なし（v2 の最初のステージ）。
- 対象ワークスペースは `apps/wiki/` のみ。`apps/accounts/` と `apps/cli/` は触らない。
- 後続の 02（ソースの R2 再配置）、03（AI Search）、05（エージェント）が `spaces` と
  `resolveSpaceAccess` に依存する。

### 読むべきもの

- `apps/wiki/CLAUDE.md`、`apps/wiki/ARCHITECTURE.md`（配置ルール、400 行上限、規約テスト一覧）
- `apps/wiki/app/features/pages/README.md`、`apps/wiki/app/features/sources/README.md`
- `docs/plans/09-source-visibility-acl.md` §1〜3 — 現行ソース ACL の仕様と 12-step 移行の手本
- `docs/plans/10-page-acl-spans.md` §0「権限の代数」 — 内側 ACL の不変条件。**弱めない**
- `docs/plans/knowledge-platform-v2/00-overview.md` §3-1

### 再利用する既存実装（書き直さない）

- `apps/wiki/app/features/auth/` の `getAccessIdentity(request, env)` — `{ user, chapters: { chapterId, role }[], claimsAvailable }` を返す。チャプター role は **既に取れる**ので accounts 側の変更は不要
- `apps/wiki/app/features/agent-api/workspace.server.ts` の `getCliIdentity` — CLI / エージェント用に同じ形を返す
- `apps/wiki/app/features/sources/sources.server.ts` の `canAccessSource`、`app/features/pages/access.server.ts` の `getEffectivePagePermissions`、`acl-spans.server.ts` の `redactPageMarkdown` — 内側 ACL。**変更しない。スペース判定の後に呼ぶ**
- `apps/wiki/migrations/0047_source_kinds.sql` と `0054_add_source_visibility.sql` — SQLite で列と CHECK を足す 12-step 再構築の手本。**`sources` / `pages` を触る移行はこの形を踏襲する**
- `apps/wiki/app/features/pages/components/ShareDialog.tsx` — メンバー検索 UI（`/api/user/search`）。スペースのメンバー追加画面で流用する
- `apps/wiki/app/components/Sidebar.tsx` / `BaseSidebar.tsx` — スペース切り替えを差し込むシェル
- `apps/wiki/tests/architecture/route-urls.test.ts` — 公開 URL のスナップショット。ルート追加時に更新する

## Design — 設計

### 1. データモデル

新規モジュール `apps/wiki/app/db/schema/spaces.ts`（依存順は `user` / `chapters` → `spaces` → `sources` → `pages`）。

```sql
CREATE TABLE "spaces" (
  "id"         TEXT PRIMARY KEY,
  "slug"       TEXT NOT NULL UNIQUE,            -- URL 用。[a-z0-9-]{2,40}
  "name"       TEXT NOT NULL,
  "kind"       TEXT NOT NULL CHECK ("kind" IN ('personal','chapter','shared')),
  "chapter_id" TEXT UNIQUE REFERENCES "chapters"("id"),  -- kind = 'chapter' のとき必須。1 チャプター 1 スペース
  "lang"       TEXT NOT NULL DEFAULT 'ja',      -- translate ジョブの対象判定に使う（Stage 04）
  "created_by" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "space_members" (
  "space_id"       TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "principal_type" TEXT NOT NULL CHECK ("principal_type" IN ('user','chapter_role','discord_guild','chat_space')),
  "principal_id"   TEXT NOT NULL,   -- user.id | "<chapterId>:<member|organizer>" | Discord guild snowflake | Google Chat spaces/<id>
  "role"           TEXT NOT NULL CHECK ("role" IN ('owner','editor','viewer')),
  "created_at"     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("space_id","principal_type","principal_id")
);
```

`sources` と `pages` に `space_id TEXT NOT NULL REFERENCES spaces(id)` を追加する（12-step 再構築）。
`pages.slug` の UNIQUE は **`(space_id, slug)` の複合 UNIQUE** に変える。URL は `/s/<spaceSlug>/wiki/<slug>`
を新設し、旧 `/wiki/<slug>` は `gdg-jp` への 301 にする（Stage 07 で削除）。

`sources.visibility`、`pages.visibility`、`page_access`、`pages.acl_source_ids` は **変えない**。

### 2. 既存データの移行（同じ移行ファイル内でバックフィル）

| 既存 | 移行先 |
|---|---|
| `sources` 全行 | `shared` スペース `gdg-jp`（名前「GDG Japan」）。`visibility` はそのまま |
| `pages` 全行 | 同じく `gdg-jp`。`<acl>` スパン、`visibility`、`page_access` はそのまま |
| `gdg-jp` の `space_members` | `chapter_role` = 全チャプターの `member`（移行スクリプトが `chapters` テーブルから生成）。admin は `resolveSpaceAccess` で常に owner なので行は作らない |

v1 の母集団「サインイン済みでいずれかのチャプターに所属」は、`gdg-jp` のメンバーシップとして
そのまま再現される。**分割・レビュー・個人スペースへの振り分けは行わない**。`private` ソースは
`gdg-jp` の中で `visibility = private` のまま本人だけに見える（内側 ACL の仕事）。

個人スペース `u-<userId>` もチャプタースペース `c-<chapterId>` も移行では作らず、ユーザーが `/spaces` の
ボタンで作る（§4）。移行は冪等（再実行で重複スペースを作らない）。

### 2-b. スペースの種別

| `kind` | 誰が作れるか | メンバーの決まり方 | `/spaces/:slug/settings` でできること |
|---|---|---|---|
| `personal` | 本人（1 人 1 つ、slug `u-<userId>`） | 作成者が `owner` の `user` principal 1 行。**他の principal は追加できない** | 名前・`lang`・`translate_enabled` のみ |
| `chapter` | そのチャプターの `organizer`、または admin（1 チャプター 1 つ、slug `c-<chapterId>`、`spaces.chapter_id` に紐づく） | 作成時に `chapter_role` 2 行を書く: `<chapterId>:organizer` → `owner`、`<chapterId>:member` → `editor`。**`user` / `discord_guild` / `chat_space` principal は追加できない**（そのチャプターに所属している人だけが閲覧・編集できる、が要件）。チャプターの所属は accounts 側が正本なので、脱退した人は claims から消えた時点で入れなくなる | 名前・`lang`・`translate_enabled`。メンバー一覧は表示のみ |
| `shared` | サインイン済みなら誰でも | 作成者が `owner`。`user` / `chapter_role` を settings で、`discord_guild` / `chat_space` を Stage 05 の `/setup` で追加 | 全部 |

`members.server.ts` の追加関数は `kind` を見て上の表に無い principal を **拒否**する（UI で隠すだけにしない）。
Stage 05 の `/setup` が選択肢に出すのは `shared` のみ（`chapter` スペースを Discord サーバ全員に開く経路を作らない）。
`gdg-jp` は `shared`（全チャプターの `member` を持つ特別な shared スペース）。

### 3. アクセス解決 — `app/features/spaces/access.server.ts`

```ts
export type SpaceRole = "owner" | "editor" | "viewer";
export type SpaceAccess = ReadonlyMap<string /* spaceId */, SpaceRole>;

export async function resolveSpaceAccess(
  db: Db,
  identity: { user: AuthUser | null; chapters: readonly { chapterId: string | number; role: string }[]; claimsAvailable: boolean },
  extraPrincipals?: readonly { type: "discord_guild" | "chat_space"; id: string }[],
): Promise<SpaceAccess>
```

- `user.isAdmin` → 全スペース `owner`。
- `user` principal、`chapter_role` principal（`String(chapterId) + ":" + role`。`organizer` は `member` も含意する）、`extraPrincipals` の `discord_guild` / `chat_space`（Stage 05 が渡す。本ステージでは型と CHECK だけ用意する）を OR で集め、同じスペースに複数当たれば **強い role** を採る。
- `claimsAvailable = false` の場合は `chapter_role` を評価しない。fail closed。
- `requireSpace(request, env, spaceSlug, minRole)` を同ファイルに置き、ルート loader/action は **まずこれを呼び、その後に既存の `canAccessSource` / `getEffectivePagePermissions` を呼ぶ**。順序を architecture テストで固定する（§制約）。

スペース内の role と内側 ACL の関係:

| スペース role | できること |
|---|---|
| `viewer` | 内側 ACL が許すページ・ソースを読む |
| `editor` | 上記 + ページ作成・編集（`getEffectivePagePermissions.canEdit` も必要）、ソース登録 |
| `owner` | 上記 + メンバー管理、スペース設定、`discord_guild` principal の付与 |

### 4. UI とルート

| URL | 内容 |
|---|---|
| `/spaces` | 自分が属するスペース一覧と 3 つのボタン: **「個人スペースを作る」**（既にあれば非表示）、**「チャプタースペースを作る」**（自分が `organizer` のチャプターのうち、まだスペースが無いものをセレクトで選ぶ。候補が無ければ非表示）、**「共有スペースを作る」**（名前と slug） |
| `/spaces/:slug/settings` | 名前・slug・lang、メンバー一覧と追加（user 検索は `ShareDialog` の検索を流用、`chapter_role` はチャプター + role のセレクト、`discord_guild` は Stage 05 の `/setup` からのみ付与し、ここでは表示と削除だけ）。`personal` / `chapter` では §2-b の表どおり追加 UI を出さない |
| ユーザー設定（サイドバー下部） | **「エージェントが作成したページを隠す」** トグル（`user_preferences.hide_agent_pages`、既定 off）。on のとき、ページツリー・`wiki-catalog`・最近の更新・`/s/:slug/search` と `/search` の結果から `origin = agent` のページを除く（検索は Stage 03 が `pages.origin` で後置フィルタする）。URL を直接開けば表示され、上部に「非表示設定中のページ」のバナーが出る。隠すのは一覧からで、権限ではない |
| `/s/:slug/wiki/*`、`/s/:slug/sources`、`/s/:slug/search` | 既存画面のスペース版。`routes.ts` で `layout()` にスペース解決を挟む |
| サイドバー | スペース切り替え（最後に開いたスペースを `user_preferences.last_space_id` に保存） |

ページ新規作成・ソース登録はカレントスペースに属する。親ページは同スペース内のみ選べる。
ページツリー（`tree.ts`）と `wiki-catalog.server.ts` は `{ spaceId, hideAgentPages }` を受け取り、`hideAgentPages`
のとき `origin = agent` を除く。`origin = agent` のページは **人間には読み取り専用**（Stage 04 §3-4 がロックを入れる。
本ステージでは `origin` バッジを出すだけ）。
`<acl src>` に指定できるソースは **同スペースのソースのみ**（`validatePageAclForSync` の
`acl_unknown_source` 判定に `space_id` 一致を足す。スペースを跨いだスパン参照は漏洩経路になる）。

### 5. レビューフラグ

```sql
CREATE TABLE "review_flags" (
  "id" TEXT PRIMARY KEY,
  "space_id" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "target_type" TEXT NOT NULL CHECK ("target_type" IN ('page','source','job')),
  "target_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,                      -- Stage 04 のジョブが積む（'human-page-conflict' など）
  "payload" TEXT NOT NULL DEFAULT '{}',
  "resolved_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
```

本ステージではテーブルと `/spaces/:slug/review` の一覧（未解決フラグ、「解決済みにする」）だけを作る。
積むのは Stage 04 以降。

### 制約

- **内側 ACL を弱めない。** `canAccessSource`、`getEffectivePagePermissions`、`redactPageMarkdown`、`validatePageAclForSync` のロジックを変更しない（`acl_unknown_source` への `space_id` 条件追加は「厳しくする」方向のみ許す）。
- **スペース判定は内側 ACL の前に、必ず両方呼ぶ。** `tests/architecture/` に「`getEffectivePagePermissions` / `canAccessSource` を呼ぶルートは同じモジュールで `requireSpace` も呼ぶ」テストを置く。
- `pages.slug` の複合 UNIQUE 化で `wiki-page-path.server.ts` の slug 解決が変わる。**slug からページを引く箇所は必ず `space_id` を伴う**。`architecture` テストで `eq(pages.slug` 単独の使用を禁止する。
- `/api/agent/*` と `/api/cli/wiki/*` は `?space=<slug>` を受け付け、省略時は `gdg-jp` を既定にして **互換を保つ**。レスポンス形式は変えない（`gdg` CLI が動き続ける）。
- `schema.sql` は生成物。`pnpm --filter @gdgjp/wiki migrate:local` で再生成する。
- 1 ファイル 400 行以下、`app/lib/` への追加禁止（`layering.test.ts`）。

## Files to touch — 変更ファイル

### `apps/wiki/`

- `migrations/00NN_spaces.sql`（新規）— `spaces` / `space_members` / `review_flags`、`sources.space_id`、`pages.space_id` + 複合 UNIQUE、`gdg-jp` バックフィル
- `app/db/schema/spaces.ts`（新規）、`app/db/schema/index.ts`、`app/db/schema/sources.ts`、`app/db/schema/pages.ts`、`app/db/schema/user.ts`（`last_space_id`、`hide_agent_pages`）
- `app/features/spaces/`（新規）— `access.server.ts`、`spaces.server.ts`（CRUD）、`members.server.ts`、`shared.ts`（型・slug 検証）、`components/`（SpaceSwitcher、MemberList、ReviewList）、各 `*.test.ts`、`README.md`
- `app/features/pages/wiki-page-path.server.ts`、`tree.ts`、`wiki-catalog.server.ts` — `space_id` を伴う検索へ、`hideAgentPages` フィルタ
- `app/features/pages/acl-spans.server.ts` — `validatePageAclForSync` の `acl_unknown_source` に `space_id` 一致条件（追加のみ）
- `app/features/sources/create.server.ts`、`sources-page.server.ts` — カレントスペースを書く
- `app/routes.ts`、`app/routes/spaces/`（新規: `list.tsx`（3 つの作成ボタン）、`settings.tsx`、`review.tsx`）、`app/routes/api/user/preferences.ts`（`hide_agent_pages`）、`app/routes/wiki/*`・`app/routes/sources/*`・`app/routes/api/agent/*`・`app/routes/api/cli/*` のスペース解決
- `app/components/Sidebar.tsx`
- `app/locales/{ja,en}/spaces.json`（新規）
- `tests/architecture/route-urls.test.ts`（スナップショット更新）、`tests/architecture/space-scoped-slug.test.ts`（新規）、`tests/architecture/space-before-inner-acl.test.ts`（新規）、`tests/migrations/00NN_spaces.test.ts`（新規）
- `ARCHITECTURE.md`、`CLAUDE.md` の Code map に `spaces` 行を追加

## Verification — 完了条件と検証

### 完了条件

- 全 `sources` / `pages` 行に `space_id = gdg-jp` が入り、`gdg-jp` の `space_members` に全チャプターの `member` principal がある。
- 移行前後で、既存ユーザーに見えるページ・ソース・黒塗り結果が **1 件も変わらない**（内側 ACL をそのまま通すため）。
- サイドバーでスペースを切り替えると、ページツリー・`/sources`・`/search` がそのスペースの内容だけになる。
- 他スペースの `/s/<slug>/wiki/<page>` を開くと 404（存在を漏らさない）。
- `/api/agent/cat` を `?space=` 無しで呼ぶと v1 と同じ結果（`gdg` CLI が壊れない）。
- organizer が `/spaces` で自分のチャプターのスペースを作ると、同チャプターの member は `editor`、organizer は `owner` で入り、他チャプターの人には 404。settings にメンバー追加 UI が無い。
- 「エージェントが作成したページを隠す」を on にするとツリーと検索から `origin = agent` が消え、URL 直打ちではバナー付きで開ける。

### コマンド

```sh
pnpm --filter @gdgjp/wiki migrate:local      # schema.sql も再生成
pnpm --filter @gdgjp/wiki typecheck
pnpm --filter @gdgjp/wiki test
pnpm --filter @gdgjp/wiki test:e2e
pnpm lint
```

### 回帰として固定すべきテスト

- **移行の冪等性** — `00NN_spaces` を 2 回適用してもスペースが増えない（`tests/migrations/`）。
- **移行の等価性** — 固定ユーザー 3 種（admin / author / member）× 固定ページ・ソースの fixture で、移行前後の `canAccessSource` / `getEffectivePagePermissions` / `redactPageMarkdown` の結果が一致する。
- **slug 単独検索の禁止** — `tests/architecture/space-scoped-slug.test.ts` が `eq(schema.pages.slug,` を `space_id` 無しで使うコードを検出して落ちる。
- **スペース判定が内側 ACL より先** — `space-before-inner-acl.test.ts`。
- **claims 取得失敗時に `chapter_role` が評価されない**（`access.server.test.ts`）。
- **他スペースのソースを `<acl src>` に指定した `/sync` は `acl_unknown_source` で拒否される。**
- **`chapter` / `personal` スペースに表 2-b に無い principal を追加する API 呼び出しは 400 で拒否される**（`members.server.test.ts`。UI を迂回しても入らない）。
- **`chapter` スペースは 1 チャプター 1 つ**（`chapter_id` UNIQUE。二重作成は 409）。
- **`hide_agent_pages` はツリー・カタログ・検索の全部に効く**（1 箇所でも漏れると「隠したのに出る」）。`tree.test.ts` / `wiki-catalog.server.test.ts` に `origin` 混在 fixture を置く。

### 手動 E2E

1. admin でサインインし `/spaces` を開く。`gdg-jp` がある。
2. `shared` スペースを新規作成し、member ユーザーを `viewer` で追加する。
2b. organizer ユーザーで「チャプタースペースを作る」→ 自分のチャプターを選ぶ → 同チャプターの member で開ける、他チャプターの member では 404。settings に追加 UI が無い。
3. そのスペースでページを作り、member ユーザーで開けること、第三のユーザーで 404 になることを確認。
4. `gdg-jp` の既存ページで `<acl>` 黒塗りが移行前と同じに見えることを、organizer / member の 2 セッションで確認。
