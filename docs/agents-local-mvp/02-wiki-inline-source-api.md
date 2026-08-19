# Stage 02 — Wiki inline source API for conversation logs

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 08 で、xangi は Discord の会話ログを `agents-local/memories/` に書き出す。
その記憶を wiki のページに昇格させるとき、**ページ本文のスパンを `<acl src="…">` で
タグ付けするには、記憶がサーバ側の `sources` 行として存在している必要がある**
（`src` の値は `sources.id` であり、サーバはそれを引いて現在の `visibility` を評価する）。

しかし現行の `POST /api/agent/sources`（`wiki/app/routes/api.agent.sources.ts`）は
**URL しか受け取らない**。`createSource` が URL から `kind` を導出する作りで
（`wiki/app/lib/sources.server.ts:72` の `classifySourceUrl`）、
**本文を直接渡す経路が存在しない**。

会話ログは「取りに行く先」を持たない。既に手元に内容がある。
このステージで、本文を直接受け取って `sources` 行 + R2 の `source_documents` を作る
唯一の窓口を用意する。

### 依存と対象範囲

- 先行ステージ: なし。**Stage 01 / 03 と並行して着手できる。**
- 後続の Stage 08（エピソード記憶）と Stage 10（睡眠）が本ステージのエンドポイントを使う。
- 対象ワークスペースは `wiki/` のみ。`cli/` と `agents-local/` は触らない。
- **`<acl>` の自動挿入は Stage 06 の担当。ここでは扱わない。**
- **`memories/` の書き出しは Stage 08 の担当。ここでは扱わない。**

### 読むべきもの

- `wiki/CLAUDE.md` — Worker の 3 ハンドラ、bindings、Drizzle 運用、`schema.sql` が生成物であること
- `CLAUDE.md`（リポジトリ直下）— migrations の運用、Biome、E2E
- `docs/plans/01-sources-raw-layer.md` — `sources` / `source_documents` / R2 raw レイヤの前提
- `docs/plans/09-source-visibility-acl.md` — **特に「`createSource` を唯一の登録窓口に保つ」制約**
- `docs/agents-local-mvp/index.md` §7 — 記憶が辿る経路の全体像

### 再利用する既存実装（書き直さない）

- `wiki/app/lib/sources.server.ts` の `createSource`（`:383`）
  — 登録の唯一の窓口。`parseSourceVisibilitySelection` → `canAssignSourceVisibility` の
  検証順をそのまま使う。**フォーム用と API 用に分岐を作らない**という既存の設計意図を守る
- `wiki/app/lib/sources.server.ts` の `parseSourceVisibilitySelection`（`:207`）/
  `canAssignSourceVisibility`（`:187`）— 検証はこの 2 つを通す
- `wiki/app/routes/api.agent.sources.ts` — ルートの雛形（`resolveAgentWorkspace` →
  `agentUnauthorized` → `createSource` → `Response.json(…, {status: 201})`）
- `wiki/app/lib/agent-workspace.server.ts` の `resolveAgentWorkspace(request, env)`
  — Bearer トークンから `WorkspaceActor` を作る。**認証はこれ以外を使わない**
- `wiki/migrations/0047_source_kinds.sql` — SQLite で CHECK 制約を変えるための
  12-step 再構築の手本。**`sources` の CHECK を触る移行はこの形をそのまま踏襲する**
- `wiki/app/routes/api.cli.wiki.sources.ts` — CLI マニフェスト。会話ログはここから **除外する**
  （ingest はローカルの `memories/` を読むため。§4）
- `wiki/workers/features/sources/fetch-source.ts` — fetchable kind の分岐。
  会話ログは **ここに足さない**
- R2 への書き込みは既存の raw 保存経路（`source_documents.r2_key` の採番規約）に合わせる

---

## Design — 設計

### 1. `sources.kind` に `conversation` を追加

移行 `wiki/migrations/0059_conversation_source_kind.sql` を新規作成する。
`0047_source_kinds.sql` と同じ 12-step 再構築（`sources_replacement` を作って
`INSERT ... SELECT` → `DROP` → `RENAME` → インデックス再作成）で CHECK を広げる。

```sql
"kind" TEXT NOT NULL CHECK ("kind" IN (
  'google-doc','google-sheet','google-slides','google-chat-space',
  'discord-channel','website','upload','text','conversation'
)),
```

`0054` が入れた visibility の CHECK 2 本（値の集合と、`chapter-*` ⇔ `chapter_id IS NOT NULL`）を
そのまま維持する。`0047` / `0054` / `0057` が作っているインデックスも全部再作成する。
**既存行のバックフィルは無い**（新しい kind なので既存行は該当しない）。

**同じ移行で `(added_by, kind, external_id)` に UNIQUE 制約を張る。**

```sql
CREATE UNIQUE INDEX "idx_sources_owner_kind_external_id"
  ON "sources" ("added_by", "kind", "external_id") WHERE "external_id" IS NOT NULL;
```

冪等性を read-then-write の分岐（§2 の手順 4）だけに任せると、
睡眠の再試行と手動実行が重なったときに行が 2 つできる。**DB で閉じる。**

**`added_by` を必ずキーに含める。** `(kind, external_id)` だけでグローバルに一意にすると、
`externalId` は `xangi-session:<sessionId>` という**推測可能な文字列**なので、
別の利用者のキーに衝突させた呼び出しが

- 相手の行をそのまま返させて `source.id` とタイトルを得る、
- 相手の行が `ready` でなければ手順 6 の upsert で **相手のソースの本文を R2 ごと差し替える**

の 2 つを行える。後者は、そのソースを `<acl src>` で引用している既存ページの
中身をすり替える経路になる。**所有者でキー空間を分ければ、どちらも起こらない。**

`external_id` は既存の他 kind でも使われているので、
**移行の中で `(added_by, kind, external_id)` に重複が無いことを先に確認する**
（重複があれば移行を失敗させ、手で解消してから再実行する）。

`wiki/app/lib/sources-shared.ts` の `SourceKind` に `"conversation"` を足す。

### 2. 本文経路の登録関数

`wiki/app/lib/sources.server.ts` に追加する。**`createSource` を分岐させない。**

```ts
export interface CreateInlineSourceInput {
  title: unknown;
  content: unknown;
  visibility: unknown;
  chapter: unknown;
  externalId?: unknown;   // 冪等キー。xangi のセッション ID を入れる
  user: AuthUser;
  chapters: readonly Membership[];
}

export async function createInlineSource(
  env: Env,
  input: CreateInlineSourceInput,
): Promise<CreateSourceResult>;
```

処理順:

1. `parseSourceVisibilitySelection(input.visibility, input.chapter)` で検証する。
   失敗なら既存どおり `{ ok: false, error, status }`。
2. `canAssignSourceVisibility(...)` を通す。**所属外チャプターは指定できない。**
3. `content` を検証する。文字列であること、空でないこと、上限
   （`MAX_INLINE_SOURCE_BYTES = 1_000_000`）を超えないこと。
   超えたら `{ error: "content_too_large", status: 413 }`。
4. `externalId` が指定され、同じ `(added_by, kind, external_id)` の行が既にあれば
   **新規作成しない**。**照合キーに `input.user.id` を必ず含める**
   （`added_by = :callerId AND kind = 'conversation' AND external_id = :externalId`）。
   ただし**その行の `status` を見る**:
   - `ready` → その行をそのまま返して終了（冪等）
   - `ready` でない（＝前回が手順 6 で落ちた）→ **手順 6 から修復する**

   **他人が所有する行に当たった場合は、返しも修復もしない。**
   UNIQUE が `(added_by, kind, external_id)` なので通常はそもそも当たらないが、
   クエリを `added_by` 抜きで書いた実装が将来紛れ込んだときのために、
   **所有者不一致は `{ ok: false, error: "external_id_conflict", status: 409 }` で落とす**。
   「所有者が違うがキーが同じ」を黙って成功させない。
5. 無ければ `sources` 行を作る。
   **INSERT が `(added_by, kind, external_id)` の UNIQUE で落ちたときの動作を定義する** —
   落ちたら同じキーで再 SELECT し、**手順 4 に戻る**（`ready` ならその行を返す、
   `fetching` なら手順 6 から修復する）。**再試行は 1 回まで**にして、
   2 回目も衝突したら `{ error: "conflict", status: 409 }` で落とす（無限ループにしない）。
   **例外をそのまま 500 で返さない** — 睡眠は再試行するので、
   並行実行のたびに片方が 500 になると、失敗として観測されないまま記憶が滞留する。
   - `status: "fetching"` — **`ready` にしない。**本文がまだ R2 に無い状態で `ready` に
     すると、手順 6 が落ちたときに「ready なのに本文が無い行」が永続化し、
     手順 4 の冪等分岐がその壊れた行を返し続ける。
   - **`pending` にもしない。** `enqueueDueSourceRefreshes` の `orphanedPending` 掃除が
     `status = 'pending'` かつ `updated_at` が 1 時間より古い行を拾ってしまう。
     **`fetching` は掃かれない**（`wiki/app/lib/sources.server.ts` の due 判定を参照）。
   - `url` は **合成 URL `gdg-memory://<externalId>`** を入れる。
     `wiki/schema.sql` の `sources.url` は `TEXT NOT NULL` であり、会話ログには
     自然な URL が無い。`url` を nullable にする移行は `sources` の 12-step 再構築を
     伴うので、対価に見合わない。
   - `refresh_policy: "manual"`。
6. R2 に本文を書き、`source_documents` 行を **upsert** する
   （`path` は `conversation.md`、`media_type` は `text/markdown`、
   `content_hash` は本文の SHA-256、`status: "ready"`）。
   `(source_id, path)` に UNIQUE があるので upsert で修復が冪等になる。
7. `sources` 行を `status: "ready"`, `last_fetched_at: now` に更新する。
   **ここで初めて `ready` になる。**
8. その行を返す。**レスポンスに `id` を必ず含める** —
   呼び出し側はこれを `<acl src>` に使う。

**この順序の要点は「本文が永続化するまで `ready` にしない」ことである。**
途中で落ちた行は `fetching` のまま残り、次の同じ `externalId` の呼び出しが
手順 4 → 6 で修復する。**部分失敗が永続化しない。**

### 3. ルート

`wiki/app/routes/api.agent.sources.inline.ts`（新規）。`api.agent.sources.ts` の構造をなぞる。

```
POST /api/agent/sources/inline
{ title, content, visibility, chapter?, externalId? }
→ 201 { id, kind: "conversation", visibility, chapterId, title, createdAt }
```

- `request.method !== "POST"` → 405。
- `resolveAgentWorkspace` が null → `agentUnauthorized()`。
- `createInlineSource` の結果をそのまま返す。
- `wiki/app/routes.ts` にルート登録を追加する。

### 4. UI から隠す

`wiki/app/routes/sources.tsx` の一覧クエリから `kind === "conversation"` を除外する。

- 除外は **一覧の取得段階** で行う（表示段階でフィルタすると件数表示やページングがズレる）。
- `GET /api/sources`（JSON API）からも除外する（`/sources` 画面と同じ扱い）。
- **`GET /api/cli/wiki/sources`（CLI マニフェスト）からも除外する。**
  ingest はローカルの `memories/` ファイルを読むので（Stage 10 §4）、manifest に出す必要が無い。
  出すと `raw pull` が同じ内容を `raw/` にも落とし、`BuildIngestQueue` が pending として
  並べるので **同じ会話ログが 2 回 ingest される**。
  加えて `.gdgwiki/state.json` はチェックアウトローカルなので、クローンを作り直すと
  過去の全会話ログが pending として復活する。
- 除外は `kind` による単純なフィルタにする。**`canAccessSource` の判定は弱めない**
  （権限の無いユーザーに見せないことは、除外とは独立に保つ）。
- i18n 文字列は追加しない（画面に出さないため）。

### 5. fetch パイプラインに乗せない

`wiki/workers/features/sources/fetch-source.ts` の fetchable kind 集合
（`google-chat-space` / `discord-channel` / `google-doc` / `google-sheet` /
`google-slides` / `website`）に **`conversation` を足さない**。

`driverKindForSource`（`workers/features/sources/import/run.ts`）にも足さない。
`refresh_policy` を `manual` 固定にすることで `enqueueDueSourceRefreshes` の
対象からも外れるが、**それに依存せず kind 側でも弾く**（二重の安全装置）。

### 6. OpenAPI

- `wiki/openapi/paths/sources.yaml` に新ルートを追加するか、
  `wiki/openapi/paths/agent-sources-inline.yaml` を新設する。
- `wiki/openapi/components/schemas/` に `InlineSourceRequest` / `Source` の kind 追加。
- `wiki/openapi/types.generated.ts` を再生成する。
  **型だけ古いとフィールドが静かに落ちる。**

### 7. CLI マニフェストに `chapterId` を足す

**このステージのもう 1 つの成果物。** 会話ソースとは独立だが、
同じマニフェストの形を触るのでここでまとめる。

`SourcesManifestEntry`（`cli/internal/wiki/client.go:135`）は現在
`documentId` / `sourceId` / `kind` / `title` / `path` / `contentHash` /
`mediaType` / `capturedAt` / `visibility` を持つ。**`chapterId` が無い。**

Stage 05 の read ゲートと Stage 09 のインデックスは、`raw/**` の判定に
`visibility` と `chapterId` の両方を要求する。`chapter-member` / `chapter-organizer` は
`chapterId` が無いと評価できず、fail closed の規則によって**全部 deny になる。**

- `GET /api/cli/wiki/sources` のレスポンスの各エントリに `chapterId`（`string | null`）を足す。
  ソースは `sources.chapter_id`。
- `cli/internal/wiki/client.go` の `SourcesManifestEntry` に
  `ChapterID *string \`json:"chapterId"\`` を足す。
- `state.Manifest` は既存のクローンに古い形で残っているので、
  **`chapterId` が欠けたエントリを「チャプター無し」と解釈しない。**
  欠落は「未解決」であり、Stage 05 は deny、Stage 09 はインデックスしない。
  `gdg wiki raw pull` を 1 回回せば新しい形になる。

**`addedBy` は足さない。**
[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする) が
所有者によるローカル判定を退けたので、要らない。
**「あると便利そうだから」で足さないこと** — マニフェストは
エージェントが読める場所に落ちる（[ADR-004 の脅威モデル](adr.md#脅威モデル)の受容事項）。

### 制約

- **`createSource` を分岐させない。** URL 経路と本文経路は別関数にし、
  検証（`parseSourceVisibilitySelection` → `canAssignSourceVisibility`）は共有する。
  raw はチャプター間で漏れてはいけないものなので、権限チェックが二重化すると必ず片方が腐る。
- **`conversation` を fetchable にしない。** 取りに行く先が無いので、
  fetch されると `error` 状態に落ちて `/sources` の運用を汚す。
- **CLI マニフェストからも隠す。** ingest はローカルの `memories/` を読むので、
  manifest に出すと `raw pull` が同じ内容を落として二重 ingest になる（§4）。
- **冪等キーから `added_by` を外さない。** 「キーが長い」「クエリが 1 列増える」は
  理由にならない。外した瞬間に §1 の 2 つの経路が開く。
- **マニフェストに `addedBy` を足さない**（§7）。
- `wiki/schema.sql` は生成物。手編集せず `pnpm --filter @gdgjp/wiki migrate:local` で再生成する。
- `wiki/worker-configuration.d.ts` も生成物。`wrangler.toml` を触ったら `cf-typegen`。
- `openapi/*.yaml` を触ったら `openapi/types.generated.ts` の再生成を必ず行う。
- `page-access.server.ts` / `page-visibility.server.ts` のページ ACL は弱めない・触らない。
- Biome（2 スペース・ダブルクォート・セミコロン・100 桁）。`import type` を使う。

---

## Files to touch — 変更ファイル

すべて `wiki/` 配下。

- `migrations/0059_conversation_source_kind.sql`（新規）
- `schema.sql`（`migrate:local` による再生成。手編集しない）
- `app/lib/sources-shared.ts` — `SourceKind` に `"conversation"`
- `app/lib/sources.server.ts` — `createInlineSource`（新規）、
  `MAX_INLINE_SOURCE_BYTES`、冪等キーの解決
- `app/lib/sources.server.test.ts` — 検証・冪等性・上限のテスト追加
- `app/routes/api.agent.sources.inline.ts`（新規）
- `app/routes.ts` — 新規ルート登録
- `app/routes/sources.tsx` — 一覧から `conversation` を除外
- `app/routes/api.cli.wiki.sources.ts` — マニフェストから `conversation` を除外、
  各エントリに `chapterId` を追加（§7）
- `app/routes/api.sources.ts` — 同上
- `workers/features/sources/fetch-source.ts` — `conversation` を fetchable にしない旨のコメントと
  明示的な除外
- `openapi/paths/agent-sources-inline.yaml`（新規）、
  `openapi/components/schemas/*.yaml`、`openapi/types.generated.ts`（再生成）

### `cli/`

- `internal/wiki/client.go` — `SourcesManifestEntry` に `ChapterID`（§7）
- `internal/wiki/client_test.go` — マニフェストのデコードに `chapterId` を含めるテスト

---

## Verification — 完了条件と検証

### 完了条件

1. `POST /api/agent/sources/inline` に `{title, content, visibility: "chapter-organizer", chapter}` を
   送ると `201` と `id` が返り、`sources` 行と `source_documents` 行と R2 オブジェクトが 1 件ずつできる。
   `sources.url` に `gdg-memory://<externalId>` が入り、`status` は `ready` である。
2. 同じ `externalId` で 2 回叩いても行が 1 件のままで、**同じ `id`** が返る。
2a. 手順 6（R2 書き込み）を失敗させると、行は `fetching` のまま残り `ready` にならない。
   同じ `externalId` で再送すると **修復されて `ready` になる**。
2b. 並行して同じ `externalId` を 2 本投げても、UNIQUE 制約により行が 2 つできない。
   **後発が 500 ではなく、先発と同じ `id` を返す**（手順 5 の衝突復帰）。
2c. **別のユーザーが同じ `externalId` を送ると、別の行ができる**（衝突しない）。
   相手の `id` もタイトルも返らず、相手の本文も差し替わらない。
2d. `GET /api/cli/wiki/sources` の各エントリに `chapterId` が入っている（§7）。
3. 作った source が `/sources` の画面にも `GET /api/sources` にも **出ない**。
4. 同じ source が `GET /api/cli/wiki/sources` のマニフェストにも **出ない**。
   `gdg wiki raw pull` しても `raw/` に落ちず、`INGEST_QUEUE.md` にも現れない。
5. 所属外チャプターを指定すると 403 相当のエラーになる。
6. `conversation` の source が fetch キューに入らない
   （`refresh_policy` を `daily` に手で書き換えても `enqueueDueSourceRefreshes` が拾わない）。

### コマンド

```bash
pnpm --filter @gdgjp/wiki migrate:local
```

```bash
pnpm --filter @gdgjp/wiki typecheck && pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

`migrate:local` は `wiki/schema.sql` を再生成する。その差分をコミットに含めること。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`conversation` が `/sources` にも `GET /api/sources` にも CLI マニフェストにも出ない。**
  3 つを 1 つのテストで固定する。マニフェストに出ると、
  `raw pull` が同じ内容を `raw/` に落とし、ローカルの `memories/` と合わせて
  **同じ会話ログが 2 回 ingest される**。重複ページができるまで気づけない。
- **クローンを作り直しても会話ログが pending にならない。** `.gdgwiki/state.json` は
  チェックアウトローカルなので、manifest に出ていると新しいクローンで
  **過去の全会話ログが復活する**。マニフェスト除外がこれを構造的に防いでいることを固定する。
- **`conversation` が fetch されない。** fetchable 集合に紛れ込むと、
  取りに行く先が無いソースが毎日 `error` に落ち続ける。
- **冪等性** — 同じ `externalId` で 2 回作成して行が増えないこと。
  **read-then-write だけに頼らない** — `(added_by, kind, external_id)` の UNIQUE 制約で
  並行時も 1 件に収まること。
- **UNIQUE 衝突が 500 にならない。** 並行 2 本のうち後発が、先発と同じ `id` を返すこと。
  ここが 500 のままだと、睡眠の再試行が毎回半分失敗し、
  **記憶ファイルが消えないまま溜まる**（削除は push 成功後なので、症状はゆっくり出る）。
- **冪等キーが所有者で分かれている。** 利用者 A と利用者 B が同じ `externalId` を送ったとき、
  行が 2 つでき、B のレスポンスに A の `id` もタイトルも含まれないこと。
  さらに **A の行が `fetching` の状態で B が同じキーを送っても、A の本文が上書きされないこと。**
  ここが壊れると、`<acl src>` で A のソースを引用している既存ページの中身が
  B の内容にすり替わる。**A 側からは何も起きていないように見える。**
- **マニフェストの `chapterId`。** `GET /api/cli/wiki/sources` の全エントリに
  `chapterId` があり、`chapter-member` / `chapter-organizer` のソースでは非 null であること。
  ここが欠けると Stage 05 が fail closed で `raw/**` を全部 deny し、
  **ingest が「権限が無い」と言い続ける**。原因がマニフェスト側にあると気づきにくい。
- **部分失敗が永続化しない。** R2 書き込みまたは `source_documents` の作成を
  失敗させたあと、行が `ready` になっていないこと。再送で修復されること。
  **`ready` を先に立てると、本文の無い行を冪等分岐が永久に返し続ける。**
- **`status: "fetching"` が `orphanedPending` に拾われない。**
  `pending` にすると `enqueueDueSourceRefreshes` が 1 時間後に fetch キューへ送り、
  取りに行く先が無いので `error` に落ちる。
- **`url` が NOT NULL を満たしている。** 合成 URL を入れ忘れると INSERT が落ちる。
  睡眠は失敗時に再試行するので、ここが壊れると記憶が重複して ingest される。
- **本文の上限** — 上限超過が 413 で弾かれ、R2 に部分書き込みが残らないこと。
- **所属外チャプターの拒否** — `canAssignSourceVisibility` を通っていること。
  新しい登録窓口を作ると、ここを通し忘れて権限チェックが片肺になる事故が起きやすい。
- **visibility の必須性** — `visibility` を省略したら `invalid_visibility` で落ちること。
  既定値 `member` に静かに落ちないこと（`member` はチャプター横断で読める）。
- **移行の等価性** — `0059` の前後で既存ソースの `kind` / `visibility` / `chapter_id` と
  インデックス定義が変わらないこと。12-step 再構築でインデックスを 1 本落とすと
  一覧クエリだけが静かに遅くなる。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）を起動する。
2. `author` のトークンで `POST /api/agent/sources/inline` を叩き、
   `visibility: "chapter-organizer"` の会話ログを 1 件登録する。返った `id` を控える。
3. `/sources` を開き、その行が **出ない** ことを確認する。
4. `author`（organizer）のトークンで `GET /api/cli/wiki/sources` を叩き、
   その `id` が **含まれない** ことを確認する（`kind: "conversation"` は manifest から除外）。
5. 同じ `externalId` でもう一度 2 を実行し、返る `id` が同じであることと、
   D1 の `sources` の件数が増えていないことを確認する。
6. `gdg wiki raw pull` を実行し、その会話ログが `raw/` に **落ちてこない** ことと、
   `INGEST_QUEUE.md` に現れないことを確認する。
   **落ちてくると、ローカルの `memories/` と合わせて二重 ingest になる。**
