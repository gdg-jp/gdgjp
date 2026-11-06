# Stage 02 — Runner と下書き: `agent_jobs` / `gdg pr runner` / `plan` `copy` `post` ジョブ / 検査と承認キュー

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** ジョブ種別と束の形は overview §6、
Playbook と Skill の構造は §5 と [`01-playbook-and-skills.md`](01-playbook-and-skills.md) が正本。

このステージで初めて AI が動く。brief から計画（`plan`）、タイトル・コピー（`copy`）、投稿文（`post`）の下書きを
OCI VM 上の Codex が作り、Worker が Playbook の検査器にかけ、**作成 → レビュー → 承認**のキューに並べる。**配信はしない**（Stage 03）。
3 段にするのは DevFest Kansai 2026 の「作成 → Rv → 公開」をそのまま写すため（overview §2-10、[`00a`](00a-devfest-2026-usecase-review.md) §2-1）。

設計の骨は wiki の v2 runner（`docs/plans/knowledge-platform-v2/04-runner-and-synthesis.md`）と同じ:
キューと状態は Cloudflare（D1）、VM は long-poll で引くだけ、Worker は LLM を呼ばない。違いは 2 つ。

- pr のジョブは**すべて読み取り専用**（wiki の `answer` ジョブと同じ守り）。clone も push も無い。束を展開して
  `codex exec --sandbox read-only --output-schema` を回し、JSON を返す。
- プロンプトは Stage 00 の Skill の `SKILL.md` そのもの。束には Skill が解決した Playbook の断片が入る。

### 依存と対象範囲

- 依存: Stage 00（Skill、`output.schema.json`、`scripts/checks/`）、Stage 01（`campaigns` / `briefs` / `schedule_items`、Playbook 同梱）。
- 対象: `apps/pr/`（ジョブ、runner API、drafts、plans、承認キュー、cron、`/admin/runner`）、`apps/cli/`（`internal/agentrunner/`
  の抽出、`gdg pr runner`）、`infra/oci-runner/`（2 本目の systemd ユニット、yomiyasu）。
- **`apps/wiki/` は触らない。** `gdg wiki runner` は抽出後も挙動を変えない（既存テストで固定）。
- Stage 03 の担当（service binding、Discord、配信）、Stage 04 以降のジョブ種別（`page` / `asset` / `analyze` / `retro`）の
  **ハンドラは作らない**。テーブルの `type` CHECK には全種別を入れておく（後のマイグレーションを減らす）。

### 事前確認（実装前に必ず）

1. OCI VM で `gdg wiki runner` が動いていること（`infra/oci-runner/README.md` §4 の `smoke.sh`）。同じ VM に同居する。
2. VM で `python3 --version`（3.10 以上）が通り、`npx skills add nanaism/yomiyasu` で `yomiyasu` を入れ、
   `python3 <yomiyasu>/scripts/yomiyasu_check.py --help` が動くこと。入れ方（グローバル / ユーザー）は `npx skills --help` で確認して
   README に書く。
3. `codex exec --output-schema <schema> -o <out>` が `--sandbox read-only` と併用できること（wiki の `answer` で実証済み。
   `apps/cli/internal/wiki/runner/backend_codex.go` の `AnswerArgs`）。

### 読むべきもの

- `apps/wiki/app/features/jobs/{runner.server.ts,runner-routes.server.ts,shared.ts,README.md}` と `app/routes/api/runner/*.ts` —
  lease / heartbeat / result / requeue / runner-down alert の実装（Drizzle）。**pr は D1 の prepared statement に移植する**
- `apps/wiki/app/routes/admin/runner.tsx` — runner 状態画面
- `apps/wiki/tests/architecture/runner-identity-routes.test.ts` — RUNNER_TOKEN を受けるルートの固定方法
- `apps/cli/internal/wiki/runner/*.go` — 抽出元。`runner.go`（ループ）、`jobs.go`（API クライアント）、`backend*.go`、
  `answer.go`（**読み取り専用ジョブの手本**: bundle 取得 → 展開 → `--output-schema` → JSON 解析）
- `apps/cli/internal/command/wiki_runner.go` — コマンドの形
- `infra/oci-runner/{README.md,cloud-init.yaml,systemd/gdg-runner.service,scripts/smoke.sh}`
- `skills/pr-{copy,x-post,plan}/SKILL.md` と `references/output.schema.json`（Stage 00）— プロンプトと出力スキーマ
- `skills/pr-playbook/scripts/checks/{run.mjs,index.mjs}` — 検査器の入口。Worker はこれを import する

### 再利用する既存実装（書き直さない）

- `apps/wiki/app/features/jobs/runner.server.ts` の **lease SQL**（`priority DESC, created_at`、`run_after <= now`、
  `lease_until`、`attempts`、`MAX_ATTEMPTS = 3`）— 条件をそのまま D1 の SQL に移す。pr には space が無いので
  「同一 space の clone ジョブ排他」は不要
- `apps/wiki/app/features/jobs/runner-routes.server.ts` の `requireRunner` / `runnerHost` / `readJson` — 同じ形で pr に置く
- `apps/cli/internal/wiki/runner/backend.go` の `ChildEnv`（`RUNNER_*` / `GDG_*` を剥ぐ）と `runAgent` — 抽出してそのまま使う
- `apps/cli/internal/wiki/runner/answer.go` の `writeBundle`（パス脱出の検査）と `parseAnswer` の流儀
- `skills/pr-playbook/scripts/checks/index.mjs` — 検査の実装。**Worker で再実装しない**
- Stage 01 の `schedule/derive.ts` — 計画採用時のアイテム生成で派生を作る

## Design — 設計

### 1. テーブル（`migrations/0002_jobs_and_drafts.sql`）

```sql
CREATE TABLE agent_jobs (
  id          TEXT PRIMARY KEY,                       -- ULID
  type        TEXT NOT NULL CHECK (type IN ('plan','copy','post','page','asset','analyze','review','retro','fix')),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','succeeded','failed','needs_review','expired')),
  priority    INTEGER NOT NULL DEFAULT 0,             -- review 10, fix 8, copy/post 5, plan 0, analyze -5, retro -10
  payload     TEXT NOT NULL DEFAULT '{}',             -- §3
  result      TEXT, error TEXT,
  lease_owner TEXT, lease_until INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   INTEGER NOT NULL DEFAULT (unixepoch()),
  requested_by TEXT,                                  -- user id（UI から積んだとき）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()), started_at INTEGER, finished_at INTEGER
);
CREATE INDEX agent_jobs_queue ON agent_jobs (status, priority DESC, run_after, created_at);
CREATE INDEX agent_jobs_campaign ON agent_jobs (campaign_id, type, status);

CREATE TABLE runner_status (
  host TEXT PRIMARY KEY, version TEXT, backend TEXT, last_seen_at INTEGER NOT NULL, running_job_id TEXT
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,                                 -- pr-plan の output.schema.json 準拠
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','adopted','superseded')),
  job_id TEXT, author TEXT NOT NULL,                  -- 'agent' | user id
  playbook_version TEXT NOT NULL,
  check_results TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (campaign_id, version)
);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                                 -- copy / x_post / ig_post / connpass_page / connpass_mail / dm_request / reminder / asset_spec / flyer_text / listing / report
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'generating'
         CHECK (status IN ('generating','drafting','in_review','needs_approval','approved','rejected','superseded')),
  assignee_user_id TEXT,                              -- 作成者（人が書き直す担当）。schedule_items から写す
  reviewer_user_id TEXT,                              -- レビュアー。NULL なら campaign_members の reviewer / lead
  review_requested_at INTEGER, reviewed_by TEXT, reviewed_at INTEGER,
  approved_by TEXT, approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX drafts_campaign ON drafts (campaign_id, status, kind);

CREATE TABLE draft_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  author TEXT NOT NULL,                               -- 'agent' | 'human'
  user_id TEXT, job_id TEXT,
  content TEXT NOT NULL,                              -- draft-kinds.md の形
  playbook_version TEXT NOT NULL,
  check_results TEXT NOT NULL DEFAULT '[]',           -- scripts/checks の出力
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (draft_id, version)
);

ALTER TABLE schedule_items ADD COLUMN plan_version INTEGER;   -- どの計画から来たか（人手は NULL）
```

`schedule_items.draft_id` は Stage 01 で予約済み。`drafts.schedule_item_id` と両方向に持つのは、1 アイテム 1 下書き（作り直しは
新しい版）を保つため。`draft_versions` は追記のみで、`content` を UPDATE しない。

### 2. runner の identity と API（`app/routes/api/runner/`、`app/features/jobs/`）

secret `RUNNER_TOKEN`（pr 用に wiki とは別の値）。`features/jobs/runner-routes.server.ts` の `requireRunner` が
`Authorization: Bearer` を定数時間比較し、`/api/runner/*` 以外では決して受けない（`tests/architecture/runner-identity-routes.test.ts`
で `requireRunner` の呼び出し元を固定）。

| メソッド / パス | 内容 |
|---|---|
| `POST /api/runner/heartbeat` | `runner_status` upsert（`host, version, backend, running_job_id`） |
| `GET /api/runner/jobs/next?types=plan,copy,post,fix&wait=25` | 1 件 lease（`lease_until = now + 20 分`）。無ければ最大 25 秒 long-poll（2 秒間隔）して 204 |
| `GET /api/runner/jobs/:id/bundle` | §4 の束 `{ files: { path: content }, prompt, schema, timeoutSeconds }` |
| `POST /api/runner/jobs/:id/heartbeat` | lease 延長。lease が他者なら 409 |
| `POST /api/runner/jobs/:id/result` | `{ status: succeeded/failed/needs_review, result?, error?, retry? }` → §5 |

cron `* * * * *`（`[triggers] crons`、`workers/app.ts` に `scheduled` を追加。wiki と同じく `event.cron` で分岐）:
`lease_until` 切れの `leased` を `queued` に戻し `attempts += 1`、3 回で `failed`。heartbeat が 10 分より古ければ
`RUNNER_ALERT_WEBHOOK_URL`（任意の secret）に 1 時間に 1 回だけ通知。

### 2-b. 下書きの状態機械（作成 → レビュー → 承認）

```
generating ──(runner 完了 + 検査)──▶ in_review ──(レビュアー OK)──▶ needs_approval ──(承認者)──▶ approved
     │                                   │ 差し戻し                        │ 差し戻し
     └─ failed                           ▼                                 ▼
                                      drafting（担当者が直す。保存で新版 + 再検査 → in_review）
```

| 遷移 | 誰が | 何が起きる |
|---|---|---|
| `generating → in_review` | Worker | 検査を通した版ができた。`reviewer_user_id` に Discord で「レビュー依頼」（Stage 03。本ステージは `/me` に出すだけ） |
| `in_review → drafting` | レビュアー | 差し戻しコメント（`draft_reviews` 行）。担当者の `/me` に出る |
| `drafting → in_review` | 担当者 | 編集して保存（`author: human` の新版 + 再検査） |
| `in_review → needs_approval` | レビュアー | 「レビュー済み」。レビュアー自身の編集も新版として残す |
| `needs_approval → approved` | 承認者（`roles` に `lead` か主催チャプターの organizer） | 配信は Stage 03 |
| `needs_approval → drafting` | 承認者 | 差し戻し |

レビュアーと承認者が同一人物のときは `in_review` から直接 `approved` にできる（1 人チームの逃げ道）。
`draft_reviews`（`draft_id, version, reviewer_user_id, decision(approve/request_changes), comment, created_at`）を 0002 に足す。

### 3. ジョブ種別と payload（本ステージで動かすもの）

| type | payload | 積む場所 | 結果の行き先 |
|---|---|---|---|
| `plan` | `{ briefVersion, instructions? }` | brief 画面「計画を作る」 | `plans` に `author: agent` の新版 |
| `copy` | `{ briefVersion, planVersion?, count: 5, instructions? }` | 計画画面「コピーを作る」 | `drafts(kind: copy)` の新規 or 既存 draft の新版 |
| `post` | `{ scheduleItemIds: number[] (≤10), channel: x \| ig, instructions? }` | スケジュール画面で複数選択「下書きを作る」。**`blocked_by` が未解消のアイテムは積めない**（UI で灰色、API でも拒否） | アイテムごとに `drafts(kind: x_post / ig_post)` |
| `post`（`kind: flyer_text`） | `{ scheduleItemId, version: v1 \| v2 }` | フライヤーのアイテムから | `drafts(kind: flyer_text)`: 文言・写真の指定・必須の事実（日時・場所・QR）だけ。入稿データは人 |
| `fix` | `{ draftId, versionId, failures: CheckResult[] }` | §5 が自動で 1 回だけ | 同じ draft の新版（`author: agent`） |

優先度: `fix` 8、`copy` / `post` 5、`plan` 0。同じ draft への `fix` は同時に 1 件（`payload.draftId` で queued を合流）。

### 4. 束（`app/features/jobs/bundle.server.ts`）

runner に渡すファイル群。Skill が「読むもの」に挙げたものを Worker が解決して入れる。

```
SKILL.md                 skills/pr-<task>/SKILL.md そのもの（= プロンプト）
JOB.md                   このジョブの指示: 対象アイテム、候補数、人の追加指示（payload.instructions）、返す形の再掲
BRIEF.json               briefs.body（指定版）
PLAN.json                採用済み計画（あれば）
SCHEDULE.json            post のとき: 対象アイテム + 同じ週の前後のアイテム（文脈用）
DRAFT_PREVIOUS.json      fix / 作り直しのとき: 直前の版と検査結果
PLAYBOOK/rules.json      scope が該当するルールだけ
PLAYBOOK/constants.json
PLAYBOOK/guides/*.md     Skill の「読むもの」に書かれたファイルだけ（SKILL.md の `<!-- reads: guides/x.md -->` マーカーを解決）
EXAMPLES/**              同上
output.schema.json       skills/pr-<task>/references/output.schema.json
```

束は 2 MB 上限。超えたら `EXAMPLES/` から落とし、それでも超えたら `failed`（`retry: false`）で人に見せる。
束はジョブ lease のたびに生成する（R2 に置かない。pr の D1 だけで完結させる）。

### 5. 結果の取り込み（`app/features/jobs/complete.server.ts`）

1. `result.output` を Skill の `output.schema.json` で検証（Worker 側でも。runner を信用しない）。不正なら `failed`。
2. 種別ごとに保存: `plan` → `plans` 新版、`copy` → draft 新版、`post` → `scheduleItemIds` ごとに draft 新版
   （`posts[].scheduleItemId` で対応付け。欠けたアイテムは `failed` 扱いで残りは保存）。
3. 保存した各版に **検査**（§6）をかけ、`check_results` を書く。
4. `MUST` の `fail` があり、その draft にまだ `fix` を積んでいなければ `fix` を 1 件積む（`attempts` ではなく
   `payload.fixOf = versionId` で 1 回を保証）。2 回目は `needs_approval` にして UI に赤で出す。
5. runner が返した `result.checks.yomiyasu`（§8）を `JA-YOMIYASU` の結果として `check_results` に合流させる。
6. draft `status = in_review`（§2-b）、`schedule_items.status = in_review`、`drafts.schedule_item_id` / `schedule_items.draft_id` を結ぶ。
   `assignee_user_id` / `reviewer_user_id` は schedule_item から写し、無ければ `campaign_members` の `reviewer` → `lead` の順で埋める。

### 6. 検査器の組み込み（`app/features/playbook/checks.server.ts`）

`import { runChecks } from "../../../../skills/pr-playbook/scripts/checks/index.mjs"` を Vite で同梱する。
`runChecks({ kind, draft, playbook })` の結果（`{ ruleId, strength, status, detail }[]`）をそのまま `check_results` に入れる。
`JA-YOMIYASU` は Worker では常に `unevaluated` を返す実装（Python が無い）で、§5-5 で runner の結果に置き換える。
`review` ルールは `unevaluated` のまま UI のチェックリストになる。

`playbook.test.ts` に「`rules.json` の `mechanical` ルールは `runChecks` が `unevaluated` 以外を返す」を足し、Stage 00 と
Worker の実装がずれたら落ちるようにする。

### 7. 画面

| URL | 内容 |
|---|---|
| `/c/:slug/plan` | `plans` の版一覧、本文（戦略 md、チャネル配分表、予算配分、スケジュール案の表）、検査結果、「採用」「作り直す（指示付き）」「コピーを作る」 |
| `/c/:slug/drafts` | draft 一覧（kind / status / 対象アイテム / MUST 失敗数） |
| `/c/:slug/drafts/:id` | 版の切り替え、本文の表示（`x_post` は `textAboveFold` と `textBelowFold` の間に「さらに表示」の線、`copy` は候補の表）、検査結果（pass / fail / unevaluated、`review` はチェックボックス）、**編集**（保存で `author: human` の新版 + 再検査）、レビュー（OK / 差し戻し + コメント）、承認 / 却下、「作り直す（指示付き）」。担当者・レビュアーの変更 |
| `/c/:slug/reviews` | `in_review` の draft をレビュアー別・`due_at` 順に。自分がレビュアーのものを上に |
| `/c/:slug/approvals` | `needs_approval` の draft を `due_at` 順に。1 画面で承認 / 却下 |
| `/me` | （Stage 01 の画面に追加）自分が担当の `drafting`、自分がレビュアーの `in_review`、期限切れ |
| `/c/:slug/schedule` | （Stage 01 の画面に追加）複数選択 → 「下書きを作る」、各行に draft の status バッジ |
| `/admin/runner` | wiki の `admin/runner.tsx` と同じ: heartbeat、running job、種別 × status の件数、直近 50 件、直近 24 時間の失敗。super admin か organizer |

**計画の採用**（`plans.status = adopted`）: `body.scheduleItems[]` を `schedule_items` に展開する（`plan_version` を付ける。`blockedBy` /
`sessionId` / `segmentId` / `assigneeRole` も写し、`assigneeRole` は `campaign_members.roles` から担当者に解決する。解決できなければ NULL で
`/me` に「未割り当て」として出す）。`body.goalCurve` は `briefs.goals.curve` に写す（brief の新版）。
以前の計画から来た `planned` のアイテム（`plan_version` が古く `status = planned`）は削除し、それ以外（人が作った、
`needs_approval` 以降に進んだ）は残す。派生は Stage 01 の `derive.ts` で作る。`body.surveyQuestions` は `campaigns` には
入れず `plans.body` に置いたまま（Stage 04 が読む）。

**承認**は draft と schedule_item の status を `approved` にするだけ。配信は Stage 03。**レビュー**は `draft_reviews` に行を足して状態を進める。

### 8. CLI — `internal/agentrunner/` の抽出と `gdg pr runner`

`apps/cli/internal/wiki/runner/` から汎用部分を `apps/cli/internal/agentrunner/` に移す。**wiki 固有（clone / verify / push、
`JobContext` / `Page`、prompts、各ハンドラ）は残す。** `gdg wiki runner` の挙動は変えない（`runner_test.go` が通る）。

| `agentrunner` に移すもの | 元 |
|---|---|
| `Config`, `ConfigFromEnv(prefix)`（`GDG_WIKI_URL` / `GDG_PR_URL` の差は呼び出し側が与える） | `runner.go` |
| `API`（`do` / `Heartbeat` / `Next` / `ExtendLease` / `Complete` + 汎用 `Get` / `Post`）、`Job`, `Result`, `APIError`, `ErrLeaseLost` | `jobs.go` |
| `Backend`, `NewBackend`, `ChildEnv`, `runAgent`, `tail`, `CodexBackend`, `GeminiBackend`, `MCPConfig` | `backend*.go` |
| `Runner`（`New(cfg, logger, handlers, slots)`, `Run`, `serve`, `process`, `heartbeatLoop`, `dryRun`, `failed`） | `runner.go` |
| `WriteBundle`（パス脱出の検査） | `answer.go` |

`CodexBackend.Answer` は `RunStructured(ctx, dir, prompt, schemaPath, outPath, mcp *MCPConfig, timeout)` に改名し、
wiki の `answer.go` から呼ぶ。`AnswerBackend` インターフェースも `StructuredBackend` に改名。

`apps/cli/internal/pr/runner/`（新規、**5 ファイル以内**）:

```
runner.go     New(cfg) → agentrunner.New(cfg, logger, handlers{plan,copy,post,fix}, slots [][]string{{"fix","post","copy","plan"}})
job.go        1 ハンドラ共通: GET bundle → WriteBundle → RunStructured(prompt = files["SKILL.md"] + "\n\n" + files["JOB.md"], schema = files["output.schema.json"]) → 出力 JSON を読む → yomiyasu（下）→ Result{succeeded, result:{output, checks}}
yomiyasu.go   出力 JSON の日本語本文（kind ごとのキー: x_post.text / copy.candidates[].mainCopy …）を一時ファイルに書き、`python3 $YOMIYASU_DIR/scripts/yomiyasu_check.py` を実行。exit 0 → pass、非 0 → fail（標準出力を detail）、ディレクトリ無し → unevaluated
runner_test.go
```

タイムアウト: `plan` 15 分、`copy` / `post` / `fix` 8 分。`--sandbox read-only`、`--ephemeral`、`-C <jobdir>`。MCP は無し。

`apps/cli/internal/command/pr.go`（`gdg pr` の親）と `pr_runner.go`（`gdg pr runner --once --dry-run`）。環境変数は
`GDG_PR_URL`（既定 `https://pr.gdgs.jp`）、`RUNNER_TOKEN`、`RUNNER_BACKEND`、`RUNNER_MODEL`、`RUNNER_WORKDIR`
（既定 `/var/lib/gdg-pr-runner`）、`YOMIYASU_DIR`。

### 9. VM（`infra/oci-runner/`）

- `systemd/gdg-pr-runner.service`: `ExecStart=/usr/local/bin/gdg pr runner`、`EnvironmentFile=/etc/gdg/pr-runner.env`、
  `WorkingDirectory=/var/lib/gdg-pr-runner`、その他は `gdg-runner.service` と同じ。
- `cloud-init.yaml`: ユニットと `/etc/gdg/pr-runner.env` の雛形、`/var/lib/gdg-pr-runner` の作成、yomiyasu の導入
  （`runner` ユーザーで `npx skills add nanaism/yomiyasu`）と `YOMIYASU_DIR` の既定を追記。
- `scripts/smoke.sh`: pr 用の疎通（`gdg pr runner --dry-run`、`yomiyasu_check.py --help`）を追加。
- `README.md`: 2 ユニット構成、`RUNNER_TOKEN` は wiki と pr で**別の値**、ローテーション手順、Codex Pro の 5 時間窓を 2 ユニットで
  共有する注意（pr は 1 スロット）。

### 制約

- **Worker は LLM を呼ばない。** `RUNNER_TOKEN` は `/api/runner/*` だけが受ける（アーキテクチャテスト）。理由: overview §2-1。
- **runner は束を読んで JSON を返すだけ。** `--sandbox read-only`、ネットワーク無し。X にも connpass にも触らない。理由: §2-2。
- **検査は `skills/pr-playbook/scripts/checks/` の実装を import する。** Worker で書き直さない。理由: 人が Skill から使う検査と
  アプリの検査がずれる。
- **`draft_versions` は追記のみ。** 人の編集も agent の作り直しも新版。理由: Stage 08 の学習ループが差分を読む。
- **`fix` は 1 版につき 1 回。** 無限ループを作らない。
- **承認は配信しない。** `approved` にするだけで、sns / tinyurl / Discord を呼ばない。理由: Stage 03 の担当。
- **`in_review` を飛ばさない。** runner の下書きは必ずレビュアーを経る（レビュアー = 承認者のときだけ 1 段で通る）。理由: overview §2-10。
- **`blocked_by` 未解消のアイテムに `post` を積まない。** UI と `enqueue.server.ts` の両方で拒否する。理由: Tips 30。
- **`gdg wiki runner` の挙動を変えない。** 抽出はリファクタであり、`apps/cli/internal/wiki/runner/runner_test.go` を通す。
- **`infra/oci-runner/` の wiki ユニットを壊さない。** `gdg-runner.service` はそのまま。

## Files to touch — 変更ファイル

### `apps/pr/`

- `migrations/0002_jobs_and_drafts.sql`、`schema.sql`（生成）
- `wrangler.toml`（`[triggers] crons = ["* * * * *"]`、secret の注記）、`.dev.vars.example`（`RUNNER_TOKEN`）
- `workers/app.ts`（`scheduled`）
- `app/features/jobs/{shared.ts,enqueue.server.ts,lease.server.ts,complete.server.ts,bundle.server.ts,runner-routes.server.ts,maintenance.server.ts}` と各 `*.test.ts`
- `app/features/plans/{plan.ts,plan.repository.server.ts,adopt.server.ts,adopt.test.ts,components/PlanView.tsx}`
- `app/features/drafts/{draft.ts,draft.repository.server.ts,version.server.ts,components/DraftView.tsx,components/XPostPreview.tsx,components/CopyCandidates.tsx,components/CheckResults.tsx}`
- `app/features/playbook/{checks.server.ts,skills.server.ts}`（`skills/pr-*/SKILL.md` と `output.schema.json` の読み込み）、`playbook.test.ts`（追記）
- `app/routes/api/runner/{heartbeat.ts,jobs-next.ts,jobs-bundle.ts,jobs-heartbeat.ts,jobs-result.ts}`
- `app/routes/plans/plan.tsx`、`app/routes/drafts/{list.tsx,detail.tsx}`、`app/routes/reviews/queue.tsx`、`app/routes/approvals/queue.tsx`、`app/routes/me.tsx`（追記）、`app/routes/admin/runner.tsx`
- `app/features/drafts/{review.server.ts,review.test.ts,state-machine.ts,state-machine.test.ts}`
- `app/routes/schedule/calendar.tsx`（複数選択と「下書きを作る」）、`app/routes/briefs/edit.tsx`（「計画を作る」）、`app/routes.ts`
- `tests/architecture/runner-identity-routes.test.ts`（新規）、`route-urls.test.ts`（更新）
- `ARCHITECTURE.md`、`CLAUDE.md`（runner 節）

### `apps/cli/`

- `internal/agentrunner/{config.go,api.go,backend.go,backend_codex.go,backend_gemini.go,runner.go,bundle.go,runner_test.go}`（新規。移動）
- `internal/wiki/runner/{runner.go,jobs.go,backend.go,backend_codex.go,backend_gemini.go,answer.go,synthesize.go,consolidate.go,translate.go,runner_test.go}`（`agentrunner` を使う形に縮める）
- `internal/pr/runner/{runner.go,job.go,yomiyasu.go,runner_test.go}`（新規）
- `internal/command/{pr.go,pr_runner.go,root.go}`

### `infra/oci-runner/`

- `systemd/gdg-pr-runner.service`（新規）、`cloud-init.yaml`、`scripts/smoke.sh`、`README.md`

## Verification — 完了条件と検証

### 完了条件

1. `go test ./...` が通り、`gdg wiki runner --dry-run` の挙動が変わらない。
2. ローカルの pr（`wrangler dev` 相当の `pnpm dev`）に対し、手元で `RUNNER_TOKEN` と `GDG_PR_URL=http://localhost:5191` を与えた
   `gdg pr runner --once` が `copy` ジョブを 1 件処理し、`/c/:slug/drafts` に候補 5 件の draft が `in_review` で出て、レビュー OK で
   `needs_approval`、承認で `approved` になる。
3. 検査が MUST を落とす下書き（例: ハッシュタグ入り）を runner が返すと、`fix` が 1 件積まれ、2 回目で `needs_approval` になる。
4. draft を人が編集すると `author: human` の新版ができ、agent の版は変わらない。
5. `/admin/runner` に heartbeat と件数が出る。lease 切れが cron で `queued` に戻る。
6. VM に `gdg-pr-runner` を入れ、`smoke.sh` が通り、本番の pr から `plan` を 1 件完走する。

### コマンド

```sh
pnpm --filter @gdgjp/pr migrate:local
pnpm --filter @gdgjp/pr typecheck && pnpm --filter @gdgjp/pr test
go test -C apps/cli ./...
go build -C apps/cli -o /tmp/gdg ./cmd/gdg
RUNNER_TOKEN=<32+ chars> GDG_PR_URL=http://localhost:5191 YOMIYASU_DIR=$HOME/.agents/skills/yomiyasu /tmp/gdg pr runner --dry-run
RUNNER_TOKEN=... GDG_PR_URL=http://localhost:5191 /tmp/gdg pr runner --once
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **lease の原子性**: 同じ queued ジョブに対する 2 つの `leaseNextJob` が同時に成功しない（D1 の `UPDATE … WHERE status='queued' AND id = (SELECT …)` の形を崩すと二重実行になる）
- **lease 切れの requeue**: `attempts` が 3 で `failed`、それまでは `queued` に戻る
- **`fix` は 1 版 1 回**: 同じ `versionId` に対して 2 件目が積まれない
- **状態機械**: `generating → approved` の直行は不可、`in_review → approved` はレビュアー = 承認者のときだけ、差し戻しは必ず `draft_reviews` に行が残る
- **`blocked_by` 未解消のアイテムに `post` を積むと 409**
- **`complete` のスキーマ検証**: runner が不正 JSON を返したら `failed` になり draft が作られない
- **`draft_versions` の不変性**: 人の編集が既存の行を UPDATE しない（版が増える）
- **`runner-identity-routes.test.ts`**: `requireRunner` の呼び出し元が `app/routes/api/runner/` だけ
- **`agentrunner.ChildEnv`**: `RUNNER_TOKEN` / `GDG_PR_URL` / `GDG_WIKI_URL` が子プロセスに渡らない
- **`pr/runner/job.go`**: 束に `../` を含むパスがあれば展開前に失敗する
- **計画採用の冪等性**: 同じ計画を 2 回採用しても `schedule_items` が重複しない。人が作ったアイテムは消えない
- **wiki runner の既存テスト**: 抽出後も `apps/cli/internal/wiki/runner/runner_test.go` が無変更で通る

### 手動 E2E

1. Stage 01 の手順で brief を入れたキャンペーンを用意。
2. `/c/:slug/brief` で「計画を作る」→ `/admin/runner` で `plan` が `queued` → ローカル runner `--once` → `/c/:slug/plan` に版 1。
3. 「採用」→ `/c/:slug/schedule` にアイテムと派生が並ぶ。`BUDGET-SPLIT` と `REMIND-STAFF-BEFORE-POST` の検査結果が pass。
4. 「コピーを作る」→ 候補 5 件。`COPY-FROM-META-THEME` の `review` がチェックリストに出る。
5. スケジュールで `x_post` 3 件を選び「下書きを作る」→ 3 件の draft。1 件を編集してハッシュタグを入れ保存 → `X-NO-HASHTAG` が fail で赤。
6. 承認 → draft と schedule_item が `approved`。sns には何も起きないことを確認（Stage 03 前）。
