# Stage 07 — Decommission: v1 の agents-index / agent-host / Vectorize / ingestion / 翻訳キュー / hooks の撤去

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 01〜06 で v2 の経路が揃っても、v1 の経路（agents-index、agent-host の sleep、Vectorize、
`WikiGenerationAgent` + Gemini、翻訳キュー + Gemini、Cursor hooks）が残っていると
二重統合・二重翻訳・API 課金の継続になる。本ステージで v1 を撤去する。`apps/agents`（Vercel）は Stage 05 で削除済み。

**撤去しないもの**: 黒塗り ACL（`sources.visibility`、`<acl>` スパン、`redactPageMarkdown`、
`validate-acl`、`/sync` の `acl_required`、`pages.visibility` + `page_access`）。これは v2 の内側 ACL として
そのまま使い続ける（`00-overview.md` §2-1）。v1 の計画 `10-page-acl-spans.md` は引き続き正本。

### 依存と対象範囲

- 依存: Stage 04（統合と翻訳が runner で動いている）、Stage 05（新エージェントが本番で応答し、`apps/agents` が削除済み）、Stage 06（ベースライン数値と leak 0 件の記録がある）。
- 対象ワークスペース: `apps/wiki/`、`apps/agents-index/`（削除）、`apps/agent-host/`（削除）、`apps/cli/`（`agenthost` と `wiki ingest` / hooks 系の削除）、リポジトリ直下（workflows、`pnpm-workspace.yaml`、`.gitmodules`、`CLAUDE.md`）。
- 本番操作（自宅サーバの停止、API キーと AI Gateway の無効化）は人間が行う。計画はその手順を列挙するだけ。

### 読むべきもの

- `apps/wiki/ARCHITECTURE.md` の「規約を強制しているテスト」表 — 撤去で消える規約テストと書き換える規約テストの一覧
- `docs/plans/10-page-acl-spans.md` §0「権限の代数」 — **残すものの正確な範囲**
- `docs/plans/11-ingest-acl-hooks.md` — 消すもの（hooks、トレース、`ingest`）と残すもの（`validate-acl`、`verify-acl`）の境界
- `apps/agent-host/README.md`、`ENVIRONMENT.md` — 本番ホストに何があるか（停止手順の材料）
- `apps/cli/internal/command/wiki.go` — `gdg wiki` サブコマンドの一覧（残すもの / 消すもの）

### 再利用する既存実装（書き直さない）

- `apps/wiki/app/features/spaces/access.server.ts`（Stage 01）と内側 ACL 一式 — 残す
- `apps/cli/internal/wiki/{remote_helper,local,client,verify}.go`、`runner/`、`mcp/` — 残す（runner と人間の編集経路）

## Design — 設計

### 1. 切り替え手順（人間の操作を含む。順番を守る）

1. Stage 06 の評価でベースライン（Codex）が記録され、黒塗り検査ケースの leak が 0 件であることを確認し、結果を `docs/eval/README.md` に記録。
2. 本番 agent-host の `xangi.service` と `agent-host-*.timer` を停止（`sleep` は Stage 04 完了時に無効化済み）。
3. `translate` ジョブ（Stage 04）が 1 週間 `content_en` を更新し続けていることを `/admin/stats` で確認してから `TRANSLATION_QUEUE` の producer を止める。
4. Vertex / Gemini API キーと AI Gateway を無効化（翻訳と `/ingest` の最後の API 利用者が消える）。
5. 以下のコード撤去を 1 PR ずつ行う。

### 2. wiki の撤去

| 対象 | 操作 |
|---|---|
| `app/features/ai-search/`、`pageEmbeddingStatus`、`/api/admin/backfill-embeddings`、`VECTORIZE` / `AI` の埋め込み利用 | 削除。`wrangler.toml` から `[[vectorize]]` と `[ai]` を外し、インデックス `gdgjp-wiki-pages` を Wrangler で削除 |
| `workers/features/ingestion/`、`workers/agents/wiki-generation-agent.ts`、`workers/workflows/wiki-generation-phase-workflow.ts`、`/ingest` ルートと `app/features/ingestion/`、`ingestion_sessions` テーブル、AI Gateway 配線、`GEMINI_*` secrets | 削除（§8-5 で決定）。`/ingest` の URL は `/s/:slug/sources` へ 301 |
| `TRANSLATION_QUEUE`、`queue-processors.server.ts` の翻訳分岐、cron `5 0 * * *`、`AUTO_TRANSLATE`、AI Gateway 配線、`translation_segments` テーブル、`app/features/translation/translation.server.ts` の段落分割 | 削除（手順 3 の確認後）。Stage 04 の `translate` ジョブ（ページ全文を 1 回で訳す）が代替。段落キャッシュは使わない |
| `discord-channel` ドライバ | 既存行を `discord-guild` に手で移行した後に削除 |
| 旧 R2 キー `raw/**` | `source_documents.r2_key` が `spaces/` で始まる行のみになったことを確認してから一括削除 |
| `/wiki/<slug>` の 301 | **残す**（Discord の過去メッセージや外部リンクに旧 URL が残る。コストはルート 1 本） |
| `wiki_agent_instructions`（`AGENTS.md`） | 残す。runner の統合方針の正本 |
| `/api/cli/wiki/{sources,raw,sync,validate-acl}` | 残す（runner が使う）。`INGEST_QUEUE.md` 生成に関わるレスポンス項目があれば削除 |
| `sources.visibility`、`<acl>`、`redactPageMarkdown`、`page_access`、`pages.visibility` | **残す。触らない** |
| 規約テスト | `search-source-exclusions`（Stage 03 で書き換え済み）、`app/routes/api/agent/architecture.test.ts`（`KNOWLEDGE` のみ）、`workers/features/ingestion/architecture.test.ts`（削除） |

### 3. リポジトリの撤去

- `apps/agents-index/`、`apps/agent-host/` をディレクトリごと削除（`apps/agents/` と `deploy.yml` の Vercel ジョブは Stage 05 で削除済み）。`pnpm-workspace.yaml` の `apps/agent-host/*` と除外設定、`.github/workflows/agent-host-{workspace,release}.yml`、`scripts/install-gdg-agent-host.sh` を削除。
- `apps/cli/`: `internal/agenthost/` と `agent-host` サブコマンド、`internal/wiki/hooks/` + `hooks.go` + `hooks_*_test.go`、`trace.go`、`acl_gate_test.go`、`raw.go` の `BuildIngestQueue` / `IngestPrompt` / `PendingIngestDocuments`、`wiki ingest` サブコマンドを削除。`clone` / `raw pull` / `push`（remote helper）/ `verify-acl` / `runner` / `mcp` / `judge` は残す。`verify-acl` のトレース読み取り分岐（`.gdgwiki/ingest-trace.json`）を削除し、`--read-sources` のみにする。
- `xangi` サブモジュール（`apps/xangi`）を削除。
- 直下 `CLAUDE.md` の該当段落を更新（`apps/agent/`、`infra/oci-runner/` を追記、削除したアプリの段落を消す）。`docs/plans/00-llm-wiki-overview.md` の冒頭に「v2 に置き換えられた。ACL スパン（Stage 09〜10）は継続」の注記。`docs/plans/11-ingest-acl-hooks.md` の冒頭に「hooks は撤去、`validate-acl` / `verify-acl` は runner が使用」の注記。

### 制約

- **黒塗り ACL 関連のコードとテーブルを削除・緩和しない。** `grep -r "redactPageMarkdown\|validatePageAclForSync\|acl_required"` の件数が本ステージの前後で減らないことを確認する。
- 撤去 PR は「wiki の検索 / Vectorize」「wiki の ingestion / 翻訳」「apps 削除」「cli 削除」の 4 本以上に分ける。1 本で消すとレビューできない。
- 本番ホストの停止・API キーと AI Gateway の無効化は人間が行い、完了を PR 本文に記録する。
- `wrangler.toml` から LLM 系 binding / secrets が消えたことを `architecture` テストで固定する（Stage 05 の `no-llm-bindings` を wiki にも置く）。

## Files to touch — 変更ファイル

### `apps/wiki/`

- `migrations/00NN_drop_embeddings.sql`、`00NN_drop_ingestion.sql`（新規）
- `app/features/ai-search/`（削除）、`app/routes/api/admin/backfill-embeddings.ts`（削除）
- `workers/features/ingestion/`、`workers/agents/`、`workers/workflows/wiki-generation-phase-workflow.ts`、`app/features/ingestion/`、`app/routes/ingest/`（削除）
- `app/lib/queue-processors.server.ts`（翻訳分岐の削除）、`workers/app.ts`（`fetch` の `/agents/*` 分岐、cron、queue 分岐）
- `workers/features/sources/import/discord/`（削除）、`fetch-source.ts`
- `wrangler.toml`（Vectorize / AI / Workflow / Queue / secrets）→ `cf-typegen`、`.dev.vars.example`
- `tests/architecture/*`（`no-llm-bindings.test.ts` 新規）、`app/routes.ts`、`ARCHITECTURE.md`、`CLAUDE.md`

### 削除

- `apps/agents-index/`、`apps/agent-host/`、`apps/xangi`（サブモジュール）
- `.github/workflows/agent-host-workspace.yml`、`agent-host-release.yml`、`scripts/install-gdg-agent-host.sh`

### `apps/cli/`

- `internal/agenthost/`（削除）、`internal/wiki/hooks/`、`hooks.go`、`hooks_test.go`、`hooks_acl_insert_test.go`、`trace.go`、`trace_test.go`、`acl_gate_test.go`（削除）、`internal/wiki/raw.go`、`internal/wiki/verify.go`（トレース分岐の削除）、`internal/command/wiki.go`、`cmd/`

### リポジトリ直下

- `pnpm-workspace.yaml`、`CLAUDE.md`、`.gitmodules`、`docs/plans/00-llm-wiki-overview.md`、`docs/plans/11-ingest-acl-hooks.md`（注記）

## Verification — 完了条件と検証

### 完了条件

- `grep -r "VECTORIZE\|WikiGenerationAgent\|TRANSLATION_QUEUE\|GEMINI_API_KEY" apps/wiki/app apps/wiki/workers apps/wiki/wrangler.toml` が 0 件。
- `grep -rc "redactPageMarkdown\|validatePageAclForSync" apps/wiki/app` の合計が本ステージ前と同じ。
- `pnpm ci:full` が通る（削除したワークスペースの参照が残っていない）。`cd apps/cli && go test ./...` が通る。
- 自宅サーバのユニットが停止し、1 週間 wiki の `last_integrated_at` が OCI runner によって更新され続けている。
- Cloudflare の AI Gateway と Vertex の当月リクエスト数が 0。

### コマンド

```sh
pnpm install
pnpm ci:full
pnpm --filter @gdgjp/wiki cf-typegen
pnpm --filter @gdgjp/wiki migrate:local
cd apps/cli && go build ./... && go test ./...
```

### 回帰として固定すべきテスト

- **黒塗り ACL のテスト（`acl-spans.test.ts`、`acl-spans.server.collab-gate.test.ts`、`tests/migrations/` の visibility 関連）がすべて残り、通る。**
- **`wrangler.toml` に LLM 系 binding / secrets が無い**（wiki と agent の両方）。
- **`pnpm-workspace.yaml` に存在しないディレクトリが無い**（`scripts/` のリポジトリテスト）。
- **`verify-acl --read-sources` を空で呼ぶとエラー**（トレース削除後に「何も検査しない」に落ちない）。

### 手動 E2E

1. 旧 `/wiki/<slug>` を開くと `/s/gdg-jp/wiki/<slug>` に 301 で着く。黒塗りは変わらず効いている（organizer / member で確認）。
2. `gdg-jp` の日本語ページを編集 → 翌日の `translate` ジョブで `content_en` が更新される（翻訳キュー撤去後も翻訳が続いている）。
3. `wrangler vectorize list` に `gdgjp-wiki-pages` が無い。
4. `/ingest` を開くと `/s/gdg-jp/sources` へ飛ぶ。
