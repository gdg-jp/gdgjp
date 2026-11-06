# Stage 04 — connpass: ページテンプレートと `page` ジョブ、プレビュー、`CONNPASS.PrService`（説明・画像・アンケート・メール）

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** connpass ページの考え方は overview §7、
Tips 5〜7 / 10〜11 / 13 は [`01-playbook-and-skills.md`](01-playbook-and-skills.md) の「元の Tips」。

connpass は媒体の最優先（Tips 25）。このステージで、採用したコピーと brief から **connpass の説明 HTML を
テンプレートのスロット埋めで生成し**、connpass 風にプレビューし、承認で `apps/connpass` のジョブ経由で反映する。
あわせて属性アンケート（Tips 13）と connpass メール（Tips 10〜11）も pr から出せるようにする。

HTML は **AI に書かせない。** AI はスロットの文言を返し、描画器（依存ゼロの ESM、Skill からも Worker からも同じもの）が
`connpass-syntax` の許可リストの中で HTML を組む。DevFest Kansai 2026 のページを分解したセクションがテンプレートになる。

### 依存と対象範囲

- 依存: Stage 02（ジョブ、drafts、承認）、Stage 03（RPC の型と形、`actor_snapshot`、`dispatching` ガード、cron）、
  Stage 00（`pr-connpass-page` / `pr-connpass-mail` Skill、`connpass-html.mjs`、`examples/connpass-page/devfest-kansai-2026/`、
  `constants.channelLabels`）。
- 対象: `skills/pr-playbook/templates/connpass-page/`（gdg-jp/skills サブモジュール）、`apps/connpass/`（`PrService` の追加だけ）、
  `apps/pr/`（`page` ジョブの束と取り込み、描画、プレビュー、connpass への反映）、`apps/cli/internal/pr/runner/`（`page` の型登録のみ）。
- Luma / Techplay / Findy は Stage 05。画像の自動生成は Stage 06（本ステージは**手でアップロードした画像**を使う）。

### 事前確認（実装前に必ず）

1. **connpass の説明欄に 100 KB 超の HTML を Browser Run で `fill` できること。** DevFest Kansai 2026 の `connpass.html` は 111 KB。
   `apps/connpass` のライブテスト（`CONNPASS_E2E_LIVE=1`、未公開のドラフトイベント）で `update_event` に実物を流し、保存後に
   `getEvent` で戻る本文が欠けていないことを確認する。長さ制限があればその値を Playbook の `constants.connpass.maxDescriptionBytes`
   に入れる（`provisional` ではない。実測）。
2. `upload_event_image` は PNG / JPEG / GIF、**1 MB 以下**（`apps/connpass/app/routes/api/events/image.ts`）。サムネイルの
   手動アップロードもこの制限で弾く。
3. bot アカウントが対象グループの管理者で、`groups` の allowlist に `chapter_id` 付きで登録されていること
   （`apps/connpass/CLAUDE.md`、`PUT /api/admin/groups/:groupId`）。共催チャプターのグループ（oC Osaka / Kobe / Kyoto、GDG Osaka / Kyoto / Nara）も
   同じ allowlist に**それぞれのチャプター id** で登録する。
4. **グループのメンバー宛メッセージ**（イベント参加者宛ではなく、connpass グループの登録メンバー宛）を connpass の管理画面が持つか、
   `apps/connpass` のジョブ `send_event_message` がそれを扱えるかを確認する。無ければ `send_group_message` ジョブを足す（Browser Run。
   `fixtures/html/` にその画面を追加）。DevFest 2026 は 7 グループからメールを送った（[`00a`](00a-devfest-2026-usecase-review.md) §2-4）。

### 読むべきもの

- `skills/connpass-syntax/references/syntax.md` — 許可タグ・属性・22 プロパティ。**描画器が出してよいものの全部**
- `skills/connpass-decent-description/references/design-guidelines.md`、`assets/{conference-template.html,meetup-template.html}` —
  パネル（白地 + `2px solid #1E1E1E`）、見出しステッカー、開催概要の `font-size:14px`、表のセルだけに色、末尾は飾らない
- `skills/pr-playbook/examples/connpass-page/devfest-kansai-2026/connpass.html` — 分解元。hero → セッション一覧画像 → 開催概要
  （色付き左罫線の行）→ メインコピー見出し + 概要 → 企画セクション → おすすめ → タイムテーブル画像 → スポンサー → プレイベント
- `skills/pr-{connpass-page,connpass-mail}/SKILL.md` と `references/output.schema.json`（Stage 00）
- `apps/connpass/app/features/connpass/event-fields.ts` — `EventEditFields`（`title`, `subtitle`, `description`, …）。
  **pr はこの契約の中だけを書く**
- `apps/connpass/app/features/jobs/{job-types.ts,job-submission.server.ts,job-repository.server.ts}` — `createJob(env, input, ctx)` と `JobRecord`
- `apps/connpass/app/routes/api/events/{detail.ts,image.ts,survey.ts,messages.ts,publish.ts,stats.ts}` — 既存 HTTP ルートの
  入力の形。`PrService` は同じ入力で同じ `createJob` を呼ぶ
- `apps/connpass/app/features/auth/{authorize.server.ts,event-route.server.ts}` — `getAllowedGroup` / `canReadGroup` / `canWriteGroup`
- `apps/connpass/app/features/connpass/ui/survey.ts` — `SurveyQuestion = { title, answerType, required, options }`
- `apps/connpass/app/features/connpass/ui/sub-events.ts` と `app/routes/api/events/sub-events.ts` — `create_sub_event` の入力（座談会・ハンズオンのサブイベント）
- Stage 03 の `apps/sns/app/features/auth/rpc-access.server.ts` — `assertPrActor` の形を connpass にも作る

### 再利用する既存実装（書き直さない）

- `apps/connpass` のジョブ基盤（`createJob` → Queue → `job-runner.server.ts` → Browser Run）。**pr から connpass.com に直接触らない**
- `apps/connpass/app/routes/api/events/image.ts` の R2 `ARTIFACTS` への一時保存 + `upload_event_image` の流れ
- `skills/pr-playbook/scripts/checks/connpass-html.mjs`（Stage 00）— 描画器の出力をこれで検査する
- Stage 03 の `dispatch` の形（`dispatching` ガード、`dispatch_log`、`actor_snapshot`）

## Design — 設計

### 1. テンプレート（`skills/pr-playbook/templates/connpass-page/`）

```
templates/connpass-page/
  README.md                 セクション一覧、スロット契約の読み方、skin の変数
  page.schema.json          sections[] のスロット契約（JSON Schema）。pr-connpass-page の output.schema.json から $ref
  skin.schema.json          { bg, panelBg, keyline, accent[], text, headingSticker? }。既定は gdg-design（Off White + Black 02）、DevFest Kansai 2026 skin も同梱
  sections/
    hero.html               画像 1 枚（+ リンク）。スロット: imageUrl, alt, linkUrl?
    summary.html            3 行概要。スロット: lines[3]
    overview.html           開催概要パネル。スロット: rows[]{ icon, label, value }（日時・時間・会場・形式・参加費）
    headline.html           メインコピー見出し + 本文 2 段落 + 一言。スロット: mainCopy, paragraphs[2], callout
    feature.html            企画セクション（学生展示など）。スロット: heading, body, imageUrl?, ctaLabel?, ctaUrl?
    audience.html           こんな方におすすめ。スロット: items[]
    sessions-image.html     セッション一覧画像。スロット: imageUrl, alt
    timetable-image.html    タイムテーブル画像。スロット: imageUrl, alt, note
    speakers.html           登壇者カード（表組み）。スロット: speakers[]{ name, role, imageUrl?, sessionTitle }
    venue.html              会場。スロット: name, address, access[], mapUrl?
    sponsors.html           スポンサー。スロット: sponsors[]{ name, tier?, logoUrl, description, links[] }
    links.html              X / Instagram / 公式。スロット: links[]{ label, url }
    faq.html                スロット: items[]{ q, a }
    plain.html              飾らない末尾セクション（主催・CoC 等）。スロット: heading, markdown
    sessions-list.html      セッションの表組み（画像を作る前・補助用）。スロット: sessions[]{ title, speaker, track, time, tags[] }。tags は「初心者 OK」「ハンズオン」「英語」「録画 NG」など
    participant-guide.html  参加者への導線。スロット: discordInviteUrl?, streamUrls?, slidesUrl?, calendarUrl?（DevFest 2026 で「概要が空白で Discord への流入経路が無かった」）
```

テンプレート言語は `{{slot}}` / `{{#each items}}…{{/each}}` / `{{#if x}}…{{/if}}` だけの最小実装（`scripts/render/template.mjs`、
依存ゼロ）。値は HTML エスケープし、URL は `https?://` 以外を捨てる。skin の色は `style` 属性の中に埋める
（`background-color:{{skin.bg}}`）。**出てよいタグ・属性・CSS は `connpass-html.mjs` の表と同じ**で、描画器のテストが
全セクションの出力を同検査に通す。

### 2. 描画器（`skills/pr-playbook/scripts/render/connpass-page.mjs`）

`renderConnpassPage({ sections: [{ id, slots }], skin, summary, title }) → { html, warnings[] }`。
順序は入力どおり。`summary` は Markdown のまま先頭に置き（connpass は Markdown + HTML を混在できる）、残りを HTML で組む。
`warnings` には「スロット超過（`maxLength`）」「画像が無いセクションをスキップ」を入れる。
Skill からは `node scripts/render/connpass-page.mjs --input page.json --out connpass.html` で使える。

### 3. `page` ジョブ

| 項目 | 内容 |
|---|---|
| type / payload | `page` / `{ kind: "connpass_page" \| "connpass_mail", briefVersion, planVersion, copyDraftId, imageUrls?: { hero?, sessionList?, timetable? }, instructions? }` |
| Skill | `kind` で `pr-connpass-page` か `pr-connpass-mail` |
| 束の追加分 | `COPY.json`（採用コピー）、`TEMPLATES/connpass-page/{README.md,page.schema.json,sections/*.html}`、`EXAMPLES/connpass-page/devfest-kansai-2026/`、`IMAGES.json`（手でアップロード済みの画像 URL） |
| 出力 | `pr-connpass-page` の schema: `title, summary, sections[]{ id, heading, slots }, html, imageSlots[], surveyQuestions[], participantOnlyInfo`（connpass の「参加者への情報」欄。配信 URL・Discord・資料の案内）/ `pr-connpass-mail` の schema |
| 取り込み | `sections[].slots` を `page.schema.json` で検証 → **Worker が描画器で `html` を作り直す**（agent の `html` は捨てる）→ `drafts(kind: connpass_page)` の版に `{ title, summary, sections, skin, html, imageSlots, surveyQuestions }` を保存 → 検査（`CP-SUMMARY-3-LINES`, `CP-HTML-ALLOWLIST`, `CP-TITLE-CONVEYS-CONTENT`, `BRAND-SKIN-DECLARED`, `JA-YOMIYASU`） |
| `imageSlots` | hero / セッション一覧 / タイムテーブル / 企画写真 など「ここに画像が要る」の一覧。Stage 06 がここから `asset` ジョブを起こす。本ステージでは draft 画面に URL 入力欄として出す |

優先度 5、タイムアウト 10 分。runner 側は Stage 02 の共通ハンドラに `page` を登録するだけ。

### 4. プレビュー（`/c/:slug/drafts/:id`、kind = connpass_page）

- `<iframe srcdoc>` に、connpass の説明欄を模した枠（本文幅 1000 px、フォントとリンク色は connpass 既定に寄せた最小 CSS）
  で `html` を入れる。**サニタイザの再現はしない**（許可リストは描画器が保証）。
- 幅の切り替え（1000 / 390 px）。img.gdgs.jp の画像はモバイルで `mobile` 版が返るので、そのまま見える。
- 右側にセクションの並べ替え・スロット編集（保存で `author: human` の新版 + 再描画 + 再検査）。
- 「HTML をコピー」（手で connpass に貼る逃げ道）。

### 5. `apps/connpass` の `PrService`（`workers/app.ts`）

```ts
export class PrService extends WorkerEntrypoint<Env> {
  getEvent({ actor, groupSlug, eventId })                       // 既存 detail と同じ同期読み取り
  updateEvent({ actor, groupSlug, eventId, fields })            // parseEventWriteFields → createJob(update_event)
  publishEvent({ actor, groupSlug, eventId })                   // createJob(publish_event)
  uploadImage({ actor, groupSlug, eventId, bytes, contentType, name })   // ≤1 MB 検証 → ARTIFACTS.put → createJob(upload_event_image)
  upsertSurvey({ actor, groupSlug, eventId, questions })        // parseQuestions と同じ検証 → createJob(upsert_survey)
  sendMessage({ actor, groupSlug, eventId, subject, body, recipients? })   // createJob(send_event_message)
  sendGroupMessage({ actor, groupSlug, subject, body })            // 事前確認 4 の結果で createJob(send_group_message)。無ければ未実装のまま
  createSubEvent({ actor, groupSlug, eventId, fields })             // createJob(create_sub_event)。座談会・ハンズオンの申込枠（抽選・優先当選は fields）
  getJob({ actor, jobId })                                      // jobToJson（redacted）
  getStats({ actor, groupSlug, eventId })                       // Stage 07 が使う
  listParticipants({ actor, groupSlug, eventId })               // Stage 07 が使う
}
```

`features/auth/rpc-access.server.ts` の `assertPrActorForGroup(env, actor, groupSlug, write)`: `getAllowedGroup` で `chapter_id` を
引き、`actor.chapters` にそのチャプターがあること（`write` なら `canWriteGroup` と同じ role 条件）を要求。
`createdBy = actor.user.id`。戻りは `{ ok: true, job: JobJson } | PrRpcFailure`。型は `packages/gdg-lib/src/pr-rpc.ts` に追記。

### 6. pr から connpass への反映（`features/connpass/`）

| 操作 | いつ | 何を |
|---|---|---|
| ページ反映 | `connpass_page` draft の**承認時** | `updateEvent({ fields: { title: draft.title, description: draft.html, participantOnlyInfo: draft.participantOnlyInfo } })`。`schedule_items` に `connpass_update` が無ければ作り、`external_ref = { jobId }`、`status = scheduled`。毎時 cron で `getJob` → `succeeded` なら `done` |
| サブイベント | `connpass_subevent` アイテムの承認 | `createSubEvent({ fields })`。`fields` は `plans.body.segmentContentIdeas` か人の入力（名前・枠数・抽選 / 先着・申込期限）。できた sub-event id を `external_ref` に |
| サムネイル | `/c/:slug/settings` の手動アップロード（本ステージ）/ Stage 06 の asset 承認時 | `uploadImage` |
| アンケート | 計画画面「アンケートを反映」 | `plans.body.surveyQuestions` を `SurveyQuestion[]` に写す。「知った場所」の `options` は `constants.channelLabels` の、計画で採用したチャネルの表示名。`required: true` |
| メール | `connpass_mail` draft 承認 → **`due_at` に cron が送る**（Tips 10 の時刻を守るため承認時に送らない） | 宛先は `campaign_accounts`（`kind = connpass_group`）ごとの `dispatch_targets`（Stage 03 と同じ形）。自チャプターのグループは `sendMessage` / `sendGroupMessage`、承認者がいない共催グループは `delegated` の依頼アイテム（文面コピー）。承認者の claims スナップショットを使う。`dispatching` ガード |
| 公開 | `/c/:slug/settings` の「公開」ボタン（確認ダイアログ） | `publishEvent`。`connpass_publish` アイテムを `done` に |

`campaigns.connpass_group_slug` / `connpass_event_id` が無ければ、どの操作も「設定が要る」で止める。イベントの新規作成
（`create_event`）は pr からはしない（タイトルだけの下書きが connpass に増えるのを避ける。人が connpass で作って id を入れる）。

### 7. 画面の変更

- `/c/:slug/plan`: 「connpass ページを作る」「メールを作る」「アンケートを反映」「サブイベントを作る」（`segmentContentIdeas` から）
- `/c/:slug/settings`: 配信先に `connpass_group` を追加（主催・共催のグループ）。グループ宛メールの可否（事前確認 4）を表示
- `/c/:slug/drafts/:id`: §4 のプレビューとスロット編集、`imageSlots` の URL 入力、承認時に「connpass に反映します（グループ / イベント id）」の確認
- `/c/:slug/settings`: サムネイル手動アップロード（1 MB 検証）、「公開」
- `/c/:slug/schedule`: `connpass_update` / `connpass_mail` の `external_ref`（connpass ジョブ id）と結果

### 制約

- **HTML は描画器だけが作る。** agent の `html` を connpass に送らない。理由: 許可リスト外の CSS は connpass に剥がされ、
  見た目が静かに崩れる。描画器 + `connpass-html.mjs` で構造的に保証する。
- **描画器が出すタグ・属性・CSS は `connpass-syntax` の表の中だけ。** テンプレートに `border-radius` や `width` を書かない。
- **connpass への書き込みは `apps/connpass` のジョブ経由。** pr に Browser Run を足さない。理由: bot セッションと再ログインは
  connpass アプリが持つ。
- **`EventEditFields` の外のフィールドを送らない。** `parseEventWriteFields` が弾く。
- **メールは `due_at` に送る。承認時に送らない。** 理由: Tips 10。
- **`create_event` を pr から呼ばない。** サブイベント（`create_sub_event`）は呼ぶ。
- **他チャプターのグループに主催側が送らない。** そのチャプターのメンバーの承認か依頼アイテム（Stage 03 と同じ）。
- Luma / Techplay / Findy（Stage 05）、画像の自動生成（Stage 06）、参加者の取り込み（Stage 07）には手を出さない。
  `listParticipants` / `getStats` の口だけ作る。

## Files to touch — 変更ファイル

### `skills/`（サブモジュール）

- `pr-playbook/templates/connpass-page/{README.md,page.schema.json,skin.schema.json}`、`sections/*.html`（§1 の 16 本）
- `pr-playbook/templates/connpass-page/skins/{gdg-default.json,devfest-kansai-2026.json}`
- `pr-playbook/scripts/render/{template.mjs,template.test.mjs,connpass-page.mjs,connpass-page.test.mjs}`
- `pr-connpass-page/SKILL.md`（描画器を使う手順に更新）、`references/output.schema.json`（`sections[].slots` を `page.schema.json` に `$ref`）
- `pr-playbook/scripts/checks/connpass-page.mjs`（`html` が描画器の出力と一致することを検査に追加）

### `packages/gdg-lib/`

- `src/pr-rpc.ts`（connpass の型を追記）

### `apps/connpass/`

- `workers/app.ts`（`PrService`）
- `app/features/auth/rpc-access.server.ts`（新規）と `*.test.ts`
- `app/features/jobs/pr-service.server.ts`（新規。各メソッドの実体）と `*.test.ts`
- `app/features/architecture.test.ts`（公開ルート集合は不変。Entrypoint の許可）

### `apps/pr/`

- `wrangler.toml`（`[[services]] CONNPASS`）
- `app/features/connpass/{page.server.ts,survey.server.ts,mail.server.ts,subevent.server.ts,publish.server.ts,poll.server.ts}` と `*.test.ts`
- `app/features/pages/{render.server.ts,preview.ts,components/ConnpassPreview.tsx,components/SectionEditor.tsx}`
- `app/features/jobs/bundle.server.ts`（`page` の束）、`complete.server.ts`（`page` の取り込み）
- `app/features/drafts/components/DraftView.tsx`（kind 分岐）
- `app/routes/plans/plan.tsx`、`app/routes/drafts/detail.tsx`、`app/routes/campaigns/settings.tsx`、`app/routes/schedule/calendar.tsx`
- `workers/app.ts`（毎時 cron に connpass ジョブの追従、毎分 cron にメール送信）
- `ARCHITECTURE.md`

### `apps/cli/`

- `internal/pr/runner/runner.go`（`page` の登録とタイムアウト）

## Verification — 完了条件と検証

### 完了条件

1. `renderConnpassPage` が 14 セクション全部の出力で `connpass-html.mjs` を pass し、DevFest Kansai 2026 の skin で組んだページが
   `examples/` の実物と同じセクション構成になる（目視 + スナップショット）。
2. ローカル runner で `page` ジョブを回すと、draft に `html` と `imageSlots` と `surveyQuestions` が入り、プレビューが connpass 風に出る。
3. 承認すると `apps/connpass` に `update_event` ジョブが積まれ、ライブテストのドラフトイベントで本文が置き換わる（事前確認 1）。
4. アンケート反映で、「知った場所」の選択肢が `constants.channelLabels` の文字列と一致する。
5. `connpass_mail` を承認しても即送信されず、`due_at` に送られる。共催グループ宛は共催メンバーの承認で送られ、承認者がいなければ依頼アイテムになる。
5b. 「サブイベントを作る」で connpass にサブイベントのドラフトができる。
5c. ページの `participant-guide` セクションと「参加者への情報」に Discord / 配信 / 資料の導線が入る。
6. 1 MB 超の画像は pr 側で弾かれる。

### コマンド

```sh
cd skills && node --test pr-playbook/scripts/render/ && node pr-playbook/scripts/validate.mjs && cd ..
pnpm --filter @gdgjp/gdg-lib typecheck
pnpm --filter @gdgjp/connpass test && pnpm --filter @gdgjp/connpass typecheck
pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
CONNPASS_E2E_LIVE=1 pnpm --filter @gdgjp/connpass test:e2e:live    # ドラフトイベントに対して。未公開のまま
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **描画器の許可リスト**: 全セクション × 全スロット埋めの出力が `connpass-html.mjs` で fail 0（テンプレートに 1 つでも許可外の
  CSS が入ると connpass で消える）
- **エスケープ**: スロット値の `<script>` と `javascript:` URL が無害化される
- **`html` の再生成**: `complete.server.ts` が agent の `html` を使わず、`sections` から描画した `html` を保存する（テストで agent の
  `html` に許可外 CSS を入れ、保存結果に無いことを確認）
- **メールの送信時刻**: 承認時に `sendMessage` が呼ばれず、`due_at` 経過後の cron で 1 回だけ呼ばれる
- **アンケートの選択肢**: `channelLabels` に無いチャネルが計画にあると反映が拒否される（文字列の不一致で tinyurl の対応付けが壊れる経路）
- **`assertPrActorForGroup`**: 他チャプターの group は forbidden、`write` は organizer 相当のみ
- **connpass の `architecture.test.ts`**: 公開ルート集合が変わらない

### 手動 E2E

1. Stage 03 までの環境に connpass の dev サーバ（:5179、bot 資格情報あり）を足す。
2. `/c/:slug/settings` に connpass のグループ slug と**未公開ドラフト**のイベント id を入れる。
3. 計画画面「connpass ページを作る」→ runner → draft。プレビューで 1000 / 390 px を確認。hero の画像 URL を入力。
4. 承認 → connpass の `/api/jobs/:id` が `succeeded` → connpass.com のドラフトで本文を確認（公式名の補い、3 行概要、パネル）。
5. 「アンケートを反映」→ connpass のアンケート編集画面で 4 問を確認。
6. 「メールを作る」→ 承認 → `due_at` を 1 分後に変える → cron → connpass のメッセージ送信ジョブ。
