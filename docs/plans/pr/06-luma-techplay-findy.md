# Stage 05 — 媒体拡張: `apps/connpass` に Luma イベント・Techplay・Findy Conference（フォーム送信）を足し、pr から掲載する

## Context — 背景とリポジトリ状況

### なぜやるか

全体計画は [`00-overview.md`](00-overview.md)。**着手前に必ず読むこと。** 媒体の優先順位は connpass → X → Instagram →
フライヤー → Luma / Techplay / Findy（Tips 25）。本ステージはその最後の 3 媒体。

`apps/connpass` は connpass の一部機能と Luma の**受付（チェックイン）**にしか対応していない。Luma へのイベント掲載、
Techplay への掲載、Findy Conference への掲載（フォーム送信）は未対応で、ユーザーが手でやっている。
このステージで 3 媒体の掲載を `apps/connpass` のジョブとして足し、pr のスケジュール（`luma_publish` / `techplay_publish` /
`findy_submit`）から承認で流せるようにする。

掲載文はコピーと brief から**機械的に**組む（LLM は使わない）。理由: 3 媒体とも「connpass と同じ事実を、各媒体の
フィールドに写す」作業であり、Tips に媒体別のコピー規則が無い。文章が要る箇所は採用済みコピーと 3 行概要を流用する。

### 依存と対象範囲

- 依存: Stage 04（`CONNPASS.PrService`、`assertPrActorForGroup`、`connpass_page` draft の `summary` / `title`）、Stage 03（配信の形）。
- 対象: `apps/connpass/`（新 feature `luma/events`、`techplay/`、`findy/`、ジョブ種別、ルート、allowlist）、`apps/pr/`
  （`listing` 下書き、3 kind の配信）、`packages/gdg-lib/src/pr-rpc.ts`。
- Playbook は変更しない（Tips に無い）。`guides/channels.md` の 3 媒体の段落を参照するだけ。

### 事前確認（実装前に必ず。通らなければ止まって報告する）

各媒体は「公式 API があるか」「無ければ Browser Run で自動化できるか」が実装前に決まらない。**最初に次を確認し、
結果を本ファイルの §1 の表に書き戻してから実装する。**

1. **Luma。** (a) チャプターの Luma が Luma Plus（公式 API `api.lu.ma/public/v1` の `event/create` / `event/update` が使える）か。
   使えるなら API キーを `LUMA_API_KEY` に置き、`lumaClient`（内部 API、bot のパスワード）は**使わない**。
   (b) Plus でなければ、既存の `lumaClient` が叩く `api.luma.com` の内部 API にイベント作成・更新があるかを、ブラウザの
   ネットワークタブで観察して確認する。(c) どちらも無理なら luma.com を Browser Run で操作する（connpass と同じ形）。
   内部 API は予告なく変わるので、(b) を選ぶ場合は README に「壊れたら (c) に落とす」と書く。
2. **Techplay。** 主催者向け API が無いことを確認し、Browser Run で操作する前提で、bot アカウント（`TECHPLAY_BOT_EMAIL` /
   `TECHPLAY_BOT_PASSWORD`、チャプターの共有アカウント）でイベント作成画面の HTML を取得し、`fixtures/html/techplay/` に置く。
   連続操作（ログイン → 作成 → 保存）が bot 検知で止まらないことをドラフト（非公開）で確認する。
3. **Findy Conference。** 掲載申請フォームの URL と項目（イベント名、日時、会場、URL、概要、主催者、連絡先 …）を
   ユーザーから受け取り、`fixtures/html/findy/` に保存する。Google Form なら Browser Run で `fill`、Findy 独自フォームなら
   その DOM に合わせる。**送信は 1 回限りで取り消せない**ので、ライブテストは「送信ボタンの直前で止める」モードを持つ。
4. 3 サイトの利用規約で自動操作が禁止されていないか、connpass と同じ基準で確認する（主催者自身の操作を bot が代行する範囲）。
5. **Bevy。** GDG チャプターの公式イベント登録（DevFest 2026 ではプレイベントも Bevy に登録した）。管理 API の有無と、組織アカウントでの
   Browser Run の可否を確認する。不可なら `bevy_publish` は人の作業のまま（pr はチェックリストと入力値の下書きだけ）。
6. **Luma の有料枠。** DevFest 2026 の懇親会は Luma + Stripe 事前決済、社会人 / 学生の 2 枠、既存申込者へのメール案内で運用した。
   方式 (a)〜(c) のどれでも「枠の種類・価格・決済」を作れるかを確認し、作れなければ Luma は無料枠だけを対象にして報告する。

### 読むべきもの

- `apps/connpass/CLAUDE.md`、`ARCHITECTURE.md` — ジョブ基盤、Browser Run、bot セッション、ライブテストの切り替え
- `apps/connpass/app/features/luma/{client.server.ts,checkin.server.ts,checkin-url.ts}` — `lumaClient`（`SESSION_KV` のセッションと
  パスワード再ログイン）、`luma_calendars` の allowlist
- `apps/connpass/app/features/connpass/{browser.server.ts,session.server.ts,ui/event-widgets.ts,ui/event-write.ts,ui/selectors.ts}` —
  Browser Run のページ取得、KV の bot セッション、フォーム操作の部品。Techplay / Findy はこれを**手本に別 feature** として書く
- `apps/connpass/app/features/jobs/{job-types.ts,job-runner.server.ts}` — 種別の追加と dispatch の形
- `apps/connpass/app/routes/api/admin/{groups.ts,luma-calendars.ts}` と `openapi/openapi.yaml` — allowlist の管理ルートと API 定義
- `apps/connpass/fixtures/html/` — セレクタの fixture の置き方
- Stage 04 の `apps/connpass/app/features/auth/rpc-access.server.ts`、`workers/app.ts` の `PrService`

### 再利用する既存実装（書き直さない）

- `apps/connpass` のジョブ基盤、`createJob`、Queue の ack / retry、`job-presentation.ts`
- `lumaClient` の「KV セッション + 401 で 1 回だけ再ログイン」の形 — Techplay のセッション管理に同じ形を**別モジュールで**作る
  （Luma の実装を Techplay に流用して分岐を増やさない）
- `luma_calendars`（calendar → chapter）の allowlist と `PUT /api/admin/luma-calendars/:calendarId` — Luma の掲載先はここで許可する
- `event-widgets.ts` の `openUntilVisible` / `clickScopedSave` / `closeDateTimePickers` — Techplay のフォーム操作で**使えるものだけ**使う

## Design — 設計

### 1. 媒体ごとの方式（事前確認の結果で確定する）

| 媒体 | 方式（候補） | 認証 | 許可リスト | ジョブ種別 |
|---|---|---|---|---|
| Luma | 公式 API（Plus）/ 内部 API / Browser Run | `LUMA_API_KEY` または既存 bot | `luma_calendars` | `luma_create_event`, `luma_update_event`, `luma_publish_event` |
| Techplay | Browser Run | `TECHPLAY_BOT_EMAIL` / `TECHPLAY_BOT_PASSWORD`、セッションは `SESSION_KV` | `techplay_organizers`（新規: organizer id → chapter） | `techplay_create_event`, `techplay_update_event`, `techplay_publish_event` |
| Findy Conference | Browser Run（フォーム） | 不要（公開フォーム） | 不要（actor のチャプター判定のみ） | `findy_submit_form` |
| Bevy（GDG 公式。プレイベントと本番の登録） | 事前確認 5 で決める（Browser Run か、MVP は人の作業のチェックリスト `bevy_publish`） | チャプターの organizer アカウント | `bevy_chapters`（新規） | `bevy_create_event`（方式次第） |

事前確認で決めた方式を**この表に書き戻し**、他の候補の実装は作らない。

**現状（2026-11-07）: 4 媒体とも方式は未決定。** 事前確認 1〜6 はユーザーの入力が要る（Luma Plus か、TECH PLAY の bot
資格情報と作成画面の HTML、Findy の申請フォーム URL、利用規約の確認、Bevy の可否）。それまでの実装は次のとおり:
`apps/connpass` の `listings/listing.ts`（共通モデルの検証、`LISTING_METHODS` は全部 `undecided`）と `PrService.createListing`
（検証のあと `not_supported`）。pr は brief から掲載文を組み、承認後は「コピーして手で掲載 → 手で掲載した」で完了にする。
方式が決まったら、その媒体の `LISTING_METHODS` と job 種別だけを足す。

### 2. 共通の掲載モデル（`packages/gdg-lib/src/pr-rpc.ts` と `apps/connpass/app/features/listings/listing.ts`）

```ts
export type EventListing = {
  mode: "mirror" | "pointer";       // mirror: その媒体で申込を受ける / pointer: connpass へ誘導する
  tickets?: { name: string; priceYen: number; capacity?: number; audience?: string }[];   // Luma の有料枠（事前確認 6）
  title: string; subtitle?: string;
  summary: string;                  // 3 行概要（connpass_page draft の summary）
  description: string;              // Markdown か素のテキスト。媒体が HTML を許す場合も HTML は送らない
  startAt: string; endAt: string;   // ISO instant
  venue: { name: string; address?: string; online?: boolean };
  capacity?: number; fee?: number;
  registrationUrl?: string;         // pointer のときの connpass URL（短縮リンクでもよい）
  imageUrl?: string;                // サムネイル（Stage 06 の asset か手動）
  organizer: { name: string; contactEmail?: string };
  tags?: string[];
};
```

媒体ごとの写像（`luma/mapping.ts`、`techplay/mapping.ts`、`findy/mapping.ts`）は純関数で、`EventListing → その媒体の
フィールド` を返す。媒体に無いフィールドは落とし、必須が欠けていれば `{ error: "missing:<field>" }` を返す（ジョブを積む前に弾く）。

### 3. `apps/connpass` の feature

```
app/features/luma/
  events.server.ts        方式に応じた create / update / publish。公式 API なら fetch、内部 API なら lumaClient、Browser Run なら ui/
  mapping.ts, mapping.test.ts
app/features/techplay/
  session.server.ts       bot ログインと SESSION_KV のセッション（lumaClient と同じ形、別実装）
  ui/{selectors.ts,event-write.ts,event-read.ts}
  events.server.ts, mapping.ts, mapping.test.ts
app/features/findy/
  ui/form.ts              フォームの fill と「送信直前で止める」モード
  submit.server.ts, mapping.ts, mapping.test.ts
app/features/jobs/job-types.ts     種別の追加（§1）
app/features/jobs/job-runner.server.ts   dispatch の追加（既存の分岐と同じ形。媒体ごとに 1 関数に委譲し、runner 本体を太らせない）
```

ルート（Bearer、既存の形に倣う）:

| パス | 内容 |
|---|---|
| `POST /api/luma/calendars/:calendarId/events` / `PATCH …/:eventId` / `POST …/:eventId/publish` | Luma |
| `POST /api/techplay/organizers/:organizerId/events` / `PATCH …/:eventId` / `POST …/:eventId/publish` | Techplay |
| `PUT /api/admin/techplay-organizers/:organizerId` | allowlist |
| `POST /api/findy/submissions`（`dryRun: true` で送信直前まで） | Findy |

`PrService` に `createListing({ actor, platform, target, listing })` / `updateListing` / `publishListing` / `submitForm` を追加。
`openapi/openapi.yaml` にも載せる（`pnpm --filter @gdgjp/connpass openapi` 系のスクリプトがあればそれで生成）。

### 4. pr 側

- `drafts.kind = "listing"`（`content = { platform, listing: EventListing }`）。**ジョブは積まない。** `features/listings/from-brief.ts` が
  brief + 採用コピー + `connpass_page` draft の `summary` から `EventListing` を組み、人が編集して承認する。
- `schedule_items.kind`: `luma_publish` / `techplay_publish` / `findy_submit`（Stage 01 の集合に既にある）。計画（`pr-plan`）が
  これらを出していれば draft を自動作成、無ければスケジュール画面から手で追加。
- 承認時の配信（Stage 03 の形）: `CONNPASS.createListing(...)` → `external_ref = { jobId, platform }` → `scheduled`。毎時 cron で
  `getJob` → `done` / `failed`。`publish` は別ボタン（確認ダイアログ）。`findy_submit` は**承認 = 送信**で、確認ダイアログに
  「取り消せません」を出す。
- `/c/:slug/settings` に Luma カレンダー id / Techplay organizer id / Bevy チャプター id を追加。
- 懇親会のように「connpass から Luma へ誘導する」運用では、Stage 04 の `participant-guide` セクションと `connpass_mail` に Luma の
  URL を入れる `listing.pointerFrom = connpass` の形を持つ。
- 画像: `listing.imageUrl` は Stage 06 の asset か手動 URL。Luma / Techplay の画像仕様（比率・サイズ）は事前確認で分かった値を
  `constants.listings.<platform>.image` に入れる（Stage 06 のテンプレートが読む）。

### 制約

- **方式は事前確認で 1 つに決め、他を実装しない。** 理由: 3 媒体 × 3 方式の分岐が `job-runner` を肥大化させる。
- **bot の資格情報は `apps/connpass` の secret だけに置く。** pr には一切置かない。
- **Findy の送信は冪等でない。** `dispatching` ガードに加え、同じキャンペーンで `findy_submit` が `done` なら 2 件目の承認を拒否する。
- **HTML を媒体に送らない。** `description` は Markdown か素のテキスト。理由: 媒体ごとのサニタイザを調べない。
- **Luma の内部 API を選んだ場合、エンドポイントとペイロードを 1 ファイル（`luma/internal-api.ts`）に閉じ込める。** 壊れたときに
  差し替える場所を 1 つにする。
- `apps/connpass` の既存ルート・既存ジョブの挙動を変えない。`architecture.test.ts` の公開ルート集合は**追加のみ**。
- LLM を使わない。文章が足りなければ人が draft を直す。

## Files to touch — 変更ファイル

### `packages/gdg-lib/`

- `src/pr-rpc.ts`（`EventListing`、`createListing` 系の型）

### `apps/connpass/`

- `app/features/listings/{listing.ts,listing.test.ts}`（新規）
- `app/features/luma/{events.server.ts,mapping.ts,mapping.test.ts}`（新規。方式次第で `internal-api.ts` か `ui/`）
- `app/features/techplay/{session.server.ts,events.server.ts,mapping.ts,mapping.test.ts,ui/selectors.ts,ui/event-write.ts,ui/event-read.ts,ui/event-write.test.ts}`（新規）
- `app/features/findy/{submit.server.ts,mapping.ts,mapping.test.ts,ui/form.ts,ui/form.test.ts}`（新規）
- `app/features/jobs/{job-types.ts,job-runner.server.ts,pr-service.server.ts}`
- `app/features/auth/authorize.server.ts`（`techplay_organizers` の allowlist）
- `app/routes/api/luma/*.ts`、`app/routes/api/techplay/*.ts`、`app/routes/api/findy/submissions.ts`、`app/routes/api/admin/techplay-organizers.ts`、`app/routes.ts`
- `migrations/000N_techplay_organizers.sql`、`schema.sql`
- `fixtures/html/{techplay,findy,luma}/`（新規）
- `openapi/openapi.yaml`、`openapi/paths/*`、`types.generated.ts`（生成）
- `wrangler.toml`（secret の注記）、`.dev.vars.example`（`LUMA_API_KEY` または既存、`TECHPLAY_BOT_EMAIL` / `TECHPLAY_BOT_PASSWORD`）
- `workers/app.ts`（`PrService` のメソッド追加）
- `CLAUDE.md`、`ARCHITECTURE.md`、`app/features/architecture.test.ts`
- `e2e/`（allowlist と入力検証の e2e、ライブは `CONNPASS_E2E_LIVE` 系の変数で分岐）

### `apps/pr/`

- `app/features/listings/{from-brief.ts,from-brief.test.ts,dispatch.server.ts,dispatch.test.ts,components/ListingForm.tsx}`
- `app/routes/drafts/detail.tsx`（kind = listing）、`app/routes/campaigns/settings.tsx`、`app/routes/schedule/calendar.tsx`
- `workers/app.ts`（毎時 cron の追従にプラットフォームを追加）
- `ARCHITECTURE.md`

## Verification — 完了条件と検証

### 完了条件

1. 事前確認 1〜4 の結果が §1 の表に書き戻され、選ばなかった方式のコードが無い。
2. `mapping.test.ts` が 3 媒体で「必須欠けは `missing:<field>`」「`pointer` のとき `registrationUrl` が必須」を示す。
3. ライブ（各媒体のドラフト / 非公開）で: Luma にイベントが作られ更新できる、Techplay にドラフトが作られる、Findy は
   `dryRun` で送信直前まで埋まる。
4. pr で `listing` draft を承認すると `apps/connpass` のジョブが積まれ、毎時 cron で `done` になる。
5. `findy_submit` は同一キャンペーンで 2 回目の承認が拒否される。

### コマンド

```sh
pnpm --filter @gdgjp/gdg-lib typecheck
pnpm --filter @gdgjp/connpass migrate:local
pnpm --filter @gdgjp/connpass test && pnpm --filter @gdgjp/connpass typecheck && pnpm --filter @gdgjp/connpass test:e2e
CONNPASS_E2E_LIVE=1 TECHPLAY_E2E_LIVE=1 LUMA_E2E_LIVE=1 pnpm --filter @gdgjp/connpass test:e2e:live   # ドラフトのみ。Findy は dryRun
pnpm --filter @gdgjp/pr test && pnpm --filter @gdgjp/pr typecheck
pnpm ci:quick
```

### 回帰として固定すべきテスト

- **セレクタの fixture テスト**（Techplay / Findy）: `fixtures/html/` の HTML に対して `selectors.ts` の全セレクタが 1 件以上ヒットする
  （サイト改修で静かに no-op になる経路。connpass の `event-fields.test.ts` と同じ考え）
- **Findy の `dryRun`**: `dryRun: true` で送信ボタンの click が呼ばれない（モック Page で検証）
- **`findy_submit` の 2 回目拒否**（pr 側）
- **Luma の方式が 1 つ**: `luma/` 配下に `internal-api.ts` と `ui/` が同時に存在しない（アーキテクチャテストで固定）
- **`job-runner.server.ts` の分岐が媒体ごとの 1 関数委譲**（400 行上限のテストがあればそれで、無ければ関数の存在をテスト）
- **`architecture.test.ts` の公開ルート集合**（追加分を含めて固定）
- **資格情報の所在**: pr の `wrangler.toml` / `.dev.vars.example` に `TECHPLAY_*` / `LUMA_*` が無い

### 手動 E2E

1. 事前確認 1〜4 を済ませ、§1 の表を確定する。
2. connpass アプリの dev サーバに bot 資格情報を入れ、`PUT /api/admin/luma-calendars/:id` と `PUT /api/admin/techplay-organizers/:id` で許可。
3. pr の `/c/:slug/settings` に Luma カレンダー id と Techplay organizer id を入れる。
4. スケジュールに `luma_publish` を追加 → `listing` draft が `from-brief` で埋まる → 編集 → 承認 → Luma のドラフトを確認。
5. `techplay_publish` も同様。`findy_submit` は `dryRun` で止め、フォームの内容を目視してから本番送信は**ユーザーが**ボタンを押す。
