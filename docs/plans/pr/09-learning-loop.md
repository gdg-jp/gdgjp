# Stage 08 — 学習ループ: 人の修正差分、`retro` ジョブ、`playbook_proposals` と Playbook への書き戻し、事例の蓄積

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 学習ループの設計は overview §5-5、原則は §2-4
（「人が直したら Playbook が学ぶ。同じ指摘を 2 度しない」）。

Stage 07 までで 1 件のキャンペーンを AI と回せる。しかし人が下書きを直した事実は `draft_versions` に眠ったままで、
次のキャンペーンでも同じ修正を繰り返す。このステージで (1) 修正差分を機械的に記録し、(2) キャンペーン終了時の `retro` ジョブが
差分と結果指標から Playbook への提案を作り、(3) 人が採否を決め、(4) 採用した提案を `skills/pr-playbook/` に書き戻す手順と道具を
用意する。ユーザーが会話で教える Tips もここから入る（「Tips を追加」フォーム）。

デザインハーネスの `design:feedback propose / decide / apply`（`packages/design-system/harness/feedback.mjs`、
`design/proposals/README.md`）と同じ形にする: 提案はガイダンスとして読まれず、採用されたものだけが正本に入り、
`apply` は機械検査できるルールと定数だけを自動で書く。

### 依存と対象範囲

- 依存: Stage 02（`draft_versions`）、Stage 06（`assets` の人の編集）、Stage 07（`metric_snapshots`、`analyze` レポート）、Stage 00
  （`proposals/README.md`、`decisions.md`、`constants.json` の `provisional`）。
- 対象: `apps/pr/`（`draft_edits`、`retro`、提案 UI、エクスポート）、`skills/`（`pr-retro` Skill、`scripts/feedback.mjs`、
  `examples/` の形式）。
- Playbook への**自動書き戻しはしない**（overview §11）。Worker はリポジトリに触らない。

### 読むべきもの

- `packages/design-system/harness/feedback.mjs` と `design/proposals/README.md`、`design/proposals/input-label.json` — 提案の形式
  （`id, observation, scope, evidence, target, rule, baseRevision, evidenceDigests, decision`）、`propose` が証拠をコピーしてハッシュ、
  `decide` が digest に束縛、`apply` が正本の変更後は拒否
- `.claude/skills/design-improve/SKILL.md` — 「教訓を最小の正本の変更に落とす」手順。`pr-improve` の手本
- `skills/pr-playbook/{rules.json,constants.json,proposals/README.md,decisions.md}`（Stage 00）
- Stage 02 の `draft_versions`、Stage 06 の `assets.derived_from_asset_id`、Stage 07 の `metric_snapshots`

### 再利用する既存実装（書き直さない）

- `feedback.mjs` の流儀（証拠の digest、`baseRevision`）— **コピーして pr 用に書く**（design-system の harness を import しない。
  別パッケージの内部ファイルに依存しない）
- Stage 02 の `complete.server.ts`（`retro` の取り込みは `report` draft + 提案行）
- Stage 07 の集計（`METRICS.json` は同じ形）

## Design — 設計

### 1. 修正差分の記録（`migrations/0006_learning.sql`、`features/learning/edits.server.ts`）

```sql
CREATE TABLE draft_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL, to_version INTEGER NOT NULL,
  kind TEXT NOT NULL,                                 -- drafts.kind
  field TEXT NOT NULL,                                -- JSON Pointer（/text, /candidates/0/mainCopy, /sections/2/slots/heading …）
  before TEXT, after TEXT,
  char_distance INTEGER NOT NULL,                     -- 文字単位の編集距離
  rule_hints TEXT NOT NULL DEFAULT '[]',              -- 変更前後で結果が変わった検査の ruleId
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX draft_edits_campaign ON draft_edits (campaign_id, kind, field);

CREATE TABLE playbook_proposals (
  id TEXT PRIMARY KEY,                                -- ULID
  chapter_id INTEGER NOT NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('retro','human','analyze')),
  kind TEXT NOT NULL CHECK (kind IN ('rule','constant','guide','template','example','decision')),
  target TEXT NOT NULL,                               -- rules.json / constants.json#/x/foldThreshold / guides/x.md / templates/images/x-post-16x9 / examples/x_post
  summary TEXT NOT NULL,
  observation TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',                -- { editIds[], draftVersionIds[], snapshotIds[], text? }
  payload TEXT NOT NULL DEFAULT '{}',                 -- rule: rules.json の 1 件 / constant: { path, value } / example: { kind, content, metrics } / guide, template: { markdown }
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','applied')),
  decided_by TEXT, decided_at INTEGER, decision_reason TEXT,
  exported_at INTEGER, applied_playbook_version TEXT,
  playbook_version TEXT NOT NULL,                     -- 提案時のバージョン
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX playbook_proposals_chapter ON playbook_proposals (chapter_id, status, kind);
```

`draft_edits` は人の版が保存されるたびに（Stage 02 の `version.server.ts` から）機械的に書く。`content` の JSON を再帰的に比較し、
文字列の葉だけを `field` ごとに 1 行にする。`rule_hints` は、前後の `check_results` で `status` が変わった `ruleId`。
`assets` の人の編集（`derived_from_asset_id`）も同じ表に `kind = asset_spec` で書く（`slots` と `layoutVars` の葉）。

### 2. `retro` ジョブ（`skills/pr-retro/`、`apps/pr`）

| 項目 | 内容 |
|---|---|
| 起動 | キャンペーンを `closed` にしたとき自動で 1 件。手動で「振り返る」（再実行可。新しいジョブ） |
| 束 | `EDITS.json`（`draft_edits` を `kind / field` で集約。各グループに件数・代表例 3 件・`rule_hints`）、`METRICS.json`（最終の snapshot と目標曲線）、`PLAN.json` + `SCHEDULE_OUTCOME.json`（各アイテムの `status` と `external_ref`、投稿ごとのクリック、依頼アイテムの `request_status`）、`CONTACTS_USED.json`、`REVIEWS.json`（`draft_reviews` の差し戻しコメント）、**`RETRO_NOTES.md`**（人が書いた KPT。キャンペーンの「振り返りメモ」欄に貼ったもの。DevFest 2026 は人別の Keep / Problem / Try / Thanks を議事録に書いた）、`rules.json`、`constants.json`（`provisional` 付き）、`guides/*.md`、`decisions.md`、`proposals/README.md`、`ANALYZE_REPORTS.md`（週次レポート） |
| 出力（`output.schema.json`） | `reportMd`、`proposals[]: { kind, target, summary, observation, evidence: { editGroupKeys[], metricRefs[], retroNoteRefs[] }, payload }`、`examples[]: { kind, draftVersionId \| assetId, why, metrics }`、`contactOutcomes[]: { contactId, outcome: worked \| no_response \| declined, note }`、`wikiOutreachUpdateMd`（**Wiki の「イベント告知対象とコネクション保有者」に人が貼る差分の Markdown**。新しい告知先・担当の変更・結果）、`provisionalUpdates[]: { path, value, evidence }` |
| 取り込み | `drafts(kind: report)`、`playbook_proposals`（`origin: retro`）、`contacts.outcomes` に追記、`wikiOutreachUpdateMd` はレポート画面に「Wiki に貼る」ブロックとして表示（pr から Wiki に**書かない**。正本は Wiki）、`provisionalUpdates` は `kind: constant` の提案に |
| 制約（Skill に書く） | 提案は「人が直した事実 + 指標」に根拠を置く。一般論で足さない。同じ指摘が 2 件以上のキャンペーンで出ていれば `summary` に書く。`decisions.md` で却下済みの案を蒸し返さない |

優先度 −10、タイムアウト 20 分、深夜帯。

### 3. 提案の UI（`/playbook/proposals`、チャプター単位、organizer）

- 一覧: `status` / `kind` / `origin` でフィルタ。各行に `summary`、根拠の件数、提案時の Playbook バージョン。
- 詳細: `observation`、証拠（`draft_edits` の before / after を並べて表示、指標の抜粋）、`payload`（ルールなら `rules.json` の 1 件を
  整形表示、定数なら現在値 → 提案値、事例なら本文と指標）。採用 / 却下 + 理由（必須）。
- 「Tips を追加」フォーム（`origin: human`）: 自由文 + 種別 + 対象。ユーザーが会話で教える Tips の入口。文章はそのまま
  `observation` に入れ、`payload` は空でよい（書き戻し時に Claude Code が形にする）。
- 「エクスポート」: `accepted` かつ未エクスポートの提案を JSON 束（`proposals-<date>.json`）でダウンロード。形式は §4。
- キャンペーンの「振り返りメモ」欄（`campaigns.retro_notes_md`。0006 に列を足す）: 人の KPT を貼る。`retro` の束に入る。

### 4. 書き戻し（`skills/pr-playbook/scripts/feedback.mjs`）

```sh
node pr-playbook/scripts/feedback.mjs import proposals-2026-12-01.json   # 束を proposals/<id>.json に展開（digest 付き）
node pr-playbook/scripts/feedback.mjs apply <id>                          # rule → rules.json 追記、constant → constants.json 更新 + provisional 解除
node pr-playbook/scripts/feedback.mjs list                                # 未適用の一覧
```

- `apply` が自動で書くのは **`rule`（`verification.kind = mechanical` で `check` 名が既存の実装にある）と `constant`** だけ。
  `guide` / `template` / `example` / `decision` は `apply` が「手で書く対象」として proposal の本文と宛先を表示して終わる
  （`design-improve` と同じ考え。散文とテンプレートは人か Claude Code が書く）。
- `example` の書き戻し先は `examples/<kind>/<campaign-slug>-<n>.json`（本文 + 指標 + `why`）。**個人名・連絡先は含めない**
  （`feedback.mjs` が `@` 付きハンドルとメールを検出して拒否）。
- `apply` は `baseRevision`（提案時の `rules.json` / `constants.json` の digest）が今と違えば拒否する（design harness と同じ）。
- 適用後、pr の UI で「適用済み（Playbook バージョン）」を記録する（`/playbook/proposals/:id` の「適用した」ボタンに
  サブモジュールのコミットを入れる。手入力）。
- `pr-improve` Skill（`skills/pr-improve/SKILL.md`）: 上の手順を Claude Code から回すための Skill。`design-improve` の構成に倣う。

### 5. 事例の蓄積と「同じ指摘を 2 度しない」

- `examples/` に入った事例は、Stage 02 の束の `EXAMPLES/` として次のキャンペーンの Skill に渡る（既に Stage 02 で解決済み。
  ディレクトリに置くだけで効く）。
- `draft_edits` の `kind / field / rule_hints` の組で、2 件目のキャンペーンでも同じ修正が出た場合、`retro` の束にその旨を
  `EDITS.json.recurring` として機械的に付ける（LLM に頼らず検出する）。

### 制約

- **Worker は Playbook に書かない。** 書き戻しは `feedback.mjs` を人か Claude Code が実行する。理由: 正本の変更はレビューを経る。
- **Worker は Wiki にも書かない。** 告知先の結果は `wikiOutreachUpdateMd` として人が貼る。理由: overview §12-15（Wiki が正本）。
- **提案は読まれない。** `proposals/` と `playbook_proposals` を束に入れない（`retro` だけは例外で、却下済みを蒸し返さないために
  `decisions.md` を渡す）。理由: design harness と同じ。採用前の案がガイダンスに混ざる。
- **個人情報を `examples/` と提案に入れない。** `feedback.mjs` と `complete.server.ts` の両方で検出して拒否。
- **`draft_edits` は機械的に書く。** 保存の action の中で、LLM を呼ばない。
- **`apply` が自動で書くのは `rule`（mechanical）と `constant` だけ。**
- **`baseRevision` の不一致で `apply` を拒否する。** 黙って上書きしない。

## Files to touch — 変更ファイル

### `skills/`（サブモジュール）

- `pr-retro/{SKILL.md,agents/openai.yaml,references/output.schema.json,references/example-output.json}`
- `pr-improve/{SKILL.md,agents/openai.yaml}`
- `pr-playbook/scripts/{feedback.mjs,feedback.test.mjs}`、`proposals/README.md`（`import / apply / list` の手順に更新）
- `pr-playbook/examples/README.md`（事例の形式と個人情報の禁止）

### `apps/pr/`

- `migrations/0006_learning.sql`、`schema.sql`
- `app/features/learning/{edits.server.ts,edits.test.ts,diff.ts,diff.test.ts,recurring.ts,recurring.test.ts,proposals.repository.server.ts,export.server.ts,export.test.ts,pii.ts,pii.test.ts,components/EditDiff.tsx,components/ProposalCard.tsx}`
- `app/features/drafts/version.server.ts`（保存時に `draft_edits` を書く）、`app/features/assets/asset.repository.server.ts`（同上）
- `app/features/jobs/bundle.server.ts`、`complete.server.ts`（`retro`）
- `app/features/campaigns/close.server.ts`（`closed` で `retro` を積む）、`app/routes/campaigns/settings.tsx`（振り返りメモ欄）、`migrations/0006_learning.sql`（`campaigns.retro_notes_md`）
- `app/routes/playbook/{proposals.tsx,proposal.tsx,export.ts}`、`app/routes/campaigns/settings.tsx`（「振り返る」）、`app/routes.ts`
- `tests/architecture/route-urls.test.ts`、`ARCHITECTURE.md`、`README.md`（書き戻しの運用手順）

### `apps/cli/`

- `internal/pr/runner/runner.go`（`retro` の登録、タイムアウト 20 分）

## Verification — 完了条件と検証

### 完了条件

1. 下書きを人が直すと `draft_edits` に `field` 単位の行が入り、`rule_hints` に結果が変わった検査の id が入る。
2. キャンペーンを `closed` にすると `retro` が走り、レポートと提案が `/playbook/proposals` に並ぶ。`contacts.outcomes` に追記され、レポートに
   「Wiki に貼る」差分ブロックが出る。振り返りメモに書いた KPT の一文が提案の `evidence.retroNoteRefs` に出る。
3. 提案を採用してエクスポートし、`feedback.mjs import` → `apply` で `rules.json` にルールが 1 件増え、`constants.json` の
   `provisional` が 1 件解除される。`baseRevision` を変えた後の `apply` は拒否される。
4. 「Tips を追加」で入れた自由文が `origin: human` の提案として並ぶ。
5. `examples/` に書き出した事例に `@` 付きハンドルやメールが無い。

### コマンド

```sh
pnpm --filter @gdgjp/pr migrate:local && pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
cd skills && node --test pr-playbook/scripts/ && node pr-playbook/scripts/validate.mjs && cd ..
node skills/pr-playbook/scripts/feedback.mjs import /path/to/proposals-<date>.json
node skills/pr-playbook/scripts/feedback.mjs apply <id>
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`diff.test.ts`: JSON の葉の文字列だけが `field` になり、配列の並べ替えで全件が差分にならない**（`sections` の順序変更で
  見出しが「全部変わった」と記録される経路）
- **`edits.test.ts`: agent の版 → agent の版（`fix`）では `draft_edits` を書かない**（人の修正だけが学習の根拠）
- **`recurring.test.ts`: 2 キャンペーンで同じ `(kind, field, rule_hint)` が出たとき `recurring` に載る**
- **`pii.test.ts`: `@handle`、メール、電話番号を含む事例のエクスポートが拒否される**
- **`feedback.test.mjs`: `apply` は `mechanical` 以外の `rule` を書かない。`baseRevision` 不一致で拒否。`constant` の適用で
  `provisional` が消える**
- **`complete.server.ts`（`retro`）: `decisions.md` で却下済みの `target` と同じ提案は `status = rejected` で入り、UI で理由が出る**
- **束に `proposals/` が入らない**（`bundle.server.ts` のテスト。`retro` 以外のジョブ種別で）

### 手動 E2E

1. Stage 07 までを回した 1 件目のキャンペーンで、`x_post` の draft を 3 本直す（リンクの位置を 1 行上げる等）。
2. キャンペーンを `closed` に → runner → `/playbook/proposals` に提案（例: `X-FOLD-LINK-VISIBLE` のしきい値の `constant` 提案）。
3. 採用 → エクスポート → `feedback.mjs import` → `apply` → `constants.json` の `x.foldThreshold` が更新され `provisional` が消える。
4. `skills` サブモジュールを進めて pr をデプロイ → 2 件目のキャンペーンの `post` ジョブの束に新しい定数が入る。
5. 「Tips を追加」で 1 件入れ、`pr-improve` Skill で Claude Code から `guides/` に書く。
