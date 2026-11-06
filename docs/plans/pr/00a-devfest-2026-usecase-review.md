# 00a — DevFest Kansai 2026 の実運用と pr 計画の照合

**Status:** レビュー結果（2026-11-07）。同日ユーザーが §6 に回答し、計画本体（`00-overview.md` §12-13〜17、Stage 00〜08）に**反映済み**。
回答: 1 レビュー工程を入れる / 2 複数チャプターで扱う（主催 + 共催、配信先はチャプターごとに承認）/ 3 Wiki を SSoT にする /
4 §5 のうち「告知効果の目安」「X Ads の CPA・CPC・CPM・CPV」「当日投稿は『終わりました』でもよい」以外を Tips に採用（Stage 00 Tips 26〜37）/
5 当日実況の生成は Stage 06。
**出典:** Google Doc「[DevFest 2026] Meeting Minutes」の `Marketing` タブと子タブ全 15 本（Marketing / Marketing MTG /
ファッション集客デザインスプリント / ToDos / 当日実況 / 競合イベント / 広報 過去イベントの learnings / 広報戦略 / Pre-event /
あまのさん / キャッチコピー × 4 / 告知チャネル / フライヤー）を全文、`Contents > Event Goals`、`タイムスケジュール`、`Swag` を全文、
親タブ `Meeting Minutes` は広報に関わる行だけ（最終参加者数、KPTT の SNS 広報、懇親会の Luma 化、告知先）。

## 0. 結論

計画の骨（Playbook + Skills、Worker は LLM を呼ばない、既存アプリを RPC で動かす、画像はテンプレート、承認なしに外へ出ない）は
実運用と矛盾しない。変わるのは**運用の形**で、大きいものから順に 8 つ。

| # | 実運用で見えたこと | 計画の現状 | 変更の方向 |
|---|---|---|---|
| 1 | **チーム運用。** 8 人が役割分担（lead / sub / connpass / 文章 / デザイン / 動画 / ファッション連携 / 企業・大学連携）。成果物は「作成 → Rv → 公開」。Postmortem の Problem は「責任範囲が広すぎ」「タスクを振れなかった」「レビュー体制の高速化」 | 1 人の操作者が runner の下書きを承認する形。`assignee_user_id` は列だけ | 下書きに **担当者とレビュアー**、状態に `in_review` を足す。レビュー依頼とリマインドを Discord に流す。担当者別の「今週の自分のタスク」ビュー |
| 2 | **告知はコンテンツ確定に従属する。** 「TBA だらけでは大物でも申し込まれない」「セッションが決まり次第送信」「タイトル確定分は 8/31 から」「title / abstract 回収 deadline 9/15」。週次の目標曲線（8/18 110 → 10/18 700）を MTG ごとに追う | brief の `sessions[]` に状態が無い。目標は `goals.applications` の 1 つの数 | `sessions[].status`（tba / confirmed / public）と `publishAfter`、`goals.curve[]`（週次マイルストーン）を brief に足す。`plan` は「告知開始条件」を出し、`post` はスケジュール行の `blocked_by` で止める。ダッシュボードは曲線との差を出す |
| 3 | **当日実況はタイムテーブル駆動の 45 本の予約投稿**（時刻・トラック・題・登壇者・配信 URL・`#DevFestKansai`）。写真待ちは実況にならない。1 人で全投稿して破綻 | `live_post` は `photo_required` 前提。`X-NO-HASHTAG` は MUST で全 X 投稿に適用 | `live_post` を「タイムテーブルから機械生成する予約投稿」と「写真付き投稿」の 2 種に分ける。`X-NO-HASHTAG` の scope から `purpose = live` を外し、`LIVE-EVENT-HASHTAG`（SHOULD）を足す。`sessions[].flags`（録画 NG / 英語 / 現地のみ / PC 持参）を投稿に写す |
| 4 | **チャネルは固定の一覧に収まらない。** LINE 公式、Bevy（GDG 公式）、TikTok、PR Times、SmartNews / LY 広告、DevFest Tokyo のページ、公式サイト、他イベントの connpass メール、スポンサー（Findy）の告知枠 | `constants.channelCatalog` の固定 enum | 一覧は**既定値**にし、キャンペーンごとに自由なチャネルを足せる（tinyurl のチャネルは名前から作られるので影響なし）。`schedule_items.kind` に `bevy_publish` / `line_post` / `website_update` / `press_release` / `short_video` を足す |
| 5 | **複数チャプター・複数アカウントで配信する。** 主催 Greater Kwansai + oC Osaka / Kobe / Kyoto + GDG Osaka / Kyoto / Nara の connpass メール、X は @gdgkwansai と @gdsc_osaka、IG は @grkwansai と @gdgoc.osaka、スタッフが各自のストーリーに上げる | `campaigns.x_account_id` は 1 つ。「チャプターをまたぐキャンペーンは作らない」 | 配信先を**複数**にする（主アカウント + ミラー）。他チャプターの口は「依頼アイテム（人が送る）」として扱い、RPC で他チャプターに直接書かない。スタッフへの「ストーリーに上げて」依頼は `staff_reminder` の型に足す |
| 6 | **集客装置としての企画。** プレイベント Meetup #1〜#4（Bevy + connpass）、学生座談会・生き残る座談会（connpass サブイベント、抽選枠・優先当選）、学生デモ（Google Form → Discord）、懇親会（Luma + Stripe 事前決済、connpass から誘導）、ハンズオンのサブイベント | `pre_event` が無い。サブイベント作成が無い。Luma は Stage 05 | `campaigns.parent_campaign_id`（プレイベントは子キャンペーン）、`connpass_subevent` kind と `CONNPASS.createSubEvent`（既存ジョブ `create_sub_event`）を Stage 04 に、Luma は「有料 + 事前決済」を Stage 05 の要件に |
| 7 | **計測の実数と事故。** 850 申込 / 目標 700、現地 533 / 852（62.6 %）、オンライン 557、広告 44 万（X 18 / IG 25、設定ミスで +6 万）、X Ads CPA ≈ 2,500 円、インプレッション 12.4 万、「connpass > リファラル > X ≫ フライヤー」、「リンクが生きているか見る」「印刷後にリンクを更新できず」 | `ad_flights` に消化ペースの表示だけ | 予算超過の**アラート**（計画比 +N %）、短縮リンク先の**死活監視**、出席率（現地 / 申込）の指標化。数値は Playbook の `examples/` 候補 |
| 8 | **Playbook に入れるべき実証済みの learnings** がある（§5） | Stage 00 は提示済み Tips のみ | そのまま。§5 を `proposals/` の初期セットにして、ユーザーが Tips として採用したものだけ Stage 00 に入れる |

## 1. 変わらないこと（計画が実運用に合っている点）

- **メタテーマ → コピー**: Event Goals の「Cognitive Surrender の回避」→「AI 時代の『考える』を取り戻す。異分野と越境の AI カンファレンス」は Postmortem の Keep。`pr-copy` の形どおり。キャッチコピーは 4 人が候補を出し「多数決より 1〜2 人でエイヤ」で決めている → 候補の生成は AI、決定は人、で合う。
- **connpass ページの作り**: 260804 の指示（KGI = CVR、概要 2〜3 行、キャッチーな画像、箇条書きの概要、こんな方におすすめ 3 行、表のタイムテーブル → 画像、登壇者ブロック、CSS 装飾、img.gdgs.jp）は Stage 04 のテンプレートそのもの。「connpass はエンジニアしか見ないのでエンジニア向けコピー、ファッション向けは他媒体で」は媒体別コピーの根拠。
- **登壇者への依頼**: 「レアな人には負担をかけたくないため身内に近い登壇者を中心に」= tier の設計。「スピーカー本人の X 投稿で集客できる」「過去 GDE 含めてリポスト依頼」も `speaker_request` の範囲。
- **予算配分**: X 18 万 : IG 25 万 ≈ 4 : 6 で `BUDGET-SPLIT` の範囲内。「印刷代は 1 万円前後」も一致（ステッカー 4 万円は Swag であって印刷広報ではない）。
- **url.gdgs.jp の acquisition ビュー**を実際に使っている（`campaigns/1?view=acquisition`）→ Stage 03 / 07 の tinyurl 連携は正しい。
- **デザイン人手不足**（「デザインを一人で抱える」「レビューコスト」「AI 生成画像は比率が崩れ、雰囲気が合わない」）→ Stage 06 のテンプレート方式の根拠が強まった。ただし広告画像は 19F の**写真**を下地にしている → テンプレートに写真背景スロットが要る。
- **Agent Skills で connpass 更新は自動化済み**（9/1 MTG）→ Stage 00 で既存 Skill を束ねる判断は正しい。

## 2. 照合の詳細（観察 → 変更案 → 影響ステージ）

### 2-1. 人とプロセス

| 観察（出典） | 変更案 | Stage |
|---|---|---|
| 役割: marketing lead / sub lead / connpass 担当 / 文章担当 / デザイン / 動画 / ファッション連携 / 企業連携 / 大学連携（08/04 MTG） | `campaign_members`（user, role）。下書き・アイテムに `assignee` と `reviewer`。承認は reviewer か lead | 01, 02 |
| 「作成 → Rv → 公開」が定型（09/16 Action items ほか）。Postmortem「レビュー体制の高速化」「成果物 RV を私にも回すべきだった」 | drafts の状態に `in_review` を足し、`needs_approval` と区別。レビュー依頼を Discord に通知。レビュー待ち時間をダッシュボードに | 02, 03 |
| 「結局 X 投稿はタスク振れなかった」「当日 1 人で全投稿」「X の投稿権限を事前に確かめられず詰んだ」 | 配信前チェック: 当日投稿の担当者が sns の contributor であることをキャンペーン開始時に検証（`SNS.listXAccounts` + contributor 確認）。当日投稿は予約投稿に寄せる（§2-3） | 03 |
| 週次 MTG の型: Updates / 進捗 / タスク整理 / Action items、人別 | `analyze` の週次レポートに「人別の今週のアイテム」「期限切れ」「レビュー待ち」を足し、MTG のアジェンダとして使える形に | 07 |
| KPTT（人別の Keep / Problem / Try / Thanks）を終了後に書いている | `retro` の束に人が書いた KPT を貼り付けられる入力（`RETRO_NOTES.md`）を足す。提案の根拠に人の振り返りも使う | 08 |

### 2-2. 計画・スケジュール

| 観察 | 変更案 | Stage |
|---|---|---|
| 週次の目標曲線（8/11 100 → 10/18 700。MTG ごとに実績 105 など） | `briefs.goals.curve[]: { date, applications }`。ダッシュボードに曲線と実績。`analyze` は曲線との差を最初に見る | 00（schema）, 01, 07 |
| 「セッションが決まり次第告知」「TBA では申し込まれない」「title / abstract 回収 9/15」 | `sessions[].status` と `publishAfter`。`plan` が「告知開始条件」（例: セッション紹介はタイトル確定後）を出し、`schedule_items.blocked_by` で `post` を止める。`copy` も確定済みの材料だけ使う | 00, 02 |
| 「Discord / connpass メールは頻繁に送ると効果が低いので節目だけ」「Discord: 1.5 か月前 / 3 週間前 / 1 週間前」「X Ads は 10〜14 日前から、最初の 3 日はインプレッション最適化」「Meta Ads は 10 日前から」「フライヤー v1 は詳細未定で、v2 はセッション 50 % 決定で」 | 節目の型を Playbook の `guides/schedule.md` に**proposal として**入れる（Tips 外）。`ad_flights` に `phases[]`（objective: impression → click）を足す | 00（proposal）, 07 |
| プレイベント Meetup #1〜#4（Bevy 登録 + connpass、本番への導線を入れる） | `campaigns.parent_campaign_id`。子キャンペーンの connpass ページとメールは同じ仕組みで作る。`bevy_publish` kind（MVP は人、Stage 05 で検討） | 01, 04, 05 |
| 「未申込の人に判断材料として足りないものを聞く（5 人程度）」「興味別の推奨セッション案内（実務者・デザイン系・学生）」 | `audienceSegments` ごとの投稿シリーズを `pr-plan` / `pr-x-post` に。`interview` kind（チェックリスト） | 00, 02 |

### 2-3. 当日実況

| 観察 | 変更案 | Stage |
|---|---|---|
| 45 本の投稿がタイムテーブルから機械的に作られている（時刻・トラック・題・登壇者・一言・配信 URL・`#DevFestKansai`）。`⚠️録画 NG`、`🌐英語`、`📍現地のみ`、`PC をご用意ください` の注記 | `sessions[].flags`（`no_recording` / `english` / `onsite_only` / `bring_pc`）と `streamUrls[track]`。`live_post` 系列を**LLM 無しで**生成する `live-posts-from-timetable.ts`（一言だけ `post` ジョブで埋めてもよい）。配信は sns の予約投稿 | 00, 03 |
| 「写真が上がってから投稿では実況にならない。『〇〇さんのセッションが終わりました』でもよい」 | `live_post` を `scheduled`（開始時刻に自動）と `photo`（写真付き、終了後）に分ける。Stage 03 の `photo_required` は後者だけ | 03 |
| ハッシュタグ `#DevFestKansai` を当日投稿全件に付けている（Instagram 投稿も多数のハッシュタグ） | `X-NO-HASHTAG` の scope を `purpose ≠ live` に限定。`LIVE-EVENT-HASHTAG`（SHOULD、`brief.event.hashtag`）。Instagram はハッシュタグ可を `guides/instagram.md` に（proposal） | 00 |
| 「4 トラック全部は撮れない」「ファッションワークショップは誰も撮らず投稿できず」 | 撮影担当の割り当てを `live_post`（photo）の `assignee` で可視化。未割り当てをダッシュボードに | 03 |

### 2-4. チャネルと配信先

| 観察 | 変更案 | Stage |
|---|---|---|
| connpass メールを 7 グループ（GrKwansai, Osaka, Kyoto, Nara, oC Osaka, oC Kobe, oC Kyoto）から送る | `connpass_mail` の宛先を**複数グループ**に。自チャプターの group は RPC、他チャプターの group は「依頼アイテム」（文面を渡して人が送る）。グループ宛（イベント参加者宛ではない）の送信が connpass アプリに無ければ Stage 04 の事前確認に追加 | 04 |
| X @gdgkwansai + @gdsc_osaka、IG @grkwansai + @gdgoc.osaka、スタッフのストーリー | `campaign_accounts[]`（主 + ミラー）。`x_post` の承認で全アカウントに予約。IG と他チャプターは依頼アイテム | 03 |
| LINE 公式、TikTok、PR Times、SmartNews / LY 広告、DevFest Tokyo ページ、公式サイト更新、スポンサー（Findy）の告知枠・メール | `channelCatalog` を既定値 + 自由追加に。kind に `line_post` / `short_video` / `press_release` / `website_update` / `sponsor_ask` | 00, 01 |
| 大学当局・企業への営業（営業書類、メール送信、「返ってきてない」の追跡、クラスメソッドは不可） | `community_ask` / `org_outreach` を**依頼アイテム**として状態（`sent` / `replied` / `declined`）と期限、再連絡リマインドを持たせる。営業書類の型を `pr-plan` の出力に | 01, 02, 03 |
| 告知先は Wiki の「イベント告知対象とコネクション保有者」が正本。人別、重複連絡の注意、個人連絡先は非掲載 | pr の `contacts` を二重の正本にしない。**Wiki ページから取り込む**（MVP は貼り付け / CSV、後に `WIKI` binding）。`contacts` は「誰が・いつ・どこに・結果」の運用表に徹する。同一団体の重複は `organization` キーで束ね、キャンペーンごとに担当 1 人 | 01, 08 |
| 他イベントでの告知（DevSummit 8/21、DevelopersIO 9/28、フロカン 10/14）、競合イベント（OSC、Kaigi on Rails） | 既存 kind で足りる。競合イベントの日程は `brief.constraints` か `schedule` の注記で | — |
| Swag / リファラル（Redeem code DEVFEST26、グループ来場特典、SNS フォロー＆投稿キャンペーンは未実施、アンケート特典）。Swag の正本は Wiki（カタログ・playbook） | `novelty` の実行は connpass の**バウチャー**（既存ジョブ `create_voucher_recipient`）と結べる。MVP はチェックリスト + `guides/novelty.md` から Wiki の Swag ページへリンク | 00, 04 |

### 2-5. コンテンツ（企画）と媒体ページ

| 観察 | 変更案 | Stage |
|---|---|---|
| 座談会・ハンズオンは connpass **サブイベント**（抽選枠、優先当選、申込者だけにメッセージ）。学生デモは Google Form → Discord 招待 | `connpass_subevent` kind と `CONNPASS.createSubEvent`（既存 `create_sub_event`）。Form / Discord は依頼アイテム | 04 |
| 懇親会は Luma + Stripe 事前決済、社会人 / 学生の枠、connpass から誘導、既存申込者にメール | Stage 05 の Luma 要件に「有料枠 + 事前決済」「枠の種類」「connpass 側の誘導文」を足す | 05 |
| ライブ配信なし → アーカイブ配信。オンライン枠 557 | `sessions[].flags` と `streamUrls` は任意。配信の有無で当日投稿の文面が変わる | 00, 03 |
| connpass にセッションの**タグ**（初心者 OK、ハンズオン）、「参加者への情報」欄、Discord への導線（概要が空白で流入経路が無かった） | テンプレートのセッションブロックにタグのスロット。`participantOnlyInfo` を `page` ジョブの出力に。「参加者への導線（Discord / 配信 / 資料）」セクションを既定で持つ | 04 |
| 公式ブランドガイド（`goo.gle/devfest26-brand-guide`）はイベントごとに別。DevFest の色・枠線を使う指示 | `brief.skin.brandGuideUrl`。`guides/brand.md` の「skin の出所」に「イベント公式ガイド > チャプターの skin > gdg-design」の順を書く | 00 |
| キャッチコピーの制約（「Google」を入れる、「AI」も？）、過去コピー（DevFest Tokyo 2025、BwAI 2026）を参照、フライヤーは別の強い一文（「AI に、使われるな。」） | `brief.copyConstraints[]`（必須語）。`examples/copy/` に過去コピー。`pr-copy` の出力に媒体別（connpass / X / IG / フライヤー）と層別（エンジニア / 非エンジニア）の変種 | 00 |
| フライヤー v1 / v2 の期限は印刷の前提（イラレ、アクセア）で決まる。「テキストデータが無いのが怖い。テキストは 2、3 日で」 | `flyer_text` draft kind（文言と写真の指定だけ。入稿データは人）。期限は印刷リードタイムから逆算する定数（proposal） | 00, 02 |
| 会場装飾（ロールアップ、A1 / A2、名札、フォトブース）もマーケが持った。Postmortem では「広すぎた」 | pr の対象外のまま。`print_item` kind をチェックリストとして置き、担当を可視化するだけ | 01 |

### 2-6. 計測

| 観察 | 変更案 | Stage |
|---|---|---|
| X Ads 設定ミスで +6 万円 | `ad_flights` の実績が計画を +N % 超えたらアラート（Discord）。CSV 取り込み時に判定 | 07 |
| 「リンクが生きているか見る」「パット見でリンクが生きているか分かるランプ」「パンフレット作成後にリンクを更新できず」 | `campaign_links` の宛先を毎時 HEAD で確認し、死んだら Discord。印刷物のリンクは必ず短縮リンク（差し替え可能）にする SHOULD ルール | 03, 07 |
| 現地 533 / 申込 852 = 62.6 %、オンライン 557 | ダッシュボードに出席率（connpass `stats` の出席）と現地 / オンライン枠別の指標 | 07 |
| CPC / CPM / CPV の相場表、X Ads CPA ≈ 2,500 円 | `examples/metrics/` と `guides/budget.md` の proposal。`analyze` の束に過去キャンペーンの実績を入れる | 00（proposal）, 07 |
| 「Instagram 広告を見た高校生がいた」「幅広い年齢に届いた」 | アンケートの年齢分布と広告媒体の突合（Stage 07 の層別ブロックで足りる） | — |

## 3. ステージ別の変更案（まとめ）

| Stage | 追加・変更 |
|---|---|
| 00 Playbook | `brief.schema.json` に `goals.curve[]`、`sessions[].status / publishAfter / flags`、`event.hashtag / streamUrls`、`skin.brandGuideUrl`、`copyConstraints[]`、`accounts[]`。`X-NO-HASHTAG` の scope 限定と `LIVE-EVENT-HASHTAG`。`channelCatalog` を既定値扱いに。`pr-copy` の媒体別・層別変種。`pr-plan` に告知開始条件・営業書類の型・層別シリーズ。§5 の proposals を初期セットに |
| 01 Workspace | `campaign_members`（role）、`assignee` / `reviewer`、`parent_campaign_id`、`contacts` の Wiki 取り込みと `organization` キー、kind の追加（`bevy_publish` / `line_post` / `short_video` / `press_release` / `website_update` / `sponsor_ask` / `connpass_subevent` / `interview` / `print_item`）、`blocked_by` |
| 02 Runner + drafts | drafts の `in_review`、レビュアー、`blocked_by` で `post` を止める、`flyer_text` kind、人別ビュー |
| 03 配信 | `campaign_accounts[]`（複数 X アカウント）、`live_post` の `scheduled` / `photo` 分離とタイムテーブル生成器、レビュー依頼・ストーリー依頼の Discord 通知、投稿権限の事前検証、依頼アイテムの状態管理、リンク死活監視 |
| 04 connpass | `createSubEvent`、複数グループ宛メール（自チャプターは RPC、他は依頼）、セッションのタグ、`participantOnlyInfo`、参加者導線セクション、グループ宛メッセージの事前確認 |
| 05 媒体拡張 | Luma の有料枠 + Stripe、Bevy の扱い（人 / 自動）を事前確認に |
| 06 画像 | 写真背景スロット、ストーリー用 9:16 の優先度を上げる（IG 広告が最も効いた） |
| 07 計測 | 目標曲線、出席率、予算超過アラート、`ad_flights.phases`、週次レポートの人別アイテム |
| 08 学習 | `RETRO_NOTES.md`（人の KPT）、Wiki の learnings ページとの往復 |

## 4. 計画の前提で修正が要るもの

- **「チャプターをまたぐキャンペーンは作らない」（overview §11）** — 主催は 1 チャプターのままでよいが、**配信先と依頼先は複数チャプターに及ぶ**。
  RPC で他チャプターのリソースに書くのではなく「依頼アイテム」で人が動く形にすれば原則は保てる。overview §11 の文言を
  「チャプターをまたぐ**所有**は作らない。配信・依頼は依頼アイテムで扱う」に直す。
- **`live_post` = `photo_required`（Stage 03）** — 実況の大半は時刻駆動の予約投稿。写真投稿は補助。
- **`X-NO-HASHTAG` が全 X 投稿に MUST（Stage 00）** — 当日実況とイベントハッシュタグの運用と矛盾する。scope を限定する。
- **`contacts` を pr の正本にする（Stage 01）** — Wiki に正本（人別の告知対象）が既にある。pr は運用表。

## 5. Playbook への proposals 候補（Tips 外。ユーザーが Tips として認めたものだけ Stage 00 に入れる）

| 候補 | 根拠（出典） |
|---|---|
| 告知効果の目安: connpass > リファラル > X ≫ フライヤー。フライヤーは掲示では読まれず、配布で読まれる | Marketing タブ FYI、learnings |
| connpass 一覧ではタイトルが見える。日本語で視覚的な長さを稼ぐ | learnings（Tips 5 の補強） |
| X Ads の CPA ≈ 2,500 円。CPC 50〜300 円、CPM 300〜1,500 円、CPV 3〜15 円 | learnings、09/16 MTG |
| 広告の設計は「目的（クリック）→ ターゲット（10〜20 代の初心者・学生）→ コピー → デザイン」の順で論理的に | Postmortem Keep |
| X Ads は 10〜14 日前から、最初の 3 日はインプレッション最適化。Meta Ads は 10 日前から。Instagram 広告の効果が最大（高校生にも届く） | 08/18 MTG、Postmortem |
| Discord 告知は 1.5 か月前 / 3 週間前 / 1 週間前。Discord・connpass メールは節目だけ | 08/18 MTG、Marketing タブ |
| セッションが決まるまで本告知は効かない。大物は申込ではなくクリックに効く。TBA だらけなら大物でも申し込まれない | 09/01 MTG |
| 登壇者本人の登壇予告投稿は効く。依頼は身内に近い登壇者中心 | 広報戦略、09/01 |
| プレイベントは告知の布石 + 参加者候補の反応を聞く機会 | Postmortem Keep |
| フライヤーは v1（詳細未定）/ v2（セッション 50 % 確定）の 2 版。印刷はアクセア、イラレ | ToDos、あまのさん |
| Swag は「全員配布 / リファラル / SNS キャンペーン抽選 / 交換コード / アンケート特典」の 5 種に分ける。キーキャップが人気 | 08/25、09/08、Postmortem |
| X へのフォロー誘導はインテント付きリンク（自動でフォロー確認が出る） | Postmortem Keep（⭐️⭐️⭐️） |
| 当日投稿は「セッションが終わりました」でもよい。写真待ちは実況にならない | 親タブ KPTT |
| Instagram 投稿はハッシュタグを多数付ける（X と逆） | honoka のインスタ用文面 |
| 「おひとりさま参戦歓迎」「オフライン限定を長所に」「ターゲットを明記（ファッションも対象）」 | 09/16 MTG |

## 6. 要判断

1. **レビュー工程を入れるか**（§2-1）。入れるなら Stage 02 の状態機械と Stage 03 の通知が増える。入れないなら「承認者 = レビュアー」の 1 段のまま。
2. **複数チャプターの扱い**（§4）。「依頼アイテム」案でよいか。oC チャプターのアカウントが sns に接続されていれば RPC で直接予約する案もある（その場合は sns 側の contributor 判定に乗る）。
3. **`contacts` の正本**（§2-4）。Wiki ページを正本にして pr は運用表、でよいか。
4. **§5 のうち Tips として採用するもの**。採用分は Stage 00 の「元の Tips」に番号を足して入れる。
5. **当日実況の生成**を Stage 03 に入れるか、Stage 06 以降に回すか。実運用の痛みが大きいので Stage 03 を推す。
