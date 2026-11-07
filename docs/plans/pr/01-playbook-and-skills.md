# Stage 00 — Playbook v0 と PR Skills（`skills/pr-playbook` + `pr-copy` / `pr-x-post` / `pr-connpass-page` / `pr-connpass-mail` / `pr-plan`）

## Context — 背景とリポジトリ状況

### なぜやるか

pr.gdgs.jp の全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。**
このステージは全体の第 1 段で、**アプリのコードは 1 行も書かない。** やることは「イベント PR の判断基準を、
AI が読んで従える形（ルール・ガイド・事例・検査器）に言語化し、タスクごとの Skill に束ねる」こと。

理由は overview §0 にある。PR の負荷の半分は「センスが 1 人の頭の中にしかない」ことで、
アプリを先に作っても、AI の下書きが使い物にならなければ承認キューにゴミが並ぶだけになる。
先に Playbook を作り、**アプリ無しで Claude Code / Codex から実イベントの X 投稿と connpass ページを作って
検査を通せる**状態にしてから、Stage 01 以降でそれをアプリに載せる。

### 対象範囲

- **`skills/` サブモジュール（gdg-jp/skills リポジトリ）だけを触る。** モノレポ側の変更は、サブモジュールのコミット更新と
  `.agents/skills/pr-* → ../../skills/pr-*` のシンボリックリンクだけ。
- 既存 Skill（`connpass-syntax`, `connpass-decent-description`, `connpass-session-list-image`, `connpass-timetable-image`,
  `gdg-design`, `gdg-sns`, `gdg-tinyurl`, `gdg-img`, `gdg-connpass`）は **参照するだけで変更しない。**
- Playbook の中身は **§「元の Tips」に列挙したものだけ**。それ以外の PR 知識を一般論で足さない（overview §12-2）。
  足したくなった知見は `skills/pr-playbook/proposals/` に proposal として置き、本文には入れない。

### 読むべきもの

- `skills/README.md` — gdg-jp/skills の体裁（`SKILL.md` + `agents/openai.yaml` + `references/` + `scripts/`）
- `skills/connpass-syntax/SKILL.md` と `references/syntax.md` — connpass が通すタグ・属性・**22 の CSS プロパティ**の実測表。
  connpass ページの検査器はこれを正本にする
- `skills/connpass-decent-description/SKILL.md` と `references/design-guidelines.md`、`assets/*.html` — connpass ページの
  構成判断とパネル / 見出し / ステッカーの実装パターン。`pr-connpass-page` はこの Skill を**束ねる**（書き直さない）
- `skills/gdg-design/SKILL.md` と `references/brand-system.md` — パレット（Blue `#4285F4` / Green `#34A853` / Yellow `#F9AB00` /
  Red `#EA4335`、Off White `#F0F0F0`、Black 02 `#1E1E1E`）、書体、ロゴの禁則
- `packages/design-system/design/rules.json`、`design/proposals/README.md`、`harness/core.mjs` の `sourceRuleSchema` —
  **ルール・提案の形式の手本。** 同じ語彙（`id` / `strength` / `scope` / `requirement` / `source` / `verification` / `fix`）を使う
- `/Users/hari/proj/shirokuma/.agents/skills/yomiyasu/SKILL.md`（出典 `nanaism/yomiyasu`、`skills-lock.json` に記録）—
  日本語推敲 Skill。`scripts/yomiyasu_lint.py` / `yomiyasu_check.py` を持つ。文面を返す Skill は最後にこれを通す
- `/Users/hari/proj/connpass/connpass.html` と `connpass.md`、`timetable.json`、`session-list.json` — DevFest Kansai 2026 の
  connpass ページの実物（ユーザーが「現時点での完成系」と呼ぶもの）。`examples/` に取り込む
- `apps/cli/internal/wiki/runner/prompts/answer.schema.json` と `answer.md` — Codex の `--output-schema` に渡す JSON Schema と
  プロンプトの書き方の実例。Skill の出力スキーマはこれと同じ流儀で書く

### 再利用する既存実装（書き直さない）

- `skills/connpass-syntax/references/syntax.md` の許可リスト — 検査器 `connpass-html.mjs` はこの表を**データとして転記**する
  （タグ → 許可属性、22 プロパティ）。独自に広げない
- `skills/connpass-decent-description/assets/conference-template.html` / `meetup-template.html` — connpass ページの
  テンプレートの出発点。Stage 04 で `templates/connpass-page/` に分解する。本ステージでは `examples/` から参照するだけ
- `skills/connpass-session-list-image/scripts/render.mjs` の `@font-face` data URI 埋め込みと検証の流儀 — Stage 06 の
  描画器の手本。本ステージでは触らない
- yomiyasu の `scripts/yomiyasu_check.py` — `JA-YOMIYASU` ルールの検査器はこれを**呼ぶだけ**

### 元の Tips（ユーザー提示。Playbook v0 の全範囲）

以下が Playbook に言語化する**すべて**である。番号は §2 のルール表から参照する。

1. X Premium は 140 字超を投稿できる。改行位置を調整し、「さらに表示（Show more）」の前に表示される文章を最大にし、
   かつ折りたたまれる直前でリンクがぎりぎり見えている状態にし、折りたたみを開くとクリックを後押しする文が見える構成にする。
2. ハッシュタグは X のアルゴリズム上不利なので入れない。
3. OGP 画像は引用ポストでは表示されない。引用が多くなりそうな投稿（登壇者が引用する投稿など）には画像を添付する。
   逆にリポストが引用より多くなる投稿では、クリックできる面積を増やすために OGP 画像（短縮リンク）を使う。
4. OGP 画像は url.gdgs.jp の短縮リンクに対して設定する。
5. connpass では検索・一覧画面ではタイトルだけが見られ、サムネイルはイベント詳細で見られる。タイトルはクリック率を上げるために
   「どんな内容のイベントか」が分かる表現にし、サムネイルは申込率を上げるためにサブコピー・日時・場所を入れる。
6. 最近の人は文章を読まない。connpass の説明文は長い説明を避け、たかだか 3 行の概要文だけ書き、あとは HTML + CSS で装飾した
   コンテンツと見やすい画像で伝える。DevFest Kansai 2026 のページが現時点の完成系。
7. GDG のイベントは TSKaigi 等より知名度が低い。「Build with AI」「DevFest」「I/O Extended」などの公式イベント名だけでは
   情報量が足りないので、タイトルやコピーで補う。
8. タイトル・メインコピーはイベントの**メタテーマ**を定義し、それを射影した分かりやすくキャッチーな文にする。
   例: メタテーマ「Cognitive Surrender の回避」「Tech × Non-tech」→ コピー「AI 時代の考えるを取り戻す。異分野と越境の AI カンファレンス」。
9. X は平日は夕方、休日は昼か夕方に投稿すると伸びやすい。
10. connpass メールは朝の起床前か夕方の退勤前に送ると伸びやすい。
11. connpass メールも長い文章・丁寧すぎる文章を避け、要件を端的に伝え、フッターや見出しに装飾を入れる。
12. X と Instagram は最適なコピー・デザイン・投稿文・投稿タイミングが全く異なる。投稿と広告でも適したデザインは違う。
13. 申込時のアンケートに「年齢・職業・経験年数・イベントを知った場所（X, Instagram, チラシ, 知人から など）」を入れ、
    参加者層を分析して広告戦略の方向性を決める。
14. url.gdgs.jp のクリック数・申込数の推移と割合、X Ads / Instagram Ads の属性データで、広告戦略とクリエイティブをチューニングする。
15. SNS 投稿の 1 時間前などにスタッフへ「いいね・リポストお願いします」とリマインドする。
16. セッション紹介投稿の数時間前に登壇者へ「引用ポストお願いします」と依頼する。ただし格が高すぎる登壇者には依頼しづらい。
17. 広告予算の配分: SNS 広告以外（印刷代等）は高々 1 万円前後で、総額が増えた分は SNS 広告に流れる。X : Instagram = 3 : 7 〜 4 : 6。
    予算はイベントにより 10 万円〜50 万円超まで幅がある。予算額で戦略とクリエイティブの種類数が変わる。
18. 広報手段のアイデア一覧: SNS 投稿、SNS 広告、フライヤー配布・掲示、他の技術イベント / カンファレンスでの LT やフライヤー配布、
    イベント参加でフォローしてもらい紹介、各 GDG チャプターの Discord、大学・研究室・会社へのまとめ紹介、友達、
    コネクションのある技術コミュニティ・サークルへの声かけや LT 登壇依頼、フォロワーの多いスピーカーの招待、
    魅力的なノベルティ（リファラル特典、交換コード特典、SNS フォロー特典）、特定の層に刺さる企画（学生なら成果物展示、
    登壇者と少人数で話せる座談会）。
19. 「魅力的なノベルティ」= 少しでも興味を持った人を申し込みまで後押しするノベルティとデザイン。
20. スケジュール: 何日に何を投稿するか、広告は何日にいくら使うか。
21. 自分たちが活用できるコネクションを洗い出して使う。
22. 当日実況用の投稿準備、当日の写真撮影と投稿（将来のイベントのための投資もスコープ内）。
23. ブランド: `gdg-design` は公式ガイドラインそのものだが、実際には公式に従わないことがある。Innovative Crosstalk 2026 や
    Build with AI Kansai 2026 は gdg-design らしくないが集客に成功した。DevFest Kansai 2026 もグレー背景ではなくブルー背景。
    Playbook は「イベント skin」で外れてよいようにする。
24. 日本語の文面は `yomiyasu` で推敲する（登壇者への依頼文を含む）。
25. 媒体の優先順位: connpass → X → Instagram → フライヤー → Luma / Techplay / Findy。

26. connpass の一覧ではサムネイルよりタイトルが見える。タイトルは日本語で視覚的な長さを稼ぎ、情報を詰める（Tips 5 の補強）。
27. 広告は「目的（クリックしてサイトへ）→ ターゲット（10〜20 代の初心者・学生エンジニア）→ コピー → デザイン（コピーを大きく）」の順で
    論理的に設計する。
28. X Ads は 10〜14 日前から出稿し、最初の 3 日はインプレッション最適化。Meta Ads（Instagram）は 10 日前から。Instagram 広告の効果が
    最も大きく、高校生など幅広い層に届いた。
29. Discord 告知は 1.5 か月前 / 3 週間前 / 1 週間前の節目だけ。Discord と connpass メールは頻繁に送ると効果が落ちる。
30. セッションが決まるまで本告知は効かない。大物スピーカーは申込ではなくクリックに効く。TBA だらけのタイムテーブルでは
    大物でイベントページまで誘導しても申し込まれない。
31. 登壇者本人の登壇予告投稿は集客に効く。依頼は身内に近い登壇者を中心にし、レアな人には負担をかけない。
32. プレイベント（Meetup）は本イベント告知の布石で、参加者候補の反応を聞く機会でもある。本番への導線を入れる。
33. フライヤーは v1（詳細未定で作る）と v2（セッションが 50 % 決まった段階で作る）の 2 版。印刷はアクセア、制作はイラレ。
34. Swag は「全員配布 / リファラル特典 / SNS キャンペーン抽選（当たりは豪華、はずれはステッカー）/ 交換コード / アンケート特典」の
    5 種に分けて設計する。キーキャップは珍しさとエンジニアとの親和性で人気だった。
35. X へのフォロー誘導はインテント付きリンク（開くとフォロー確認が自動で出る）にする。例: `https://gdgs.jp/gdg_kwansai_x`。
36. Instagram の投稿はハッシュタグを多数付ける（X と逆）。
37. 告知文には「おひとりさま参戦歓迎」「オフライン限定を長所に（生でしか聞けない）」「ターゲットを明記（ファッションなど他分野も対象）」を
    入れる。

Tips 26〜37 は 2026-11-07 に DevFest Kansai 2026 の議事録（[`00a`](00a-devfest-2026-usecase-review.md) §5）から採用したもの。
Tips 38〜50 は 2026-11-07 に、Figma「GDG Design Kit」の Greater Kwansai ページ（DevFest Kansai 2026、Innovative Crosstalk 2026、
I/O Extended Osaka 2026）のデザイナーの制作物とユーザーの指示から言語化したデザインの判断基準（`guides/design.md`、`examples/design/`）。
同じ §5 のうち「告知効果の目安（connpass > リファラル > X ≫ フライヤー）」「X Ads の CPA / CPC / CPM / CPV」「当日投稿は
『終わりました』でもよい」の 3 件は**採用しない**（`decisions.md` に却下として書く）。

**X の折りたたみ位置（Tips 1 のしきい値）は未回答。** 定数に仮値を置き `provisional: true` を付け、観察値が来たら更新する。
仮値を根拠ありげに書かない。

## Design — 設計

### 1. `skills/pr-playbook/` の構造

```
skills/pr-playbook/
  SKILL.md                    「PR の判断基準を引く」Skill。どのファイルが何の正本かの表 + 使い方
  agents/openai.yaml          Codex 向け表示名（既存 Skill と同形式）
  rules.json                  §2
  constants.json              §3
  guides/                     §4
  examples/                   §5
  proposals/README.md         提案の形式（design/proposals/README.md を PR 向けに書き直す）。v0 では空
  decisions.md                却下した案。v0 では「ブランド: 公式ガイドライン厳守案を却下（Tips 23）」と、00a §5 のうち採用しなかった
                              3 件（告知効果の目安 / X Ads の CPA・CPC・CPM・CPV / 当日投稿は「終わりました」でもよい。2026-11-07 ユーザー判断）
  references/brief.schema.json   §6。全 Skill と Stage 01 の `briefs` テーブルが共有する入力の形
  references/draft-kinds.md      下書き種別ごとの JSON の形（§7 の各 Skill の出力）
  scripts/checks/             §8。依存ゼロの ESM
  scripts/validate.mjs        §8-4
```

### 2. `rules.json`

形式は `packages/design-system/design/rules.json` に倣う。1 ルール =

```json
{
  "id": "X-NO-HASHTAG",
  "strength": "MUST",
  "scope": ["draft.x_post"],
  "requirement": "X の投稿本文にハッシュタグ（# で始まる語）を入れない。",
  "source": "Tips 2: ハッシュタグは X のアルゴリズム上不利に働く",
  "verification": { "kind": "mechanical", "check": "x-post/no-hashtag" },
  "fix": "ハッシュタグを削り、必要なら語を本文に溶かす。"
}
```

`verification.kind` は `mechanical`（`scripts/checks/` に実装がある）/ `render`（Stage 06 で描画結果を測る。v0 では
実装無しで `unevaluated`）/ `review`（人が見る）。`scope` は `draft.<kind>` か `plan`。

v0 のルール（**これ以外を足さない**）:

| id | strength | scope | 要件（要約） | 検査 | Tips |
|---|---|---|---|---|---|
| `X-NO-HASHTAG` | MUST | draft.x_post（`purpose ≠ live`） | 告知投稿にハッシュタグ無し | mechanical | 2 |
| `LIVE-EVENT-HASHTAG` | SHOULD | draft.x_post（`purpose = live`） | 実況投稿に `brief.event.hashtag` を付ける | mechanical | 22 |
| `X-FOLD-LINK-VISIBLE` | MUST | draft.x_post | `constants.x.foldThreshold` 超の投稿は、折りたたみ前の範囲にリンクが収まり、折りたたみ後の冒頭に後押し文がある。`textAboveFold` / `textBelowFold` の分割を明示 | mechanical（仮値） | 1 |
| `X-IMAGE-VS-OGP` | MUST | draft.x_post | `expectedReaction = quote` なら `attachment.kind = image`、`repost` なら `ogp`（短縮リンク + OGP） | mechanical | 3 |
| `OGP-ON-SHORTLINK` | MUST | draft.x_post | `attachment.kind = ogp` のとき `attachment.link.ogImage` が必須 | mechanical | 4 |
| `X-POST-TIME` | SHOULD | draft.x_post（`purpose ≠ live`） | `scheduledAt`（JST）が `constants.x.postWindows` の窓に入る | mechanical | 9 |
| `X-FOLLOW-INTENT-LINK` | SHOULD | draft.x_post, draft.connpass_page | フォロー誘導のリンクが `constants.x.followIntentPattern` に一致する（X のプロフィール URL を直接貼らない） | mechanical | 35 |
| `CHANNEL-SPECIFIC-COPY` | MUST | draft.ig_post | Instagram 用の本文が X 用と同一文字列でない。広告用は投稿用と `purpose` が区別されている | mechanical | 12 |
| `COPY-FROM-META-THEME` | MUST | draft.copy | 各候補に `metaThemeMapping`（どのメタテーマをどう射影したか）がある | mechanical + review | 8 |
| `COPY-PER-MEDIUM` | MUST | draft.copy | `connpassTitle` / `xShort` / `igShort` / `flyerLine` の媒体別変種と、`audienceSegments` ごとの変種がある。`brief.copyConstraints`（必須語）を全変種が含む | mechanical | 12, 37 |
| `CP-TITLE-CONVEYS-CONTENT` | MUST | draft.copy | connpass タイトルが `constants.officialSeriesNames` だけで構成されていない。内容語（技術名・テーマ語）を含む。日本語の文字数が `constants.connpass.titleMinChars` 以上 | mechanical + review | 5, 7, 26 |
| `CP-THUMB-HAS-FACTS` | MUST | draft.asset_spec | サムネイルのスロットに `subcopy` / `date` / `place` が埋まっている | mechanical（v0 は asset_spec の JSON に対して） | 5 |
| `CP-SUMMARY-3-LINES` | MUST | draft.connpass_page | `summary` が 3 行以内（`\n` 区切り、1 行 60 字以内） | mechanical | 6 |
| `CP-HTML-ALLOWLIST` | MUST | draft.connpass_page | HTML が `connpass-syntax` の許可タグ・属性・22 プロパティだけで書かれている | mechanical | 6 |
| `MAIL-SEND-TIME` | SHOULD | draft.connpass_mail | `scheduledAt` が `constants.mail.sendWindows` に入る | mechanical | 10 |
| `MAIL-SHORT` | MUST | draft.connpass_mail | 本文が `constants.mail.maxBodyLines` 行以内。敬語の重ね（「〜させていただきます」等、`constants.mail.bannedPhrases`）を含まない | mechanical | 11 |
| `MAIL-DECORATED` | SHOULD | draft.connpass_mail | 見出しかフッターに装飾（罫線・記号）がある | mechanical | 11 |
| `SURVEY-STANDARD-QUESTIONS` | MUST | plan | アンケート設問に年齢・職業・経験年数・知った場所の 4 問がある。「知った場所」の選択肢が計画のチャネル一覧と一致 | mechanical | 13 |
| `ANNOUNCE-AFTER-CONFIRMED` | MUST | plan, draft.x_post | セッション紹介のアイテム・投稿は、そのセッションの `status` が `confirmed` 以上。`plan` は各アイテムに `blockedBy`（`session:<id>:confirmed` など）を付ける | mechanical | 30 |
| `ADS-FLIGHT-TIMING` | SHOULD | plan | X Ads の開始が `constants.ads.x.startDaysBefore` の範囲、最初の `impressionDays` 日は `objective = impression`。Meta Ads の開始が `constants.ads.meta.startDaysBefore` | mechanical | 28 |
| `DISCORD-MILESTONES` | SHOULD | plan | `discord_post` と `connpass_mail` が `constants.milestonesDaysBefore` の節目に対応し、節目以外に無い | mechanical | 29 |
| `PLAN-HAS-PRE-EVENTS` | SHOULD | plan | プレイベントが少なくとも 1 件あり、それぞれに本番への導線（`leadsTo`）がある | mechanical | 32 |
| `PLAN-FLYER-VERSIONS` | SHOULD | plan | `flyer_text` が v1 / v2 の 2 件で、v2 の期限がセッション確定の見込み日以降 | mechanical | 33 |
| `PLAN-SWAG-KINDS` | SHOULD | plan | `noveltyIdeas` が 5 種（全員 / リファラル / 抽選 / 交換コード / アンケート）に分類されている | mechanical | 34 |
| `REMIND-STAFF-BEFORE-POST` | MUST | plan | すべての `x_post` / `ig_post` に `-constants.reminders.staffOffsetMinutes` の `staff_reminder` が派生している | mechanical | 15 |
| `SPEAKER-REQUEST-BEFORE-POST` | SHOULD | plan | `speakerId` 付きのセッション紹介投稿に `-constants.reminders.speakerOffsetMinutes` の `speaker_request` が派生している | mechanical | 16 |
| `SPEAKER-TIER-HIGH-NO-ASK` | MUST | plan, draft.x_post | `tier = high` の登壇者への `speaker_request` は `suggestionOnly: true` | mechanical | 16, 31 |
| `SPEAKER-OWN-ANNOUNCE` | SHOULD | plan | 登壇者本人の登壇予告投稿を依頼する `speaker_request`（`purpose = own_announce`）が、`tier = normal` の登壇者全員にある | mechanical | 31 |
| `BUDGET-SPLIT` | MUST | plan | `budget.print ≤ constants.budget.nonAdsMaxYen` 前後、残りが SNS 広告、X : IG が `constants.budget.xIgRatioRange` 内 | mechanical | 17 |
| `PLAN-COVERS-CHANNELS` | SHOULD | plan | Tips 18 の手段一覧（`constants.channelCatalog`）の各項目について、採用 / 不採用と理由がある | mechanical | 18, 21 |
| `PLAN-HAS-LIVE-POSTS` | SHOULD | plan | 当日実況の `live_post` が少なくとも 1 件ある | mechanical | 22 |
| `BRAND-SKIN-DECLARED` | MUST | draft.asset_spec, draft.connpass_page | `skin` が brief に無い場合だけ `gdg-design` の既定を使い、その旨を `skinSource` に記す。ロゴの禁則（`gdg-design` の Logo 節）は skin に関係なく守る | mechanical + review | 23 |
| `JA-YOMIYASU` | MUST | draft.*（日本語本文を持つもの） | `yomiyasu_check.py` が exit 0 | mechanical（スクリプトが無い環境では `unevaluated`） | 24 |
| `IG-HASHTAGS` | SHOULD | draft.ig_post | Instagram の投稿本文にハッシュタグが `constants.instagram.minHashtags` 個以上 | mechanical | 36 |

### 3. `constants.json`

Skill と検査器が共有する数値。**値は Tips にあるものだけ確定し、無いものは `provisional: true` を付ける。**

```json
{
  "x": {
    "foldThreshold": { "chars": 280, "provisional": true, "note": "ユーザーの観察値で更新する" },
    "postWindows": { "weekday": [["17:00", "19:30"]], "weekend": [["12:00", "13:30"], ["17:00", "19:30"]], "provisional": true }
  },
  "mail": {
    "sendWindows": [["06:00", "07:30"], ["16:30", "18:00"]], "provisional": true,
    "maxBodyLines": 12, "provisional_maxBodyLines": true,
    "bannedPhrases": ["させていただきます", "ご確認のほど", "何卒"]
  },
  "reminders": { "staffOffsetMinutes": 60, "speakerOffsetMinutes": 180, "provisional_speaker": true },
  "budget": { "nonAdsMaxYen": 10000, "xIgRatioRange": [[3, 7], [4, 6]], "bands": [100000, 300000, 500000] },
  "officialSeriesNames": ["DevFest", "Build with AI", "I/O Extended", "Google I/O Extended", "DevFest Kansai"],
  "channelCatalog": ["x_organic", "x_ads", "ig_organic", "ig_ads", "flyer_distribute", "flyer_post", "other_event_lt", "other_event_flyer", "other_event_attend", "gdg_discord", "org_outreach", "friends", "community_ask", "speaker_invite", "novelty", "segment_content"],
  "surveyQuestions": ["年齢", "職業", "経験年数", "イベントを知った場所"],
  "milestonesDaysBefore": [45, 21, 7],
  "ads": { "x": { "startDaysBefore": [10, 14], "impressionDays": 3 }, "meta": { "startDaysBefore": 10 } },
  "connpass": { "titleMinChars": 20, "provisional_titleMinChars": true },
  "instagram": { "minHashtags": 5, "provisional_minHashtags": true },
  "flyer": { "versions": ["v1", "v2"], "v2SessionConfirmedRatio": 0.5 },
  "swag": { "kinds": ["all", "referral", "lottery", "redeem", "survey"] },
  "xFollowIntentPattern": "^https://(x|twitter)\\.com/intent/(follow|user)\\?",
  "channelLabels": { "x_organic": "X（投稿）", "x_ads": "X（広告）", "ig_organic": "Instagram（投稿）", "ig_ads": "Instagram（広告）", "flyer_distribute": "チラシ（配布）", "flyer_post": "チラシ（掲示）", "other_event_lt": "他イベントの LT", "other_event_flyer": "他イベントでのチラシ", "other_event_attend": "他イベントで知り合った", "gdg_discord": "GDG の Discord", "org_outreach": "学校・会社からの案内", "friends": "知人・友人", "community_ask": "コミュニティ・サークル", "speaker_invite": "登壇者の告知", "novelty": "ノベルティ", "segment_content": "企画" }
}
```

`provisional` の付いた値を使うルールは、検査結果の `detail` に「仮値」と書く。
`channelLabels` は connpass アンケート「イベントを知った場所」の選択肢と tinyurl のチャネル名に**同じ文字列**で使う（Stage 04 / 07 が読む）。
`channelCatalog` は**既定値**で、計画やアプリはこれに無いチャネル（LINE、SmartNews、PR Times …）を自由に足せる。足したチャネルの
ラベルは `plan` の出力か人の入力で与える。`xFollowIntentPattern` は実装時に `x.followIntentPattern` として `x` ブロックに入れる。

### 4. `guides/`（散文の判断基準）

1 ファイル 1 媒体。**各ファイルは「元の Tips」の番号を節ごとに明記する**（出典の無い段落を書かない）。

| ファイル | 必ず書くこと | Tips |
|---|---|---|
| `copy.md` | メタテーマの定義の仕方（2〜3 語の対立・越境・回避で書く）、射影の手順、例（Cognitive Surrender / Tech × Non-tech → コピー）、公式名の補い方、connpass タイトルと X 用コピーの違い、媒体別・層別の変種（connpass はエンジニア向け、ファッション等は他媒体で）、必須語の制約、候補は AI が出し 1〜2 人が決める、「おひとりさま歓迎」「オフライン限定」「ターゲット明記」の文言 | 5, 7, 8, 12, 26, 37 |
| `x.md` | 折りたたみ構成（上段 = 最大情報量 + リンク、下段 = 後押し）、画像 vs OGP の判断表（`expectedReaction` の決め方: 登壇者紹介 = quote、告知 = repost）、告知投稿のハッシュタグ禁止と実況のイベントハッシュタグ、投稿時刻、投稿と広告の違い、フォロー誘導はインテント付きリンク | 1, 2, 3, 4, 9, 12, 22, 35 |
| `instagram.md` | X との違い（コピー・画像比率・文体・時刻）、ハッシュタグは多数付ける、Instagram 広告の効果が最も大きい（幅広い層に届く）。それ以上の断定は**しない** | 12, 28, 36 |
| `connpass-page.md` | 3 行概要 + 装飾セクション + 画像の構成、DevFest Kansai 2026 を手本にする理由、`connpass-decent-description` と `connpass-syntax` をいつ読むか、サムネイルに載せる 3 要素 | 5, 6 |
| `connpass-mail.md` | 送信時刻、短さ、装飾、文例の骨格（見出し / 要件 3 行 / リンク / 装飾フッター） | 10, 11 |
| `schedule.md` | 投稿カレンダーの組み方（何日に何を）、週次の目標曲線、告知開始条件（セッション確定に従属）、広告の開始時期、Discord / メールの節目、派生リマインド（スタッフ -60 分、登壇者 -180 分）、プレイベントの位置づけと本番への導線、フライヤー v1 / v2 の期限、当日実況の準備 | 15, 16, 20, 22, 28, 29, 30, 32, 33 |
| `budget.md` | 配分の型（非広告 1 万円前後、残りを X : IG = 3 : 7 〜 4 : 6）、予算帯（10 / 30 / 50 万円超）で変わるもの（クリエイティブ数は予算に比例させる、という**方向だけ**。具体数は書かない）、広告設計の順序（目的 → ターゲット → コピー → デザイン） | 17, 27 |
| `novelty.md` | 「申し込みの後押し」としてのノベルティ、5 種の型（全員 / リファラル / 抽選 / 交換コード / アンケート）、層別企画（学生展示、座談会）。品目と発注先は Wiki の Swag カタログ・playbook ページへリンクし、ここに写さない | 18, 19, 34 |
| `connections.md` | コネクションの洗い出しの観点（人・組織・コミュニティ・サークル・研究室）、頼み方の型（LT 登壇依頼、まとめ紹介） | 18, 21 |
| `reminders.md` | スタッフ依頼文の型（いいね・リポスト、ストーリーへの掲載、レビュー依頼）、登壇者依頼文の型（本人の登壇予告、引用）、tier の考え方（high には出さない） | 15, 16, 24, 31 |
| `brand.md` | `gdg-design` との距離: skin で外れてよいもの（背景色、見出し書体、トーン）、外れてはいけないもの（ロゴの改変、公式ロックアップの捏造）、成功例の名前（Innovative Crosstalk 2026、Build with AI Kansai 2026、DevFest Kansai 2026 のブルー背景） | 23 |
| `channels.md` | Tips 18 の手段一覧を 1 項目 1 段落で。媒体の優先順位。`channelCatalog` は既定値で、キャンペーンごとに足してよいこと。告知先の正本は Wiki の「イベント告知対象とコネクション保有者」であること | 18, 25 |

### 5. `examples/`

- `examples/connpass-page/devfest-kansai-2026/`: `connpass.html`（`~/proj/connpass/connpass.html` をそのまま）、`connpass.md`、
  `timetable.json`、`session-list.json`、`README.md`（何が手本か: 3 行概要、セクション順、画像の使い方、ブルー背景の skin、
  パネルの作り）。画像は img.gdgs.jp の URL 参照のままにし、ファイルは持ち込まない
- `examples/copy/devfest-kansai-2026.json`: メタテーマ → コピーの実例（Tips 8）。媒体別の変種も入れる: connpass のメインコピー
  「AI 時代の『考える』を取り戻す。異分野と越境の AI カンファレンス」、フライヤーの「AI に、使われるな。技術と共創し、人間にしかできない価値をつくれ」、
  Instagram 用のファッション層向け文面（`~/proj/connpass` と議事録から）
- `examples/skins/`: DevFest Kansai 2026 の skin（`bg: #4285F4` 系のブルー、Off White ではない）を `brief.schema.json` の `skin` 形式で 1 件。
  Innovative Crosstalk 2026 / Build with AI Kansai 2026 は **素材が手元に無いので置かない**。`README.md` に「ユーザーから
  URL と画像をもらって追加する」と書く
- `examples/briefs/devfest-kansai-2026.json`: `connpass.md` の開催概要・セッション・登壇者から起こした brief。検査器と
  Skill の動作確認に使う（§9）

### 6. `references/brief.schema.json`

全 Skill の入力。Stage 01 の `briefs` テーブルの `JSON` 列はこの形をそのまま持つ。

| キー | 型 | 内容 |
|---|---|---|
| `event` | object | `name`, `officialSeries?`, `startAt`, `endAt`, `venue`, `format(onsite/online/hybrid)`, `fee`, `capacity?`, `connpassUrl?`, `hashtag?`（例 `#DevFestKansai`）, `streamUrls?: { [track]: url }` |
| `metaThemes` | string[] | 2〜3 個 |
| `audienceSegments` | `{ id, label, note? }[]` | 学生 / 若手エンジニア / 異分野 など |
| `goals` | object | `applications`（数）, `curve?: { date, applications }[]`（週次の目標曲線）, `bySegment?` |
| `speakers` | `{ id, name, role, org?, xHandle?, followers?, tier: "normal" \| "high", sessionIds }[]` | |
| `sessions` | `{ id, title, track?, startAt?, endAt?, speakerIds, keywords, status: "tba" \| "confirmed" \| "public", publishAfter?, flags?: ("no_recording" \| "english" \| "onsite_only" \| "bring_pc")[] }[]` | `status` が告知開始条件の根拠（Tips 30） |
| `budget` | object | `totalYen`, `printYen?`, `adsSplit?: { x, ig }` |
| `skin` | object? | `bg`, `accent`, `textColor`, `headingFont?`, `tone`, `referenceAssetUrls[]`, `brandGuideUrl?`（イベント公式のブランドガイド。DevFest は年ごとに別）。優先は公式ガイド > チャプターの skin > `gdg-design` |
| `copyConstraints` | string[]? | コピーに必ず入れる語（例 「Google」「AI」） |
| `chapters` | `{ chapterId, role: "host" \| "co-host" }[]`? | 主催と共催。アプリでは `campaign_chapters` |
| `accounts` | `{ kind: "x" \| "ig" \| "connpass_group", handle, chapterId, role: "primary" \| "mirror" }[]`? | 配信先。アプリでは `campaign_accounts` |
| `preEvents` | `{ name, date, venue?, leadsTo? }[]`? | プレイベント（Tips 32） |
| `novelty` | string[]? | |
| `connections` | `{ kind, name, relation, channel, owner? }[]`? | |
| `constraints` | string[]? | 「○○は言わない」など |
| `notes` | string? | |

### 7. タスク Skill

各 Skill は `SKILL.md` + `agents/openai.yaml` + `references/output.schema.json`（Codex の `--output-schema` にそのまま渡せる
JSON Schema）+ `references/example-output.json`（検査器の fixture 兼 手本）。`SKILL.md` の構成は共通:

1. **入力** — `pr-playbook/references/brief.schema.json` の brief と、タスク固有の入力
2. **読むもの** — `pr-playbook` の `rules.json` のうち自分の `scope`、該当 `guides/`、`examples/`、依存 Skill
3. **手順** — 判断の順番（例: メタテーマ → 射影 → 候補 N → 公式名の補い → 検査）
4. **出力** — `output.schema.json` の形で JSON だけを返す。自由文は `*Md` キーに閉じる
5. **検査** — `node <pr-playbook>/scripts/checks/run.mjs --kind <kind> --input <json>` を実行し、MUST を直してから返す
6. **推敲** — 日本語本文は `yomiyasu` を通す（Skill が無い環境では、その旨を `notes` に書く）

| Skill | kind | 出力の必須キー | 束ねる既存 Skill |
|---|---|---|---|
| `pr-copy` | `copy` | `candidates[]: { title, mainCopy, connpassTitle, xShort, igShort, flyerLine, bySegment: { [segmentId]: { line } }, metaThemeMapping: { theme, projection }[], rationaleMd }` | — |
| `pr-x-post` | `x_post`（`ig_post` も同 Skill の `--channel ig`） | `posts[]: { purpose(announce/session/speaker/countdown/live/segment), segmentId?, sessionId?, scheduledAt(JST ISO), text, textAboveFold, textBelowFold, expectedReaction(quote/repost/click), attachment: { kind: image/ogp/none, imageSlots?, link?: { url, ogImage } }, speakerId?, staffReminder: { text }, speakerRequest?: { speakerId, purpose: quote/own_announce, text, suggestionOnly } }`。`purpose = session` は `sessions[].status` が `confirmed` 以上のものだけ | `gdg-sns`（投稿の制約の参照のみ） |
| `pr-connpass-page` | `connpass_page` | `title, summary(≤3 行), sections[]: { id, heading, slots: {…} }, html(全体。**`templates/connpass-page/` の描画器の出力と一致**。Stage 04 までは描画器が無いので、Skill が `connpass-decent-description` のパターンで組んだ HTML をそのまま入れ、検査は `CP-HTML-ALLOWLIST` だけ), imageSlots[]: { id, purpose, text }, surveyQuestions[]` | `connpass-decent-description`, `connpass-syntax`, `gdg-design` |
| `pr-connpass-mail` | `connpass_mail` | `subject, scheduledAt, bodyLines[], footer, purpose` | `connpass-syntax`（メールは Markdown 相当） |
| `pr-plan` | `plan` | `strategyMd, goalCurve[], channelMix[]: { channel, label?, adopt, reason, weight }, budgetAllocation: { printYen, adsYen, x, ig, byWeek[], flights[]: { medium, startDaysBefore, phases[] } }, scheduleItems[]: { kind, channel, dueAt, title, speakerId?, sessionId?, segmentId?, blockedBy?: string[], derivedFrom?, offsetMinutes?, assigneeRole? }, preEvents[], outreach[]: { organization, kind, ownerRole, pitchMd }, connectionsToUse[], noveltyIdeas[]: { kind, idea }, segmentContentIdeas[], surveyQuestions[]` | — |

`pr-x-post` の `textAboveFold` / `textBelowFold` は、本文 `text` を `constants.x.foldThreshold` で機械的に切ったものと
一致しなければならない（検査器が切り直して比較する）。改行位置の調整は `text` 側で行う。

短縮リンクは本文に `{{shortlink}}` プレースホルダとして書く（実 URL は Stage 03 の配信時に差し込む）。検査器は
`{{shortlink}}` と `https?://` の URL を **23 字**（X の t.co 換算）として数え、折りたたみ判定とリンク可視判定の両方で URL 扱いにする。

### 8. 検査器（`scripts/checks/`）

- Node 22 以上、依存ゼロの ESM。`run.mjs --kind <kind> --input <file> [--playbook <dir>]` が
  `{ kind, playbookVersion, results: { ruleId, strength, status: pass|fail|unevaluated, detail }[] }` を標準出力に書き、
  MUST の `fail` があれば exit 1。
- 1 ルール 1 関数。`index.mjs` が `rules.json` の `verification.check` 名 → 関数の表を持つ。
  表に無い `mechanical` ルールがあれば `validate.mjs` が落ちる（§8-4）。
- `connpass-html.mjs`: `syntax.md` の表をデータとして持ち、HTML を正規表現ではなく**簡易トークナイザ**で走査する
  （タグ名・属性名・`style` の宣言名を取り出す）。Markdown 部分は検査しない。
- `x-post/fold.mjs`: `foldThreshold.chars` で切り、上段に URL（`https?://`）が含まれるか、下段の先頭 1 行が空でないかを見る。
- `JA-YOMIYASU`: `python3 <yomiyasu>/scripts/yomiyasu_check.py` を `YOMIYASU_DIR` 環境変数か `~/.agents/skills/yomiyasu` から探し、
  無ければ `unevaluated`。
- 各検査関数に `node --test` のテストを置く（`*.test.mjs`）。
- `scripts/validate.mjs`: `rules.json` のスキーマ検査、`check` 名の実在、`guides/` と `examples/` の参照切れ、
  `constants.json` の `provisional` の列挙を出力する。

### 9. モノレポ側

- `.agents/skills/pr-playbook`, `pr-copy`, `pr-x-post`, `pr-connpass-page`, `pr-connpass-mail`, `pr-plan` を
  `../../skills/<name>` へのシンボリックリンクとして置く（`.claude/skills` は `.agents/skills` を指す）。
- `skills` サブモジュールのコミットを進める。
- `skills/README.md` の一覧に 6 件を足す。

### 制約

- **Tips に無い知識を書かない。** 一般的な SNS マーケティングの常識で埋めたくなる箇所（Instagram の最適時刻、ハッシュタグの数、
  画像比率の推奨）は、書かずに `proposals/` に「ユーザーに確認」として置く。理由: Playbook は「ユーザーのセンスの言語化」であり、
  一般論が混ざると人の修正で学ぶループが濁る。
- **仮値は仮値と分かる形にする。** `provisional: true` の無い数値を足さない。
- **既存 Skill を変更しない。** `connpass-syntax` の許可リストを広げたくなっても、転記だけにする。理由: 実測に基づく表であり、
  広げると connpass に剥がされる。
- **Skill は `skills/` の中だけで完結させる。** モノレポのファイル（`apps/`, `packages/`）を相対パスで参照しない。
  理由: `npx skills add gdg-jp/skills` で他プロジェクトに入れたときに壊れる。
- **Python は yomiyasu の呼び出しだけ。** 検査器は Node で書く。理由: runner の VM と Worker の両方で同じ実装を使う。
- Stage 01 以降の担当（Worker、D1、runner、テンプレートの描画）には手を出さない。`templates/` は空ディレクトリと README だけ。

## Files to touch — 変更ファイル

### `skills/`（gdg-jp/skills サブモジュール。すべて新規）

- `pr-playbook/SKILL.md`, `agents/openai.yaml`, `rules.json`, `constants.json`, `decisions.md`, `proposals/README.md`
- `pr-playbook/guides/{copy,x,instagram,connpass-page,connpass-mail,schedule,budget,novelty,connections,reminders,brand,channels}.md`
- `pr-playbook/examples/connpass-page/devfest-kansai-2026/{connpass.html,connpass.md,timetable.json,session-list.json,README.md}`
- `pr-playbook/examples/{copy/devfest-kansai-2026.json,skins/devfest-kansai-2026.json,skins/README.md,briefs/devfest-kansai-2026.json}`
- `pr-playbook/references/{brief.schema.json,draft-kinds.md}`
- `pr-playbook/templates/README.md`（Stage 04 / 06 の予約席）
- `pr-playbook/scripts/checks/{run.mjs,index.mjs,x-post.mjs,copy.mjs,connpass-page.mjs,connpass-html.mjs,mail.mjs,plan.mjs,asset-spec.mjs,yomiyasu.mjs,util.mjs}` と `*.test.mjs`
- `pr-playbook/scripts/validate.mjs`
- `pr-copy/`, `pr-x-post/`, `pr-connpass-page/`, `pr-connpass-mail/`, `pr-plan/`: 各 `SKILL.md`, `agents/openai.yaml`,
  `references/output.schema.json`, `references/example-output.json`
- `README.md`（一覧に追記）

### モノレポ

- `.agents/skills/pr-{playbook,copy,x-post,connpass-page,connpass-mail,plan}`（シンボリックリンク、新規）
- `skills`（サブモジュールのコミット更新）

## Verification — 完了条件と検証

### 完了条件

1. `rules.json` の `mechanical` ルール全件に検査関数があり、`validate.mjs` が exit 0。
2. 5 つのタスク Skill の `references/example-output.json` が、それぞれの `run.mjs --kind` で **MUST 全件 pass**（`JA-YOMIYASU` は
   yomiyasu がある環境で pass、無い環境で `unevaluated`）。
3. `examples/briefs/devfest-kansai-2026.json` が `brief.schema.json` に適合する。
4. Claude Code で `/pr-x-post` を DevFest Kansai 2026 の brief に対して実行すると、`constants` の仮値を仮値と断って、
   検査を通った JSON が返る（手動 E2E）。
5. `guides/*.md` の各節に Tips 番号が付いていて、番号の無い段落が無い（`validate.mjs` が `<!-- tips: n -->` マーカーで数える）。

### コマンド

```sh
cd skills
node pr-playbook/scripts/validate.mjs
node --test pr-playbook/scripts/checks/
for s in copy x-post connpass-page connpass-mail plan; do
  node pr-playbook/scripts/checks/run.mjs --kind "$(sed 's/-/_/g; s/x_post/x_post/' <<<"$s")" --input "pr-$s/references/example-output.json"
done
node pr-playbook/scripts/checks/run.mjs --kind connpass_page --input pr-playbook/examples/connpass-page/devfest-kansai-2026/as-draft.json
```

（`as-draft.json` は `connpass.html` を `connpass_page` の下書き JSON に包んだもの。`CP-HTML-ALLOWLIST` の実物テスト）

### 回帰として固定すべきテスト

- **`connpass-html.mjs` が `syntax.md` の 22 プロパティを 1 つも落とさず、`border-radius` / `line-height` / `display` / `width` を fail にする**
  （許可リストの転記ミスは connpass に剥がされるまで気づけない）
- **`x-post/fold.mjs` が全角文字を 1 文字と数える**（`.length` は UTF-16 単位。サロゲートペアの絵文字で崩れる）
- **`SPEAKER-TIER-HIGH-NO-ASK` が `tier: high` で `suggestionOnly: false` を fail にする**（静かに依頼が出る経路）
- **`BUDGET-SPLIT` が X : IG = 5 : 5 を fail、3.5 : 6.5 を pass にする**（範囲判定の境界）
- **`CP-TITLE-CONVEYS-CONTENT` が「DevFest Kansai 2026」単体を fail、「DevFest Kansai 2026 — AI 時代の考えるを取り戻す」を pass にする**
- **`X-NO-HASHTAG` が `purpose = live` の投稿を検査対象にせず、`LIVE-EVENT-HASHTAG` がそれを検査する**（実況投稿が全件 fail になる経路）
- **`ANNOUNCE-AFTER-CONFIRMED` が `status = tba` のセッション紹介投稿を fail にし、`confirmed` を pass にする**
- **`run.mjs` が `provisional` な定数を使ったルールの `detail` に「仮値」を含める**

### 手動 E2E

1. `~/proj/connpass` で `npx skills add gdg-jp/skills --skill pr-x-post`（ローカルのサブモジュールパスでもよい）。
2. Claude Code で `/pr-x-post` に `examples/briefs/devfest-kansai-2026.json` を渡し、「セッション紹介 3 本 + 告知 2 本」を頼む。
3. 返った JSON を `run.mjs --kind x_post` にかけ、MUST が全件 pass であること。
4. 登壇者に `tier: high` を 1 人混ぜ、その人の `speakerRequest.suggestionOnly` が `true` であること。
5. `/pr-connpass-page` で同じ brief からページを作り、`connpass-syntax` の許可リスト外の CSS が 1 つも出ないこと。
6. ユーザーが「自分なら直す」箇所を数え、`proposals/` に書く（Stage 08 の種）。
