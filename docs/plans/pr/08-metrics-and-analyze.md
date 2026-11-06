# Stage 07 — 計測と分析: `metric_snapshots` の収集、広告 CSV の取り込み、`ad_flights`、ダッシュボード、`analyze` ジョブ

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 計測の設計は overview §8-2、予算は §8-3。
Tips 13・14・17・20 が根拠（[`01-playbook-and-skills.md`](01-playbook-and-skills.md)「元の Tips」）。

Stage 03 までで短縮リンクは tinyurl のキャンペーンに乗り、Stage 04 でアンケートが connpass に入る。しかし数字はそれぞれの
アプリに散らばっていて、「週次の目標曲線に対して申込がどこにいるか」「どのチャネルからの申込が伸びているか」「広告費に対して申込がいくらか」
「予算の消化ペースは計画どおりか」を 1 画面で見られない。このステージで pr に集め、週次の `analyze` ジョブで再配分と差し替えの**案**を出す（適用は人）。

DevFest Kansai 2026 では毎週の MTG で目標曲線（8/18 110 → 10/18 700）と実績を追い、広告の設定ミスで 6 万円を余分に使い、
現地出席は申込の 62.6 % だった（[`00a`](00a-devfest-2026-usecase-review.md) §2-6）。曲線・超過アラート・出席率はそこから。

広告の指標は X Ads / Meta の API が無い（overview §12-5）ので、広告マネージャの CSV を人が取り込む。

### 依存と対象範囲

- 依存: Stage 03（`TINYURL.getAnalytics`、`campaign_channels`、`actor_snapshot`）、Stage 04（`CONNPASS.getStats` / `listParticipants`、
  アンケートの選択肢 = `constants.channelLabels`）、Stage 02（ジョブ）、Stage 00（`BUDGET-SPLIT`、`guides/{budget,schedule}.md`）。
- 対象: `apps/pr/`（収集 cron、CSV 取り込み、`ad_flights`、ダッシュボード、`analyze`）、`skills/`（`pr-analyze` Skill、
  `constants.ads`）、`apps/tinyurl/`（**任意**: 参加者取り込みの RPC。§3 の事前確認で決める）。
- 広告 API、Instagram API は作らない。

### 事前確認（実装前に必ず）

1. **広告 CSV の列。** X 広告マネージャと Meta 広告マネージャからユーザーが実際に書き出した CSV を 1 本ずつもらい、
   `fixtures/ads/{x,meta}-sample.csv`（**数値は伏せ字に置換**）として置く。列名はロケールと版で変わるので、パーサは固定の列名を
   当てにせず、初回取り込み時に UI で列を割り当て、`chapter_settings.ads_column_maps` に保存する。
2. **connpass の参加者とアンケート回答の取得経路。** `CONNPASS.listParticipants`（`scrapeParticipants`、`surveyAnswers` 付き）の回答が、
   tinyurl の参加者 CSV 取り込み（`campaign-participant-import.server.ts`、「知った場所」→チャネル対応付け）と同じラベルで
   取れるなら、pr から tinyurl へ自動で流す RPC（`TINYURL.importParticipants`）を作る。取れなければ、**tinyurl の既存の CSV 取り込み
   画面を人が使う**運用のままにし、pr は `metrics_review` アイテムでそれを促す。結果を §3 に書き戻す。
3. `TINYURL.getAnalytics` の `acquisition` は tinyurl 側に参加者が取り込まれていないと `null`。ダッシュボードはその状態を「未取り込み」
   として表示する（0 と区別する）。

### 読むべきもの

- `apps/tinyurl/app/features/campaigns/{campaign-cli-analytics.ts,campaign-acquisition.ts,campaign-participant-analytics-db.ts,campaign-participant-import.server.ts,connpass-csv.ts}` —
  `CampaignAnalytics`（`totalClicks`, `trend`, `links`, `sources`, `acquisition`）、参加者取り込みの入力と「知った場所」対応付け
- `apps/tinyurl/app/features/analytics/analytics-engine.ts` — 時間バケットと `AnalyticsWindow`
- `apps/connpass/app/features/connpass/ui/participants.ts` — `Participant`（`surveyAnswers`）、`scrapeEventStatistics`
- `apps/pay/app/features/receipts/` — CSV / 構造化データ取り込みの UI の前例（列割り当て UI の手本として参照）
- Stage 03 の `features/dispatch/poll.server.ts`（毎時 cron の形）
- `skills/pr-playbook/guides/{budget,schedule,x,instagram}.md`、`rules.json` の `BUDGET-SPLIT`

### 再利用する既存実装（書き直さない）

- tinyurl の `getCampaignAnalyticsForActor` と `campaignAcquisitionAnalytics` — 集計は tinyurl 側。pr は結果を snapshot するだけ
- tinyurl の `buildCampaignParticipantAnalyticsInput` と参加者取り込み — 事前確認 2 で自動化する場合も、**この関数を RPC から呼ぶ**
- `@gdgjp/design-system` のチャート（あれば）。無ければ tinyurl の `features/analytics/components/charts/` の形に倣う
- Stage 02 のジョブ基盤、Stage 03 の `actor_snapshot`

## Design — 設計

### 1. テーブル（`migrations/0005_metrics.sql`）

```sql
CREATE TABLE metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('tinyurl','connpass_stats','connpass_survey','x_ads_csv','ig_ads_csv')),
  captured_at INTEGER NOT NULL,
  period_start INTEGER, period_end INTEGER,           -- CSV の集計期間
  payload TEXT NOT NULL,                              -- §2 の形。**個人を特定できる値を入れない**
  imported_by TEXT,                                   -- CSV のとき
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX metric_snapshots_campaign ON metric_snapshots (campaign_id, source, captured_at);

CREATE TABLE ad_flights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  medium TEXT NOT NULL CHECK (medium IN ('x_ads','ig_ads','print')),
  name TEXT NOT NULL,
  start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
  planned_yen INTEGER NOT NULL, actual_yen INTEGER,
  phases TEXT NOT NULL DEFAULT '[]',                  -- JSON: [{ from, to, objective: impression | click | conversion }]（Tips 28: X は最初の 3 日がインプレッション）
  overrun_alerted_at INTEGER,                         -- 超過アラートを送った時刻（1 回だけ送る）
  creative_asset_ids TEXT NOT NULL DEFAULT '[]',
  targeting_notes TEXT,
  plan_version INTEGER,                               -- 計画から展開したもの。人手は NULL
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
ALTER TABLE chapter_settings ADD COLUMN ads_column_maps TEXT NOT NULL DEFAULT '{}';
```

### 2. 収集

| source | いつ | 何を（`payload`） |
|---|---|---|
| `tinyurl` | 毎時 cron（`actor_snapshot`） | `TINYURL.getAnalytics({ from: 開始日, to: now, bucket: day })` の `CampaignAnalytics` をそのまま（`links` は上位 10 件） |
| `connpass_stats` | 毎時 cron | `CONNPASS.getStats` → `{ applications, waitlisted, canceled, capacity, byType[]: { name, applications, attended? } }`（事前確認で返る項目に合わせる。現地 / オンラインの枠別と出席数） |
| `connpass_survey` | 日次 02:30 JST | `CONNPASS.listParticipants` の `surveyAnswers` を **集計して**保存: `{ age: {…}, occupation: {…}, experience: {…}, source: {…} }`。名前・メール・id は保存しない。事前確認 2 で自動化する場合は同時に `TINYURL.importParticipants` へ |
| `x_ads_csv`, `ig_ads_csv` | 人の取り込み | `{ rows: [{ date, campaignName, adName?, spendYen, impressions, clicks, linkClicks?, results? }], breakdowns?: { age?: {…}, gender?: {…} } }` |

cron は Stage 03 の毎時分岐に足す。1 キャンペーン 1 回の呼び出しで、`active` のキャンペーンだけ。失敗は `dispatch_log`。

### 3. 広告 CSV の取り込み（`/c/:slug/metrics/import`）

1. ファイルを選び媒体を選ぶ → ヘッダ行を表示 → 必要な項目（日付、キャンペーン名、広告名、費用、インプレッション、クリック、
   リンククリック、結果、年齢、性別）に列を割り当てる → `ads_column_maps[medium]` に保存（次回は自動適用、差分だけ確認）。
2. 費用は通貨記号・桁区切りを除いて整数円。日付は `YYYY-MM-DD` に正規化。
3. 同じ `period_start/end` の snapshot があれば置き換える（重複集計を防ぐ）。
4. `ad_flights` のうち期間が重なるものに `actual_yen` を**合計で**書く（1 媒体 1 フライトが基本。複数なら `name` で突合し、
   突合できなければ画面で選ばせる）。
5. 書き込み後に **超過アラート**: `actual_yen > planned_yen × (1 + constants.budget.overrunAlertRatio)`（既定 0.1、provisional）で、
   `overrun_alerted_at` が無ければ Discord（チャプター webhook）に 1 回だけ送る。日割りの消化ペースが計画の 1.5 倍を超えたときも同様
   （設定ミスで 6 万円が溶けた事故の再発防止）。

事前確認 1 の結果（列の実例）を §2 の `payload.rows` の必須項目に反映する。

### 4. ダッシュボード（`/c/:slug/metrics`）

| ブロック | データ | 表示 |
|---|---|---|
| 申込の推移 | `connpass_stats` の時系列、`briefs.goals.curve`（無ければ `goals.applications` の 1 点） | 折れ線 + **目標曲線**。各マイルストーンとの差（+/−）、残日数と 1 日あたり必要申込数。週次 MTG の最初の 1 枚 |
| 出席 | `connpass_stats.byType` | 現地 / オンラインの枠別の申込と、当日以降は出席率（現地 533 / 852 のような値） |
| チャネル別 | `tinyurl.sources` / `links`（クリック）、`tinyurl.acquisition.channels`（申込、未取り込みなら「未取り込み」） | 表: チャネル / クリック / 申込 / 申込率 |
| 広告 | `x_ads_csv` / `ig_ads_csv` の rows、`ad_flights` | 媒体別の費用・クリック・CPC、**CPA**（費用 ÷ そのチャネルの申込。申込が未取り込みなら未算出） |
| 予算の消化 | `ad_flights` の planned / actual の累積 | 計画線と実績線。X : IG の実績比率と `BUDGET-SPLIT` の範囲 |
| 層別 | `connpass_survey` の集計 | 年齢 / 職業 / 経験年数 / 知った場所の棒グラフ（Tips 13） |
| 運用 | レビュー待ち、承認待ち、配信失敗、`delegated` の依頼、返事待ちの依頼（`request_status = sent`）、短縮リンクの死活（Stage 03）、runner の最終応答、直近の `analyze` レポート | 既存の値をまとめて。**人別**（`campaign_members`）に今週の担当アイテムと期限切れを出す |

グラフは `dataviz` の流儀（意味で色を割り当て、凡例とツールチップ、ライト / ダーク両対応）。

### 5. `ad_flights`（`/c/:slug/budget`）

計画採用（Stage 02）で `plans.body.budgetAllocation.byWeek` から `ad_flights` を展開する（`plan_version` 付き。再採用のルールは
`schedule_items` と同じ）。画面で追加・編集（期間、金額、クリエイティブ = `assets` の選択）。`BUDGET-SPLIT` の検査結果を常時表示。

### 6. `analyze` ジョブ（`skills/pr-analyze/`、`apps/pr`）

| 項目 | 内容 |
|---|---|
| 起動 | 週次 cron（月曜 02:00 JST = 日曜 17:00 UTC、`active` のキャンペーンごと）と、ダッシュボードの「分析する」ボタン |
| payload | `{ weekOf }` |
| 束 | `METRICS.json`（§2 の最新 snapshot と前週比、目標曲線との差、出席率）、`AD_FLIGHTS.json`（phases 付き）、`PLAN.json`、`SCHEDULE.json`（今後 14 日。担当者・`blocked_by`・`request_status` 付き）、`TEAM.json`（`campaign_members` と各人の今週のアイテム）、`ASSETS.json`（承認済み画像の一覧と用途）、`guides/{budget,schedule,x,instagram}.md`、`rules.json`（`plan` scope） |
| 出力（`output.schema.json`） | `reportMd`（週次 MTG のアジェンダとして読める形: 目標曲線との差 → チャネル → 広告 → 運用）、`findings[]: { metric, observation, evidence }`、`budgetReallocation: { byMedium: { x_ads, ig_ads, print }, byWeek[], rationaleMd }`、`creativeChanges[]: { assetId?, templateId, reason, slotHints }`、`scheduleChanges[]: { action: add \| move \| drop, itemId?, kind?, dueAt?, title?, reason }`、`perPerson[]: { userId, thisWeek[], overdue[] }`、`nextWeekFocusMd` |
| 取り込み | `drafts(kind: report)` に保存。`budgetReallocation` は `BUDGET-SPLIT` で検査し、範囲外なら fail を付けて表示 |
| 適用 | レポート画面の各提案に「適用」ボタン: `budgetReallocation` → `ad_flights` の `planned_yen` を書き換える（確認付き）、`scheduleChanges` → `schedule_items` を追加 / 移動 / `skipped`、`creativeChanges` → `asset` ジョブを積む。**自動では適用しない** |

優先度 −5、タイムアウト 15 分、深夜帯に寄せる（Codex Pro の 5 時間窓）。

### 制約

- **個人を特定できる値を pr に保存しない。** 参加者の名前・メール・id・自由記述は `metric_snapshots` に入れない。集計だけ。
  理由: pr は PR の道具で、名簿の置き場ではない。
- **集計は tinyurl / connpass 側の既存関数で行い、pr は結果を snapshot する。** 理由: 二重実装。
- **`analyze` の提案は人が適用する。** `ad_flights` と `schedule_items` を cron が書き換えない。
- **広告 API を呼ばない。** CSV のみ。
- **snapshot は追記、同一期間の CSV は置き換え。** 集計の二重計上を防ぐ。
- `BUDGET-SPLIT` の範囲（X : IG = 3 : 7 〜 4 : 6）と超過アラートの比率を TS に直書きしない。`constants.json` から読む。
- **超過アラートは 1 フライト 1 回。** 毎時鳴らさない。

## Files to touch — 変更ファイル

### `skills/`（サブモジュール）

- `pr-analyze/{SKILL.md,agents/openai.yaml,references/output.schema.json,references/example-output.json}`
- `pr-playbook/constants.json`（`ads.requiredColumns`、`analyze.weeklyCron`）、`guides/budget.md`（CPA の見方は Tips 14 の範囲で。Tips 番号を付ける）

### `apps/tinyurl/`（事前確認 2 で自動化する場合のみ）

- `workers/app.ts`、`app/features/campaigns/pr-service.server.ts`（`importParticipants`）と `*.test.ts`
- `packages/gdg-lib/src/pr-rpc.ts`（型）

### `apps/pr/`

- `migrations/0005_metrics.sql`、`schema.sql`
- `app/features/metrics/{snapshot.ts,snapshot.repository.server.ts,collect.server.ts,collect.test.ts,survey-aggregate.ts,survey-aggregate.test.ts,dashboard.server.ts,components/*.tsx}`
- `app/features/ads/{csv.ts,csv.test.ts,column-map.ts,import.server.ts,import.test.ts,components/ColumnMapper.tsx}`
- `app/features/budget/{flight.ts,flight.repository.server.ts,expand-from-plan.ts,expand-from-plan.test.ts,components/FlightTable.tsx,components/PaceChart.tsx}`
- `app/features/analyze/{enqueue.server.ts,apply.server.ts,apply.test.ts,components/ReportView.tsx}`
- `app/features/jobs/bundle.server.ts`、`complete.server.ts`（`analyze`）
- `app/features/plans/adopt.server.ts`（`ad_flights` の展開）
- `app/routes/metrics/{dashboard.tsx,import.tsx}`、`app/routes/budget/flights.tsx`、`app/routes/analyze/report.tsx`、`app/routes.ts`
- `workers/app.ts`（毎時 / 日次 / 週次の分岐。`[triggers] crons` に `30 17 * * *`（02:30 JST）と `0 17 * * 0`）
- `fixtures/ads/{x-sample.csv,meta-sample.csv}`（伏せ字）
- `tests/architecture/route-urls.test.ts`、`ARCHITECTURE.md`

### `apps/cli/`

- `internal/pr/runner/runner.go`（`analyze` の登録、タイムアウト 15 分）

## Verification — 完了条件と検証

### 完了条件

1. `active` のキャンペーンで毎時 cron が `tinyurl` と `connpass_stats` の snapshot を積み、ダッシュボードに申込の推移と目標線が出る。
2. 伏せ字 CSV（X / Meta）を列割り当てで取り込め、2 回目は割り当てが自動適用され、同一期間の再取り込みで行が増えない。
3. `ad_flights` に実績が入り、消化ペースと X : IG 比率が出る。範囲外なら `BUDGET-SPLIT` の警告。
4. `connpass_survey` の集計に個人を特定できる値が無い（テストで `payload` のキーを固定）。
5. `analyze` ジョブのレポートが `drafts(kind: report)` に入り、「適用」で `ad_flights` / `schedule_items` が変わる。cron は変えない。

### コマンド

```sh
pnpm --filter @gdgjp/pr migrate:local && pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
pnpm --filter @gdgjp/tinyurl test          # importParticipants を足した場合
cd skills && node pr-playbook/scripts/validate.mjs && cd ..
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`survey-aggregate.test.ts`: 出力のキーが `age / occupation / experience / source` だけで、値が数**（自由記述や名前が混ざる経路）
- **CSV の同一期間の置き換え**: 2 回取り込んでも `metric_snapshots` が 1 行、`ad_flights.actual_yen` が二重にならない
- **列割り当ての保存と差分検出**: 列が増えた CSV で未割り当ての項目だけ確認を求める
- **`BUDGET-SPLIT` の定数参照**: `constants.json` の範囲を変えるとテストの期待が追随する（TS 直書きの検出）
- **`apply.test.ts`: `analyze` の提案を適用しない限り `ad_flights` / `schedule_items` が変わらない**
- **`acquisition` が `null` のとき CPA が未算出として表示され、0 円にならない**
- **超過アラート**: `planned × 1.1` を超えた CSV 取り込みで Discord が 1 回だけ呼ばれ、2 回目の取り込みでは呼ばれない
- **目標曲線**: `goals.curve` が無いキャンペーンでも `goals.applications` の 1 点で描画でき、曲線があればマイルストーンごとの差が出る
- **`collect.server.ts`: `actor_snapshot` 無しのキャンペーンは収集をスキップし `dispatch_log` に残す**

### 手動 E2E

1. Stage 04 までの環境で、tinyurl にクリックを数件発生させ（短縮リンクを開く）、毎時 cron 相当を叩く → ダッシュボードにクリックが出る。
2. tinyurl の既存画面で connpass の参加者 CSV を取り込む（または事前確認 2 の自動経路）→ `acquisition.channels` が出る。
3. X の伏せ字 CSV を `/c/:slug/metrics/import` で取り込み、列を割り当てる → 広告ブロックに費用と CPA。
4. `/c/:slug/budget` で X : IG を 5 : 5 にする → 警告。X の `actual_yen` を計画の 1.2 倍にした CSV を取り込む → Discord に超過アラート。
5. 「分析する」→ runner → レポート。`budgetReallocation` を適用 → `ad_flights` が変わる。
