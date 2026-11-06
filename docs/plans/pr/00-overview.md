# pr.gdgs.jp — イベントマーケティング支援アシスタント 全体方針

**Status:** 設計確定（2026-11-06 起草、同日 §12 の要判断を回答済み。Stage 00〜08 に分割済み。2026-11-07 に DevFest Kansai 2026 の実運用との照合 [`00a`](00a-devfest-2026-usecase-review.md) を反映）
**Related:** `docs/plans/knowledge-platform-v2/00-overview.md`（OCI runner と「Worker は LLM を呼ばない」原則の出典）、
`docs/roster/index.md`（新規アプリ計画セットの体裁の手本）、`skills/README.md`（gdg-jp/skills。既存の connpass / gdg-* Skill）、
[`00a-devfest-2026-usecase-review.md`](00a-devfest-2026-usecase-review.md)（実運用との照合と採否）

本書は人間向けの地図であり、`plan-creator` の見出し契約の対象外。各ステージファイルは本書の
用語・定数・モデルを前提にする。**各ステージに着手する前に、必ず本書を最初に読むこと。**

## 0. 結論

GDG のイベント集客は「数十種類の小さなタスクを全部やる」ことでしか成功しない（塵も積もれば）。
負荷の正体は 2 つある。

| 負荷 | 中身 | 解き方 |
|---|---|---|
| **量** | 媒体ごとの投稿・画像・短縮リンク・メール・リマインド・集計が、1 イベントで数十〜百件 | オーケストレーション。計画からスケジュールと下書きを生成し、既存アプリに配信させ、結果を 1 画面に集める |
| **センスの属人化** | 「どの文を上に出すか」「改行をどこに入れるか」「サムネに何を載せるか」が 1 人の頭の中にしかない | **Playbook + Agent Skills**。Tips をルール・ガイド・テンプレート・事例に言語化し、タスクごとの Skill が必要な部分を束ね、AI の下書きを機械検査し、人の修正を次のルールに戻す |

pr.gdgs.jp は次の 3 層で作る。

1. **Playbook + Skills（`skills/pr-*`、gdg-jp/skills サブモジュール）** — PR の知見の正本 `pr-playbook` と、タスクごとに
   それを束ねる Skill（`pr-copy` / `pr-x-post` / `pr-connpass-page` / `pr-connpass-mail` / `pr-plan` …）。
   `packages/design-system/design/` のデザインハーネスと同じ構造（契約 + ルール + 検査 + 学習ループ）。
   人が Claude Code / Codex から使う入口と、runner が Codex に渡す束の両方になる。
2. **Worker（`pr.gdgs.jp`）** — キャンペーン（= 1 イベント）の brief、計画、スケジュール、下書き、承認、資産、計測、
   リマインドを持つ。React Router v7 SSR、D1 + R2 + Browser Rendering。**LLM は呼ばない。**
3. **Runner（OCI VM）** — `agent_jobs` を long-poll し、Playbook と brief を束ねて Codex に渡し、構造化 JSON の下書きを
   返す。ナレッジ基盤 v2 の `gdg wiki runner` と同じ形。コストはサブスクリプション定額。

既存アプリを再実装しない。投稿は `sns`、短縮リンクと流入分析は `tinyurl`、画像配信は `img`、connpass 操作は
`connpass` が既に持っている。pr はそれらを「計画どおりの順番と内容で動かす側」に徹する。
ただし `apps/connpass` は connpass の一部機能と Luma の受付にしか対応していないので、Luma / Techplay への掲載と
Findy Conference のフォーム送信は Stage 05 で `apps/connpass` 側に足す。

画像は「AI に描かせる」のではなく、**テンプレートのスロットを AI が埋め、Browser Rendering で描画し、機械検査する**。
今の AI はポン出しで良いデザインを作れない、という前提を設計に織り込む。

何も承認なしに外へ出ない。pr の UI は「承認キュー + カレンダー + ダッシュボード」である。

## 1. 既存資産の棚卸し — pr が再実装しないもの

| タスク（ユーザー提示） | 既にあるもの | pr が足すもの |
|---|---|---|
| X 投稿の予約・公開、当日の写真投稿 | `apps/sns`: `posts`（`scheduled` / `photo_required`）、毎分 cron、X OAuth、Google Photos 取り込み、CLI API、Skill `gdg-sns` | 投稿文と画像の生成、スケジュールからの一括登録、投稿 1 時間前のスタッフ依頼 |
| 短縮リンク、OGP 画像、クリック数、申込数、流入元の割合 | `apps/tinyurl`: `campaigns` → `channels` → `sources` → `links`、Analytics Engine、`og_image_url`、connpass 参加者 CSV 取り込みと「知った場所」→チャネル対応付け、Skill `gdg-tinyurl` | キャンペーン・チャネル・リンクの自動作成、週次の分析ジョブ、広告費との突合 |
| 画像の配信（connpass ページ用、OGP 用） | `apps/img`: アップロード、スラッグ、モバイル版、`ImageUploadService` RPC（tinyurl から呼ぶ前例）、Skill `gdg-img` | テンプレートからの描画結果を自動アップロード |
| connpass のページ作成・公開・画像・アンケート・メール | `apps/connpass`: `create_event` / `update_event` / `publish_event` / `upload_event_image` / `upsert_survey` / `send_event_message` ジョブ（Browser Run）、`stats` / `participants` 読み取り、Skill `gdg-connpass` | HTML ページの生成、属性アンケートの定型、メール文面の生成と送信時刻。Luma / Techplay / Findy は未対応（Stage 05） |
| connpass ページの記法・構成・画像 | Skill `connpass-syntax`（サニタイザが通す 22 の CSS プロパティと許可タグの実測表）、`connpass-decent-description`（構成と GDG 風デザインのガイド + テンプレート HTML）、`connpass-session-list-image` / `connpass-timetable-image`（JSON → HTML → Playwright → PNG の描画器、Google Sans + LINE Seed JP） | ページ全体の生成とプレビュー、Worker 側での描画（Browser Rendering） |
| LLM をコスト定額で回す | `apps/cli/internal/wiki/runner/`（lease / heartbeat / result、Codex・Gemini バックエンド、`ChildEnv`、読み取り専用の `answer` ジョブ）、`infra/oci-runner/` | pr のジョブ種別と束の形式 |
| GDG ブランド | Skill `gdg-design`（ロゴ・色・書体・ステッカー）、`@gdgjp/design-system` | イベントごとの skin（§7）。公式ガイドラインから外れる自由を持たせる |
| 日本語の推敲 | Skill `yomiyasu`（`nanaism/yomiyasu`。AI 生成文の不自然な比喩・曖昧な主述・コピー調を直す。lint / check スクリプト付き） | 文面を作るジョブと Skill の最終工程に組み込む |
| 知見の言語化と機械検査 | `packages/design-system/design/`（rules.json / scenarios / proposals / `design:check` / `design:feedback`） | 同じ構造を PR 向けに作る |
| 告知先とコネクション | Wiki の「イベント告知対象とコネクション保有者」ページ（人別、複数開催回を横断、重複連絡の注意、個人連絡先は非掲載）。**Wiki が正本** | pr は `WIKI` service binding で操作者として読み、「誰が・いつ・どこに・結果」の運用表だけを持つ。pr から Wiki に書かない |

足りないもの（新規）: Instagram への投稿、X Ads / Instagram Ads の指標取得、Luma / Techplay / Findy への掲載、
Discord への告知、スタッフ・登壇者へのリマインド、動画、印刷物。§11 で MVP から外すものを決める。

## 2. 設計原則

1. **Worker は LLM を呼ばない。** 生成はすべて `agent_jobs` → OCI runner → Codex。v2 と同じ理由（従量課金を避ける、
   止まったら見える）。
2. **Runner は束を読んで JSON を返すだけ。** X にも connpass にも触らない。配信は Worker が承認後に行う。
   Codex の 1 回の暴走が投稿にならない。
3. **Playbook が正本、Skill が束ねる。** プロンプトに直書きしない。ジョブ種別 = Skill で、Skill がその仕事に要る
   ルール・ガイド・テンプレート・事例を Playbook から解決する。runner は Skill の本文をプロンプトに、解決した
   Playbook を束に入れる。下書きには使った Playbook のバージョン（サブモジュールのコミット）を記録する。
4. **人が直したら Playbook が学ぶ。** 下書きの版を全部残し、人の修正差分を提案（proposal）に変え、採否を人が決める。
   「同じ指摘を 2 度しない」が目標。ユーザーが会話で教える Tips も同じ入口から入れる。
5. **承認なしに外へ出ない。** 投稿・ページ更新・メール・DM 依頼はすべて `approved` を経る。例外は
   キャンペーン単位で明示的に自動化を許可したスタッフ向けリマインドだけ。
6. **連携は RPC。** 他アプリは service binding の `WorkerEntrypoint` で呼ぶ（tinyurl → img の `ImageUploadService` と同じ）。
   `actor: { user, chapters }` を渡し、相手側の既存の権限関数で判定する。Bearer トークンはユーザーに紐づくので、
   cron から動く pr には向かない。
7. **計測はキャンペーン ID で貫く。** pr のキャンペーン = tinyurl のキャンペーン = connpass のイベント。
   1 対 1 で対応付け、流入チャネルの名前も pr の媒体名から機械的に作る。
8. **観測できないものは動いていないとみなす。** runner の最終応答、未処理ジョブ、承認待ち、配信失敗を
   キャンペーンのダッシュボードに出す。
9. **日本語の文面は yomiyasu を通す。** 文面を返すジョブと Skill は、最終稿の前に `yomiyasu` の推敲とスクリプト検査を
   必ず通す。runner の VM にも `yomiyasu` を置く。
10. **作成 → レビュー → 承認の 3 段。** 下書きは作成者（agent か人）、レビュアー、承認者（= 配信する人）を分ける。
    DevFest 2026 の「作成 → Rv → 公開」をそのまま状態機械にする。レビュー依頼と待ち時間は Discord とダッシュボードに出す。
11. **主催チャプターが所有し、共催チャプターが参加する。** キャンペーンは 1 つの主催チャプターに属し、共催チャプターの
    メンバーも同じキャンペーンを見て動く。配信先（X / Instagram アカウント、connpass グループ）はチャプターごとに持ち、
    **そのチャプターのメンバーが承認したときだけ** RPC で書く。他チャプターの承認者がいなければ依頼アイテムになる。

## 3. アーキテクチャ

```
accounts.gdgs.jp (IdP, chapter claims)
      │
      ▼
pr.gdgs.jp (Worker)  ──────────────────────────────────────────────────────────────┐
  campaigns / briefs / plans / schedule_items / drafts(+versions) / assets         │
  contacts / ad_flights / metric_snapshots / playbook_proposals / agent_jobs       │
  cron(* * * * *): due item dispatch, reminders, lease expiry                       │
  cron(0 * * * *): metrics pull (tinyurl analytics, connpass stats)                 │
  BROWSER: template → PNG / connpass page preview       R2 ASSETS: rendered files  │
  Playbook: ../../skills/pr-playbook を build 時に同梱（Vite import.meta.glob）      │
  ┌─ service bindings ───────────────────────────────────────────────────────────┐ │
  │ SNS.PrService.createScheduledPost / updatePost / attachMedia / listXAccounts │ │
  │ TINYURL.PrService.ensureCampaign / ensureChannel / createLink / analytics    │ │
  │ CONNPASS.PrService.updateEvent / uploadImage / upsertSurvey / sendMessage    │ │
  │ IMG_UPLOAD.upload（既存）                                                      │ │
  └───────────────────────────────────────────────────────────────────────────────┘ │
  /api/runner/* ◀── long-poll ────────────────────────────────────────────────────┼──┐
                                                                                   │  │
Discord webhook（スタッフ向けリマインド）◀── cron ───────────────────────────────┘  │
                                                                                      ▼
[OCI VM]  gdg pr runner（systemd 1 ユニット、1 スロット。gdg wiki runner と同居）
  job dir に束を展開: BRIEF.md / PLAN.json / PLAYBOOK/（Skill が解決した分）/ EXAMPLES/ / METRICS.json
  codex exec --sandbox read-only --output-schema <type>.schema.json（プロンプト = Skill 本文）
  → JSON を /api/runner/jobs/:id/result に返す。push も投稿もしない
```

## 4. ドメインモデル

1 イベント = 1 キャンペーン。すべてチャプターに属し、`apps/accounts/` の chapter claims でゲートする（`apps/roulette/` と同じ）。

| テーブル | 役割 | 主な列 |
|---|---|---|
| `campaigns` | イベントの PR 単位 | `id, chapter_id(主催), parent_campaign_id(プレイベントは子), slug, name, event_at, venue, status(draft/active/closed), connpass_group_slug, connpass_event_id, tinyurl_campaign_id, budget_total_yen, playbook_version, created_by` |
| `campaign_chapters` | 共催チャプター | `campaign_id, chapter_id, role(host/co-host)` |
| `campaign_members` | 役割分担（lead / sub / connpass / writer / designer / video / outreach / photographer） | `campaign_id, user_id, roles(JSON), discord_handle?` |
| `campaign_accounts` | 配信先アカウント（主 + ミラー） | `campaign_id, kind(x/ig/connpass_group/discord), chapter_id, external_id(sns の x_account_id、IG ハンドル、connpass group slug), role(primary/mirror)` |
| `briefs` | 企画の入力。計画ジョブの材料 | `campaign_id, version, meta_themes(JSON), audience_segments(JSON), goals(JSON: 申込目標・**週次の目標曲線**・層別目標), speakers(JSON: name, x_handle, tier, followers), sessions(JSON: title, status(tba/confirmed/public), publishAfter, flags), event.hashtag, event.streamUrls, skin(brandGuideUrl 含む), copy_constraints, novelty_ideas, constraints, notes` |
| `plans` | 計画ジョブの出力。人が編集した版も保持 | `campaign_id, version, strategy_md, channel_mix(JSON), budget_allocation(JSON), schedule_proposal(JSON), connections_to_use(JSON), status(draft/adopted)` |
| `schedule_items` | 配信・作業の 1 件 | `campaign_id, kind, channel, due_at, title, draft_id, assignee_user_id, reviewer_user_id, requires_approval, status(planned/drafting/in_review/needs_approval/approved/scheduled/done/failed/skipped), blocked_by(JSON: セッション確定などの条件), request_status(依頼アイテム: sent/replied/declined), external_ref(JSON), derived_from_item_id, offset_minutes` |
| `drafts` / `draft_versions` | 生成物の本文と履歴 | `kind(copy/x_post/ig_post/x_ad/connpass_page/connpass_mail/dm_request/reminder/asset_spec/flyer_text/listing/report), status(generating/in_review/needs_approval/approved/rejected/superseded), assignee_user_id, reviewer_user_id, content(JSON), playbook_version, job_id, author(agent/human), check_results(JSON)` |
| `assets` | 描画済みファイル | `campaign_id, template_id, slots(JSON), width, height, r2_key, img_id, img_url, checks(JSON), derived_from_asset_id` |
| `contacts` | 告知先の運用表。**正本は Wiki**（`WIKI` binding で取り込む） | `chapter_id, organization(重複連絡の束ね), kind(person/org/community/circle/lab/school/company/media), name, relation, channel, owner_user_id, wiki_path, wiki_person, synced_at, notes, outcomes(JSON)` |
| `ad_flights` | 広告の計画と実績 | `campaign_id, medium(x_ads/ig_ads/print), start_at, end_at, planned_yen, actual_yen, creative_asset_ids(JSON), targeting_notes` |
| `metric_snapshots` | 計測の時系列（外部から引いたもの、CSV 取り込み） | `campaign_id, source(tinyurl/connpass/x_ads_csv/ig_ads_csv), captured_at, payload(JSON)` |
| `playbook_proposals` | 学習ループの提案 | `campaign_id, kind(rule/guide/template/example), summary, evidence(JSON), status(proposed/accepted/rejected), decided_by` |
| `agent_jobs` | runner のキュー | wiki の `agent_jobs` と同じ列。`type ∈ {plan, copy, post, page, asset, analyze, review, retro}` |
| `runner_status` | runner の生存 | wiki と同じ 1 行 |

`schedule_items.kind` の初期集合:
`x_post`, `x_ad_start`, `ig_post`, `ig_ad_start`, `short_video`, `connpass_publish`, `connpass_update`, `connpass_subevent`,
`connpass_mail`, `luma_publish`, `techplay_publish`, `findy_submit`, `bevy_publish`, `line_post`, `discord_post`, `press_release`,
`website_update`, `flyer_text`, `flyer_print`, `flyer_distribute`, `print_item`, `lt_at_event`, `community_ask`, `org_outreach`,
`sponsor_ask`, `interview`, `staff_reminder`, `speaker_request`, `live_post`, `metrics_review`。`channel` は媒体名で tinyurl の
チャネルコードに写す（§8）。`constants.channelCatalog` は**既定値**で、キャンペーンごとに自由なチャネルを足せる（LINE、SmartNews、
PR Times のように毎回増える）。

派生アイテム（`derived_from_item_id`）は Playbook のルールから機械的に作る。例: `x_post` 1 件ごとに
`staff_reminder`（-60 分）、`speaker_id` 付きのセッション紹介 `x_post` には `speaker_request`（-180 分、tier が
`high` なら `requires_approval` かつ提案止まり）。

## 5. Playbook + Skills — センスの言語化

### 5-1. 置き場と構造

Playbook と Skill は **gdg-jp/skills リポジトリ**（モノレポでは `skills/` サブモジュール）に置く。
既存の `connpass-syntax` / `connpass-decent-description` / `gdg-design` / `gdg-sns` と同じ場所で、
`npx skills add gdg-jp/skills` でどのプロジェクトからも使え、Codex にも Claude Code にも同じ形で届く。
pr Worker はビルド時に `../../skills/pr-playbook` を同梱する（CI / deploy は `skills` サブモジュールも初期化する）。

```
skills/
  pr-playbook/            正本。Skill としては「PR の判断基準を引く」役
    SKILL.md
    rules.json            機械検査できる断定。id / strength / scope / requirement / verification / fix
    guides/               媒体別の判断基準（散文）。copy.md, x.md, instagram.md, connpass-page.md,
                          connpass-mail.md, thumbnail.md, schedule.md, budget.md, novelty.md,
                          connections.md, reminders.md, brand.md（公式ガイドラインとの距離の取り方）
    templates/            描画テンプレートとスロット契約（Stage 06 で実体化）
    examples/             良い事例と結果。DevFest Kansai 2026 の connpass ページ（`~/proj/connpass` から）、
                          Innovative Crosstalk 2026 / Build with AI Kansai 2026 の「公式っぽくないが集客できた」事例
    proposals/            採否待ちの教訓。D1 の playbook_proposals の輸出先
    decisions.md          却下した案と理由
    scripts/checks/       依存ゼロの ESM。JSON in / JSON out。Worker も同じ実装を import する
  pr-copy/                タイトル・メインコピー（メタテーマの射影）
  pr-x-post/              X 投稿文（折りたたみ位置、画像 vs OGP、投稿時刻、スタッフ依頼）
  pr-connpass-page/       connpass ページ（connpass-decent-description + connpass-syntax を束ねる）
  pr-connpass-mail/       connpass メール
  pr-plan/                戦略・チャネル配分・予算配分・スケジュール・派生リマインド
  （Stage 06 以降）pr-asset / pr-analyze / pr-retro
```

Skill の本文がそのまま runner のプロンプトになる。Skill は「読むべき Playbook の節」「返す JSON のスキーマ」
「最後に yomiyasu を通す」を書く。

### 5-2. ルールの例（ユーザー提示の Tips を書き直したもの）

| id | 要件 | 検査 |
|---|---|---|
| `X-NO-HASHTAG` | X の**告知投稿**（`purpose ≠ live`）にハッシュタグを入れない | 機械（正規表現） |
| `LIVE-EVENT-HASHTAG` | 当日実況の投稿にはイベントのハッシュタグ（`brief.event.hashtag`）を付ける | 機械 |
| `ANNOUNCE-AFTER-CONFIRMED` | セッション紹介の投稿・ページ掲載は `sessions[].status` が `confirmed` 以上になってから。TBA の多い段階で本告知しない | 機械（`blocked_by`） |
| `X-FOLLOW-INTENT-LINK` | X へのフォロー誘導はインテント付きリンク（フォロー確認が自動で出る）で行う | 機械（URL 形式） |
| `ADS-FLIGHT-TIMING` | X Ads は 10〜14 日前から、最初の 3 日はインプレッション最適化。Meta Ads は 10 日前から | 機械（`ad_flights`） |
| `DISCORD-MILESTONES` | Discord と connpass メールは節目だけ（1.5 か月前 / 3 週間前 / 1 週間前） | 機械（派生） |
| `X-FOLD-LINK-VISIBLE` | 140 字超の投稿は、折りたたみ前に表示される範囲にリンクが収まり、折りたたみ後の冒頭にクリックを後押しする文を置く | 機械（折りたたみ位置のシミュレーション。しきい値は Playbook の定数 `x.foldThreshold`。**初期値は仮置き、ユーザーの観察値で更新**） |
| `X-IMAGE-VS-OGP` | 引用が多くなる投稿（登壇者が引用する投稿など）は画像を添付し、リポストが多くなる投稿は OGP 付き短縮リンクにする | 機械（投稿の `expected_reaction` 属性と添付種別の整合） |
| `X-POST-TIME` | 平日は夕方、休日は昼か夕方に投稿する | 機械（時刻窓。窓は Playbook の定数） |
| `MAIL-SEND-TIME` | connpass メールは起床前の朝か退勤前の夕方に送る | 機械（時刻窓） |
| `MAIL-SHORT` | メールは要件を端的に。本文の行数上限と、見出し・フッターの装飾の必須 | 機械（行数） + review |
| `CP-TITLE-CONVEYS-CONTENT` | connpass タイトルは一覧で内容が分かる表現。GDG 公式名（Build with AI, DevFest, I/O Extended）だけで終わらない | 機械（公式名のみのタイトルを弾く） + review |
| `CP-THUMB-HAS-FACTS` | サムネイルにサブコピー・日時・場所を入れる | 機械（スロット必須） |
| `CP-SUMMARY-3-LINES` | 説明文の冒頭の概要は 3 行まで。残りは装飾済みセクションと画像で伝える | 機械（行数） |
| `COPY-FROM-META-THEME` | タイトル・メインコピーは brief のメタテーマの射影であること。生成物にメタテーマとの対応を書かせる | 機械（対応の記載） + review |
| `OGP-ON-SHORTLINK` | OGP 画像は url.gdgs.jp の短縮リンク側に設定する | 機械（リンク作成時に `og_image_url` 必須） |
| `SPEAKER-TIER-HIGH-NO-ASK` | tier が `high` の登壇者には引用依頼を自動で出さない。提案として人に見せるだけ | 機械（派生アイテムの生成規則） |
| `REMIND-STAFF-BEFORE-POST` | 投稿の 60 分前にスタッフへ「いいね・リポスト」を依頼する | 機械（派生） |
| `BUDGET-SPLIT` | SNS 広告以外（印刷等）は 1 万円前後。残りは SNS 広告。X : Instagram = 3 : 7 〜 4 : 6 | 機械（配分の範囲） |
| `JA-YOMIYASU` | 日本語の文面は yomiyasu の check を通す | 機械（`yomiyasu_check.py`） |

`strength` は `MUST` / `SHOULD`、`verification` は `mechanical`（`scripts/checks/`）/ `render`（描画結果の計測）/
`review`（人が見る）。`review` は機械検査が通っても未評価として UI に残る。

### 5-3. ブランドとの距離

`gdg-design` は公式ガイドラインそのものだが、実際の集客に成功したページ（Innovative Crosstalk 2026、Build with AI
Kansai 2026、DevFest Kansai 2026 のブルー背景）は公式から外れている。Playbook はこれを **「イベント skin」** として扱う:
brief にイベントの色・書体・トーンを持ち、`gdg-design` は「skin が未指定のときの既定値」と「ロゴの扱いなど
外れてはいけない最小限」に限定する。`guides/brand.md` に「外れてよいもの / だめなもの」を書く。

### 5-4. 検査器

`skills/pr-playbook/scripts/checks/` の純 ESM モジュール。入力は下書きの JSON と Playbook、出力は
`{ ruleId, status(pass/fail/unevaluated), detail }[]`。人が Skill から使うときは `node scripts/checks/run.mjs`、
Worker は同じモジュールを import する。runner が返した下書きはこれを通ってから `needs_approval` になる。
`MUST` に落ちたら 1 回だけ修正ジョブを積む（wiki の `acl-fix` と同じ形）。2 回目は人に回す。

### 5-5. 学習ループ

1. 人が下書きを編集すると `draft_versions` に `author: human` の版が残る。
2. キャンペーン終了時の `retro` ジョブ（§6）が、人の修正差分と結果指標を読んで提案を作る。
3. 提案は `playbook_proposals` と UI に出る。人が採否を決める。
4. 採用した提案は `skills/pr-playbook/` に書く（MVP では人か Claude Code が行う。`design-improve` と同じ）。
   サブモジュールを進めた pr のデプロイで次のキャンペーンに乗る。

ユーザーが会話で教える Tips も同じ入口（提案 → ルール/ガイド）に入れる。Tips を prompt に直書きしない。
Stage 00 の Playbook は **ユーザーが最初に提示した Tips だけ**に限定し、以降の Tips は Stage 01 以降と並行して足す。

## 6. ジョブ（runner）

| type | Skill | 入力の束 | 出力（`--output-schema`） | 典型の起動 |
|---|---|---|---|---|
| `plan` | `pr-plan` | brief、予算、`contacts`、過去キャンペーンの要約、`guides/{schedule,budget,connections,novelty,reminders}.md` | 戦略、チャネル配分、予算配分、スケジュール案（`schedule_items` の列）、使うコネクション、ノベルティ案、刺さる企画案 | brief 確定時、予算変更時 |
| `copy` | `pr-copy` | brief のメタテーマ、`guides/copy.md`、事例 | タイトル候補 × N、メインコピー × N、各候補のメタテーマとの対応、connpass 向け/X 向けの短縮形 | 計画採用後 |
| `post` | `pr-x-post`（IG は `guides/instagram.md`） | 採用コピー、スケジュール行、登壇者・セッション、`rules.json`、事例 | 媒体別の投稿本文（X は改行位置と折りたたみ前後の分割を明示）、添付方針（画像 / OGP）、画像スロットの文言、依頼文（スタッフ / 登壇者） | スケジュール行ごと、まとめて |
| `page` | `pr-connpass-page` / `pr-connpass-mail` | 採用コピー、セッション・登壇者・会場、`templates/connpass-page/*` のスロット契約、DevFest Kansai 2026 の事例 | connpass の説明 HTML（テンプレートのスロット値 + 3 行概要）、必要画像のスロット一覧、アンケート設問、メール文面 | 計画採用後、内容変更時 |
| `asset` | `pr-asset` | テンプレートのスロット契約、採用コピー、skin、`guides/thumbnail.md` | スロット値（文言、強調、並び）と許容範囲内のレイアウト変数。**ピクセルは返さない** | 画像が要る行ごと |
| `analyze` | `pr-analyze` | `metric_snapshots`、`ad_flights`、計画 | 週次レポート、予算の再配分案、クリエイティブの差し替え案、次週のスケジュール修正案 | 週次 cron、人の要求 |
| `review` | 対象 Skill | 1 件の下書き、Playbook | 指摘と修正案（`review` ルールの事前評価） | 人の要求 |
| `retro` | `pr-retro` | 計画と実績、全下書きの人の修正差分、`contacts` の結果 | 振り返りレポート、`playbook_proposals` 候補、`examples/` 候補、`contacts.outcomes` | キャンペーン終了時 |

- `codex exec --sandbox read-only --output-schema`。束は job dir に展開済みで、ネットワークは pr API（ジョブ用トークン、
  TTL 15 分、読みだけ）に限る。wiki の `answer` ジョブ（`apps/cli/internal/wiki/runner/answer.go`）と同じ守り。
- 出力は JSON schema で縛る。自由文は `*_md` 列に閉じる。
- 文面を返すジョブは、Skill の指示で最後に yomiyasu を通し、runner が `yomiyasu_check.py` を実行して `JA-YOMIYASU` を判定する。
- スロットは wiki と分ける（別 systemd ユニット `gdg-pr-runner`、1 スロット）。Codex Pro の 5 時間窓は共有なので、
  `analyze` / `retro` は深夜帯に寄せる。`post` / `copy` は短い。
- ループ本体（lease / heartbeat / result / `runAgent` / `ChildEnv` / バックエンド）は `apps/cli/internal/wiki/runner/` から
  `apps/cli/internal/agentrunner/` に出して両方から使う（Stage 02）。

## 7. 制作パイプライン — 画像とページ

前提: AI はピクセルを設計しない。人が決めたレイアウトの中で文言と変数を埋める。

```
「顔」= イベントのサムネイル（Figma で人が作る、または hero テンプレート）
   │ 色・書体・コピー・写真を skin として brief に持つ
   ▼
templates/<id>/  = HTML テンプレート + スロット契約（JSON schema: 文言の最大字数、必須、許容レイアウト変数）
   │ asset ジョブがスロット値を返す
   ▼
Worker が HTML を組み立て → BROWSER.quickAction("screenshot", { html, viewport }) で出力サイズに描画 → PNG
   │ render 検査: はみ出し、最小文字サイズ、コントラスト、縮小表示（一覧サムネ相当）での可読性、セーフゾーン
   ▼
R2 ASSETS に保存 → IMG_UPLOAD.upload で img.gdgs.jp へ → URL を下書き・短縮リンクの OGP・connpass 画像に配る
```

書体は `connpass-session-list-image` の描画器と同じ Google Sans + LINE Seed JP を `@font-face` の data URI で埋める
（フォントファイルは R2 に置き、リポジトリにはコミットしない）。

テンプレートの初期集合: connpass サムネイル、OGP（1200×630）、X 投稿画像（16:9 / 1:1）、X 広告、Instagram フィード（4:5）、
Instagram ストーリー（9:16）、セッション紹介カード、登壇者紹介カード。タイムテーブルとセッション一覧は既存 Skill の
描画器を使う。フライヤー（印刷入稿）と動画（Remotion）は MVP 外（§11）。

connpass ページも同じ形。`templates/connpass-page/` に DevFest Kansai 2026 のページ（`~/proj/connpass/connpass.html`）を
分解したセクション（hero、3 行概要、セッション一覧、登壇者、タイムテーブル、会場、FAQ、スポンサー）を置き、`page` ジョブが
スロットを埋め、Worker が `connpass-syntax` の許可リスト（タグ・属性・22 の CSS プロパティ）で HTML 文字列を組み立てる。
プレビューは connpass 風の枠に iframe で出し、承認後に `CONNPASS.PrService.updateEvent({ description })`。

Figma との分担: 「顔」と、テンプレートに収まらない 1 点物は Figma / Illustrator のまま。pr は「顔から派生する
量産物」を担う。Figma からの自動取り込みは後回し。

## 8. 配信・計測・リマインド

### 8-1. 配信

| kind | 経路 | 承認後の動き |
|---|---|---|
| `x_post` | `campaign_accounts` の X アカウントごとに `SNS.PrService.createScheduledPost({ actor, chapterId, xAccountId, text, scheduledAt, condition, media })`。他チャプターのアカウントは、そのチャプターのメンバーが承認したときだけ | sns が予約し、毎分 cron で公開 |
| `live_post` | 時刻駆動の実況（タイムテーブルから機械生成、Stage 06）は `scheduled` で sns に予約。写真付きは `photo_required` で当日の Google Photos 取り込みに乗る | 同上 |
| `connpass_publish` / `connpass_update` / `connpass_mail` | `CONNPASS.PrService.*` → 既存ジョブ（Browser Run） | ジョブ id を `external_ref` に持ち、完了を取り込む |
| `luma_publish`, `techplay_publish`, `findy_submit` | Stage 05 で `apps/connpass` に足す新ジョブ | 同上 |
| `ig_post`, `ig_ad_start`, `x_ad_start` | **MVP では人**。画像・文面・入稿メモを 1 画面に揃え、`done` を人が押す | API 連携は §11 |
| `discord_post`, `staff_reminder` | Discord webhook（チャプター設定） | `staff_reminder` はキャンペーン設定で自動送信を許可できる |
| `speaker_request` | 文面を生成（yomiyasu 済み）。送信は人（X DM / メール）。tier `high` は提案のみ | |
| `community_ask`, `org_outreach`, `sponsor_ask`, 他チャプターへの配信依頼 | **依頼アイテム**: 文面・宛先・担当者・`request_status`（sent / replied / declined）と再連絡リマインド | |
| `flyer_*`, `print_item`, `lt_at_event`, `interview`, `website_update` | チェックリスト（担当者、期限、メモ） | |

### 8-2. 計測

- キャンペーン作成時に `TINYURL.PrService.ensureCampaign` でキャンペーンと媒体別チャネル（`x_organic`, `x_ads`,
  `ig_organic`, `ig_ads`, `flyer`, `discord`, `referral`, `community`, …）を作る。投稿やフライヤーごとに
  `createLink({ channel, source, ogImageUrl })` でリンクを切る。
- connpass の属性アンケート（年齢・職業・経験年数・知った場所）は Playbook の定型を `upsert_survey` で入れ、
  tinyurl の参加者取り込み（既存の「知った場所」→チャネル対応付け）に揃える。
- 毎時 cron で tinyurl の `campaign analytics` と connpass の `stats` を `metric_snapshots` に積む。
- 広告指標は X Ads / Meta 広告マネージャの CSV を UI から取り込む（パーサは媒体別）。API は §11。
- ダッシュボード: 申込の推移と目標線、チャネル別のクリック → 申込 → 参加、層別（年齢・職業）、広告費と CPA、
  予算の消化ペース、承認待ちと配信失敗、runner の状態。

### 8-3. 予算

既定の型（`guides/budget.md`、ユーザー回答より）: **SNS 広告以外（印刷代等）は高々 1 万円前後。総額が増えた分は
すべて SNS 広告に流れる。X : Instagram = 3 : 7 〜 4 : 6。** `plan` はこの型を起点に `budget_allocation`（媒体別、週別）を
出し、`ad_flights` に展開する。実績は CSV 取り込みと人の入力。`analyze` が消化ペースと CPA から再配分を提案し、
人が `ad_flights` を直す。

## 9. コストと運用

| 項目 | 内容 |
|---|---|
| Workers | 有料プラン（Browser Rendering、cron、R2、D1。wiki と同じアカウント） |
| LLM | Codex（個人 Pro）。1 イベントあたり `plan` 1 + `copy` 数回 + `post` 数十 + `page` 数回 + `asset` 数十 + `analyze` 週 1 + `retro` 1。ほとんどが短い |
| VM | `infra/oci-runner/` の VM に `gdg-pr-runner` ユニットを足す。cloud-init は共通。`yomiyasu` を `runner` ユーザーの Skill に入れる |
| 秘密 | `RP_SESSION_SECRET`、`IDP_CLIENT_SECRET`、`RUNNER_TOKEN`（pr 用に別値）。Discord webhook URL はチャプター設定として D1 に暗号化保存（sns の X トークンと同じ方式） |
| 観測 | `/admin/runner`（wiki と同じ）、キャンペーンごとの配信失敗 |

## 10. 段階

依存: `00 → 01 → 02 → {03, 04} → 05（04 の後）、06（02 の後）、07（03 の後）→ 08`。
03・04・06 は並行可。各ステージは 1 回の delegate で完結する大きさにし、`plan-creator` の見出し契約に従う。

| Stage | ファイル | 内容 | 成果の観測 |
|---|---|---|---|
| **00 Playbook v0 + Skills** | `01-playbook-and-skills.md` | `skills/pr-playbook/` と `pr-copy` / `pr-x-post` / `pr-connpass-page` / `pr-connpass-mail` / `pr-plan` を作る。**ユーザー提示済みの Tips だけ**をルール・ガイド・事例に言語化。検査器を依存ゼロの ESM で書く。yomiyasu を組み込む | Claude Code から実イベント 1 件の X 投稿と connpass ページを作って検査を通せる |
| 01 Workspace + campaign | `02-workspace-and-campaigns.md` | `apps/pr/` を `apps/roulette/` から scaffold。`campaigns`（主催 + 共催、子キャンペーン）/ `campaign_members` / `briefs` / `schedule_items`（担当・レビュアー・`blocked_by`）の手動 CRUD、カレンダー、**Wiki からの告知先取り込み**、accounts クライアント、CI / deploy 登録、Playbook の同梱 | 手でスケジュールを組める |
| 02 Runner + drafts | `03-runner-and-drafts.md` | `agent_jobs` / `/api/runner/*`、`agentrunner` 抽出、`gdg pr runner`、`plan` / `copy` / `post` ジョブ、`drafts` と版、**作成 → レビュー → 承認**のキュー、検査器の組み込み、`blocked_by` による告知の抑止 | brief から投稿下書きがレビューキューに並ぶ |
| 03 配信 + 計測の土台 | `04-distribution.md` | `SNS.PrService` / `TINYURL.PrService`、キャンペーン・チャネル・リンクの自動作成、**複数アカウント**への X 投稿の受け渡し（チャプターごとの承認）、派生リマインド、レビュー依頼・ストーリー依頼の Discord 通知、依頼アイテムの状態、短縮リンクの死活監視 | 承認した X 投稿が sns 経由で出る。クリックが tinyurl に乗る |
| 04 connpass | `05-connpass-page.md` | `CONNPASS.PrService`、`page` ジョブ、`templates/connpass-page/`、プレビュー、`updateEvent` / `uploadImage` / `upsertSurvey` / `sendMessage` / `createSubEvent`、複数グループ宛メール、セッションのタグと参加者導線 | connpass ページとアンケートが pr から更新される |
| 05 媒体拡張 | `06-luma-techplay-findy.md` | `apps/connpass` に Luma イベント（有料枠 + Stripe 事前決済を含む）、Techplay（Browser Run）、Findy Conference（フォーム送信）、Bevy を足し、pr から配信 | 3 媒体に pr から掲載できる |
| 06 画像 | `07-assets.md` | テンプレート群（写真背景スロット含む）、`asset` ジョブ、Browser Rendering、render 検査、フォント、R2 → img、OGP、**当日実況の生成**（タイムテーブル → 予約投稿 + セッションカード） | サムネから派生した投稿画像が自動で付く。当日の投稿が予約で流れる |
| 07 計測 + 分析 | `08-metrics-and-analyze.md` | `metric_snapshots` の cron、広告 CSV 取り込み、`ad_flights`（フェーズ付き）、目標曲線と出席率のダッシュボード、予算超過アラート、`analyze` ジョブ（人別の今週のタスク付き） | 週次レポートと再配分案が出る |
| 08 学習 | `09-learning-loop.md` | `draft_versions` 差分、人の KPT の取り込み、`retro` ジョブ、`playbook_proposals` UI、Playbook への書き戻し手順、Wiki の告知先ページへの結果の書き戻し案、`examples/` 蓄積 | 2 件目のキャンペーンで Playbook が変わっている |

## 11. やらないこと（MVP）

- Instagram への API 投稿（プロアカウントも Meta アプリも無い。画像と文面を揃えて人が投稿）
- X Ads API / Meta Marketing API（申請が無い。CSV 取り込み）
- 動画（Remotion）。`asset` ジョブの出力を Remotion の props にする拡張は後回し
- 印刷物の入稿データ（`.ai`）。フライヤーは PNG / PDF の下書きまで
- Figma からの自動取り込み、Figma への書き出し
- 登壇者・参加者への自動 DM
- 細粒度の RBAC（役割は `campaign_chapters.role` と `campaign_members.roles` の最小集合）
- Playbook の採用提案をリポジトリへ自動で書き戻すジョブ（MVP は人か Claude Code）

## 12. 決定事項（2026-11-06）

| # | 項目 | 決定 |
|---|---|---|
| 1 | Playbook の置き場 | **gdg-jp/skills（`skills/pr-playbook`）**。当初案の `apps/pr/playbook/` は、Skills と一体で運用し `npx skills add` で配れるようにするため変更した。pr Worker はサブモジュールから同梱する |
| 2 | Stage 00 の範囲 | ユーザーが最初に提示した Tips のみ。以降の Tips は Stage 01 以降と並行して Playbook に追加する |
| 3 | runner の形 | `gdg pr runner`。別 systemd ユニット、1 スロット。ループ本体を `internal/agentrunner/` に抽出 |
| 4 | 画像の方式 | テンプレート + Browser Rendering + 機械検査。Figma は「顔」と 1 点物。画像生成モデルは使わない |
| 5 | Instagram / 広告 API | 前提が無い。§11 のとおり人手 + CSV |
| 6 | リマインドの送り先 | Discord webhook |
| 7 | 登壇者への依頼 | 文面生成のみ、送信は人、tier は人が付ける。文面生成は `yomiyasu` を通す |
| 8 | 他アプリ連携 | service binding + `WorkerEntrypoint`（`actor` を渡す） |
| 9 | connpass の HTML | `connpass-syntax` の実測表が正本。DevFest Kansai 2026 の実物は `~/proj/connpass/connpass.html`（`examples/` に取り込む） |
| 10 | 媒体の優先順位 | connpass → X → Instagram → フライヤー → Luma / Techplay / Findy |
| 11 | X の折りたたみ位置 | **未回答**。Playbook の定数 `x.foldThreshold` に仮値を置き、観察値が来たら更新する |
| 12 | 予算帯の既定構成 | SNS 広告以外は 1 万円前後、増分は SNS 広告、X : IG = 3 : 7 〜 4 : 6 |
| 追加 | ブランド | `gdg-design` は既定値と最小限の禁則に限定し、イベント skin で外れてよい（§5-3） |
| 追加 | 媒体掲載 | `apps/connpass` に Luma / Techplay / Findy（フォーム送信）を足す（Stage 05） |

### 2026-11-07（実運用照合 `00a` §6 への回答）

| # | 項目 | 決定 |
|---|---|---|
| 13 | レビュー工程 | **入れる。** 作成 → レビュー → 承認の 3 段（§2-10） |
| 14 | 複数チャプター | **複数チャプターで扱う。** 主催 + 共催、配信先はチャプターごとに承認（§2-11）。依頼アイテムは承認者がいないときの逃げ道 |
| 15 | 告知先の正本 | **Wiki を SSoT にする。** pr は `WIKI` binding で読み、運用表だけ持つ |
| 16 | 00a §5 の learnings | 「告知効果の目安」「X Ads の CPA / CPC / CPM / CPV」「当日投稿は『終わりました』でもよい」の 3 件を**除き**、残り 12 件を Tips として採用（Stage 00 の Tips 26〜37）。除いた 3 件は `decisions.md` に却下として記録 |
| 17 | 当日実況の生成 | **Stage 06** に入れる（セッションカードと一緒に作る）。Stage 03 の `live_post` は写真付き投稿だけ |
