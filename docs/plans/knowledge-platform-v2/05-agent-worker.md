# Stage 05 — Agent Worker: Discord エージェントを Cloudflare に移し、回答を `answer` ジョブで生成する

## Context — 背景とリポジトリ状況

### なぜやるか

v1 の質問応答は `apps/agents`（Vercel、Next.js、Redis、Chat SDK、Gemini API）と
`apps/agent-host`（自宅、xangi、Cursor CLI）の 2 系統ある。前者は `ls/cat/FTS` しか検索手段がなく
API 従量課金、後者は属人的な VM に縛られている。本ステージで **1 つの Cloudflare Worker** `apps/agent`
に統合する。Worker は LLM を呼ばず、**権限解決・検索・黒塗り済み資料の束ね・Discord の往復**だけを担い、
回答生成は Stage 04 の runner に `answer` ジョブとして渡す。

黒塗りの守り方が v1 と変わる。v1 は「エージェントに生データを見せて、hooks と uid 分離で漏れを防ぐ」。
v2 は「**渡す前に質問者の権限で黒塗りする**」。runner に渡る束は `/api/agent/cat`（既存の黒塗り）を
通したものだけで、追加調査の MCP ツールも質問者の権限に縛ったジョブ用トークンで wiki を呼ぶ。

### 依存と対象範囲

- 依存: Stage 01（`spaces` / `space_members` の `discord_guild` principal、`resolveSpaceAccess`）、Stage 03（`/api/agent/knowledge-search`、`audienceKeysFor`）、Stage 04（runner、`agent_jobs`、`runner_status`）。
- 対象ワークスペース: `apps/agent/`（新規）、`apps/wiki/`（ジョブ用トークン、エージェント向け API）、`apps/cli/`（runner の `answer` handler と `gdg wiki mcp`）、`apps/accounts/`（OAuth クライアント `agent` の seed）。
- `apps/agents`（Vercel）は **既に使われていない**（`00-overview.md` §8-1）。並走させず、移植が終わった本ステージ最後の PR でディレクトリごと削除する。Vercel プロジェクトと Redis の停止、`deploy.yml` の Vercel ジョブ削除も本ステージ。

### 事前確認（実装前に必ず）

- 本番の Discord アプリは v1 のもの（`DISCORD_APPLICATION_ID` / `DISCORD_PUBLIC_KEY` / Bot トークン）をそのまま使い、Interactions URL を Worker に向け直す（v1 は止まっているので取り合わない）。開発用には別アプリを 1 つ作ってテストサーバに入れる。署名 PING が通ることを最初に確認する。
- Codex CLI の **MCP サーバ設定**（`~/.codex/config.toml` の `mcp_servers`、または `codex exec -c mcp_servers.…`）で stdio の MCP サーバを起こせること、`--sandbox read-only` でも MCP サーバプロセス自体は wiki へ HTTPS を出せることを VM 上で確認する。**出せなければ MCP 無しの「束だけ」方式（§3-3 の fallback）で進め、報告する。**
- Google Chat 連携は **維持する**（`00-overview.md` §8-2）。v1 の Chat アプリ設定（`GOOGLE_CHAT_AUDIENCE`、サービスアカウント）を引き継ぎ、HTTP エンドポイント URL を Worker に向け直す。Worker から Chat API（`spaces.messages.create`）をサービスアカウントの JWT（WebCrypto で署名）で呼べることを最初に確認する。**呼べなければ Chat は縮退応答のみ（§5）で進め、報告する。**

### 読むべきもの

- `apps/agents/ARCHITECTURE.md` — feature 分割（webhooks / chat / auth / inquiry / wiki / filing / telemetry）。**この分割を Worker にそのまま持ち込む**
- `apps/agents/features/auth/*` — PKCE リンク、トークン暗号化（AES-GCM キーリング）、ローテーション。移植対象
- `apps/agents/features/webhooks/verify.ts` — Discord Ed25519 / Google Chat JWT 検証。移植対象
- `apps/agents/features/filing/*` — 回答の wiki 書き戻し。移植対象
- `apps/agents/features/wiki/tools.ts` — v1 のツール説明文（index を先に読む、パスは結果から verbatim、404 で再試行しない）。**runner の `answer` プロンプト方針として引き継ぐ**
- `docs/agents-setup.md`、`docs/agents-observability.md` — Langfuse 規約（ID のマスキング、score の付け方）
- `docs/plans/knowledge-platform-v2/04-runner-and-synthesis.md` §2〜3 — ジョブ API と runner のスロット
- `packages/gdg-lib/` — relying-party auth と signed-cookie ヘルパ

### 再利用する既存実装（書き直さない）

- `apps/agents/features/{auth,webhooks,filing,telemetry}` のロジック（Node API 依存を Web 標準に置き換えて移植。Redis は D1 / KV に）
- `apps/wiki/app/routes/api/agent/{ls,cat,knowledge-search}` — 既存 / Stage 03 の読み取り API。**`cat` の黒塗り（`redactPageMarkdown`）が束の入口**
- `apps/wiki/app/features/jobs/`（Stage 02 / 04）— `answer` ジョブも同じ関数で積む
- `apps/cli/internal/wiki/runner/`（Stage 04）— `answer` handler を **種別として追加**する
- `apps/accounts/` の既存 OAuth クライアント seed（`/admin/seed-clients`）— `agent` クライアントを 1 行足すだけ

## Design — 設計

### 1. Worker の構成（`apps/agent/`）

React Router は使わない（UI は `/`（説明ページ）と `/auth/callback` だけ）。素の Worker + 小さなルータで、`src/features/<domain>/` に v1 の分割を保つ。**LLM の API キーも AI binding も持たない。**

| binding | 用途 |
|---|---|
| `DB`（D1） | `account_links`（暗号化トークン）、`guild_spaces`（§2）、`replay_nonces`、`asked_questions`（書き戻し冪等）、`pending_answers`（§3） |
| `KV` | PKCE state（TTL 10 分）、Discord の deferred 応答トークン（TTL 15 分） |
| `WIKI`（service binding → `gdgjp-wiki`） | `/api/agent/*`、`/api/agent/jobs/*` を内部ネットワークで呼ぶ |
| secrets | `DISCORD_PUBLIC_KEY` `DISCORD_BOT_TOKEN` `DISCORD_APPLICATION_ID` `IDP_CLIENT_SECRET` `TOKEN_ENCRYPTION_KEYS` `AGENT_SERVICE_TOKEN`（wiki に対する agent Worker の identity）`LANGFUSE_*` `TELEMETRY_ID_SALT` `GOOGLE_CHAT_AUDIENCE` `GOOGLE_CHAT_CREDENTIALS`（サービスアカウント JSON。Chat API への非同期投稿に使う） |

### 2. スペース選択とプリンシパル

```sql
CREATE TABLE "guild_spaces" (
  "guild_id" TEXT NOT NULL, "space_id" TEXT NOT NULL,
  "granted_by_user_id" TEXT NOT NULL,     -- /setup を実行したリンク済みユーザー（owner 以上）
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("guild_id","space_id")
);
```

- `/setup`（サーバ管理者権限が必要、Discord の `member.permissions` で判定）: 実行者をリンク済みユーザーとして wiki に問い合わせ、**実行者が `owner` の `shared` スペース**を選択肢に出す（`personal` / `chapter` は出さない。Stage 01 §2-b）。選ぶと `guild_spaces` に入れ、wiki 側 `space_members` に `discord_guild` principal を `viewer` で追加する（wiki の `POST /api/agent/spaces/:id/members` を新設。`owner` のトークンでのみ成功）。
- `/ask` の権限 = `resolveSpaceAccess(リンク済みユーザー, extraPrincipals=[discord_guild])`。未リンクユーザーは `discord_guild` principal 経由で見えるスペースのみ、内側 ACL は「所属なし」（`member` 以上のソースとスパンは見えない）。**v1 の「最初にリンクした人の資格を全員が借りる」挙動は廃止**。
- 検索対象 = 上記 ∩ `guild_spaces`。DM では `guild_spaces` の絞り込み無し。10 を超える場合は「このサーバで選ばれたスペース」を優先し、超過分は **回答末尾に「対象外にしたスペース」を列挙**する。
- **公開チャンネルでの回答は、質問者ではなくチャンネルの読者全員に見える。** したがってギルドのチャンネルで `/ask` された回答の生成 identity は、質問者がリンク済みでも **`discord_guild` principal のみ（所属なし）** にする。organizer がチャンネルで聞いた質問に organizer 専用スパンの内容が公開で投稿される経路を塞ぐため。リンク済みの質問者には回答の下に「自分の権限で再回答（自分にだけ表示）」ボタンを出し、押されたら質問者の identity で `answer` ジョブを積み直して **ephemeral**（`flags: 64`）で返す。DM では最初から質問者の identity。

### 3. 回答の生成 — `answer` ジョブ

#### 3-1. Worker 側（`src/features/inquiry/`）

1. Interaction 受信 → 署名検証 → 3 秒以内に deferred 応答。
2. `ctx.waitUntil` で: 権限解決（§2）→ `WIKI` の `/api/agent/knowledge-search?space=…&layers=page,acl,raw&q=…`（`rewrite: true`、上位 12 件）→ ヒットしたページを `/api/agent/cat?space=…`（**質問者として呼ぶ**: リンク済みならそのトークン、未リンクなら `AGENT_SERVICE_TOKEN` + ヘッダ `X-Agent-Principal: discord_guild:<id>`。wiki 側はこのヘッダを `extraPrincipals` と「所属なし identity」に写す）で最大 8 ページ読む。
3. 束を作る: `question.md`、`index.md`（対象スペースの index ページ、黒塗り済み）、`hits/<n>-<space>-<slug>.md`（黒塗り済み本文、front matter に引用 URL）、`raw/<n>-<space>-<sourceId>.md`（`layer: raw` のヒットは **検索結果の抜粋 `hit.text` だけ**を入れる。raw 全文を読む API は作らない。`audience` フィルタで質問者が読めるソースの抜粋しか返らない）、`INSTRUCTIONS.md`（回答フォーマット: JSON `{ answer, citations: [{ url, quote }], confidence, unanswered: bool }`、言語は質問に合わせる、引用無しの断定はしない、見つからなければ `unanswered: true`）。
4. wiki の `POST /api/agent/jobs/answer`（新設。`agent_jobs` に `type=answer, priority=10, deadline_at=now+90s` を積み、束を R2 `jobs/<jobId>/` に書き、**ジョブ用トークン**を発行して返す）。ジョブ用トークンは `job_tokens` テーブル（`token_hash, job_id, principal(JSON: user_id | discord_guild), expires_at`）に入り、`/api/agent/{knowledge-search,cat,ls}` でのみ有効、TTL 10 分。
5. `pending_answers`（`interaction_id, job_id, follow-up token`）に記録。15 秒ごとに `GET /api/agent/jobs/:id` を見るのではなく、**wiki 側が結果受領時に agent Worker の `POST /internal/answer-ready` を service binding で叩く**（agent Worker は wiki から見て `AGENT` service binding）。
6. 結果を受けたら Discord に follow-up（本文 + 引用 + 👍/👎 ボタン）。`unanswered: true` なら「見つからなかったスペース」を明示。
7. **縮退応答**: (a) `runner_status.last_seen_at` が 60 秒より古い、または (b) `deadline_at` を過ぎて結果が無い（wiki の cron ではなく、agent Worker が `pending_answers` を 30 秒間隔の Durable Object alarm で見る）なら、ヒット上位 5 件の抜粋と引用 URL だけを並べて follow-up し、「エージェントが応答していないため検索結果のみ」と添える。ジョブは `expired` にする。

#### 3-2. runner 側（`apps/cli/internal/wiki/runner/answer.go`）

1. 束を `<workdir>/answer/<jobId>/` に展開（R2 から `GET /api/runner/jobs/:id/bundle`）。**この作業ディレクトリに入るのは束だけ**。クローンも raw も置かない。
2. MCP サーバ設定を書く: `gdg wiki mcp --token <ジョブ用トークン> --spaces a,b,c`（stdio。ツール `search(query, layers?)` と `read_page(space, slug)`。wiki の `knowledge-search` / `cat` をジョブ用トークンで呼ぶだけの薄い変換）。
3. `codex exec --ask-for-approval never --sandbox read-only -C <dir> -c 'mcp_servers.wiki.command="gdg"' -c 'mcp_servers.wiki.args=[...]' --output-schema answer.schema.json "$(cat prompts/answer.md)"`。タイムアウト 75 秒（`deadline_at` より手前）。
4. 出力 JSON を検証（schema、`citations[].url` が束か MCP の結果に含まれる URL であること。**含まれない URL は落とす**）して `POST result`。

#### 3-3. MCP が使えない場合の fallback

事前確認で MCP が通らない場合は、束のみ（ヒット 12 件を全文で入れる）で `codex exec` を回す。
多段の調査はできないが黒塗りの性質は同じ。この場合もインターフェースは変えず、`answer.go` の分岐だけで済ませる。

### 4. ツールの方針（プロンプト `prompts/answer.md`）

v1 `features/wiki/tools.ts` の方針を引き継ぐ: index を先に読む（束に入っている）、ページのパスは検索結果から verbatim、
存在しないページを推測しない、404 で再試行しない、`raw` のヒットは裏取りに使い引用はページ優先。
`file_note`（回答の wiki 書き戻し）は runner ではなく **Worker 側**で行う: 結果 JSON の `confidence` が高く
`unanswered: false` のとき、v1 `filing` の判断ロジックで `answers/` に `/sync` 相当（`/api/agent/file-note`、
`asked_questions` で冪等）を呼ぶ。

### 5. Google Chat

v1 `webhooks/verify.ts` の JWT 検証（署名と `aud`）を移植。Chat には slash command が無いので `/unlink` 等は
メッセージ文で判定（v1 と同じ）。Chat のスペース ↔ wiki スペースは `chat_spaces` テーブルで `/setup` 相当。
Stage 01 の `space_members` には `chat_space` principal（`principal_id = spaces/<id>`）を使い、`discord_guild` と同じく owner だけが付与できる。

Chat の同期応答期限は 30 秒で、`answer` ジョブの 20〜60 秒は収まらない。Discord の deferred と同じ形にする:
同期応答は「調べています」、`/internal/answer-ready` でサービスアカウントの Chat API（`spaces.messages.create`、`thread.threadKey` に元メッセージのスレッド）に本回答を投稿する。Chat API が使えない環境（事前確認で失敗）では
縮退応答（検索結果 + wiki へのリンク）だけを同期で返す。👍 / 👎 は Chat のカードボタンで受け、Discord と同じ `scores` に送る。
Chat のスペースも複数人が読むので、Discord の公開チャンネルと同じく **`chat_space` principal のみの identity** で回答する。Chat には ephemeral が無いため、「自分の権限で再回答」はボットから質問者への DM に投稿する。

### 6. 観測とフィードバック

- Langfuse: v1 `telemetry/` の規約（`chatUserId` / `spaceId` を `TELEMETRY_ID_SALT` で HMAC、トークンを属性に入れない）をそのまま移植。trace に `space_ids`, `guild_id(hashed)`, `job_id`, `cited_urls`, `degraded: bool`, `latency_ms` を付ける。runner 側の `codex exec` の所要時間は `result` に入れて Worker が trace に書く。
- 👍 / 👎 は Discord のメッセージコンポーネント（ボタン）で受け、`scores` に送る。Stage 06 の評価セットの供給源になる。

### 制約

- **agent Worker は LLM を呼ばない。** `AI` binding、`GEMINI_*`、`OPENAI_*` を `wrangler.toml` / secrets に置かない（`architecture` テストで `wrangler.toml` を検査）。
- 権限判定は wiki 側（`resolveSpaceAccess` + 内側 ACL）に置く。agent Worker は「誰として呼ぶか」だけを決め、**自前でスペースの可否や黒塗りを判断しない**。
- **束に入る本文は必ず `/api/agent/cat` の出力**（黒塗り済み）。D1 や R2 から直接ページを読む経路を agent Worker に作らない。
- ジョブ用トークンは `job_id` に紐づき、`/api/agent/{knowledge-search,cat,ls}` でのみ有効、TTL 10 分、ジョブ終了時に失効。`runner` identity（`RUNNER_TOKEN`）は `answer` ジョブ中の wiki 読み取りに **使わない**（使うと全スペースが読める）。
- `apps/agents` の削除は、移植した 4 feature のテストが Worker 側で通り、本番の Discord と Chat が Worker に向いてから、本ステージ最後の PR で行う。削除前に Redis の `account_links` を D1 に 1 回移行する（移行スクリプトは削除 PR に含め、以後は不要）。
- Redis / Chat SDK は持ち込まない。
- トークンの暗号化キーリング形式（`TOKEN_ENCRYPTION_KEYS`）は v1 と同じにし、リンク済みユーザーの再リンクを不要にする（D1 への移行スクリプトは Redis から読む 1 回限りのもの）。

## Files to touch — 変更ファイル

### `apps/agent/`（新規ワークスペース `@gdgjp/agent`）

- `wrangler.toml`、`package.json`、`tsconfig.json`、`.dev.vars.example`、`README.md`、`ARCHITECTURE.md`、`CLAUDE.md`
- `src/index.ts`（ルータ、`/internal/answer-ready`）、`src/features/webhooks/`、`src/features/chat/`（Discord interaction 型、deferred / follow-up、`/ask` `/setup` `/login` `/unlink`、ボタン）、`src/features/auth/`、`src/features/inquiry/`（権限解決、検索、束、縮退応答）、`src/features/filing/`、`src/features/telemetry/`、`src/durable/pending-answers.ts`
- `migrations/0001_init.sql`
- `scripts/sync-discord-commands.mjs`（v1 から移動）、`scripts/migrate-redis-links.mjs`（1 回限り）
- `tests/architecture/no-llm-bindings.test.ts`

### `apps/wiki/`

- `migrations/00NN_job_tokens.sql`（新規）、`app/db/schema/jobs.ts`
- `app/features/auth/`（ジョブ用トークンと `AGENT_SERVICE_TOKEN` + `X-Agent-Principal` の identity 解決）
- `app/features/jobs/answer.server.ts`（束の R2 書き込み、トークン発行、結果受領時の `AGENT` 通知）
- `app/routes/api/agent/jobs/{answer,$id,$id.bundle}.ts`（新規）、`app/routes/api/agent/spaces/members.ts`（新規、`owner` のみ）、`app/routes/api/agent/file-note.ts`（新規）、`app/routes/api/runner/jobs.$id.bundle.ts`（新規）
- `wrangler.toml`（`AGENT` service binding）→ `cf-typegen`
- `openapi/openapi.yaml` → `types.generated.ts`

### `apps/cli/`

- `internal/wiki/runner/answer.go`（新規）、`internal/wiki/runner/prompts/answer.md`、`answer.schema.json`
- `internal/command/wiki.go` — `mcp` サブコマンド、`internal/wiki/mcp/`（新規、stdio MCP サーバ。`search` / `read_page` の 2 ツール）

### `apps/accounts/`

- 既存 OAuth クライアント `agents` の redirect URI を Worker のホスト（`https://agent.gdgs.jp/auth/callback`）に差し替える seed。新規クライアントは作らない

### リポジトリ直下

- `.github/workflows/deploy.yml`（wrangler deploy のジョブ追加、Vercel `agents` ジョブの削除）、`pnpm-workspace.yaml`、`CLAUDE.md`

### 削除（最後の PR）

- `apps/agents/`

## Verification — 完了条件と検証

### 完了条件

- 開発用 Discord アプリをテストサーバに招待し、`/setup` でスペースを選び、未リンクのメンバーが `/ask` で **そのスペースの内容だけ**から引用付き回答を得る（runner 経由、20〜60 秒）。
- `organizer` 専用スパンの固有語で member が `/ask` しても、回答にも引用にも出ない。organizer なら出る。
- runner を止めて `/ask` → 60 秒以内に縮退応答（検索結果のみ）が返る。
- リンク済みメンバーが `/ask` すると、自分の個人スペースの内容も参照される。
- Langfuse に trace と 👍 / 👎 スコアが入る。
- Google Chat のスペースで質問すると「調べています」の後、同じスレッドに本回答が投稿される。
- 本番の Discord と Chat が Worker に向き、`apps/agents/` がリポジトリから消え、`pnpm ci:full` が通る。Vercel プロジェクトが停止している。

### コマンド

```sh
pnpm --filter @gdgjp/agent typecheck
pnpm --filter @gdgjp/agent test
pnpm --filter @gdgjp/agent exec wrangler dev --remote
pnpm --filter @gdgjp/wiki test
cd apps/cli && go test ./internal/wiki/...
```

### 回帰として固定すべきテスト

- **署名検証に失敗した Interaction は 401 で、ジョブが積まれない**（`webhooks/verify.test.ts`）。
- **束の本文は `/api/agent/cat` の出力と一致する** — `cat` をモックして黒塗りプレースホルダを返すと束にもそれが入る（黒塗りをバイパスする経路が無い）。
- **ジョブ用トークンで `/api/agent/cat` を呼ぶと質問者の黒塗りが適用される**、**別ジョブのトークンでは 401**、**`/sync` には使えない**。
- **未リンクユーザーの `/ask` が `guild_spaces` 以外のスペースを `knowledge-search` に渡さない**。
- **ギルドチャンネルの `/ask` は質問者がリンク済み organizer でも `discord_guild` identity で `cat` を呼ぶ**（公開投稿にスパン本文が出ない）。「自分の権限で再回答」の結果は ephemeral で返る。
- **束の `raw/` には `hit.text` 以外が入らない**（raw 全文を読む経路が無い）。
- **`citations[].url` が束と MCP 結果のどちらにも無い URL は落とされる**（幻覚引用の遮断）。
- **`runner_status` が古いと縮退応答になり、ジョブが `expired` になる**。
- **`wrangler.toml` に `ai` / LLM 系 secrets が無い**（`no-llm-bindings.test.ts`）。
- **`file_note` は同じ `interaction.id` で 2 回呼ばれても 1 回しか書かない**。

### 手動 E2E

1. テストサーバで `/setup` → スペース `e2e-shared` を選ぶ。wiki の `/spaces/e2e-shared/settings` に Discord サーバの principal が現れる。
2. 未リンクのユーザーで `/ask` → 「調べています」→ 引用付き回答。別スペースの固有語で `/ask` → 「見つからない」。
3. `/login` でリンク後、個人スペースの固有語で `/ask` → 見つかる。
4. organizer スパンの固有語で member が `/ask` → 出ない。organizer がチャンネルで同じ `/ask` → 公開回答にも出ない。「自分の権限で再回答」→ 自分にだけ見える回答に出る。
5. runner 停止 → `/ask` → 縮退応答。
6. 👍 を押す。Langfuse に score が付く。
7. Google Chat のテストスペースで質問 → 「調べています」→ スレッドに本回答。カードの 👍 で score が付く。
