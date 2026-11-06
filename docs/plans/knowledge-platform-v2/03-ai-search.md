# Stage 03 — AI Search: スペースごとのインスタンス、スパン分離ミラー、audience フィルタ

## Context — 背景とリポジトリ状況

### なぜやるか

v1 の検索は 3 系統（Workers AI bge-m3 + Vectorize、FTS、agents-index の e5-small）あり、どれも
hybrid 検索・リランク・クエリ書き換えを持たず、ACL フィルタをそれぞれ自前実装している
（`00-overview.md` §1-5）。Cloudflare AI Search は R2 の prefix を監視して自動でチャンク・埋め込み・
インデックスを行い、hybrid + rerank + metadata filter を binding から呼べる。

v2 の ACL は 2 層なので、検索も 2 層で守る。**スペース = インスタンス**（他スペースは構造的に
ヒットしない）、**黒塗り = オブジェクト分離 + `audience` フィルタ**（スパン本文は本文オブジェクトに
含めず、audience 別の別オブジェクトに置く）。

### 依存と対象範囲

- 依存: Stage 01（`spaces`、`resolveSpaceAccess`）。Stage 02 の R2 prefix 規約と `audience` に合わせるが、02 と並行して進めてよい。
- 対象ワークスペースは `apps/wiki/` のみ。
- Stage 04（runner の `consolidate`）と Stage 05（エージェントの検索）が本ステージの `searchSpaces()` と `/api/agent/knowledge-search` に依存する。

### 事前確認（実装前に必ず）

AI Search はローカルで動かない。**着手前に Cloudflare ダッシュボードで `gdgjp-wiki-storage` を
データソースにしたインスタンスを 1 つ手で作り、`wrangler dev --remote` から `search()` が返ること、
`retrieval.filters` に `or` を含むフィルタが効くことを確認する。** 通らなければ止まって報告する。

### 読むべきもの

- Cloudflare docs: `ai-search/usage/workers-binding`、`ai-search/how-to/multitenancy`、`ai-search/configuration/indexing/path-filtering`、`ai-search/configuration/metadata`、`ai-search/configuration/retrieval-configuration`（filters）、`ai-search/platform/limits-pricing`
- `apps/wiki/app/features/ai-search/README.md` — 置き換え対象
- `apps/wiki/app/features/pages/acl-spans.server.ts` 冒頭の規約と `buildAclSpanPolicy` / `redactPageMarkdown` — スパンの判定器。ミラーの分離もこれを使う
- `docs/plans/10-page-acl-spans.md` §0「権限の代数」
- `apps/wiki/tests/architecture/search-source-exclusions.test.ts` — 「生ソースは検索に入れない」規約。**v2 では方針が変わる**（§2）

### 再利用する既存実装（書き直さない）

- `@gdgjp/gdg-lib/acl` の `parseAclSpans` / `removeAclSpans` / `aclSpanSourceIds` / `sourceAudienceKey` — スパンの切り出しと audience キー
- `app/features/pages/acl-spans.server.ts` の `buildAclSpanPolicy` — 質問者に見えるスパンの判定。**検索側で同じ判定を再実装しない**。検索フィルタは「質問者の audience キー集合」を渡すだけにし、その集合は `canAccessSource` を通して作る（§3）
- `app/features/spaces/access.server.ts` の `resolveSpaceAccess`（Stage 01）
- `workers/features/sources/persist.ts` の `rawObjectKey` とカスタムメタデータ（Stage 02）

## Design — 設計

### 1. バインディングとインスタンス

```toml
[[ai_search_namespaces]]
binding = "KNOWLEDGE"
namespace = "gdgjp-knowledge"
```

インスタンス ID はスペース ID と同じ（`spaces.id`）。作成は `app/features/knowledge/instances.server.ts`
の `ensureSpaceInstance(env, space)` に集約する。

| 設定 | 値 |
|---|---|
| データソース | R2 `gdgjp-wiki-storage`、path filter include `spaces/<spaceId>/**` |
| `sync_interval` | `900`（15 分、最短） |
| embedding / reranker | 既定モデル。多言語性能に問題が出たら Stage 06 の評価で差し替え |
| カスタムメタデータ | `layer`, `audience`, `source_id`, `page_type`, `lang`（5 枠すべて使う） |
| OCR | off |

`ensureSpaceInstance` はスペース作成時と、cron `0 16 * * *` の分岐 `reconcileSpaceInstances`
（スペース有りインスタンス無しを作る）から呼ぶ。スペース削除時は `KNOWLEDGE.delete(id)`。

### 2. ページミラー（スパン分離）

D1 が正本。ページが保存されるすべての経路（エディタ保存、`/api/cli/wiki/sync`、Stage 04 の runner も
`/sync` 経由）の **1 箇所** — `app/features/pages/persist.server.ts` に新設する `persistPage()` ポート —
からミラーを書く。

| オブジェクト | 内容 | metadata |
|---|---|---|
| `spaces/<spaceId>/pages/<slug>.md` | front matter（`title`, `page_type`, `origin`, `updated_at`, `sources`）+ 本文から `<acl>` スパンを **除去**したもの（`removeAclSpans`。黒塗りプレースホルダも入れない） | `layer: "page"`, `audience: "page"`, `source_id: ""`, `page_type`, `lang` |
| `spaces/<spaceId>/acl/<audienceKey>/<slug>.md` | そのページのスパンのうち、audience キーが `<audienceKey>` のものの本文を連結（見出しにページタイトル） | `layer: "acl"`, `audience: <audienceKey>`, `source_id: ""`, `page_type`, `lang` |

スパンの audience キー: `aclSpanSourceIds` で `src` を集め、各ソースの `sourceAudienceKey`。
1 スパンに複数 `src` がある場合は **最も狭い**キー（`audienceContains` で比較。比較できない組は
別オブジェクトに両方書かず `review_flags(kind='acl-ambiguous-span')` を立ててミラーから除外する）。

更新時は、そのページの旧 `acl/*/<slug>.md` を **全部消してから**書く（audience が変わったスパンが
旧キーに残ると漏れる）。アーカイブ・削除時は `pages/` と `acl/` の両方を消す。

**v1 の「生ソースは検索に入れない」規約は撤回する。** raw も同じインスタンスに入れ、
`layer` フィルタで用途を分ける（UI の `/search` は既定で `layer ∈ {page, acl}`、エージェントは
raw も含む）。`search-source-exclusions.test.ts` は「`/search` UI の既定 `layers` に `raw` が無い」を
固定する形に書き換える。

書き込み後は binding のジョブ作成を `ctx.waitUntil` で呼ぶ。30 秒に 1 回の制限があるので、
429 は無視して次の `sync_interval` に任せる。

### 3. 検索ポート — `app/features/knowledge/search.server.ts`

```ts
export type KnowledgeLayer = "raw" | "page" | "acl";
export type KnowledgeHit = {
  spaceId: string; key: string; layer: KnowledgeLayer; audience: string; score: number;
  text: string; pageSlug?: string; sourceId?: string; title?: string;
};

export async function searchSpaces(env: Env, input: {
  spaceIds: readonly string[];        // resolveSpaceAccess で絞った上で渡す。1〜10
  audienceKeys: readonly string[];    // 質問者が読める audience キー集合（§3-1）。空なら "page" のみ
  query: string;
  layers?: KnowledgeLayer[];          // 既定 ["page", "acl"]
  maxResults?: number;                // 既定 10、最大 50
  rewrite?: boolean;                  // エージェント用。既定 false
}): Promise<KnowledgeHit[]>
```

- フィルタ: `and( or(layer = l1, …), or(audience = "page", audience = k1, …) )`。`audienceKeys` は常に `"page"` を含めて組む。
- `spaceIds.length === 1` → インスタンスの `search()`、2 以上 → namespace の `search()` に `instance_ids`。10 を超えたら例外（切り詰めない）。
- `retrieval_type: "hybrid"`, `reranking.enabled: true`。
- `key` から `spaceId` / `layer` / `audience` / `slug` or `sourceId` を復元する `parseObjectKey()` を `shared.ts` に置く。
- AI Search が落ちたら空配列ではなく例外。

#### 3-1. 質問者の audience キー集合 — `app/features/knowledge/audience.server.ts`

```ts
export async function audienceKeysFor(db, spaceId, identity): Promise<string[]>
```

スペース内の **ソースを列挙し、`canAccessSource(source, user, chapters)` が true のものの
`sourceAudienceKey` を集める**（重複除去）。レベル文字列から直接組まない。
`acl-spans.server.ts` 冒頭の「判定器は `canAccessSource` 1 本」を検索側でも守るため。
`user = null`（未リンク Discord ユーザー）なら空集合 → `"page"` のみ。

### 4. `/search` UI と `/api/agent/*` の置き換え

- `/search`（スペース横断）は `resolveSpaceAccess` で見えるスペースのうち最大 10 件を対象に `searchSpaces(spaceIds, …)` を呼び、ヒットにスペース名を添える。11 件以上見えるユーザーには対象スペースのチェックボックスを出す。
- `/s/:slug/search` は `searchSpaces([spaceId], audienceKeysFor(...), q)` → ヒット一覧（引用 URL 付き）。**回答合成（LLM）は行わない**（Worker から LLM を呼ばない方針）。v1 の `rag-search.server.ts` の回答合成は捨てる。
- 閲覧者の `user_preferences.hide_agent_pages`（Stage 01）が on のとき、`page` / `acl` レイヤーのヒットを `pages.origin` で **後置フィルタ**する（ヒットのキー `spaces/<id>/pages/<slug>.md` から `(space_id, slug)` を取り、D1 に 1 回の `IN` で引く）。`origin` は AI Search のメタデータ 5 枠に入らない（`00-overview.md` §3-2）ので検索側では絞れない。件数が減ることがあるので、`maxResults` は設定値の 2 倍で取ってから切る。
- `/api/agent/search` は内部実装を `searchSpaces` に変え、レスポンス形式は維持（`gdg` CLI と Stage 05 の agent Worker が同じ形式を使う）。
- 新規 `/api/agent/knowledge-search?space=a,b,c&layers=&q=`（Stage 05 と runner の MCP が使う）。呼び出し元 identity の `resolveSpaceAccess` と `audienceKeysFor` を **サーバ側で**計算して `searchSpaces` に渡す。クライアントは audience を指定できない。
- `ai-search/` の `chunker` / `embedding` / `knowledge-retriever` / `pageEmbeddingStatus` 更新経路 / `/api/admin/backfill-embeddings` は **呼び出しを止める**（削除は Stage 07）。

### 制約

- `searchSpaces` 自身は権限を判定しない。`spaceIds` と `audienceKeys` は呼び出し側が `resolveSpaceAccess` / `audienceKeysFor` から作る。`architecture` テストで `searchSpaces` の呼び出し元が両者を import していることを確認する。
- **`pages/` オブジェクトにスパン本文を 1 文字も残さない。** `removeAclSpans` の結果に `<acl` が残っていたら書かずに例外（`scrubResidualAclMarkup` の結果と比較）。
- `audience` の値は `sourceAudienceKey` 由来のみ。
- ページの正本は D1。R2 ミラーから D1 を復元する経路は作らない。
- Vectorize binding と `ai-search/` は本ステージで削除しない。Stage 07。
- E2E は `remote: true` で本番 namespace の `e2e-*` スペースを使う。`tests/e2e/global-setup.ts` で作成・後始末する。

## Files to touch — 変更ファイル

### `apps/wiki/`

- `wrangler.toml`（`ai_search_namespaces`）→ `cf-typegen`
- `app/features/knowledge/`（新規）— `instances.server.ts`、`search.server.ts`、`audience.server.ts`、`mirror.server.ts`（スパン分離）、`shared.ts`（キー規約・`parseObjectKey`）、`*.test.ts`、`README.md`
- `app/features/pages/persist.server.ts`（新規ポート。既存の保存経路をここに通す）、`app/features/pages/archive.server.ts`
- `app/features/spaces/spaces.server.ts`（作成時に `ensureSpaceInstance`）
- `app/routes/wiki/search.tsx`、`app/routes/api/agent/search.ts`、`app/routes/api/agent/knowledge-search.ts`（新規）
- `app/routes/api/cli/sync.ts`、エディタ保存 action — `persistPage` 経由に
- `workers/app.ts`（cron 分岐に `reconcileSpaceInstances`）
- `openapi/openapi.yaml`（`knowledge-search`）→ `types.generated.ts`
- `tests/architecture/search-source-exclusions.test.ts`（規約の書き換え）、`app/routes/api/agent/architecture.test.ts`
- `tests/e2e/global-setup.ts`（`e2e-*` スペースとインスタンス）
- `ARCHITECTURE.md` / `CLAUDE.md` の bindings 表

## Verification — 完了条件と検証

### 完了条件

- スペースを作ると同 ID の AI Search インスタンスができ、path filter が `spaces/<id>/**` になっている。
- `<acl src>` を含むページを保存すると、`pages/<slug>.md` にはスパン本文が無く、`acl/<audienceKey>/<slug>.md` にスパン本文がある。
- member 権限で `/s/<slug>/search` にスパン本文の固有語を入れてもヒットせず、organizer 権限ならヒットする。
- 他スペースのページは `searchSpaces` の対象に入らない。
- `/api/agent/search` のレスポンス形式が v1 と同じ。

### コマンド

```sh
pnpm --filter @gdgjp/wiki cf-typegen
pnpm --filter @gdgjp/wiki test
pnpm --filter @gdgjp/wiki exec wrangler dev --remote     # AI Search の疎通
pnpm --filter @gdgjp/wiki test:e2e
```

### 回帰として固定すべきテスト

- **`pages/` オブジェクトにスパン本文が無い** — fixture ページ（スパン 3 種）で `removeAclSpans` 後の本文にスパン内の固有語が含まれない。**黒塗り漏れの主経路**。
- **スパンの audience 変更で旧 `acl/` オブジェクトが消える** — ソースの visibility を変えて再保存したとき、旧キーのオブジェクトが残っていない。
- **`audienceKeysFor` は `canAccessSource` を通す** — `canAccessSource` をモックして false を返すとキーが出ない。
- **ページ保存経路すべてがミラーを書く** — `persistPage` を経由しない保存を `architecture` テストで禁止。
- **`parseObjectKey` の往復** — `rawObjectKey` / `pageObjectKey` / `aclObjectKey` → `parseObjectKey` が同じ値に戻る。
- **11 スペース以上で `searchSpaces` が例外**。
- **`/search` UI の既定 `layers` に `raw` が無い**。

### 手動 E2E

1. 新規スペースを作る。ダッシュボードにインスタンスが現れる。
2. organizer 専用ソースを登録し、その内容を `<acl src>` で囲んだページを 1 枚書く。15 分待つ。
3. member セッションで `/s/<slug>/search` にスパン内の固有語を入力。ヒットしない。organizer セッションではヒットし、スパン本文が引用に出る。
4. ソースの visibility を `member` に変更して再保存。15 分後、member でもヒットする。
5. ページをアーカイブし、次の sync 後に検索から消える。
