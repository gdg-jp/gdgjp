# Stage 09 — agents-index local semantic index

## Context — 背景とリポジトリ状況

### なぜやるか

query が遅い。エージェントが `index` を読み、namespace を `ls` し、ページを `cat` し、
を逐次判断して繰り返すため、**LLM 呼び出しが 5〜10 回積む**。
往復回数がボトルネックである。

top-k を返す検索エンドポイントで置き換えるのは不適切である。
セマンティック検索（＝エージェントが FS を辿って探す形）はそのまま残し、
**補助的なインデックスを足して、最初の 1 ホップで行き先が絞れるようにする**。

### 既存 OSS を使わない理由

`kiri`（`kiri-mcp-server` v0.26.0、CAPHTECH/kiri）を実測した結果、要件を満たさない。

1. **本文を DuckDB の `blob` テーブルに丸ごと持つ。**
   `~/proj/wiki` のインデックスは 7.3 GB。かつ本文取得 `snippets_get` は
   **FS を経由しない** ので、Stage 05 の read ゲートを完全に迂回する。
2. **"semantic" が言語モデルの埋め込みではない。** `dist/src/shared/embedding.js` は
   sha256 ベースの 64 次元ハッシュ化 bag-of-tokens で、
   コード中のコメント自身が「BERT や GPT のような意味的類似ではない」と書いている。
   日本語の言い換えに効かない。
3. **フィルタが deny のみ。** allowlist 機構が無く、
   読むのは root の `.gitignore` と `denylist.yml` だけ。
4. 列挙が `git ls-files` 固定で FS walk のフォールバックが無い。

権限フィルタを**後付けすると必ず漏れる**。フィルタを一級市民として持つ実装が要る。

### 依存と対象範囲

- **先行ステージ: Stage 01（`gdg-lib` の ACL 評価器）、Stage 04（認可サーバと nonce）。**
- 実体は gdgjp モノレポの新ワークスペース `agents-index/`。
  `pnpm-workspace.yaml` に追加する。
- **インデックスは 1 つだけ。** workdir が 1 つなので、権限クラスごとに
  複製しない（7 GB × クラス数は中央 1 台で現実的でない）。
- **対象は `pages/` / `raw/` / `memories/` のすべて。**
  対象を絞ることは禁止（絞るとセマンティック検索の意味が消える）。

### 読むべきもの

- `CLAUDE.md`（リポジトリ直下）— workspace 追加、Biome、Turborepo タスク
- `docs/agents-local-mvp/index.md` §8「インデックス」
- `docs/agents-local-mvp/04-xangi-authz-iam.md` §3 — nonce の解決 API
- `docs/plans/09-source-visibility-acl.md` — 5 値の意味

### 再利用する既存実装（書き直さない）

- `gdg-lib/src/acl`（Stage 01）— **`canClassesAccessSourceInChannel` /
  `canClassesSeePageInChannel`**（§5-4）。
  **post-filter はこれを直接呼ぶ。クラス版の裸の評価器と `canAccessSource` は呼ばない**（§4）。
  import は **`@gdgjp/gdg-lib/acl/agent`**（エージェント側の面。Stage 01 §5-5）
- `cli/internal/wiki/local.go` の front matter 規約 — `visibility` / `chapter_id` /
  `access` / `sources`。**同じ形を読む**
- `.gdgwiki/state.json` の `manifest.documents[]` — `raw/` のパス → `sourceId` /
  `visibility` の解決
- `~/proj/xangi/src/authz-server.ts`（Stage 04）— `GET /resolve?nonce=`

---

## Design — 設計

### 1. ワークスペース

```
agents-index/
  package.json          @gdgjp/agents-index
  src/
    index.ts            MCP サーバのエントリ
    indexer/
      watcher.ts        chokidar
      chunk.ts          Markdown をチャンクに割る
      embed.ts          ローカル埋め込み
      store.ts          sqlite-vec
    acl/
      frontmatter.ts    front matter と manifest から subject を作る
      filter.ts         gdg-lib のクラス版評価器を呼ぶ
    authz.ts            nonce → PermissionClass[]
  test/
```

`pnpm-workspace.yaml` に `agents-index` を追加する。
`@gdgjp/gdg-lib` を `workspace:*` で依存し、**`@gdgjp/gdg-lib/acl/agent`** を直接 import する
（`./acl` ではない。クラス版の裸の評価器を見せない面である。Stage 01 §5-5）。

### 2. インデクサ

- **追尾**: `chokidar` で workdir 配下を監視。デバウンス 500ms。
  `.git/`、`.gdgwiki/`（`state.json` を除く）、`node_modules/` は除外。
- **チャンク**: Markdown を見出し境界で割り、1 チャンク 200〜800 文字程度に揃える。
  各チャンクは `{ path, startLine, endLine, text }`。
  **front matter はチャンクに含めない**（本文の検索にノイズが乗る）。
- **埋め込み**: ローカルの多言語モデル。候補は
  `intfloat/multilingual-e5-small`（384 次元）または `cl-nagoya/ruri-small`。
  実行は `@huggingface/transformers`（ONNX、CPU）で完結させる。
  **外部への送信は行わない。**
  モデルの選定は実装時にベンチマークで決める（日本語の言い換え想起で評価する）。
- **ストア**: `sqlite-vec`。1 ファイル。
  **本文は保存する**（スニペット提示のためではなく、再チャンクを避けるため）。
  ただし **API から本文は返さない**（§4）。
- **置き場所は `/var/lib/agents-index/index.db`。workdir の中に置かない。**
  本文を丸ごと持つ以上、DB は「read ゲートを迂回して全文を読める平文コピー」である。
  workdir に置くと、shell を持つエージェント（ADR-005）が
  `sqlite3 index.db 'select text from chunks'` で全部読める — ADR-013 が kiri を
  却下した理由（`snippets_get` が FS を経由しない）とまったく同じ穴になる。
  - 所有者はインデクサ／xangi の uid（`gdgagent-svc`）。
    **どのエージェントスロット（`gdgagent-run-<N>`）からも読めない権限にする**（Stage 07）。
  - エージェントが触れるのは MCP の `search` だけ。
  - ADR-006（workdir とインデックスを 1 つに保つ）は**維持される**。
    インデックスが 1 つであることと、それが agent の可読範囲に在ることは独立である。
- **増分更新**: パス単位。変更されたファイルのチャンクだけ削除して入れ直す。
  削除されたファイルはチャンクごと消す。

### 3. ACL メタデータ

チャンクごとに、判定に必要な最小限を非正規化して持つ。

| パス種別 | メタデータの取得元 |
|---|---|
| `pages/**/page.md` | front matter の `visibility` / `chapter_id` / `access` |
| `raw/**` | `.gdgwiki/state.json` の `manifest.documents[]` を前方一致で引き、`visibility` / `chapterId` |
| `memories/**` | ファイル front matter の `visibility` / `chapter_id` |
| その他 | インデックスしない |

**チャンクの行範囲と交差するすべての `<acl>` スパン**について、その `src` を集め、
**和集合**をメタデータに持つ。
`parseAclSpans` でスパンの範囲を取り、チャンクの行範囲と突き合わせる。
post-filter はページの判定に加えて、**集めたすべての id を AND で評価する**
（`.gdgwiki/acl-sources.json` から `visibility` / `chapterId` を引き、
`canClassesAccessSourceInChannel` に渡す。1 つでも読めなければそのチャンクを落とす。
[Stage 11](11-wk-mediator.md) §4）。

理由: ページ単位の判定だけだと、**読めないスパンの中身がヒットしたという事実**
（パスと行範囲、そして「そのクエリ語がそこにある」こと）が返る。
本文は返さないが、`wk read` すると黒塗りなので、
**「黒塗りの中に何が書いてあるか」を検索で当てられる。**

**「チャンクがスパンの内側にあるなら」と書かない。包含では向きが逆である。**
チャンクは見出し境界で 200〜800 字（§2）、スパンは追加行を包む数行（Stage 06）なので、
実際に多いのは**スパンがチャンクの内側にある**形である。
包含だけを見ると、**その多数派にメタデータが付かず、上の漏れがそのまま起きる。**

- **交差は「行範囲の重なりが 1 行以上」で判定する。** 端点だけの接触も交差に数える（安全側）。
  `parseAclSpans` の返す範囲をそのまま使い、比較を自前で書かない。
- **ACL 境界でチャンクを分割する案は採らない。** 見出し境界の分割規則（§2）と二重になり、
  スパンが挿入・削除されるたびに `startLine` / `endLine` が動いて
  増分更新（§2）のキーが不安定になる。

**メタデータが解決できないファイルはインデックスしない。**
「メタデータ不明 = 誰でも読める」に倒さない。

**`chapterId` はマニフェストに Stage 02 §7 で追加される。**
それ以前の形（`documentId` / `sourceId` / `kind` / `title` / `path` /
`contentHash` / `mediaType` / `capturedAt` / `visibility`）には `chapterId` が無く、
`chapter-member` / `chapter-organizer` のソースを評価できない。
**欠落を「チャプター無し」と読まず、インデックスしない**（上の規則そのまま）。
古いクローンでは `gdg wiki raw pull` を 1 回回す。

front matter が変わったら、そのファイルのチャンクのメタデータを更新する。
`state.json` が変わったら、`raw/` 配下のメタデータを再解決する。

### 4. MCP サーバ

**出力に本文を含めない。** これが設計の中核である。
post-filter が万一漏れても被害が「パス名」に限定されるのは、
**①API が本文を返さないこと**と**②`index.db` が agent の可読範囲外にあること**（§2）の
2 つが揃っている場合だけである。どちらか一方でも崩れると、この主張は成立しない。

```
tool: search
  input:  { query: string, limit?: number (1..50, default 10), pathPrefix?: string }
  output: [{ path, startLine, endLine, score }]
```

- **これ 1 本だけ。** `snippets_get` 相当を作らない。
  本文はエージェントが **`wk read`** で取りに行く（`Read` ツールは Stage 05 が deny する）。
  **ACL の判定点が 1 つに保たれる。**
- 権限クラス**と `channelAudience`** は env の `XANGI_AUTHZ_NONCE` /
  `XANGI_AUTHZ_SOCKET` から認可サーバに問い合わせて得る（Stage 04 §2-2）。
  **どちらも引数で受け取らない。**
- 検索 → **post-filter** → `limit` 件に切る、の順。
  フィルタ前に切ると、読めるものが結果から押し出される。
- **固定倍率のオーバーサンプリングにしない。** `limit * 5` のような固定幅では、
  上位がすべて権限外で下位に権限内のチャンクがある場合に、
  権限内の結果が存在するのに空を返す。
  ランク順に**ページ単位で候補を取り、post-filter を通し、権限内が `limit` 件たまるか
  候補が尽きるまで繰り返す**。1 ページは 100 件程度。
- 打ち切りの上限を明示的に置く。走査した候補の総数（既定 1000、`INDEX_MAX_SCANNED`）と
  経過時間（既定 2 秒、`INDEX_SEARCH_TIMEOUT_MS`）。
  **上限に達したら空ではなく、その時点までに集まった部分結果を返す。**
- post-filter は `@gdgjp/gdg-lib/acl/agent` の**チャンネル込みの評価器**を呼ぶ —
  `raw/**` と `memories/**` は `canClassesAccessSourceInChannel`、
  `pages/**` は `canClassesSeePageInChannel`（どちらも Stage 01 §5-4）。
  **スパンと交差するチャンクは、加えて交差したすべての `src` の AND を通す**（§3）。
  **クラス集合だけで絞らない。** `member` 写像の全国チャンネルからのクエリでは、
  クラス集合に `{tokyo, member}` が残るので、
  クラス版だけを見ると `chapter-member:tokyo` のパスが結果に出る（Stage 04 §2-2）。
  **`canAccessSource` を呼ばない。** あれは `user.isAdmin` と
  `source.addedBy === user.id` を要求するが、nonce が返すのはクラス集合だけである
  （[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)）。
  ダミーの `user` をでっち上げて渡さないこと — `addedBy` が空文字のソースが
  **全員に読めるようになる。**
- **nonce が解決できないとき、および応答に `channelAudience` が無いときは
  空配列を返す**（fail closed）。「audience 不明 = 制約なし」に倒さない。

### 5. 起動と接続

**`~/.cursor/mcp.json` に MCP サーバの実体を書かない。**
その経路では **Cursor が親になる**ので、子プロセスはエージェントのスロット uid を継ぎ、
`index.db`（§2 で agent から読めない所有権にした）を開けない。
「開けないから権限を緩める」に倒すと、ADR-013 が kiri を却下した理由に戻る。

構成を 2 段にする（配置と所有権は **Stage 07 §6**）。

| プロセス | uid | 役割 |
|---|---|---|
| インデクサ／MCP デーモン | `gdgagent-svc` | `index.db` を開く。検索と post-filter。UNIX ソケットで待つ |
| stdio プロキシ | `gdgagent-run-<N>` | Cursor が spawn する。stdio ↔ ソケットの中継のみ |

- MCP 設定に書くのは**プロキシ**である。プロキシは判定もせず `index.db` も開かない。
- **設定ファイルは `setup.sh` がスロットごとに 1 回置く。root 所有 `0444`。**
  ソケットは `/run/gdg-agent/<N>/index.sock` でスロット固定なので、**内容は静的である。**
  固定ランチャが `HOME` をスロットホームにし、そこにある root 所有 `mcp.json` を読む
  （Stage 07 §6）。`--mcp-config` は無い。
  **xangi が invocation ごとに書く形にしない** — `.cursor/` は root 所有なので
  `gdgagent-svc` は書けず、書ける場所に置けばエージェントも書ける。
  Stage 05 の MCP allowlist は、この固定が前提である（Stage 05 §3-5）。
- インデクサは **常駐**（xangi のサービスと一緒に起動）し、書き込みも常駐側だけが行う。
- **デーモンが nonce を受け取り、自分で認可サーバに問い合わせて post-filter する。**
  プロキシが申告するクラスを信用しない。プロキシは乗っ取られうる前提で置く。
- Stage 05 のハーネスは **`MCP:search` だけを allowlist する**（既定 deny）。
  ACL の判定はこのサーバが行うが、**「MCP だから通す」ではない**（Stage 05 §3-5）。

### 6. `AGENTS.md` への指示

インデックスは **航行の補助** であって、答えの出典ではない。

- 「まず `search` で当たりをつけ、返ったパスを `Read` で読む」
- 「`search` の結果は本文を含まない。必ず読んでから答える」
- 「`search` が空でも、そこに何も無いとは限らない（権限で絞られている）」

### 制約

- **API から本文を返さない。** `snippets_get` 相当を作らない。
  作った瞬間に ACL の判定点が 2 つになり、read ゲートを迂回する経路ができる。
- **インデックスの対象を絞らない。** `raw/` も `memories/` も入れる。
  絞るとセマンティック検索の意味が消える。
- **権限クラスと `channelAudience` を引数で受け取らない。** nonce から引く。
- **nonce が解決できなければ空配列**（fail closed）。
  **`channelAudience` の欠落も同じ扱い。**
- **チャンネルの天井を落とさない。** クラス版の裸の評価器を呼ばない
  （`@gdgjp/gdg-lib/acl/agent` からは見えない。Stage 01 §5-5）。
  落とすと、全国チャンネルからのクエリに `chapter-*` のパスが出る。
  **結果が増えるだけなので、テストが無ければ気づけない。**
- **メタデータが解決できないファイルをインデックスしない。**
- **フィルタ前に `limit` で切らない。**
- **埋め込みを外部 API に送らない。** ローカル完結。
- **判定ロジックを再実装しない。** `@gdgjp/gdg-lib/acl` を呼ぶ。
- **`canAccessSource` を呼ばない。** クラス版
  （`canClassesAccessSource` / `canClassesSeePage`）だけを使う。
  ダミーの `user` をでっち上げて既存関数に渡さない。
- **MCP サーバの実体を MCP 設定に書かない。** プロキシを書く（§5、Stage 07 §6）。
  実体を直接 spawn させると、スロット uid を継いで `index.db` を開けない。
- **MCP 設定を xangi が実行時に書く形に戻さない。** root 所有の静的ファイル + `HOME` である（§5）。
  書ける場所に置くと、エージェントもそこに別のサーバを足せる
  （Cursor は `<projectRoot>/.cursor/mcp.json` も読む。Stage 05 の確認済みの事実 9）。
- **`index.db` を workdir の中に置かない。** `/var/lib/agents-index/` に置き、
  agent uid から読めない所有権にする。ここが崩れると §4 の「被害はパス名に限定」が嘘になる。
- Biome（2 スペース・ダブルクォート・セミコロン・100 桁）。`import type` を使う。

---

## Files to touch — 変更ファイル

### 新規ワークスペース `agents-index/`

- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/index.ts` — MCP デーモン（UNIX ソケット、`gdgagent-svc` で走る）
- `src/proxy.ts` — stdio ↔ ソケットの中継のみ（スロット uid で走る。判定を持たない）
- `src/authz.ts` — nonce → `PermissionClass[]`
- `src/indexer/watcher.ts`, `chunk.ts`, `embed.ts`, `store.ts`
- `src/acl/frontmatter.ts`, `src/acl/filter.ts`
- `src/cli.ts` — 常駐インデクサの起動（`agents-index watch --root <path>`）
- `test/chunk.test.ts`, `test/filter.test.ts`, `test/store.test.ts`

### リポジトリ直下

- `pnpm-workspace.yaml` — `agents-index` を追加
- `turbo.json` — 必要なら `build` / `test` タスクの調整
- `CLAUDE.md` — ワークスペース一覧に `agents-index/` を追加

### `gdg-lib/`

- **触らない。** `canClassesAccessSource` / `canClassesSeePage` は
  Stage 01 §5 で追加済みである（本ステージで足すのではない）。

### `~/proj/xangi`

- **MCP 設定は触らない。** root 所有の静的ファイルを `setup.sh` が置き、
  ランチャが `HOME` でそれを選ぶ（§5、Stage 07 §6）。`--mcp-config` は渡さない。
- `src/authz-server.ts` — インデックスデーモンからの nonce 解決を受ける
  （フックと同じ `/resolve`。**`channelAudience` も返る**）

### `agents-local/`

- `AGENTS.md` — `search` の使い方と限界
- `setup.sh` — 常駐インデクサの起動

---

## Verification — 完了条件と検証

### 完了条件

1. `agents-index watch --root <workdir>` が起動し、
   `pages/` / `raw/` / `memories/` のチャンクが `index.db` に入る。
2. ファイルを編集すると 1 秒以内にそのファイルのチャンクだけが更新される。
3. MCP の `search` が **パス + 行範囲 + score だけ** を返し、本文を返さない。
3a. **スパンがチャンクの内側にある**ページで、そのスパンを読めないクラスの
   `search` 結果にそのチャンクが**含まれない**（§3 の交差判定）。
   読めるクラスでは含まれる。
4. `chapter-organizer` の記憶が、`member` クラスの nonce での `search` 結果に
   **パスすら現れない**。
4a. **`member` 写像のチャンネルの nonce では、`chapter-member:<自分のチャプター>` の
   パスが `search` 結果に現れない。** 同じユーザーの
   `chapter-member` 写像のチャンネルの nonce では**現れる**。
5. nonce を無効にすると `search` が空配列を返す。
   **`channelAudience` を欠いた応答でも空配列になる。**
5a. どのスロット uid（`gdgagent-run-<N>`）からも `/var/lib/agents-index/index.db` を**開けない**
   （`sqlite3` でも `cat` でも）。`index.db` が workdir 配下に存在しない。
5b. 上位 500 件がすべて権限外で 501 件目に権限内のチャンクがあるクエリで、
   その 1 件が返る。走査上限に達した場合は空ではなく部分結果が返る。
6. 日本語の言い換えクエリ（「懇親会の予算」→「懇親会 費用」を含むページ）で
   目的のページが上位に来る。

### コマンド

```bash
pnpm --filter @gdgjp/agents-index test
```

```bash
pnpm --filter @gdgjp/agents-index build && pnpm --filter @gdgjp/agents-index exec agents-index watch --root /tmp/wiki-test
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`search` の出力に本文フィールドが無い。** スキーマをテストで固定する。
  「デバッグ用に snippet を返す」変更が入った瞬間に、read ゲートを迂回する経路ができる。
- **スパンと交差するチャンクが、そのスパンを読めないクラスの結果に出ない。**
  ページは読めるがスパンは読めないクラスでクエリし、
  スパン内の語に一致するヒットが**返らない**こと。
  ここが抜けると、`wk read` の黒塗りの中身を検索で推測できる。
- **交差の 3 形をすべて置く。** ①**スパンがチャンクの内側にある**（＝多数派）
  ②チャンクがスパンの内側にある ③端が重なるだけ。
  **①が抜けるのが実際の事故である** — 「チャンクがスパンの内側なら」と書いた
  包含判定の実装は、①に何のメタデータも付けないまま正常に見える（§3）。
  読めるクラスでは同じヒットが**返ること**を同じテストに並べる
  （返らないことだけを見ると、権限が無いのかフィルタが壊れているのか区別が付かない）。
- **複数スパンと交差するチャンクが AND で評価される。** 片方だけ読めるクラスで
  そのチャンクが**返らない**こと。「どちらか読めれば通す」に倒れないこと。
- **post-filter が漏れない。** 各 visibility × 各クラスの組み合わせで、
  読めないパスが結果に含まれないこと。**5 値 × 2 ロール × 複数チャプターを網羅する。**
- **チャンネルの天井が効いている。** `member` / `organizer` 写像のチャンネルの nonce で
  `chapter-*` のパスが 1 つも返らないこと。
  **同じユーザーのチャプター写像チャンネルでは返ること**を同じテストに並べる。
  ここが抜けると、全国チャンネルでチャプター限定ページの存在と行範囲が分かる。
- **`channelAudience` の欠落が空配列になる。** 「制約なし」に倒れないこと。
- **フィルタ前に `limit` で切っていない。** 読めないチャンクが上位を占めるクエリで、
  読めるチャンクが結果に残ること。**固定倍率のオーバーサンプリングに戻っていないこと**
  — `limit * N` 形式は、上位 N*limit 件がすべて権限外のときに静かに空を返す。
- **`index.db` のパスが workdir 配下に戻っていない。** テストでパスを固定する。
  戻ると、本文の平文コピーが agent の可読範囲に置かれる。**検索結果は正常に見えるので気づけない。**
- **nonce 解決失敗が空配列になる。** 認可サーバを止めた状態で
  「全部返す」に反転しないこと。**反転しても検索結果が増えるだけで気づけない。**
- **メタデータ不明のファイルがインデックスされない。**
  front matter の無いファイル、`manifest` に無い `raw/` のファイルが
  「誰でも読める」で入らないこと。
- **front matter の変更がメタデータに反映される。** ページの `visibility` を
  狭めたあと、`search` の結果から消えること。**反映が遅れると、
  権限を絞ったはずのページが検索できたままになる。**
- **`state.json` の変更が `raw/` のメタデータに反映される。**
- **削除されたファイルのチャンクが消える。** 消え残ると、存在しないパスが返る。
- **判定ロジックが再実装されていない。** `agents-index/src/` に
  `visibility` の文字列比較が無いこと（grep で固定する）。
- **`canAccessSource` を呼んでいない。** `…InChannel` 版だけを使っていること（grep で固定する）。
  ダミー `user` を渡す実装が入ると、`addedBy` が空文字のソースが全員に読める。
- **import 元が `@gdgjp/gdg-lib/acl/agent` である**（`./acl` ではない）。
  `./acl` に戻すと、クラス版の裸の評価器が見えるようになる。
- **`chapterId` の無いマニフェストエントリがインデックスされない。**
  Stage 02 §7 より前の形のクローンで、`chapter-*` のソースが
  「チャプター無し」として通らないこと。
- **デーモンとプロキシの uid が分かれている。** プロキシ側のプロセスから
  `index.db` が開けないこと。ここが同じ uid に戻ると、
  §2 の「本文が読めない」が崩れ、**検索は正常に動き続けるので気づけない。**
- **デーモンがプロキシ申告のクラスを信用していない。** リクエストに
  クラスを直接載せても無視され、nonce からの解決だけが効くこと。

### 手動 E2E

1. `gdg wiki clone` + `raw pull` した作業ツリーに対して `agents-index watch` を起動する。
2. 初回インデックス完了までの時間と `index.db` のサイズを記録する
   （kiri の 7.3 GB と比較して、本文込みで妥当な範囲に収まっているか確認する）。
3. `chapter-organizer` の記憶ファイルを 1 件置く。
4. `member` クラスの nonce で `search` を叩き、その記憶のパスが **出ない** ことを確認する。
4a. `sudo -u gdgagent-run-0 sqlite3 /var/lib/agents-index/index.db 'select 1'` が
   権限エラーで失敗することを確認する。
5. 同じチャプターの `organizer` クラスの nonce で叩き、**出る** ことを確認する。
5a. 同じユーザーの `member` 写像チャンネルの nonce で叩き、
   `chapter-*` のパスが **1 つも出ない**ことを確認する（チャンネルの天井）。
6. 認可サーバを止めて叩き、空配列が返ることを確認する。
7. 日本語の言い換えクエリを 10 個ほど用意し、目的のページが上位 3 件に入る率を測る。
   **kiri（字面一致）と比較して改善していることを確認する。**
8. Discord から質問を投げ、`search` 導入前後で LLM 呼び出し回数が減っていることを
   xangi の `logs/turn-latency/` で確認する。
