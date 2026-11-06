# Stage 04 — Runner and synthesis: OCI 上の `gdg wiki runner` と `synthesize` / `consolidate` / `translate` ジョブ

## Context — 背景とリポジトリ状況

### なぜやるか

v1 では raw の取得だけがクラウドで、raw をページへ統合する工程は自宅サーバの Cursor CLI にしか無く、
止まっても見えない（`00-overview.md` §1-1）。v2 でも LLM はコスト上の理由で API ではなく
サブスクリプションのコーディングエージェント（Codex CLI）で回す。そのため統合は VM に残るが、
**キューと状態を Cloudflare（Stage 02 の `agent_jobs`）に置き、VM はそれを引くだけの常駐 1 本**にする。
自宅サーバではなく共有 Oracle Cloud の VM に置き、cloud-init 1 枚で誰でも作り直せるようにする。

v1 の agent-host が持っていた uid 分離・Cursor hooks・AppArmor・署名付きリリースは作らない。
統合ジョブは「全スペースを読める単一の信頼されたプロセス」で、黒塗りの守りは
サーバ側の既存検証（`verify-acl` → `validate-acl`、`/sync` の `acl_required`）に置く。

### 依存と対象範囲

- 依存: Stage 02（`agent_jobs`、`last_integrated_at` / `integrated_hash`、`audience`）、Stage 03（`persistPage` 経由の `/sync`、`/api/agent/knowledge-search`）。
- 対象ワークスペース: `apps/wiki/`（`/api/runner/*`、ジョブ状態 UI）、`apps/cli/`（`gdg wiki runner`、`clone --space`）、`infra/oci-runner/`（新規）。
- Stage 05 の `answer` ジョブは本ステージの runner の **ジョブ種別追加**として実装する。本ステージは `synthesize`・`consolidate`・`translate` を完走させる。

### 事前確認（実装前に必ず）

1. **Codex CLI の無人実行の可否。** OpenAI の現行ドキュメントと利用規約で、ChatGPT サインイン（`~/.codex/auth.json`）を常駐プロセスからの `codex exec` に使ってよいかを確認する。CI 向けには API キーか Business / Enterprise の Codex アクセストークンが案内されている。契約は **個人の ChatGPT Pro**（`00-overview.md` §8-3）。**不可なら Gemini CLI バックエンド（§6）に切り替えて報告する。API キーに戻す選択はこの計画の前提（定額）を崩すので取らない。**
2. OCI の共有アカウントで `VM.Standard.A1.Flex`（2 OCPU / 12 GB、Ubuntu 24.04 aarch64）を 1 台起動できること。
3. その VM から `codex exec --ask-for-approval never --sandbox read-only "echo ok"` が通ること（arm64 musl バイナリ）。

### 読むべきもの

- `apps/cli/internal/command/wiki.go` — `gdg wiki` サブコマンド（`clone` / `raw pull` / `ingest` / `verify-acl`）の現行実装
- `apps/cli/internal/wiki/{client,remote_helper,verify,local,state}.go` — Sync クライアント、`gdg-wiki` git remote helper、`verify-acl` の実体
- `docs/plans/03-local-ingest-toolchain.md`、`03a-agents-md.md` — clone / remote helper / sync の全体像と v1 の `AGENTS.md`（統合方針。**プロンプトの土台**）
- `docs/plans/11-ingest-acl-hooks.md` §1 — `validate-acl` の仕様（ページ単位 + 実行単位の検査）。runner はこれを `readSourceIds = ジョブの sourceIds` で呼ぶ
- `apps/agent-host/workspace/AGENTS.md` の「Knowledge routing」表 — 何をどこに書くかの運用知識
- `apps/wiki/app/features/pages/README.md` — `origin: human | agent` の意味

### 再利用する既存実装（書き直さない）

- `apps/cli/internal/wiki/client.go` の `Client`（Bearer、`*HTTPError`、`Sync`、`ValidateACL`）— runner の HTTP はここに足す
- `apps/cli/internal/wiki/remote_helper.go` — `git push` → `/sync`。**「`pages/**` と `AGENTS.md` 以外の push を拒否する」検査を緩めない**
- `apps/cli/internal/wiki/verify.go` の `verify-acl` — 変更ページ収集 + `validate-acl` 呼び出し。**runner はこれを呼ぶだけ**
- `apps/cli/internal/wiki/local.go` の `LocalPages` / `FrontMatter`
- `apps/wiki/app/features/pages/acl-spans.server.ts` の `validatePageAclForSync` / `validateReadSourcesTagged`、`app/routes/api/cli/wiki/validate-acl.ts`
- `apps/wiki/app/features/agent-api/agents-md.server.ts` — サーバ側に版管理された `AGENTS.md`。統合方針の正本として使い続ける
- `apps/wiki/app/features/jobs/`（Stage 02）— ジョブの状態遷移関数。`/api/runner/*` はこれを呼ぶ
- `apps/wiki/app/features/spaces/` の `review_flags`（Stage 01）

## Design — 設計

### 1. runner の identity — `RUNNER_TOKEN`

wiki に secret `RUNNER_TOKEN` を置く。`/api/runner/*` と `/api/cli/wiki/*`（clone / raw / sync /
validate-acl）が `Authorization: Bearer <RUNNER_TOKEN>` を受けたら identity を **`runner`** にする:
`user = { id: "runner", isAdmin: true, name: "Knowledge Runner" }`、全スペース `owner`。

- `runner` identity は **読みは全スペース・全 visibility**、書きは `/sync`（`origin: agent` 固定）と `/api/runner/*` のみ。それ以外のルート（エディタ保存 action、`/api/sources` 等）では 403。`architecture` テストで「`runner` identity を受け付けるルート一覧」を固定する。
- `/sync` は `runner` からの push でも `validatePageAclForSync` を **通常どおり**適用する。管理者だから省く、はしない。
- トークンは `wrangler secret put RUNNER_TOKEN` と VM の `/etc/gdg/runner.env` の 2 箇所。ローテーション手順を `infra/oci-runner/README.md` に書く。

### 2. ジョブ API — `app/routes/api/runner/*`

| メソッド / パス | 内容 |
|---|---|
| `GET /api/runner/jobs/next?types=synthesize,consolidate&wait=25` | `queued` を `priority DESC, created_at` で 1 件 lease（`lease_owner = runner ホスト名`、`lease_until = now + 20 分`）。無ければ最大 25 秒 long-poll（D1 を 2 秒間隔でポーリング）して 204 |
| `POST /api/runner/jobs/:id/heartbeat` | `lease_until` 延長。runner は 60 秒ごとに送る |
| `POST /api/runner/jobs/:id/result` | `{ status: succeeded / failed / needs_review, result, error }`。`synthesize` 成功時は `payload.documentIds` の `integrated_hash = content_hash`、`sources.last_integrated_at = now` |
| `POST /api/runner/heartbeat` | runner 自体の生存（`runner_status` テーブル 1 行: `host, version, backend, last_seen_at, running_job_id`）。UI と Stage 05 の縮退判定が読む |

`lease_until` を過ぎた `leased` は cron `0 * * * *` の分岐で `queued` に戻す（`attempts += 1`、3 回で `failed`）。

### 3. `gdg wiki runner`（`apps/cli/internal/wiki/runner/`）

systemd で常駐する Go のループ。**10 ファイル以内**に収める（v1 の `agenthost` 40 ファイルの再来を防ぐ）。

```
loop:
  POST /api/runner/heartbeat
  GET  /api/runner/jobs/next?types=<自分が処理できる種別>
  lease 取得 → ジョブ種別ごとの handler → POST result
```

同時実行は **2 スロット**（2 OCPU）: 1 本は `answer` 専用（Stage 05）、1 本は `synthesize` / `consolidate` / `translate`。`answer` が無いときにスロットを `synthesize` に貸さない（応答遅延を守る）。

設定は `/etc/gdg/runner.env`: `GDG_WIKI_URL`, `RUNNER_TOKEN`, `RUNNER_BACKEND=codex|gemini`, `RUNNER_WORKDIR=/var/lib/gdg-runner`, `RUNNER_MODEL`（任意）。

#### 3-1. `synthesize` handler

1. `gdg wiki clone --space <slug> --lang <space.lang> <workdir>/<jobId>`（**`--space` を新設**: そのスペースのページだけを clone する。`runner` identity なので黒塗り無しの全文）。
2. `gdg wiki raw pull --source <id>...`（ジョブの `payload.sourceIds` のみ。全 raw は引かない）。
3. `JOB.md` を書く: 変更された文書のパス一覧（**各文書のバイト数と、前回統合時からの差分行数**を添える。Discord の月次ファイルは数 MB になり得るので、大きい文書は「見出し単位で読み、全文を一度に開かない」と指示する）、ソースの visibility（`- visibility: organizer` 形式。v1 の `INGEST_QUEUE.md` と同じ書式）、ソース ID（`<acl src>` に書く値そのもの）、`AGENTS.md` の統合節へのポインタ。ジョブの raw 合計が 4 MB を超える場合はソース単位に分けて `codex exec` を複数回に分ける（1 回 30 分の上限はそのまま）。
4. `codex exec --ask-for-approval never --sandbox workspace-write -C <clone> "$(cat prompts/synthesize.md)"`。タイムアウト 30 分。**子プロセスの環境変数から `RUNNER_TOKEN` と `GDG_*` を外す**（`exec.Cmd.Env` を明示的に組む）。Codex はクローン内のファイルだけを編集し、`git push` は runner が行う。トークンが環境に残っていると Codex が自分で push でき、verify-acl を飛ばせる。
5. `gdg wiki verify-acl --read-sources <payload.sourceIds>`（**`--read-sources` を新設**: v1 のトレース `reads[]` の代わりにジョブのソース一覧を `readSourceIds` として渡す。hooks もトレースも無いので、これが `acl_untagged_read_source` 検査の入力）。exit 1 なら **1 回だけ** findings を添えて `codex exec` を再実行（「以下のソース由来の記述を `<acl src>` で囲め」）。2 回目も exit 1 なら `needs_review` + `review_flags(kind='acl-untagged', payload=findings)` で終了。push しない。
6. `git add -A pages && git commit && git push`（remote helper → `/sync`。サーバの `acl_required` が最終防壁）。remote helper は clone 時の `revision` を `expectedRevision` として送る（v1 の既存挙動）。`origin: agent` のページは人間が編集できない（§3-4）ので、409 が返るのは **同スペースの別ジョブが先に push した**場合だけ。runner はジョブを `failed`（`attempts += 1`）にして再キューに任せる。同スペースの clone 系ジョブ（`synthesize` / `consolidate`）は lease 時にスペース単位で直列化するので、通常は起きない。
7. `POST result`。`pages_written` に push したページ slug を入れる。

`origin: human` のページへの変更: `/sync` 側で `origin` を見て、`runner` からの human ページ更新は **適用せず** `review_flags(kind='human-page-conflict', payload=差分)` に積み、`/sync` は当該ページだけ `skipped` を返す（他ページは適用）。runner はプロンプトで human ページを避けるよう指示するが、守りはサーバ。v1 の `humanOriginSyncError`（即エラー）を「skipped + フラグ」に緩める形。

`JOB.md` には `## Requests` 節を足し、§3-4 の「エージェントに依頼」で積まれた依頼（依頼者の表示名、対象ページ、本文）を
そのまま載せる。依頼があるジョブは `payload.sourceIds` が空でもよい（raw を引かず、ページだけ直す）。

#### 3-2. `consolidate` handler

cron `0 16 * * *` の分岐 `enqueueConsolidation(env)` がスペースごとに 1 件積む（`queued` があれば積まない）。

1. `gdg wiki clone --space <slug>`。
2. `codex exec`（`prompts/consolidate.md`: 重複候補の統合提案、リンク切れ修正、`index` と名前空間ページの更新。**新規トピックページは作らない、raw を読まない**）。
3. `verify-acl` → push。
4. LLM 不要の検査は wiki 側で: `index` の決定的再生成、`[[slug]]` のリンク切れ → `review_flags(kind='broken-link')`。

#### 3-3. `translate` handler

v1 の翻訳は `TRANSLATION_QUEUE` → Gemini API（AI Gateway）で、費用が高額になった（`00-overview.md` §8-4）。v2 では Codex の定額に寄せる。
**品質より安さを優先する**（§8-7 で決定）: 1 ジョブ = 1 ページ、ページ全文をそのまま渡して英語にしてもらうだけ。
用語集・段落キャッシュ・英語版クローン・`JOB.md` は作らない。

- **変更検出**: `pages` に `translation_source_hash TEXT`（最後に翻訳した時点の `content_ja` の sha256）を足す。翻訳が要るのは `translation_status_en != 'human'` かつ `translation_source_hash` が現在の `content_ja` のハッシュと違うページ（新規ページは NULL なので対象）。
- **投入**: wiki 側の cron（深夜 JST 02:00、新規 `0 17 * * *`）が `translate_enabled` のスペース（**既定 true、全スペース**。owner が settings で off にできる）について対象ページを集め、**1 ページ 1 ジョブ**で `agent_jobs(type=translate, priority=-5, payload={ pageId, sourceHash })` に積む（`enqueueTranslate`、`app/features/jobs/enqueue.server.ts`）。1 晩の上限は 200 ページ（環境変数 `TRANSLATE_NIGHTLY_CAP`）、`updated_at` が古い順。溢れた分は翌晩。1 日 1 回・変更があったページだけなので、通常の夜は数枚〜数十枚。ページ画面の「英語版を今すぐ更新」ボタン（`editor` 以上）は同じ関数を `priority=5` で 1 件呼ぶ。`AUTO_TRANSLATE` 変数は廃止。
- **実行**: runner は `GET /api/runner/pages/:id?lang=ja`（runner identity、黒塗り無し）で front matter 付き全文を取り、空の作業ディレクトリに `source.md` として置く。`codex exec --ask-for-approval never --sandbox workspace-write -C <workdir> "$(cat prompts/translate.md)"`（15 分）。プロンプトは「`source.md` は日本語の wiki ページ。英語に訳して `target.md` に書く。Markdown 構造・front matter のキー・`[[slug]]` リンク・URL・コードブロックは変えない。**`<acl src="…">…</acl>` は同じ数・同じ `src` で、中身だけ訳す**。訳注や前置きは書かない」。runner は `target.md` を読み、`POST /api/runner/pages/:id/translation { contentEn, sourceHash }` を送る。
- **サーバ側の受け口**（`app/routes/api/runner/pages.$id.translation.ts`）: (1) `sourceHash` が現在の `content_ja` のハッシュと違えば 409（翻訳中に日本語が変わった。翌晩やり直す）、(2) `validatePageAclForSync` と同じスパン検査を `contentEn` に通し、**スパンの数か `src` が原文と食い違えば `acl_required` で拒否**、(3) 通れば Stage 03 の `persistPage()` を `en` だけで呼ぶ（`content_en`、`translation_status_en = 'ai'`、`translation_source_hash`。`content_ja` と front matter は触らない）。`/sync` は使わない（1 ページのために全スペースを clone しない）。
- **大きすぎるページ**: `content_ja` が 150 KB を超えるページは積まず `review_flags(kind='translate-stuck', payload={ reason: 'too_large' })`。
- **運用**: `/admin/runner` に `translate` の滞留枚数。レート制限で失敗したジョブは翌晩の cron で再投入される（`attempts` は翻訳では上限なし、ただし同じページが 3 日連続で失敗したら `review_flags(kind='translate-stuck', payload={ reason: 'failed_3_days' })`）。
- v1 の `TRANSLATION_QUEUE` + Gemini API と `translation_segments` は Stage 07 で撤去（1 週間の並走で `content_en` が更新され続けることを確認してから）。

#### 3-4. `origin: agent` ページの編集ロックと「エージェントに依頼」

agent が書いたページは **人間が編集できない**（§8-6 で決定）。直したいときはエージェントに頼む。

- **ロック**: `app/features/pages/origin-lock.server.ts`（新規）に `canHumanEditPage(page, identity)` を置く。`origin = agent` なら `identity` が `runner` のときだけ true。エディタ route の loader / action、collab DO の接続、`/api/pages/*` の本文・タイトル更新、`/api/cli/sync` の非 runner 呼び出し（Stage 07 までは開発者が叩ける）が **全部これを通る**。`getEffectivePagePermissions` は変えない（内側 ACL を触らない規約）。ロックは `canEdit` の **後**に AND で掛ける。
- **ロックの対象外**: アーカイブ・移動・visibility / 共有の変更・レビューの「適用」は人間（スペース `editor` 以上 + `canManageSharing` 等の既存判定）ができる。本文とタイトルだけがロック。
- **UI**: `origin = agent` のページでは「編集」ボタンの代わりに **「エージェントに依頼」** ボタン。押すとテキストエリア（依頼内容、必須、2000 字まで）→ `enqueueSynthesize(db, { spaceId, sourceIds: [], requests: [{ pageSlug, text, requestedBy }] })`。同スペースに `queued` の `synthesize` があればその `payload.requests` に合流（Stage 02 §3 の束ねと同じ扱い。1 時間 1 本の制限内）。runner は `JOB.md` の `## Requests` に載せ（§3-1）、完了時に依頼者へ既存の通知（`app/features/notifications/`）で「反映しました / できませんでした（理由）」を送る。Codex が依頼を断る（`log` に理由を書く）ことも許す。
- **`architecture` テスト**: 本文を書く関数（`persistPage()` を呼ぶ route / action）を列挙し、`runner` 以外から呼ばれる経路はすべて `canHumanEditPage` を通ることを固定する（`tests/architecture/agent-page-lock.test.ts`）。

### 4. プロンプト（`apps/cli/internal/wiki/runner/prompts/*.md`、`//go:embed`）

- `synthesize.md`: v1 `03a-agents-md.md` の方針を踏襲。既存ページを優先して更新、矛盾は両論を「未確認」ブロックに、連絡先を本文に入れない、1 ソース 15 ページまで、会話ログ（Discord / Chat）は転記せず決定・数値・合意だけをトピックページに、**`JOB.md` の visibility が `member` より狭いソース由来の記述は必ず `<acl src="…">` で囲む**、`origin: human` のページは触らず `log` に提案を書く、`## Requests` の依頼は対象ページに反映し、できない依頼は `log` に理由を書く。
- `translate.md`: §3-3 の文面。短い 1 段落。
- プロンプト本文は短く保ち、統合方針の詳細はクローン内の `AGENTS.md`（サーバ版管理）に任せる。プロンプトを変えたら Stage 06 の評価を回す（`CLAUDE.md` に明記）。

### 5. OCI 配備（`infra/oci-runner/`）

| ファイル | 内容 |
|---|---|
| `cloud-init.yaml` | apt（git, curl, ca-certificates, node 22）、`codex` CLI（GitHub Release の `codex-aarch64-unknown-linux-musl`、sha256 を固定）、`gdg` CLI（リリース zip）、ユーザー `runner`、`/etc/gdg/runner.env` のテンプレート、`gdg-runner.service`（`Restart=always`） |
| `README.md` | OCI コンソールでの作成手順（shape、イメージ、SSH 鍵は共有アカウントのグループに）、`codex login` を 1 回手で行う手順（VM にブラウザは無いので、デバイスコード認証か、契約者のローカルで作った `~/.codex/auth.json` を `scp` で置く。**復旧には Pro 契約者本人が要る**ことを明記）、`RUNNER_TOKEN` の配置とローテーション、`journalctl -u gdg-runner` の見方、作り直し手順（10 分で復旧できること） |
| `scripts/smoke.sh` | VM 上で `codex exec "echo ok"`、`gdg wiki runner --once --dry-run` を実行して配備を検証 |

アイドル回収対策: runner の long-poll と日次 `consolidate` で CPU / ネットワークが動く。
それでも回収された場合の復旧は README の作り直し手順。Pay As You Go 化（Always Free 枠は無料のまま）で
回収を避ける選択は共有アカウントの管理者判断とし、README に選択肢として書く。

### 6. バックエンド差し替え

`RUNNER_BACKEND=gemini` で `gemini -p "<prompt>" --yolo`（Gemini CLI、Google アカウントの無料枠）に切り替えられる
インターフェース `Backend { Exec(ctx, dir, prompt, mode) }` を切る。実装は `codex` を主、`gemini` は
**`smoke.sh` が通る範囲**で用意する（品質比較は Stage 06）。

### 7. UI

- `/s/:slug/sources` の「統合」列（Stage 02）に `agent_jobs` の最終状態と `needs_review` 件数。
- `/admin/runner`（新規）: `runner_status`（最終応答、稼働中ジョブ、バックエンド、版）、`queued` / `leased` の件数と最古、直近 50 ジョブの一覧とエラー。runner の最終応答が 10 分より古いと Discord（既存の通知経路 `app/features/notifications/`）に 1 回通知。
- ページ画面: `origin = agent` では「編集」の代わりに「エージェントに依頼」（§3-4）、「英語版を今すぐ更新」（§3-3）。
- `/s/:slug/review` に `human-page-conflict` の差分プレビューと「適用」「破棄」。`acl-untagged` の findings には制限ソース由来の記述がそのまま入るので、**フラグの表示は `canAccessSource` を満たす閲覧者に限り、満たさない人には件数だけ**出す（レビュー画面が黒塗りの抜け道にならない）。「適用」は `persistPage()` を `origin` を変えずに呼ぶ。`acl-untagged` は findings と該当ページへのリンク。

### 制約

- `runner` identity で書けるのは `/sync` と `/api/runner/*` のみ。`architecture` テストで固定する。
- `/sync` は `runner` からの push にも `validatePageAclForSync` を適用する。省略する分岐を作らない。
- `remote_helper.go` の「`pages/**` と `AGENTS.md` 以外の push を拒否する」検査を緩めない。
- `gdg wiki runner` は `apps/cli/internal/wiki/runner/` の 10 ファイル以内。uid 分離・AppArmor・sudoers・hooks・署名検証を **持ち込まない**（持ち込みたくなったら設計に戻る）。
- `codex exec` には `--ask-for-approval never` と `--sandbox`（`synthesize` は `workspace-write`、`consolidate` も同じ）を必ず付ける。`danger-full-access` は使わない。
- `synthesize` のクローンには **そのスペースのページとジョブ対象ソースの raw だけ**を入れる。他スペースを同じ作業ディレクトリに置かない。
- `agent-host` の sleep と `gdg wiki ingest` は本ステージでは削除しないが、**本ステージの完了条件に「本番の sleep を無効化する」を含める**（二重統合を避ける）。
- `codex exec` の子プロセスに `RUNNER_TOKEN` / `GDG_*` を渡さない。push と API 呼び出しは runner だけが行う（`runner_test.go` で `Env` を検査）。
- `review_flags.payload` を一覧に出すときは、対象ページ・ソースの ACL と同じ判定（`canAccessSource` / `pageAclClearance`）を通す。レビュー画面に内側 ACL を迂回する表示を作らない。
- `origin = agent` ページの本文・タイトルを書く経路は `runner` identity のみ（§3-4）。`getEffectivePagePermissions` に `origin` 条件を足して実現しない（内側 ACL を触らない規約。ロックは別関数で AND）。
- `translate` の受け口はスパン検査を省かない。「翻訳だから」で `acl_required` を飛ばすと、英語版だけ黒塗りが外れる。

## Files to touch — 変更ファイル

### `apps/wiki/`

- `wrangler.toml`（secret `RUNNER_TOKEN` の記載は `.dev.vars.example`）
- `migrations/00NN_runner.sql`（新規）— `runner_status`
- `app/db/schema/jobs.ts`（`runner_status`）
- `app/features/auth/`（`runner` identity の受理。`getCliIdentity` の分岐）
- `app/features/jobs/`（`lease.server.ts`、`result.server.ts`、`requeue.server.ts`）
- `app/routes/api/runner/{jobs.next,jobs.$id.heartbeat,jobs.$id.result,heartbeat}.ts`（新規）、`app/routes.ts`
- `app/routes/api/cli/sync.ts` — `origin: human` ページの `skipped` + `review_flags`、非 runner 呼び出しへの `canHumanEditPage`
- `app/features/jobs/enqueue.server.ts` — `enqueueTranslate`、`enqueueSynthesize` の `requests` 合流、`workers/app.ts` — cron `0 17 * * *`、`wrangler.toml`（cron 追加、`AUTO_TRANSLATE` 削除、`TRANSLATE_NIGHTLY_CAP`）
- `app/routes/api/runner/pages.$id.ts`（新規、runner 向け全文取得）、`app/routes/api/runner/pages.$id.translation.ts`（新規、スパン検査 → `persistPage()` en のみ）
- `migrations/00NN_space_translate.sql`（新規）— `spaces.translate_enabled`（DEFAULT 1）、`pages.translation_source_hash`
- `app/features/pages/origin-lock.server.ts`（新規）+ `origin-lock.server.test.ts`、`app/routes/wiki/*` のエディタ loader / action、collab DO の接続ゲート、`app/routes/api/pages/*` の本文・タイトル更新 action、`app/features/pages/components/`（「エージェントに依頼」ダイアログ、「英語版を今すぐ更新」）
- `tests/architecture/agent-page-lock.test.ts`（新規）
- `app/routes/admin/runner.tsx`（新規）、`app/routes/spaces/review.tsx`（差分プレビュー）
- `workers/app.ts`（cron 分岐: `enqueueConsolidation`、lease 期限切れの再キュー、runner 不在通知）
- `tests/architecture/runner-identity-routes.test.ts`（新規）
- `openapi/openapi.yaml`（`/api/runner/*`）→ `types.generated.ts`
- `ARCHITECTURE.md`、`CLAUDE.md`（bindings / secrets 表、cron 分岐）

### `apps/cli/`

- `internal/wiki/runner/`（新規）— `runner.go`（ループ、スロット、スペース単位の直列化）、`jobs.go`（API クライアント）、`synthesize.go`、`consolidate.go`、`translate.go`（source.md → codex → target.md → POST）、`backend.go`（`Backend` インターフェース）、`backend_codex.go`、`backend_gemini.go`、`prompts/*.md`、`runner_test.go`
- `internal/command/wiki.go` — `runner` サブコマンド、`clone --space`、`verify-acl --read-sources`
- `internal/wiki/client.go` — `/api/runner/*` 用メソッド

### `infra/oci-runner/`（新規）

- `cloud-init.yaml`、`README.md`、`scripts/smoke.sh`、`systemd/gdg-runner.service`

## Verification — 完了条件と検証

### 完了条件

- Discord サーバソースに新しい投稿が入り、`hourly` refresh → `agent_jobs(synthesize)` → OCI の runner → 関連トピックページが更新される、までが人手なしで完走する。
- `organizer` ソースの新規文書を統合したページで、該当記述が `<acl src>` で囲まれており、member セッションでは黒塗りで見える。
- runner を止めると `/admin/runner` に滞留が出て、10 分後に Discord 通知が届く。再起動で滞留が消化される。
- `origin: human` のページに影響する変更が `/s/<slug>/review` に出て、適用するまで本文が変わらない。
- `gdg-jp` の日本語ページを更新すると、翌日の `translate` ジョブで `content_en` だけが更新され、`content_ja` と frontmatter は変わらない。訳文の `<acl src>` スパンが原文と同数ある。変更の無いページには翻訳ジョブが積まれない。
- `origin = agent` のページを人間が開くと「編集」が無く「エージェントに依頼」がある。依頼を送ると次の `synthesize` の `JOB.md` に載り、反映後に通知が来る。エディタ URL を直接開いても保存できない（403）。
- 本番の agent-host `sleep` が無効化され、二重統合が起きない。
- `infra/oci-runner/README.md` の手順どおりに **別のメンバーが** VM を作り直して runner が動く。

### コマンド

```sh
cd apps/cli && go build ./... && go test ./...
pnpm --filter @gdgjp/wiki cf-typegen
pnpm --filter @gdgjp/wiki migrate:local
pnpm --filter @gdgjp/wiki test
# VM 上
sudo bash infra/oci-runner/scripts/smoke.sh
```

### 回帰として固定すべきテスト

- **`runner` identity はエディタ保存・`/api/sources` で 403**（`runner-identity-routes.test.ts`）。
- **`/sync` は `runner` の push にも `acl_required` を返す** — 管理者扱いで省かれていないこと。
- **`verify-acl --read-sources` がジョブの全ソースを `readSourceIds` に含める** — 空で呼ぶとゲートが無効化される（静かに壊れる）。
- **human ページの更新は `/sync` で `skipped` になり `review_flags` に積まれる**。
- **`translate` の受け口は `content_en` のみ更新し、`content_ja` と front matter を変えない**（v1 の部分ロケール更新の回帰）。**訳文でスパンの数か `src` が原文と食い違うと `acl_required` で拒否する**（翻訳で黒塗りが外れる経路）。**`sourceHash` が現在と違えば 409**。
- **`translate_enabled = false` のスペースにはジョブが積まれない。`translation_source_hash` が現在の `content_ja` と一致するページにも積まれない**（変更が無いページを毎晩訳して Pro の枠を使う経路）。
- **`origin = agent` ページへの本文・タイトル更新は、エディタ action・`/api/pages/*`・非 runner の `/sync` のどれからでも 403**（`agent-page-lock.test.ts` + 各 route のテスト）。**`runner` からは通る**。
- **`chapter` スペースの `/sync` も同じ**（スペース種別でロックが変わらない）。
- **lease 期限切れの再キューは 3 回で `failed`**。
- **同スペースの `synthesize` が同時に 2 本 lease されない**（スペース単位の直列化）。
- **`clone --space` が他スペースのページを含まない**（`client_test.go`）。
- **`codex exec` の子プロセス環境に `RUNNER_TOKEN` が無い**（`runner_test.go`）。
- **同スペースの clone 系ジョブ（`synthesize` / `consolidate`）は同時に lease されず、`expectedRevision` 不一致の 409 はジョブ `failed` + 再キューになる**（他ページは push されない。半分だけ反映された状態を作らない）。
- **`acl-untagged` の findings は `canAccessSource` を満たさない閲覧者に本文を出さない**。

### 手動 E2E

1. テストスペースに `website` ソースを登録 → `ready` → `agent_jobs` に `synthesize` → runner のログに `codex exec` → 数分後にページが生える。`/s/<slug>/sources` の「統合」が `succeeded`。
2. `organizer` 専用ソースを登録して refresh。生成ページに `<acl src>` があり、`verify-acl` が通っている（runner ログ）。
3. そのページの英語版を開く。スパン内の記述が member セッションでは英語でも黒塗りされている。
3b. そのページ（`origin: agent`）を member で開く。「編集」が無く「エージェントに依頼」がある。「見出しを 1 つ追加して」と依頼 → 次の統合で反映され、通知が届く。
3. 同ソースの内容を `<acl>` 無しで書くようプロンプトを一時的に壊して再実行。`verify-acl` が exit 1 → 再試行 → `needs_review` になり、push されていない。
4. runner の systemd を停止。`/admin/runner` に「最終応答 N 分前」と滞留。10 分後に Discord 通知。起動して消化。
5. 翌日の `consolidate` 後、`index` ページに新ページが載っている。
