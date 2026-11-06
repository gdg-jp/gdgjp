# Stage 06 — Eval harness: 精度・権限外漏れ・鮮度を数値で持つ

## Context — 背景とリポジトリ状況

### なぜやるか

v1 には「精度が高い / 低い」を言う根拠が無かった。エージェントのバックエンド（Codex / Gemini CLI）、
プロンプト、検索設定（reranker、`match_threshold`、クエリ書き換え）を変えても、良くなったか分からない。
v2 では `00-overview.md` §6 の 7 指標を継続的に測り、変更をこの数値で判断する。黒塗りを維持する以上、
**権限外漏れ 0 件**は精度と同格の指標として扱う。

### 依存と対象範囲

- 依存: Stage 05（`answer` ジョブを Discord を通さず起こせること）、Stage 03（`searchSpaces`）、Stage 04（runner）。
- 対象ワークスペース: `apps/agent/`（評価ランナー）、`apps/wiki/`（鮮度計測の計測点、評価用ジョブ投入 API）、`docs/eval/`（評価セット）。
- 判定器（LLM-as-judge）は **開発者のローカルで `codex exec` を回す**。Worker から LLM を呼ばない方針は評価でも守る。

### 読むべきもの

- `.claude/skills/evaluate-rag/`、`write-judge-prompt/`、`validate-evaluator/`、`error-analysis/` — リポジトリにある評価手法の skill。手順はこれに従う
- `docs/agents-observability.md` — Langfuse の trace / score 規約
- `.claude/skills/langfuse/` — Langfuse CLI で trace と score を取り出す方法
- `docs/plans/knowledge-platform-v2/05-agent-worker.md` §3 — `answer` ジョブの入出力

### 再利用する既存実装（書き直さない）

- `apps/agent/src/features/inquiry/`（Stage 05）— 評価ランナーは Discord を通さず、この権限解決 → 検索 → 束 → ジョブ投入を直接呼ぶ
- `apps/agent/src/features/telemetry/`（Stage 05）— 評価実行も同じ trace 形式で Langfuse に送る（`environment: "eval"`）
- `apps/wiki/app/db/schema/jobs.ts`（Stage 02 / 04）の `agent_jobs` と `source_documents.captured_at` / `integrated_hash` — 統合遅延の計測点
- `apps/cli/internal/wiki/runner/backend.go`（Stage 04）— 判定器のローカル実行も同じ `Backend` を使う（`gdg wiki judge` として露出）

## Design — 設計

### 1. 評価セット（`docs/eval/qa/*.yaml`）

```yaml
- id: qa-0001
  space: gdg-jp
  asker: member            # admin | organizer | member | guest（未リンク Discord）
  question: "DevFest Kansai 2026 の会場のキャパシティは？"
  expected_keys: ["spaces/<id>/pages/venues/xxx.md"]     # 正答を含むオブジェクト（1 つ以上）
  expected_answer_contains: ["200"]                          # 任意。無ければ判定器のみ
  forbidden_answer_contains: []                              # 権限外漏れの検出。asker に見えてはいけない固有語
  expected_refusal: false
  source: langfuse:trace-id
  tags: [venue, numeric]
```

初期 50 件は Langfuse に残っている v1 `/ask` の trace のうち 👍 が付いたものから作る
（`langfuse` skill の CLI で `score.name = "helpful"` を抽出）。個人情報は質問文から落とす。
`space` が `gdg-jp` 以外のケースを 10 件以上含め、**黒塗りの検査ケース**を 10 件以上入れる:
同じ質問を `asker: organizer` と `asker: member` で持ち、member 側に `forbidden_answer_contains`
（スパン内の固有語）を置く。`expected_refusal: true`（スペース外の情報を聞く）も 5 件以上。

### 2. ランナー（`apps/agent/eval/run.ts`）

`pnpm --filter @gdgjp/agent eval -- --set docs/eval/qa --space-prefix e2e-` で、

1. 各ケースの `space` に対応する評価用スペース（`e2e-` プレフィクス、Stage 03 の E2E セットアップで作る）に、評価セットの参照ページとソース（visibility 付き）を事前投入する（`docs/eval/fixtures/`）。AI Search の sync（最長 15 分）を待つ。
2. `asker` ごとの identity（E2E の固定ユーザー 3 種 + `guest`）で `knowledge-search` を直接呼び `expected_keys` が上位 5 件に入るかで **hit@5**。`forbidden_answer_contains` の語を含むヒットが返ったら **leak**。
3. `answer` ジョブを wiki の `POST /api/agent/jobs/answer` で積み（評価用の `environment: eval` フラグ）、runner が処理した結果 JSON を取る。`expected_refusal` は `unanswered: true` かで判定。`forbidden_answer_contains` の語が `answer` / `citations[].quote` に出たら **leak**。
4. 判定器（§3）で忠実性を採点。
5. 結果を `eval/results/<date>.json` に書き、Langfuse に `environment: "eval"` で trace + score を送る。
6. 前回結果との差分（指標ごとの増減、新たに落ちたケース ID、leak の件数）を標準出力に出す。**leak が 1 件でもあれば exit 1**。

### 3. 判定器（`apps/agent/eval/judge.ts` → `gdg wiki judge`）

`write-judge-prompt` skill の手順で作る。判定は 2 値（`faithful` / `unfaithful`）、根拠の引用を必須にする。
実行は開発者のローカルで `gdg wiki judge --backend codex --input results/<date>.json`（`codex exec --sandbox read-only`、
JSON schema 出力）。回答生成と同じ Codex でも、**判定プロンプトは回答を見て引用ページと突き合わせる別タスク**なので
相関は許容するが、`validate-evaluator` skill に従い最初の 50 件は人手ラベルを付けて TPR / TNR を出し、
どちらかが 0.8 を下回るプロンプトは採用しない。

### 4. 鮮度・統合遅延・回答遅延の計測

wiki 側に cron（既存 `0 16 * * *` 分岐）で `freshness_samples` を書く小さなジョブを足す。

- 鮮度: 直近 24 時間に `captured_at` が更新された `source_documents` を無作為に 20 件選び、その `r2_key` を `searchSpaces(..., { layers: ["raw"] })` に `metadata_only` で問い合わせ、見つかるまでの時間を `captured_at` との差で記録。
- 統合遅延: `agent_jobs(type=synthesize).finished_at - min(source_documents.captured_at)`。
- 回答遅延: `agent_jobs(type=answer)` の `finished_at - created_at`、`expired` 率。
- `/admin/stats` に p50 / p95 を表示。Langfuse ではなく wiki に置く（AI Search 側の問題か runner 側の問題かを運用者が wiki だけで判別できるように）。

### 5. 使い方の規約

- Stage 03 の検索設定、Stage 04 / 05 のプロンプト、`RUNNER_BACKEND` / `RUNNER_MODEL` を変える PR は **評価結果の差分を PR 本文に貼る**。`apps/agent/CLAUDE.md` と `apps/cli/internal/wiki/runner/README.md` に明記する。
- 月 1 回、Langfuse の 👎 trace から 5 件を評価セットに追加する（`error-analysis` skill）。
- Codex と Gemini CLI の比較は同じセットで両バックエンドを回し、`docs/eval/README.md` に表で残す。

### 制約

- 評価は本番スペースに対して走らせない。`e2e-*` スペースのみ（本番の AI Search クエリ数と課金、runner のスロットを汚さない）。runner は `environment: eval` のジョブを本番ジョブより低優先で処理する。
- 評価セットに実在の個人の連絡先・金額を入れない（fixture は匿名化する）。
- 判定器のプロンプトを変えたら必ず `validate-evaluator` を再実行し、TPR / TNR を `docs/eval/judge-validation.md` に追記する。
- 判定器を Worker に置かない。LLM はローカルの `codex exec` か runner だけ。

## Files to touch — 変更ファイル

### `apps/agent/`

- `eval/run.ts`、`eval/report.ts`、`eval/identities.ts`（asker → identity）、`eval/*.test.ts`、`package.json`（`eval` スクリプト）
- `CLAUDE.md`（評価結果を PR に貼る規約）

### `apps/cli/`

- `internal/command/wiki.go` — `judge` サブコマンド、`internal/wiki/runner/judge.go`、`prompts/judge.md`、`judge.schema.json`

### `apps/wiki/`

- `migrations/00NN_freshness_samples.sql`（新規）、`app/db/schema/observability.ts`（新規）
- `workers/features/observability/freshness.ts`（新規）、`workers/app.ts`（cron 分岐）
- `app/routes/admin/stats.tsx`（p50 / p95 表示）
- `app/features/jobs/`（`environment: eval` の優先度）

### `docs/eval/`（新規）

- `qa/*.yaml`、`fixtures/`、`judge-validation.md`、`README.md`

## Verification — 完了条件と検証

### 完了条件

- `pnpm --filter @gdgjp/agent eval` が 50 件を回し、7 指標を出力し、Langfuse に `environment: "eval"` の trace が入る。
- 黒塗り検査ケース（organizer / member の対）で leak が 0 件。
- 判定器の TPR / TNR が人手ラベル 50 件に対して 0.8 以上。
- `/admin/stats` に鮮度・統合遅延・回答遅延の p95 が表示される。
- ベースライン（v2 初期設定、Codex）の数値が `docs/eval/README.md` に記録されている。

### コマンド

```sh
pnpm --filter @gdgjp/agent eval -- --set docs/eval/qa --space-prefix e2e-
gdg wiki judge --backend codex --input apps/agent/eval/results/<date>.json
pnpm --filter @gdgjp/agent test
pnpm --filter @gdgjp/wiki test
```

### 回帰として固定すべきテスト

- **`forbidden_answer_contains` の語が検索ヒット・回答・引用のどこかに出たら leak として exit 1** — 黒塗りの回帰をここで捕まえる。
- **`expected_refusal: true` のケースで `expected_keys` 外のページが引用されたら fail**。
- **評価ランナーが `e2e-` 以外のスペース ID を受け取ったら起動前に止まる**。
- **判定器の出力に根拠引用が無い場合は `unfaithful` 扱い**（空の根拠で `faithful` にならない）。
- **`asker: guest` の identity で `knowledge-search` を呼ぶと `audience` が `page` のみになる**。

### 手動 E2E

1. 評価を 1 回走らせ、結果 JSON と Langfuse の trace を見る。
2. `match_threshold` を意図的に 0.9 にして再実行し、hit@5 が下がることを確認（ハーネスが変化を検出できる）。
3. Stage 03 のミラーを意図的に壊し（スパン除去を外す）、leak が検出されて exit 1 になることを確認。元に戻す。
4. 判定器プロンプトを改変して `validate-evaluator` を回し、TPR / TNR が記録に追記される。
