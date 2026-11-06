# ナレッジ基盤 v2 — 全体方針（wiki / agents / agents-index / agent-host の作り直し）

**Status:** 提案 / 未着手（2026-11-06 起草、同日改訂: 黒塗り ACL 維持・LLM を OCI 上のエージェントで実行。同日 §8 の 5 項目を決定し各ステージに反映）
**Related:** `docs/plans/00-llm-wiki-overview.md`（v1 の全体方針。本書はこれを置き換える）

## 0. 結論

v1 の 4 アプリ（`apps/wiki` `apps/agents` `apps/agents-index` `apps/agent-host`）が抱える問題は、
個別のバグではなく **責務の置き場所と、止まったときに見えないこと** に集約される。

| 工程 | v1 の置き場所 | 結果 |
|---|---|---|
| raw 取得（Docs / Chat / Discord / Web） | Cloudflare（wiki Worker、cron 01:00 JST） | 動く。資産 |
| 統合（raw → ページ） | **自宅サーバ**の xangi「sleep」（04:00 JST）→ Cursor CLI | 自宅サーバが止まれば wiki は更新されない。キューも状態も無いので止まったことが分からない |
| 質問応答 | Vercel（Next.js + Redis、Gemini 2.5 flash API） | 既に使われていない。検索が `ls/cat/FTS` のみ、API 従量課金 |
| 検索インデックス | Workers AI bge-m3 + Vectorize（UI 用）、e5-small + SQLite（agents-index、自宅） | 2 系統、どちらもハイブリッド検索・リランク無し |
| ACL | `sources.visibility` + `pages.visibility` + `page_access` + `<acl>` スパン黒塗り + Cursor hooks + uid 分離 4 スロット | 黒塗りは価値がある。hooks と uid 分離は「エージェントに生データを見せながら漏らさない」ための構造物で、ここが属人化の根 |

v2 は次の 5 点に絞って作り直す。

1. **スペース（テナント）を外側の ACL 単位として足す。** ソースもページもちょうど 1 つのスペースに属し、見えるスペースだけが見える。**スペースの内側では v1 の `sources.visibility` と `<acl src>` スパン黒塗りをそのまま使う。** 1 ページに複数 visibility の情報を混ぜる運用は続ける。
2. **LLM は API ではなく、共有 Oracle Cloud 上の VM で動くコーディングエージェント（Codex CLI）で回す。** 統合も質問応答も VM 側のジョブとして実行し、Cloudflare 側は LLM を一切呼ばない。コストはサブスクリプションの定額に収める。
3. **止まっても見える構造にする。** ジョブキューと状態は Cloudflare（D1）に置き、VM はそれを引く側に回る。VM が落ちればキューが溜まり、wiki の UI に「未統合 N 件 / runner 最終応答 X 分前」と出る。回答は runner 不在時に抜粋のみの縮退応答へ落ちる。
4. **検索は Cloudflare AI Search に委ねる。** 1 スペース = 1 インスタンス。黒塗りはインスタンス内のメタデータ `audience` でフィルタする。自前の Vectorize / bge-m3 / agents-index は捨てる。
5. **黒塗りの守りは「実行時のゲート」から「渡す前の黒塗り」に変える。** 質問応答のエージェントには、質問者の権限で黒塗り済みの資料だけを渡す。統合のエージェントは信頼された単一プロセスとして全文を読み、書いた結果をサーバの既存検証（`/sync` の `acl_required`、`validate-acl`）で弾く。Cursor hooks、uid 分離、AppArmor、署名付きリリースは要らなくなる。

## 1. 現状診断

### 1-1. wiki の自動更新が機能していない理由

v1 の運用ループは 2 つの環境に跨がる。

```
[Cloudflare]  0 16 * * * (01:00 JST)  enqueueDueSourceRefreshes
              → SOURCE_FETCH_QUEUE → SourceImportDurableObject alarm 連鎖
              → R2 raw/ + source_documents(content_hash)
                                      ここで止まる。「統合待ち」を表すキューも状態も無い
[自宅サーバ]  04:00 JST  xangi sleep → gdg wiki raw pull → cursor-agent が pages/** を編集
              → git push（gdg-wiki remote helper）→ /api/cli/wiki/sync
```

- 統合は **自宅サーバ 1 台 + Cursor サブスクリプション + xangi フォーク** に完全依存する。サーバ停止、`cursor-agent` のバージョン更新、`auth.json` 失効、`sleep-progress.json` の詰まり、ミューテックス待ち、hooks の deny、どれが起きても wiki は静かに止まる。
- 手元のクローン `~/proj/wiki` の最終 ingest は 2026-08-13。それ以降ソースは fetch され続けているがページに反映された証拠が無い。
- wiki の `/sources` に出る `ready` は「fetch 済み」であって「統合済み」ではない。**統合済みかどうかを示す状態が UI にもテーブルにも無い**ので、止まっていても誰も気づけない。
- `enqueueDueSourceRefreshes` は `daily` / `weekly` のみ。Discord のような高頻度ソースも最短 1 日遅れる。

v2 でも LLM を VM で回す以上、VM は止まりうる。違いは **止まったことが見える**（キューが Cloudflare にある）ことと、**誰でも作り直せる**（cloud-init 1 枚、共有 OCI アカウント）ことに置く。

### 1-2. テナント（スペース）が無いことの波及

v1 の権限モデルは「サインイン済み全員」を母集団に、ソースは 5 値の `visibility`、ページは `restricted/unlisted/public` + `page_access`、さらに本文の一部だけを隠す `<acl src>` スパンを持つ。

黒塗りスパン自体は要件である（1 ページに Organizer 限定の数値と Member 向けの説明を同居させたい）。問題はその周辺に積まれたもの:

- ingest エージェントが機密 raw を読んで `<acl>` を付け忘れないための Cursor hooks（Stage 11）
- 共有ワークツリーをエージェントが読める以上、プロセス間で nonce が漏れないための uid 分離 4 スロット
- agents-index が authz ソケット経由で呼び出し元を解決し、スパン単位で結果をフィルタする仕組み

これらは **「権限の異なる複数のエージェントが同じホストで生データを読む」** という前提から生まれた。v2 では質問応答のエージェントに生データを渡さない（渡す前に黒塗りする）ので、hooks も uid 分離も不要になる。スパンの検証はサーバ側（`/sync`、`validate-acl`）に既にあり、それだけで足りる。

スペースは別の問題を解く。「GDG 全体」以外の母集団（特定 Discord サーバのコミュニティ、チャプター単独、個人）を持てないことと、Discord bot が「このサーバで参照してよい範囲」を選べないこと。

### 1-3. Discord ソースがチャンネル単位

`sources.kind = "discord-channel"` で 1 チャンネル = 1 行 = 1 Durable Object。新チャンネルは手で追加しないと入らず、サーバ全体の管理画面も無い（`discord_guild_settings` はリマインダ用途のみ）。

### 1-4. agent-host が属人化している

`apps/agent-host` は Go コンバージャ（`apps/cli/internal/agenthost`、40 ファイル超）、xangi フォークの pin、Cursor CLI の sha256 pin、AppArmor プロファイル、sudoers、systemd 7 ユニット、Ed25519 署名付き 2 段リリース、Lima VM テスト環境から成る。1-2 の前提が消えれば、残る要件は「VM 上でジョブを引いて `codex exec` を回す常駐 1 本」だけになる。

### 1-5. 検索経路が 3 本ある

| 経路 | 埋め込み | 利用者 | ACL フィルタ |
|---|---|---|---|
| `app/features/ai-search/` | Workers AI bge-m3 → Vectorize | wiki `/search` UI | `knowledge-retriever.server.ts` |
| `/api/agent/{ls,cat,search}` | 無し（FTS + ツリー走査） | Vercel エージェント | `workspace.server.ts` |
| `apps/agents-index` | e5-small（ローカル） | agent-host の Cursor | authz ソケット + スパン評価 |

3 本とも ACL フィルタを独自実装し、どれも hybrid 検索・リランク・クエリ書き換えを持たない。

### 1-6. LLM のコスト構造

v1 は統合を「ローカルのサブスクリプション（Cursor）」、質問応答と翻訳を「API（Vertex / Gemini）」で払っていた。質問応答が増えるほど従量課金が伸び、翻訳はページ全文を毎回通すため特に高額になった。v2 は両方をサブスクリプション側（Codex CLI の ChatGPT プラン）に寄せ、Cloudflare 側は AI Search のクエリ課金（月 1,000 クエリ無料、超過 $0.75/1,000）だけにする。

## 2. 設計原則

1. **2 層 ACL。** 外側はスペース（`sources.space_id`、`pages.space_id` NOT NULL。スペースのメンバーでなければ存在すら見えない）。内側は v1 のまま（`sources.visibility`、`<acl src>` スパン、`redactPageMarkdown`、`pages.visibility` + `page_access`）。スパンの判定器は `canAccessSource` 1 本（`acl-spans.server.ts` 冒頭の規約）を守る。
2. **LLM は VM の Codex だけが呼ぶ。** wiki Worker と agent Worker に LLM の API キーを置かない。AI Search のクエリ書き換え・リランクは Cloudflare の製品機能として使う（LLM API ではない）。
3. **キューは Cloudflare、実行は VM。** `agent_jobs`（D1）に `synthesize` / `answer` / `consolidate` / `translate` を積み、VM の runner が long-poll で引く。VM は書き込みを `/sync` と `/api/runner/*` 経由でしか行えない。
4. **渡す前に黒塗りする。** `answer` ジョブに渡る資料は、質問者の権限で `redactPageMarkdown` を通したものだけ。runner に発行するジョブ用トークンも質問者の権限に縛る。
5. **検索は AI Search。** 1 スペース = 1 インスタンス。黒塗り部分は本文から外して `audience` 別の別オブジェクトに分け、問い合わせ時に質問者の audience キーでフィルタする。
6. **観測できないものは動いていないとみなす。** ジョブの状態・統合済み時刻・runner の最終応答・鮮度・評価スコアを wiki UI と Langfuse に出す。

## 3. アーキテクチャ

```
                 accounts.gdgs.jp (IdP, chapter/role claims)
                            │
   ┌────────────────────────┼──────────────────────────────┐
   │  wiki.gdgs.jp (Worker) │                              │  agent.gdgs.jp (Worker)
   │                        ▼                              │
   │  spaces / space_members ──── resolveSpaceAccess ◀─────┼── Discord Interactions (/ask /setup /login)
   │  sources(space_id, visibility) ─▶ SourceImportDO       │
   │     ─▶ R2 spaces/<id>/raw/<src>/…  (metadata audience) │  /ask: 権限解決 → AI Search → 黒塗り済み
   │  source_documents(content_hash) ─▶ agent_jobs(synthesize)   資料を R2 jobs/<id>/ に束ねる
   │  pages(space_id, <acl> spans) ─▶ R2 spaces/<id>/pages/ │     → agent_jobs(answer) → 結果を follow-up
   │     本文（スパン除去）+ acl/<audience>/<slug>.md         │  runner 不在時: 抜粋のみの縮退応答
   │  AI Search namespace KNOWLEDGE（instance per space,    │
   │     filter: layer / audience / source_id / page_type / lang）
   │  /api/runner/*  ◀── long-poll ──────────────────────────┼──────────────┐
   │  /api/cli/wiki/sync（既存。acl_required 検証）◀── git push │              │
   └───────────────────────────────────────────────────────┘              │
                                                                          ▼
                                   [OCI Always Free A1 VM]  gdg wiki runner（systemd 1 ユニット）
                                     synthesize: gdg wiki clone --space → codex exec（workspace-write）
                                                 → gdg wiki verify-acl → git push
                                     answer:     空ディレクトリに黒塗り済み束を展開 → codex exec（read-only）
                                                 + MCP（search / read_page、ジョブ用トークン）→ JSON 回答
```

### 3-1. スペース

| 概念 | 内容 |
|---|---|
| `spaces` | `id, slug, name, kind(personal/chapter/shared), chapter_id, created_by, lang, translate_enabled, created_at`。`chapter` は 1 チャプター 1 つ、メンバーはそのチャプターの `member`（editor）と `organizer`（owner）だけで他の principal を足せない（Stage 01 §2-b） |
| `space_members` | `space_id, principal_type(user / chapter_role / discord_guild / chat_space), principal_id, role(owner / editor / viewer)` |
| 所属 | `sources.space_id`、`pages.space_id`（NOT NULL）。ページツリーはスペース内で閉じる |
| 内側の ACL | スペースの `viewer` 以上であることが前提。その上で `sources.visibility` / `canAccessSource` / `<acl>` スパン / `pages.visibility` + `page_access` が v1 どおり効く |
| 既存データの移行 | **全ソース・全ページを `shared` スペース `gdg-jp` に置く。** `visibility` も `<acl>` もそのまま。`gdg-jp` の `space_members` は全チャプターの `chapter_role = member`。移行で分割やレビューは発生しない |

`discord_guild` principal は「この Discord サーバのメンバーなら閲覧可」を表す。スペース owner が明示的に付与する。これにより未リンクの Discord ユーザーにも、サーバに対して許可されたスペースの範囲で回答できる（v1 の「最初に `/login` した人の資格を全員が借りる」挙動を置き換える）。未リンクユーザーの内側 ACL は「サインイン済み・チャプター所属なし」相当（`member` 以上は見えない。`canAccessSource` の fail-closed がそのまま効く）。

### 3-2. R2 レイアウトと AI Search

```
spaces/<spaceId>/raw/<sourceId>/<path>.md            取得済み raw。metadata.audience = ソースの visibility から
spaces/<spaceId>/pages/<slug>.md                      ページ本文から <acl> スパンを除いたもの。audience = "page"
spaces/<spaceId>/acl/<audienceKey>/<slug>.md          そのページのスパン本文を audience キーごとに集めたもの
```

`audienceKey` は既存の `sourceAudienceKey`（`member` / `organizer` / `chapter-member:<id>` / `chapter-organizer:<id>` / `private:<userId>`）をそのまま使う。

| 項目 | 決定 | 根拠 |
|---|---|---|
| インスタンス粒度 | 1 スペース = 1 インスタンス（`ai_search_namespaces` binding、`env.KNOWLEDGE.create({ id })`） | Cloudflare が推奨する multitenancy。クロスインスタンス検索は最大 10 |
| データソース | 既存 R2 バケット `gdgjp-wiki-storage`、path filter `spaces/<id>/**` | 1 バケットを複数インスタンスに分割できる（2026-01 追加） |
| 同期 | `sync_interval = 900`（最短）+ 書き込み直後に `jobs.create`（30 秒に 1 回まで） | 鮮度目標 ≤ 30 分 |
| カスタムメタデータ（5 枠） | `layer(raw/page/acl)`, `audience`, `source_id`, `page_type`, `lang` | 黒塗りフィルタに `audience` が必須なので `origin` は front matter に落とす |
| 検索フィルタ | `and(layer ∈ 指定, or(audience = "page", audience ∈ 質問者の audience キー集合))` | 質問者に見えないスパン・raw がヒットしない |
| 検索 | `retrieval_type: hybrid`、`reranking.enabled`、`query_rewrite.enabled`（エージェント側のみ） | |
| 課金（2026-12-01 開始） | 月 1,000 セマンティッククエリ無料、超過 $0.75/1,000。取り込み 5M トークン無料、超過 $0.75/M | 現規模では無料枠内 |
| ローカル開発 | AI Search はローカルで動かない。`remote: true` か、テストでは binding をモック | |

### 3-3. ジョブ基盤（自動更新の本体）

```
source_documents の content_hash 変化（persist.ts）
  → agent_jobs INSERT { type: synthesize, space_id, source_id, document_ids }  ※同スペースの queued は合流
  → VM runner が /api/runner/jobs/next を long-poll して lease
      1. gdg wiki clone --space <slug>（ページ全文 + 変更 raw。runner トークン = 全スペースを読める service identity）
      2. codex exec --ask-for-approval never --sandbox workspace-write（AGENTS.md の統合方針、JOB.md に変更一覧）
      3. gdg wiki verify-acl（既存。変更ソースが <acl> でタグ付けされているかをサーバの validate-acl で dry-run）
      4. git push → /api/cli/wiki/sync（既存の acl_required 検証が最終防壁）
      5. POST /api/runner/jobs/<id>/result → integrated_hash / last_integrated_at 更新
  → 日次 consolidate ジョブ（重複候補・リンク切れ・index 再生成）
```

「新しい raw が来たら統合」になるので、鮮度は `refresh_policy`（Discord は `hourly`）と runner の処理能力で決まる。

### 3-4. エージェント Worker と `answer` ジョブ

`apps/agents`（Vercel / Next.js / Redis / Chat SDK）を `apps/agent`（Cloudflare Worker）に置き換える。LLM は呼ばない。

1. `/ask` → 3 秒以内に deferred 応答。
2. 権限解決: `resolveSpaceAccess(リンク済みユーザー, discord_guild principal) ∩ guild_spaces`、内側は質問者の identity（未リンクなら所属なし）。
3. AI Search（`audience` フィルタ付き）で上位ヒットを取り、ヒットしたページを `/api/agent/cat`（既存。質問者の権限で黒塗り）で読む。
4. 束（index ページ、ヒット本文、質問、回答フォーマット指示）を R2 `jobs/<id>/` に書き、`agent_jobs(type=answer)` を積む。同時に **ジョブ用トークン**（質問者の権限に縛った短命トークン、TTL 10 分）を発行する。
5. runner: 空の作業ディレクトリに束を展開し、`codex exec --sandbox read-only` を起動。追加調査は MCP ツール `search` / `read_page`（ジョブ用トークンで wiki を呼ぶ `gdg wiki mcp` プロセス）経由。
6. 結果 JSON `{ answer, citations[] }` を `/api/runner/jobs/<id>/result` に返し、agent Worker が Discord に follow-up。👍/👎 ボタン付き。
7. runner の最終応答が 60 秒より古い、またはジョブが 90 秒以内に終わらない場合は、**AI Search のヒット抜粋と引用 URL だけを並べた縮退応答**を返す（LLM 無し）。

### 3-5. Discord ソースをサーバ単位に

`kind = "discord-guild"`、1 サーバ = 1 ソース行 = 1 DO。設定にカテゴリ / チャンネルの include / exclude を持ち、include されたカテゴリ配下の新チャンネルは次回 tick で自動発見する。チャンネルごとのカーソルは DO ローカル SQLite に置く（既存の `do-store.ts` と同じ）。

### 3-6. VM（必須）

| 項目 | 内容 |
|---|---|
| 置き場所 | 共有 Oracle Cloud アカウントの Always Free `VM.Standard.A1.Flex`。**2026-06-15 以降は 2 OCPU / 12 GB**（4/24 ではない）。アイドル回収（7 日間 CPU・ネットワーク・メモリが低いと停止）があるため、runner の常駐と日次 consolidate で回避する。回収を確実に避けるなら Pay As You Go への切り替え（Always Free 枠は無料のまま）を検討 |
| エージェント | **Codex CLI**（`codex-aarch64-unknown-linux-musl`、`codex exec --ask-for-approval never`）。Antigravity は x86_64 ビルドしか無く、OCI Always Free の x86（1/8 OCPU、1 GB）では動かないので対象外 |
| 認証 | **個人の ChatGPT Pro**（§8-3 で決定）で `codex login` を 1 回手で行い `~/.codex/auth.json` を置く。**事前確認: ChatGPT サインインを無人実行で使ってよいかは OpenAI の規約と現行ドキュメントで確認する**（CI 用途には API キーまたは Business / Enterprise の Codex アクセストークンが案内されている）。不可なら Gemini CLI バックエンドに切り替えて報告する。API キーに戻す選択は従量課金になり、この計画の前提が崩れるので取らない。Pro の 5 時間ローリング上限は契約者本人の対話利用と共有されるため、runner は 2 スロット固定とし、`consolidate` / `translate` は深夜帯（JST 02:00〜06:00）に寄せる |
| 代替バックエンド | runner のバックエンドは `codex` / `gemini`（Gemini CLI、Google アカウントの無料枠）の 2 択で差し替え可能にする。規約・レート制限で Codex が使えない場合の逃げ道 |
| 形 | `gdg wiki runner`（Go、`apps/cli` の既存 `client.go` / `remote_helper.go` / `verify.go` を再利用）を systemd 1 ユニットで常駐。uid 分離・hooks・AppArmor・署名付きリリース・xangi は無し |
| 配備 | `infra/oci-runner/cloud-init.yaml` 1 枚（apt, node, codex, gdg）。OCI コンソールの権限は共有アカウントのグループに付け、誰でも作り直せる |

## 4. 捨てるもの / 残すもの

| 対象 | 判断 | 理由 |
|---|---|---|
| `apps/wiki` ページ・エディタ・collab DO・タスク・通知 | **残す** | 利用者がいる。スペース列を足すだけ |
| `apps/wiki` ソースドライバ（Drive / Chat / Discord / Web、DO alarm、subrequest 予算） | **残す** | 最も手間がかかった資産。出力先 prefix を変えるだけ |
| `apps/wiki` `sources.visibility`・`<acl>` スパン・`redactPageMarkdown`・`/sync` の `acl_required`・`validate-acl`・`pages.visibility` + `page_access` | **残す** | 黒塗りは要件。スペースはその外側に 1 枚足すだけ |
| `apps/wiki` `/api/agent/*`（`ls` / `cat` / `search` / `sources`） | 残す（`?space=` を追加。`search` は AI Search に委譲） | `cat` の黒塗りが `answer` ジョブの資料の入口になる |
| `apps/wiki` `ai-search/`（bge-m3 + Vectorize） | **捨てる** → AI Search | |
| `apps/wiki` `workers/features/ingestion/`（`WikiGenerationAgent` + Workflow + Gemini）と `/ingest` UI | **捨てる** → `synthesize` ジョブ | LLM API を Worker から呼ばない方針。ソース登録 → 統合はジョブが担う（§8-5 で決定） |
| `apps/wiki` 翻訳キュー（JA→EN、Gemini API）と `translation_segments` | **`translate` ジョブに移す**（Stage 04）。1 ページ全文を 1 回で訳す。段落キャッシュ・用語集は作らない | Gemini API の翻訳費が高額だった（§8-4）。品質より安さ（§8-7）。1 日 1 回・変更ページだけなので枚数は小さい |
| `apps/agents`（Vercel） | **捨てる** → `apps/agent` Worker。`auth` `webhooks` `filing` `telemetry` のロジックを移植し、**Stage 05 の最後の PR でディレクトリを削除**（既に使われていないので並走させない、§8-1） | Redis・Vercel・Gemini API を無くす |
| `apps/agents-index` | **捨てる** | AI Search + `audience` フィルタが代替 |
| `apps/agent-host` + `apps/cli/internal/agenthost` + xangi フォーク | **捨てる** → `gdg wiki runner` + cloud-init | 1-4 |
| `gdg wiki clone / raw pull / push / verify-acl` と `validate-acl` | **残す**（runner がそのまま使う） | |
| `gdg wiki ingest`（`INGEST_QUEUE.md` 生成）と Cursor hooks（`hooks.go`、`acl-gate.ts`、`trace.go`） | **捨てる** | キューはサーバの `agent_jobs`、エージェントは Codex で hooks が無い。トレースの代わりにジョブの `source_ids` を `verify-acl` の `readSourceIds` 下限にする |

## 5. ステージと依存

| # | ファイル | 内容 | 依存 |
|---|---|---|---|
| 01 | [01-spaces.md](01-spaces.md) | スペースのデータモデル・メンバーシップ・アクセス解決・UI・既存データの `gdg-jp` 移行 | — |
| 02 | [02-space-scoped-sources.md](02-space-scoped-sources.md) | R2 を `spaces/<id>/` に再配置、`audience` メタデータ、Discord サーバ単位ソース、`agent_jobs` テーブルと `synthesize` 投入 | 01 |
| 03 | [03-ai-search.md](03-ai-search.md) | AI Search namespace、インスタンス作成、スパン分離ミラー、`audience` フィルタ付き検索、`/search` 置換 | 01（02 と並行可） |
| 04 | [04-runner-and-synthesis.md](04-runner-and-synthesis.md) | `/api/runner/*`、`gdg wiki runner`、OCI cloud-init、`synthesize` / `consolidate` / `translate` ジョブの完走 | 02, 03 |
| 05 | [05-agent-worker.md](05-agent-worker.md) | `apps/agent` Worker（Discord + Google Chat、スペース選択、`answer` ジョブ、縮退応答、書き戻し、`apps/agents` の削除） | 03, 04 |
| 06 | [06-eval-harness.md](06-eval-harness.md) | 評価セット・判定器・鮮度計測・Langfuse ダッシュボード | 05 |
| 07 | [07-decommission.md](07-decommission.md) | agents-index / agent-host / Vectorize / ingestion / 翻訳キュー / hooks の撤去（`apps/agents` は Stage 05 で削除済み） | 04, 05, 06 |

`01 → 02 → 04`、`01 → 03 → 04`、`04 → 05 → 06`、`{04, 05, 06} → 07`。02 と 03 は並行できる。

付録 [00a-walkthrough.md](00a-walkthrough.md) は全ステージ完了後の見え方を人間目線と VM 上の Codex 目線で追ったレビュー資料。§C に歩き読みで見つけた問題と各ステージへの反映を置く（delegate しない）。

## 6. 「高精度」の定義

| 指標 | 測り方 | 目標 |
|---|---|---|
| Retrieval hit@5 | 評価セットの正答が含まれるページが検索上位 5 件に入る率 | ≥ 0.85 |
| 回答忠実性 | LLM 判定器（`write-judge-prompt` skill、開発者のローカル Codex で実行）で引用ページに根拠がある回答の率 | ≥ 0.9 |
| 権限外漏れ | `expected_refusal` ケースで権限外の内容・引用が出た件数 | 0 |
| 鮮度 | `source_documents.captured_at` → AI Search で検索可能になるまで | p95 ≤ 30 分 |
| 統合遅延 | `captured_at` → `sources.last_integrated_at` | p95 ≤ 2 時間 |
| 回答遅延 | `/ask` → follow-up | p95 ≤ 90 秒（超過は縮退応答） |
| 無回答率 | 評価セットで「わからない」と答えた率（正答がスペース内にあるもの） | ≤ 0.1 |

評価セットは Langfuse に残っている v1 の `/ask` トレース（質問 + 👍 の付いた回答）から 50 件を初期セットにする（Stage 06）。

## 7. リスク

- **VM が再び単一障害点になる。** 受け入れる。違いは (a) キューが Cloudflare にあり UI に滞留が出る、(b) Discord は縮退応答で沈黙しない、(c) cloud-init 1 枚で共有アカウントの誰でも作り直せる、(d) runner の heartbeat が 10 分途切れたら Discord に通知する。**ただし Codex の認証は個人 Pro の `auth.json` なので、VM を作り直すときの `codex login` は契約者本人しかできない。** 契約者不在時の復旧は Gemini CLI バックエンド（別メンバーの Google アカウント）で凌ぐ、を README の手順に含める。VM に SSH できる人は契約者の ChatGPT アカウントで Codex を使えることも受け入れる（SSH 鍵は共有アカウントのグループに限定）。
- **Codex の無人実行が規約・レート制限に引っかかる。** Stage 04 の事前確認で止める。個人 Pro を使う（§8-3）ため、runner の消費が契約者本人の対話利用と 5 時間ローリング上限を分け合う。runner は 2 スロット固定、重いジョブは深夜帯に寄せ、`/admin/runner` にレート制限で失敗した件数を出す。足りなければ Gemini CLI バックエンドへ。
- **`codex exec` の 1 回あたりの遅さ。** 質問応答で 20〜60 秒かかる。Discord の deferred 応答（15 分）には収まるが、体感は v1 より遅い。縮退応答と「調べています」の中間メッセージで補う。
- **AI Search はローカルで動かない。** ユニットテストは binding をモック、E2E は `remote: true` で本番インスタンスの `e2e-*` スペースに向ける。
- **`audience` メタデータの取り違えは黒塗りの漏れになる。** ミラー書き込みは `persistPage()` 1 箇所に集約し、「スパン本文が `pages/` オブジェクトに残っていない」「`acl/` オブジェクトの `audience` が `buildAclSpanPolicy` と一致する」をテストで固定する（Stage 03）。
- **クロスインスタンス検索は 10 まで。** 11 スペース以上に属するユーザーは `/setup` で選んだスペースに限定する。
- **Codex の統合品質が Cursor Composer と違う。** Stage 06 の評価で測る。AGENTS.md の方針は v1 を引き継ぐ。
- **`discord_guild` principal は「サーバの全員」。** owner の明示的な付与に限定し、`/setup` で表示する。公開チャンネルの回答は質問者の権限ではなくこの principal の権限で生成する（Stage 05 §2）。

## 8. 決定事項（2026-11-06、1〜5 が第 1 ラウンド、6〜10 が同日の第 2 ラウンド）

| # | 論点 | 決定 | 反映先 |
|---|---|---|---|
| 1 | `apps/agents`（Vercel）の扱い | **並走させず完全削除。** 既に使われていない。移植が終わった Stage 05 の最後の PR でディレクトリと `deploy.yml` の Vercel ジョブを消す。Discord / Google Chat のアプリ設定は v1 のものを引き継ぎ、エンドポイント URL を Worker に向け直す | Stage 05、Stage 07 |
| 2 | Google Chat 連携 | **維持。** 同期応答は「調べています」、本回答はサービスアカウントの Chat API で非同期投稿 | Stage 05 §5 |
| 3 | Codex の契約形態 | **個人の ChatGPT Pro。** 5 時間上限を契約者本人と分け合うので runner は 2 スロット固定、重いジョブは深夜帯。無人実行の規約確認は Stage 04 の事前確認のまま。不可なら Gemini CLI バックエンド | §3-6、Stage 04 |
| 4 | 翻訳（JA→EN） | **`translate` ジョブとして続ける。** Gemini API での翻訳費が高額だったので Codex の定額に寄せる。対象は `translate_enabled` のスペース（**既定 true、全スペース**）。1 日 1 回、変更があったページだけ。`TRANSLATION_QUEUE` + Gemini は Stage 07 で撤去 | Stage 04 §3-3、Stage 07 |
| 5 | `/ingest`（対話的生成 UI） | **捨てる。** ソースを登録すれば `synthesize` ジョブが統合する、だけにする | §4、Stage 07 |
| 6 | agent ページの人間編集 | **不可にする。** `origin = agent` の本文・タイトルは `runner` だけが書く。人間はページ上の「エージェントに依頼」で次の `synthesize` に依頼を載せる。アーカイブ・移動・共有は人間ができる | Stage 04 §3-4 |
| 7 | 翻訳の方式 | **1 ジョブ 1 ページ、全文をそのまま渡して英語にするだけ。** 用語集・段落キャッシュ・英語版クローンは作らない。品質より安さ | Stage 04 §3-3、Stage 07 |
| 8 | チャプタースペース | **「個人スペースを作る」の隣に「チャプタースペースを作る」。** organizer が作り、そのチャプターの member が editor、organizer が owner。他の principal は足せない（Discord `/setup` の選択肢にも出ない） | Stage 01 §2-b、Stage 05 |
| 9 | agent ページの非表示 | **ユーザー設定「エージェントが作成したページを隠す」。** ツリー・カタログ・検索から除く。権限ではなく表示設定 | Stage 01 §4、Stage 03 §4 |
| 10 | ウォークスルー §C の要判断 | **C-5（公開チャンネルは guild 権限で生成）、C-9（個人 Pro を共有 VM に置く）とも計画どおり。** | 00a §C |

未決は残っていない。Stage 04 の事前確認（Codex 無人実行の可否）だけが、着手後に設計を変え得る点。
