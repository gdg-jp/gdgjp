# Stage 01 code-map — wiki のコードマップ整備と dead code 削除

## Context — 背景とリポジトリ状況

### なぜやるか

`wiki/` はモノレポ最大のワークスペース（非テストソース 52,459 行）で、エージェントが
「どこに何があるか」を突き止めるだけで大量のトークンを消費する。
全体計画は `docs/wiki-refactoring/index.md` にある。**着手前に必ず読むこと。**

このステージは全体計画の第 1 段で、**ファイルを 1 つも移動しない**。
やることは 2 つだけ。

1. 探索の入口となるコードマップを作る（後続ステージが更新していく土台）
2. 参照ゼロの dead code を削除する

ファイル移動を伴わないため、import の書き換えが発生せず、リスクが最も低い。

### 対象範囲

`wiki/` ワークスペースのみ。`cli/`・他アプリ・`gdg-lib/` は触らない。

### 読むべきもの

- `docs/wiki-refactoring/index.md` — 全体計画。目標構成と配置ルールの正本
- `wiki/CLAUDE.md` — バインディング、3 ハンドラ、auth、Drizzle、i18n、E2E の前提
- `wiki/README.md` — 現行「Directory structure」節（46〜72 行目付近）
- `wiki/workers/features/ingestion/README.md` — feature README の手本。**この粒度を真似る**

### 再利用する既存実装 — 書き直さないこと

- `wiki/workers/features/ingestion/README.md` — 既に存在する feature README。
  **新規作成せず、そのまま残す。** 他 feature の README はこれより短くてよい。
- `wiki/DESIGN.md` — デザイントークン方針。`ARCHITECTURE.md` から参照するだけで、内容は複製しない。

### 前提として確認済みの事実（再調査不要）

以下の 4 ファイルは参照がゼロであることを確認済み。再調査せず削除してよい。

- `app/routes/api.ingest..status.ts`（26 行）— ファイル名がタイポ（`..`）。`routes.ts` 未登録
- `app/routes/api.discord.ingest.ts`（80 行）— `routes.ts` 未登録、参照なし
- `app/components/MermaidBlock.tsx`（67 行）— 参照なし
- `app/lib/task-visibility.server.ts`（29 行）— 参照なし

---

## Design — 設計

### 1. `wiki/ARCHITECTURE.md` を新規作成する

コードマップの正本。**散文を書かない。表と箇条書きだけ**にする
（このファイル自体がエージェントの読むトークンになるため、150 行を上限とする）。

構成:

```markdown
# wiki architecture

`CLAUDE.md` に運用上の前提（バインディング・auth・i18n）、ここに「コードがどこにあるか」を置く。

## Code map

（下記 2. と同じ表。CLAUDE.md には要約、ここには全ドメイン分）

## 配置ルール

（index.md の「配置ルール」7 項目をそのまま転記）

## ランタイム境界

| 境界 | 実体 |
|---|---|
| Worker entry（fetch / scheduled / queue） | `workers/app.ts` |
| Durable Object | `workers/collab-durable-object.ts`, `workers/source-import-durable-object.ts` |
| Workflow | `workers/workflows/wiki-generation-phase-workflow.ts` |
| Agents SDK | `workers/agents/wiki-generation-agent.ts` |

## 読まないファイル

## 規約を強制しているテスト
```

「規約を強制しているテスト」節には、既存の 4 本を列挙する。
`workers/features/ingestion/architecture.test.ts` /
`app/routes/api.agent.architecture.test.ts` /
`app/design-token-policy.test.ts` / `app/theme-tokens.test.ts`。
後続ステージで `tests/architecture/` が増えたらここに追記する。

### 2. `wiki/CLAUDE.md` に `## Code map` 節を追加する

`## App conventions` 節の**直前**に挿入する。25 行以内。
現時点（移動前）の実際の場所を書く。後続ステージが移動のたびに更新する。

```markdown
## Code map — 「X はどこ？」

詳細は `ARCHITECTURE.md`。まずこの表を見て、grep する前に場所を絞る。

| 探しもの | 場所 |
|---|---|
| ページ本体 / ACL / 可視性 / ツリー / バージョン | `app/lib/page-*.server.ts`, `acl-spans*` |
| ソース取り込み（UI・API 側） | `app/lib/sources.server.ts` |
| ソース取り込み（Worker 実行・DO alarm） | `workers/features/sources/` |
| wiki 生成 AI | `workers/features/ingestion/` — README あり |
| AI 検索（Vectorize） | `app/features/ai-search/` |
| Google 連携（Drive / Docs / Forms / Chat） | `app/lib/google-*.server.ts` |
| Discord 連携 | `app/lib/discord-*.server.ts` |
| CLI / エージェント読み取り API | `app/routes/api.cli.*`, `app/routes/api.agent.*` |
| リアルタイム共同編集 | `workers/collab-durable-object.ts`, `app/hooks/useCollabEditor.ts` |
| DB スキーマ | `app/db/schema.ts` |

**読まないファイル**（すべて生成物。grep のノイズになるだけ）:

| ファイル | 行数 | 正本 |
|---|---|---|
| `worker-configuration.d.ts` | 14,750 | `wrangler.toml` のバインディング表（CLAUDE.md 内） |
| `schema.sql` | 599 | `app/db/schema.ts` |
| `openapi/types.generated.ts` | 1,157 | `openapi/openapi.yaml` |
```

**このマップは移動のたびに更新する契約である**ことを、節の末尾に 1 行で明記する。

### 3. `wiki/README.md` の「Directory structure」節を置き換える

現行の 27 行の散文を、次の 1 行 + 表への参照に置き換える。

```markdown
## Directory structure

`ARCHITECTURE.md` を参照。コードの場所と配置ルールはそこが正本。
```

README の他の節（Tech stack and bindings / Local dev setup / Scripts / Testing notes）は変更しない。

### 4. feature README を置く

`app/features/` の既存 5 ディレクトリ（`ai/` `ai-search/` `ingestion/` `translation/`
`zip-import/`）と `workers/features/sources/` に、**5〜10 行の** `README.md` を新規作成する。

書く内容は 3 つだけ。長い散文は書かない（README 自体がトークンコスト）。

- そのディレクトリが何を担当するか（1〜2 行）
- 入口となるファイル（1〜3 個、パス付き）
- 触るときの注意（あれば 1〜2 行。なければ書かない）

`workers/features/ingestion/README.md` は**既存のものを残す**。新規作成も上書きもしない。

### 5. dead code を削除する

「前提として確認済みの事実」の 4 ファイルを `git rm` する。

`app/routes/api.sources.$id.delete.ts`（32 行）は別扱い。`routes.ts` に未登録だが
`app/routes/api.sources.$id.delete.test.ts` が存在する。**実装時に判断する**:

- 他の `api.sources.$id.*`（archive / unarchive / refresh / visibility）が登録されているのに
  delete だけ登録されていない → 登録漏れの可能性が高い。UI 側（`app/routes/sources.tsx`）が
  `/api/sources/:id/delete` を fetch しているか確認する
- fetch していれば `routes.ts` に `route("/api/sources/:id/delete", ...)` を追加する（バグ修正）
- fetch していなければ route とテストの両方を削除する

どちらを選んだかを、変更の説明に必ず書く。

### 制約

- **ファイルを移動しない。** このステージは「文書追加」と「削除」だけ。
  `git mv` も import 書き換えも発生しない。発生したら設計を誤読している
- **`CLAUDE.md` の既存節を削らない。** 追記のみ。バインディング表・3 ハンドラの説明・
  auth・Drizzle・i18n・E2E の節はすべて残す。これらは運用上の前提であって、コードマップとは役割が違う
- **`ARCHITECTURE.md` に `CLAUDE.md` の内容を複製しない。** 二重管理は必ず腐る。
  役割分担は「CLAUDE.md = 運用前提、ARCHITECTURE.md = コードの場所」
- **`workers/features/ingestion/README.md` を書き換えない。** 生成 AI の観測性設定を含む
  運用文書であり、このステージの守備範囲外
- **削除は参照ゼロを再確認してから行う。** 上の 4 ファイルは確認済みだが、
  `git rm` の前に `grep -rn "<basename>" app workers shared tests` を 1 回走らせて 0 件を確認する

---

## Files to touch — 変更ファイル

### 新規

- `wiki/ARCHITECTURE.md`
- `wiki/app/features/ai/README.md`
- `wiki/app/features/ai-search/README.md`
- `wiki/app/features/ingestion/README.md`
- `wiki/app/features/translation/README.md`
- `wiki/app/features/zip-import/README.md`
- `wiki/app/features/google-documents/README.md`
- `wiki/workers/features/sources/README.md`

### 変更

- `wiki/CLAUDE.md` — `## Code map` 節を `## App conventions` の直前に追加
- `wiki/README.md` — 「Directory structure」節を `ARCHITECTURE.md` 参照に置換
- `wiki/app/routes.ts` — `api.sources.$id.delete.ts` を登録する判断をした場合のみ

### 削除

- `wiki/app/routes/api.ingest..status.ts`
- `wiki/app/routes/api.discord.ingest.ts`
- `wiki/app/components/MermaidBlock.tsx`
- `wiki/app/lib/task-visibility.server.ts`
- `wiki/app/routes/api.sources.$id.delete.ts` + `.test.ts` — 不要と判断した場合のみ

---

## Verification — 完了条件と検証

### 完了条件

- `wiki/ARCHITECTURE.md` が存在し、150 行以下で、Code map / 配置ルール / ランタイム境界 /
  読まないファイル / 規約を強制しているテスト の 5 節を持つ
- `wiki/CLAUDE.md` を読んだだけで、上の表の 11 ドメインについて「どのディレクトリを見るか」が分かる
- feature README が 7 個作られ、いずれも 10 行以下
- dead code 4 ファイルが消え、テストが全部通る
- **コードの振る舞いが 1 バイトも変わっていない**（削除した dead code を除く）

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

削除前の参照ゼロ確認（0 件であること）:

```bash
cd wiki && grep -rn "MermaidBlock\|task-visibility\|api.discord.ingest\|ingest..status" app workers shared tests --include="*.ts" --include="*.tsx" | grep -v "^app/components/MermaidBlock\|^app/lib/task-visibility\|^app/routes/api.discord.ingest\|^app/routes/api.ingest..status"
```

`ARCHITECTURE.md` が肥大していないことの確認（150 以下）:

```bash
wc -l wiki/ARCHITECTURE.md wiki/app/features/*/README.md
```

### 回帰として固定すべきテスト — 静かに壊れる経路

このステージは削除がリスクの中心。ビルドが通っても壊れる経路は 2 つ。

- **`app/routes/api.sources.$id.delete.ts` を削除したのに UI がまだ叩いている。**
  `sources.tsx` からの fetch は型検査に出ない文字列 URL なので、typecheck も build も通り、
  実行時に 404 になる。削除を選ぶ前に
  `grep -rn "sources/.*delete\|/delete" wiki/app/routes/sources.tsx wiki/app/components/sources/`
  を必ず走らせる。**ここを飛ばすと、ソース削除ボタンが本番で無言で壊れる。**
- **`MermaidBlock` が動的 import されている。** 静的 import の grep では出ない。
  `grep -rn "Mermaid" wiki/app` で mermaid パッケージの利用箇所も含めて確認する
  （`mermaid` は `package.json` の依存に残っているため、他所で使われている可能性がある）。

### 手動 E2E

このステージは UI を変更しないため、通常の E2E は不要。
ただし `api.sources.$id.delete.ts` について削除ではなく「登録」を選んだ場合のみ、次を確認する。

1. `pnpm --filter @gdgjp/wiki dev` で :5177 を起動する
2. `/sources` を開き、アーカイブ済みソースを 1 件削除する
3. 一覧から消え、リロードしても復活しない
