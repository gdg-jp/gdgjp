# Stage 06 — 画像と当日実況: 画像テンプレートと `asset` ジョブ、Browser Rendering での描画と render 検査、img.gdgs.jp への配布、タイムテーブルからの実況投稿の生成

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 画像の方針は overview §7（「AI はピクセルを設計しない。
テンプレートのスロットを AI が埋め、Browser Rendering で描画し、機械検査する」）。Tips 5・12・23 が根拠。

Stage 04 までで投稿文と connpass ページはできるが、画像は人が Figma で作って URL を手入力している。このステージで、
「顔」（イベントのサムネイル）の skin から派生する量産物 — OGP、X 投稿画像、X 広告、Instagram フィード / ストーリー、
セッション紹介カード、登壇者カード、connpass サムネイル — をテンプレートから自動生成し、承認で img.gdgs.jp に上げ、
短縮リンクの OGP・X 投稿の添付・connpass のサムネイルに配る。

描画は 2 系統で同じ HTML を使う: 人が Skill から使う **ローカル描画器**（Playwright。`connpass-session-list-image` と同じ流儀）と、
Worker の **Browser Rendering**（`BROWSER.quickAction`）。検査（はみ出し・最小文字サイズ・コントラスト・セーフゾーン・
縮小時の可読性）はテンプレートに埋めたスクリプトが DOM から測り、どちらの系統でも同じ結果を返す。

あわせて**当日実況の生成**（§8）をこのステージに置く。DevFest Kansai 2026 では時刻・トラック・題・登壇者・配信 URL・ハッシュタグから
成る 45 本の投稿をタイムテーブルから手で起こし、当日 1 人で投稿して破綻した（[`00a`](00a-devfest-2026-usecase-review.md) §2-3）。
セッションカードの画像と一緒に、タイムテーブルから予約投稿を機械生成して sns に流す（overview §12-17）。

### 依存と対象範囲

- 依存: Stage 02（ジョブ、`fix`）、Stage 03（`campaign_links` と OGP、`SNS.attachMedia`、`IMG_UPLOAD` の前例、`dispatch_targets`、`live_post` の写真経路）、Stage 04
  （`connpass_page.imageSlots`、`CONNPASS.uploadImage`、テンプレート言語 `scripts/render/template.mjs`）、Stage 00（`CP-THUMB-HAS-FACTS`、
  `BRAND-SKIN-DECLARED`、`LIVE-EVENT-HASHTAG`、`sessions[].flags`、`event.streamUrls`、`guides/thumbnail.md`、`guides/brand.md`、`render` 種別のルール枠）。
- 対象: `skills/pr-playbook/templates/images/` と `pr-asset` Skill と `scripts/render/images.mjs`（サブモジュール）、`apps/pr/`
  （`asset` ジョブ、`BROWSER` / `ASSETS` / `IMG_UPLOAD` binding、描画・検査・配布）、`apps/tinyurl/`（`PrService.updateLink` の追加だけ）。
- フライヤーの印刷入稿、動画、Figma 連携は overview §11 のとおり作らない。タイムテーブルとセッション一覧の画像は既存 Skill
  （`connpass-timetable-image` / `connpass-session-list-image`）の領分で、ここでは作らない。

### 事前確認（実装前に必ず）

1. **Browser Rendering の `quickAction("snapshot", { html, viewport, screenshotOptions })` が、`html` を直接受け取り、
   レンダリング後の DOM（`content`）と PNG（base64）を 1 回で返すこと。** `apps/wiki/worker-configuration.d.ts` の
   `BrowserRunSnapshotOptions` / `BrowserRunScreenshotOptions`（`html?: string`、`viewport`、`screenshotOptions.type/quality`）を確認し、
   pr でも `[browser] binding = "BROWSER"` を足して `cf-typegen` の型で確かめる。`snapshot` が無ければ `screenshot` + `scrape`
   （`#__checks` の text）の 2 回呼びに落とす。
2. **`html` 引数のサイズ上限。** フォントを data URI で埋めると HTML が数 MB になる。上限に当たるなら、フォントは
   `pr.gdgs.jp/assets/fonts/<file>?t=<署名>` で配信し `@font-face { src: url(...) }` で参照する（§5）。
3. **フォントファイルの入手と権利。** `connpass-session-list-image` は `~/Library/Fonts/GoogleSans-*.ttf` と `LINESeedJP-*.ttf` を使う。
   同じファイルを R2 `ASSETS` の `fonts/` に置く（リポジトリにはコミットしない）。`gdg-design` の Typography 節のとおり、
   埋め込みの権利が確認できない書体は使わず、ユーザーに確認して止まる。
4. connpass のイベント画像の推奨サイズ（表示上の比率）と、X / Instagram の画像仕様（§3 の表）を、各媒体の現行ヘルプで確認し、
   `constants.images` に入れる（実測・公式値は `provisional` 無し、推測は `provisional`）。

### 読むべきもの

- `skills/connpass-session-list-image/scripts/render.mjs` と `model.mjs`、`assets/session-list.css` — HTML → Playwright → 2x PNG、
  フォントの `@font-face` data URI、はみ出し・フォント読み込みの検証、10 MB 上限。**ローカル描画器の手本**
- `skills/gdg-design/references/brand-system.md` — ロゴの禁則（改変・回転・クロップ・文字重ね禁止）、パレット、ステッカー
- `skills/pr-playbook/guides/{thumbnail,brand}.md`（Stage 00）
- Stage 04 の `scripts/render/template.mjs`（テンプレート言語）
- `apps/tinyurl/app/features/links/link.service.ts` の `updateLinkWithExtras`（OGP の更新）
- `apps/img/workers/app.ts` と `packages/gdg-lib/src/image-upload.ts` — `IMG_UPLOAD.upload({ bytes, contentType, filename, user, chapterId })`
- `apps/wiki/workers/features/sources/website.ts` の `fetchHtmlViaBrowser` — `BROWSER.quickAction` の呼び方とエラー処理
- `apps/connpass/app/routes/api/events/image.ts` — 1 MB 上限（connpass サムネイルは JPEG で品質を下げて収める）

### 再利用する既存実装（書き直さない）

- Stage 04 の `template.mjs`（`{{slot}}` / `each` / `if`、エスケープ、URL 検査）— 画像テンプレートも同じ言語
- `connpass-session-list-image` の描画器の検証ロジック（フォント読み込み待ち、`document.fonts.ready`、はみ出し検査）— **関数を移植**
  して `images.mjs` に置く（既存 Skill は変更しない）
- Stage 02 の `fix` ジョブの仕組み — render 検査の MUST 失敗で 1 回だけ `asset` を作り直す
- Stage 03 の `IMG_UPLOAD` と `campaign_links`、Stage 04 の `CONNPASS.uploadImage`

## Design — 設計

### 1. テンプレート（`skills/pr-playbook/templates/images/<id>/`）

```
templates/images/<id>/
  template.html          1 枚の HTML。<body> 直下に固定サイズの .canvas、末尾に <script id="__checks-script">（§4）
  slots.schema.json      スロット契約: 各スロットの型・必須・maxLength・許容レイアウト変数（layoutVars）の範囲
  README.md              用途、サイズ、どの媒体に出すか、必須スロット、縮小表示の想定（一覧サムネ相当の縮尺）
```

| id | サイズ（px, 1x） | 媒体 | 必須スロット | 備考 |
|---|---|---|---|---|
| `connpass-thumbnail` | **事前確認 4** | connpass イベント画像 | `title`, `subcopy`, `date`, `place`（`CP-THUMB-HAS-FACTS`） | JPEG で 1 MB 以下 |
| `ogp-1200x630` | 1200×630 | 短縮リンクの OGP | `title`, `subcopy`, `date` | |
| `x-post-16x9` | 1600×900 | X 投稿画像 | `headline` | `speakers[]` 任意 |
| `x-post-1x1` | 1080×1080 | X 投稿画像 | `headline` | |
| `x-ad-16x9` | 1600×900 | X 広告 | `headline`, `cta` | 投稿用と `purpose` を分ける（Tips 12） |
| `ig-feed-4x5` | 1080×1350 | Instagram フィード | `headline` | |
| `ig-story-9x16` | 1080×1920 | Instagram ストーリー | `headline`, `cta` | 上下のセーフゾーン |
| `session-card-1x1` | 1080×1080 | セッション紹介 | `sessionTitle`, `speakerName`, `speakerRole`, `speakerImageUrl` | |
| `speaker-card-1x1` | 1080×1080 | 登壇者紹介 | `speakerName`, `speakerRole`, `speakerImageUrl` | |
| `live-session-16x9` | 1600×900 | 当日実況（§8）のセッション開始投稿 | `time`, `track`, `sessionTitle`, `speakerName`, `flags[]` | 文字中心。写真は無し |
| `photo-16x9` | 1600×900 | 写真を下地にした投稿・広告 | `photoUrl`, `headline`, `sub?` | DevFest 2026 の広告画像は 19F の写真が下地。`photoUrl` は R2 の「顔」素材か Google Photos 取り込み |

全テンプレートは `skin`（Stage 04 の `skin.schema.json`: bg / panelBg / keyline / accent[] / text / headingFont、`brandGuideUrl` は参照だけ）を受け、
既定は `gdg-design`。`ig-story-9x16` と `ig-feed-4x5` は Instagram 広告の効果が最大だった（Tips 28）ので、テンプレートの実装順を
`connpass-thumbnail` → `ogp` → `ig-story` → `ig-feed` → X 系 → カード系にする。ロゴは `gdg-design/assets/gdg.svg` を `<img>` で置き、**サイズ以外を変えない**（`RENDER-LOGO-INTACT`）。
書体は Google Sans（見出し）+ LINE Seed JP（本文）。`layoutVars` は `titleScale`（0.8〜1.2）、`align`（left / center）、
`emphasis`（強調する語の配列）のように**範囲付き**で、テンプレートが解釈する。AI が任意の CSS を返す口は無い。

### 2. `pr-asset` Skill（`skills/pr-asset/`）

入力: テンプレート id、`slots.schema.json`、採用コピー、brief（`skin`、登壇者・セッション）、`guides/thumbnail.md`、`guides/brand.md`、
投稿側の `imageSlots` の文言（あれば）。出力（`references/output.schema.json`）:

```json
{ "templateId": "x-post-16x9", "slots": { "headline": "…", "sub": "…" }, "layoutVars": { "titleScale": 1.1, "emphasis": ["AI"] },
  "skinSource": "brief" , "rationaleMd": "…" }
```

**ピクセル・CSS・HTML は返さない。** Skill の手順: スロット契約を読む → 文言を決める（字数制限は契約から）→
`node pr-playbook/scripts/render/images.mjs --template <id> --slots out.json --skin skin.json --out dir/` でローカル描画 →
検査結果（§4）を読んで直す → JSON を返す。

### 3. ジョブと取り込み（`apps/pr/`）

| 項目 | 内容 |
|---|---|
| type / payload | `asset` / `{ templateId, forDraftVersionId?, forScheduleItemId?, forImageSlotId?, copyDraftId, instructions? }` |
| 束の追加分 | `TEMPLATE/{template.html,slots.schema.json,README.md}`、`SKIN.json`（brief の skin か既定）、`COPY.json`、`POST.json`（投稿の文言と `imageSlots`） |
| 取り込み | `slots` を契約で検証 → `assets` 行（`status = rendering`）→ **描画（§5）→ render 検査（§4）** → MUST 失敗なら `fix` 1 回 → `status = needs_approval` |
| 起動 | (a) `x_post` / `ig_post` draft の `attachment.kind = image`（承認前に自動で積む）、(b) `connpass_page` draft の `imageSlots[]` ごと、(c) `/c/:slug/settings` 「サムネイルを作る」、(d) 短縮リンク作成時に OGP が無いとき `ogp-1200x630` |

`migrations/0004_assets.sql`:

```sql
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  slots TEXT NOT NULL, layout_vars TEXT NOT NULL DEFAULT '{}', skin TEXT NOT NULL,
  width INTEGER NOT NULL, height INTEGER NOT NULL, scale INTEGER NOT NULL DEFAULT 2,
  r2_key TEXT, r2_key_jpeg TEXT,                      -- PNG 2x と、connpass 用 JPEG（≤1 MB）
  img_id TEXT, img_url TEXT,                          -- 承認後に img.gdgs.jp へ
  checks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'rendering' CHECK (status IN ('rendering','needs_approval','approved','rejected','superseded','failed')),
  for_draft_version_id INTEGER, for_schedule_item_id INTEGER, for_image_slot_id TEXT,
  derived_from_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  job_id TEXT, playbook_version TEXT NOT NULL,
  approved_by TEXT, approved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX assets_campaign ON assets (campaign_id, status);
```

### 4. render 検査（テンプレート内スクリプト + `rules.json` の `render` ルール）

各テンプレートの末尾の `<script>` が `document.fonts.ready` 後に DOM を測り、`<pre id="__checks">` に JSON を書く。
Worker もローカル描画器も、この要素を読むだけ。ルールは Stage 00 の `rules.json` に `verification.kind = "render"` で追加する:

| id | strength | 測るもの | 定数 |
|---|---|---|---|
| `RENDER-NO-OVERFLOW` | MUST | `.slot` 要素の `scrollWidth/Height` が `clientWidth/Height` を超えない、`.canvas` 外に出ない | — |
| `RENDER-MIN-FONT` | MUST | 必須スロットの computed `font-size` × `thumbnailScale` ≥ `minFontPxAtThumbnail` | `constants.render.thumbnailScale`（0.25、provisional）、`minFontPxAtThumbnail`（9、provisional） |
| `RENDER-CONTRAST` | MUST | 必須スロットの文字色と背景色のコントラスト比 ≥ 4.5（背景は `.slot` の最も近い不透明な祖先） | — |
| `RENDER-SAFE-ZONE` | SHOULD | 必須スロットが `.canvas` のセーフゾーン内（テンプレートの `data-safe-inset`） | テンプレートごと |
| `RENDER-LOGO-INTACT` | MUST | `img[data-logo]` の表示比率が自然比率と一致、`transform` 無し、クロップ無し、上に重なる要素無し | — |
| `RENDER-FONTS-LOADED` | MUST | `document.fonts.check` が Google Sans と LINE Seed JP で true | — |

結果の形は Stage 00 の検査器と同じ `{ ruleId, status, detail }[]`。`CP-THUMB-HAS-FACTS` / `BRAND-SKIN-DECLARED` は `slots` の
JSON に対して（Stage 00 の mechanical 実装）、render ルールは描画後に、両方を `assets.checks` に入れる。

### 5. 描画（`apps/pr/app/features/assets/render.server.ts`）

1. `template.mjs` で HTML を組む（skin、slots、layoutVars）。フォントは §事前確認 2 の結果で data URI か `pr.gdgs.jp/assets/fonts/…`
   （R2 `ASSETS` の `fonts/` から配信。URL に HMAC 署名 `t=` を付け、TTL 10 分。Worker の `/assets/fonts/:file` ルートは署名検証のみ）。
2. `BROWSER.quickAction("snapshot", { html, viewport: { width, height, deviceScaleFactor: 2 }, screenshotOptions: { type: "png" } })`
   → `content` から `#__checks` を抜き、`screenshot` を R2 `campaigns/<id>/assets/<assetId>.png` に置く。
3. connpass 用: `type: "jpeg", quality: 85` で再描画し 1 MB を超えるなら `quality` を 10 ずつ下げて再試行（最低 60。それでも超えたら `failed`）。
4. 失敗（Browser Rendering の 429 / タイムアウト）は `retry: true` で 1 回だけ再キュー。

ローカル描画器 `skills/pr-playbook/scripts/render/images.mjs` は同じ HTML を Playwright で開き、同じ `#__checks` を読んで
PNG と `checks.json` を書く。**HTML を組む関数は 1 つ**（`scripts/render/image-html.mjs`）で、Worker はそれを import する。

### 6. 配布（承認時）

| 行き先 | 何を |
|---|---|
| img.gdgs.jp | `IMG_UPLOAD.upload({ bytes: PNG, contentType: "image/png", filename: "<campaign>-<template>-<id>.png", user: 承認者, chapterId })` → `assets.img_id / img_url` |
| 短縮リンクの OGP | `for_schedule_item_id` の `campaign_links.og_image_url` を更新し、`TINYURL.updateLink({ linkId, ogImageUrl })`（**tinyurl の `PrService` に `updateLink` を追加**。`updateLinkWithExtras` を呼ぶだけ） |
| X 投稿の添付 | `x_post` draft の `attachment.assetId` に結び、Stage 03 の配信時に `SNS.attachMedia({ bytes, contentType, altText: slots.headline })`。**asset が `approved` でないと投稿 draft を承認できない**（UI と `dispatch` の両方で） |
| connpass サムネイル | `connpass-thumbnail` の承認で `CONNPASS.uploadImage({ bytes: JPEG })` |
| connpass ページの画像 | `for_image_slot_id` の `connpass_page` draft のスロットに `img_url` を入れて再描画（人の版として保存） |

### 8. 当日実況の生成（`features/live/`）

入力は brief の `sessions[]`（`startAt` / `endAt` / `track` / `speakerIds` / `flags`）、`event.streamUrls`、`event.hashtag`、採用コピー。
**LLM は使わない**（一言の見どころだけ `post` ジョブで埋めてもよいが、無くても成立する形にする）。

| 生成する投稿 | 時刻 | 本文の型 |
|---|---|---|
| 開場 / オープニング / クロージング / 懇親会 | brief の時刻 | 定型（`guides/live.md` の型）+ ハッシュタグ |
| セッション開始（トラックごと） | `startAt` | `{絵文字}{時刻}〜 {track}\n『{title}』\n👤{speaker}氏\n\n{一言}\n{flags: ⚠️録画 NG / 🌐英語 / 📍現地のみ / PC をご用意ください}\n📺配信はこちら {streamUrl}\n{hashtag}` |
| 休憩 | 休憩の開始 | 次の開始時刻と「次に聴きたいテーマ」 |
| 写真付き（終了後） | `endAt` + 10 分 | Stage 03 の `live_post(photo)`。撮影担当（`assignee`）が付く |

- `live-posts-from-timetable.ts`（純関数）が `schedule_items`（`kind = live_post`、`purpose = live`、`session_id`）と draft（`x_post`、`purpose = live`）を
  一括生成する。同じ開始時刻のセッションは**1 投稿に 1 セッション**（DevFest 2026 と同じ）。
- 画像は `live-session-16x9` を `asset` ジョブ無しで**スロット埋めが自明**なので Worker が直接描画する（`asset` ジョブはコピーの判断が要るときだけ）。
- 生成した投稿は通常の `in_review → needs_approval → approved` を通り、Stage 03 の `dispatch_targets` で各 X アカウントに `scheduled` で予約される。
  `X-NO-HASHTAG` の対象外、`LIVE-EVENT-HASHTAG` と `ANNOUNCE-AFTER-CONFIRMED`（`status = public` のセッションだけ）の対象。
- `/c/:slug/live`: タイムテーブルと生成済み投稿を並べ、撮影担当の割り当て（トラックごと）、未割り当ての警告、「前日に全件を予約」ボタン。
  当日の変更（登壇順の入れ替え）は brief の `sessions` を直して**再生成**（既存の `scheduled` は sns 側で `updatePost`）。
- 配信 URL が無い（配信しない）イベントでは `📺` 行を省く。

### 7. 画面

- `/c/:slug/assets`: 一覧（テンプレート、用途、状態、検査の赤 / 黄）、「作り直す（指示付き）」
- `/c/:slug/live`: §8
- `/c/:slug/assets/:id`: 1x / 縮小（`thumbnailScale`）/ 2x の表示、検査結果、スロットと `layoutVars` の**手編集 → 再描画**
  （人の編集は `derived_from_asset_id` 付きの新 asset）、承認 / 却下
- `/c/:slug/drafts/:id`（x_post / connpass_page）: 紐づく asset のサムネイルと状態、「画像を作る」
- `/c/:slug/settings`: 「サムネイルを作る」（`connpass-thumbnail`）と、Figma で作った「顔」のアップロード（R2 に置いて skin の
  `referenceAssetUrls` に入れるだけ。色の自動抽出はしない）

### 制約

- **AI はスロットと範囲付きの `layoutVars` だけ返す。** 出力スキーマに HTML / CSS / 座標の口を作らない。理由: overview §7。
- **テンプレートは `skin` の外の色・書体を持たない。** 理由: Tips 23 のイベント skin で外れる自由と、ロゴの禁則の両立。
- **ロゴは `gdg.svg` を `<img>` で置くだけ。** 再描画・再着色しない（`RENDER-LOGO-INTACT`）。
- **フォントファイルをコミットしない。** R2 に置き、README に入手元と権利の確認を書く。
- **HTML を組む関数は 1 つ。** Worker とローカル描画器で別実装にしない。理由: Skill で通った画像が Worker で変わる経路を塞ぐ。
- **connpass 用は 1 MB 以下。** 超えたら `failed` で止め、黙って別サイズにしない。
- **既存 Skill（`connpass-session-list-image` 等）を変更しない。** 関数の移植はコピーで。
- 動画、印刷入稿、Figma 連携、Instagram API は作らない（overview §11）。
- **当日実況の本文に LLM を必須にしない。** タイムテーブルだけで全件が成立する。理由: 当日の変更に即応できるのは機械生成だけ。

## Files to touch — 変更ファイル

### `skills/`（サブモジュール）

- `pr-playbook/templates/images/<id>/{template.html,slots.schema.json,README.md}`（§1 の 9 本）
- `pr-playbook/scripts/render/{image-html.mjs,image-html.test.mjs,images.mjs,checks-script.js}`（`checks-script.js` はテンプレートに
  インライン展開される検査スクリプト。1 本を共有）
- `pr-playbook/rules.json`（`render` ルール 6 本）、`constants.json`（`render.*`、`images.*`、`live.*`: 絵文字と定型）、`guides/thumbnail.md`（縮小表示の節を追記。Tips 5）、`guides/live.md`（当日実況の型。Tips 22）
- `pr-asset/{SKILL.md,agents/openai.yaml,references/output.schema.json,references/example-output.json}`
- `pr-playbook/scripts/checks/asset-spec.mjs`（Stage 00 の雛形を実装に）

### `packages/gdg-lib/`

- `src/pr-rpc.ts`（`TinyurlUpdateLinkInput`）

### `apps/tinyurl/`

- `workers/app.ts`、`app/features/links/pr-service.server.ts`（`updateLink` の追加）と `*.test.ts`

### `apps/pr/`

- `wrangler.toml`（`[browser]`、`[[r2_buckets]] ASSETS`、`[[services]] IMG_UPLOAD`）、`.dev.vars.example`（`FONT_URL_SIGNING_KEY`）
- `migrations/0004_assets.sql`、`schema.sql`
- `app/features/assets/{asset.ts,asset.repository.server.ts,render.server.ts,render.test.ts,checks.server.ts,distribute.server.ts,distribute.test.ts,fonts.server.ts,components/AssetView.tsx,components/SlotEditor.tsx}`
- `app/features/live/{live-posts-from-timetable.ts,live-posts-from-timetable.test.ts,generate.server.ts,components/LiveTimeline.tsx,components/PhotographerAssign.tsx}`
- `app/routes/live/timeline.tsx`
- `app/features/jobs/bundle.server.ts`、`complete.server.ts`（`asset`）
- `app/features/dispatch/dispatch.server.ts`（`attachMedia`、asset 未承認の拒否）
- `app/routes/assets/{list.tsx,detail.tsx}`、`app/routes/assets-fonts.ts`（`/assets/fonts/:file`）、`app/routes/drafts/detail.tsx`、`app/routes/campaigns/settings.tsx`、`app/routes.ts`
- `tests/architecture/route-urls.test.ts`、`ARCHITECTURE.md`、`README.md`（フォントの配置手順）

### `apps/cli/`

- `internal/pr/runner/runner.go`（`asset` の登録）

## Verification — 完了条件と検証

### 完了条件

1. ローカル描画器で 9 テンプレート × 例スロットの PNG が出て、`checks.json` の MUST が全件 pass（意図的に長い文言では
   `RENDER-NO-OVERFLOW` / `RENDER-MIN-FONT` が fail）。
2. Worker で `asset` ジョブ → `assets` 行に R2 キーと `checks` が入り、画面で 1x / 縮小 / 2x が見える。
3. 承認で img.gdgs.jp に上がり、OGP が tinyurl のリンクに付き、`x_post` の配信で sns に画像が添付される。
4. `connpass-thumbnail` の JPEG が 1 MB 以下で `CONNPASS.uploadImage` に渡る。
5. asset が未承認の `x_post` draft は承認できない。
6. DevFest Kansai 2026 の `timetable.json`（Stage 00 の `examples/`）から実況投稿を生成すると、議事録の「当日実況」タブと同じ件数・順序・時刻の
   投稿ができ、`⚠️` / `🌐` / `📍` の注記が `flags` から付く。

### コマンド

```sh
cd skills && node --test pr-playbook/scripts/render/ && node pr-playbook/scripts/validate.mjs && cd ..
node skills/pr-playbook/scripts/render/images.mjs --template x-post-16x9 --slots skills/pr-asset/references/example-output.json --skin skills/pr-playbook/templates/connpass-page/skins/devfest-kansai-2026.json --out /tmp/pr-assets
pnpm --filter @gdgjp/tinyurl test
pnpm --filter @gdgjp/pr migrate:local && pnpm --filter @gdgjp/pr cf-typegen && pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **`image-html.mjs` の決定性**: 同じ入力から同じ HTML（Worker とローカルの差分検出の前提）
- **`checks-script.js` の単体**: Playwright で固定 HTML を開き、はみ出し / 最小フォント / コントラスト / ロゴ比率の各ケースで期待の `status`
- **`RENDER-LOGO-INTACT`**: `transform: rotate(1deg)` を足したテンプレートで fail
- **JPEG の品質降下ループ**: 1 MB を超える入力で `quality` が 60 まで下がり、それでも超えたら `failed`（無限ループと黙ったリサイズの両方を防ぐ）
- **配信ガード**: `attachment.kind = image` で asset 未承認の draft は `approve` が拒否される
- **フォント URL の署名**: 署名無し / 期限切れは 403
- **`updateLink`（tinyurl）**: 他チャプターのリンクは forbidden
- **既存 Skill の不変**: `skills/connpass-session-list-image/` に差分が無い（`git diff --stat` を CI 外で確認）
- **実況生成の決定性**: 同じ brief から同じ投稿列。`sessions` の順序を入れ替えても時刻順に並ぶ。`streamUrls` が無いトラックでは `📺` 行が出ない
- **実況のルール**: 生成した投稿が `X-NO-HASHTAG` の対象外で `LIVE-EVENT-HASHTAG` を pass する

### 手動 E2E

1. R2 `ASSETS` に `fonts/` を置く（README の手順）。pr の `[browser]` を有効にしてデプロイ（Browser Rendering はローカルで動かない。
   ローカルは `remoteBindings` か `images.mjs` で代替）。
2. `/c/:slug/settings` で「サムネイルを作る」→ runner → `/c/:slug/assets/:id` で縮小表示の可読性を見る。
3. 文言を長くして再描画 → `RENDER-NO-OVERFLOW` が赤。`titleScale` を下げて pass。
4. 承認 → img.gdgs.jp の URL が付く → connpass のドラフトイベントにサムネイルが上がる。
5. `x_post` draft（`attachment.kind = image`）で「画像を作る」→ 承認 → 投稿 draft を承認 → sns の投稿に画像。
6. OGP 無しで短縮リンクを作る経路（`attachment.kind = ogp`）で `ogp-1200x630` が自動で積まれ、承認後にリンクの OGP に入る。
