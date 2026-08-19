# Stage 11 — the `wk` mediator CLI

## Context — 背景とリポジトリ状況

### なぜやるか

`<acl src="…">` スパンは、**ページ可視性より狭い記述**を表すための仕組みである。
ところがローカルのワークツリーには、**スパン本文がそのまま載っている。**
`gdg wiki clone` が落とす内容は `wiki/app/routes/api.cli.wiki.snapshot.ts:73` が決めていて、
`fullClearance` なら `<acl>` タグごと全文、そうでなければページ全体に `removeAclSpans` を掛ける
**all-or-nothing** である。運用者は広い clearance でクローンするので、
ディスク上のページには機密のスパンが平文で存在する。

したがって、ページ単位の可視性だけを見るゲートでは
**`public` / `member` のページに埋まった `chapter-organizer` 由来のスパンが、
そのページを読めるすべてのクラスに見える。**
Stage 06 の `<acl>` 自動挿入が、workdir の内側では意味を持たなくなる。

**そしてこれはフックでは直せない。**
`~/.cursor/skills-cursor/create-hook/SKILL.md` の Event Output Cheat Sheet のとおり、
`preToolUse` が返せるのは `permission` / `user_message` / `agent_message` / `updated_input` で、
`postToolUse` の `updated_mcp_tool_output` は **MCP ツール限定**である。
**フックはツールの出力を書き換えられない。** 濾過ができるのは、自分が本文を出す側に立ったときだけである。

このステージで **`wk`** を作る。ワークツリーの読み書きの唯一の窓口であり、
`<acl>` をクラスごとに濾し、書き込み時に再合成と挿入を行う
（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

### 依存と対象範囲

- **先行ステージ: Stage 00（Node ネイティブ TypeScript 基盤）、
  Stage 01（`gdg-lib` の ACL 評価器と、生成物 `cli/internal/wiki/hooks/acl.ts`）、
  Stage 02（マニフェストの `chapterId`）、Stage 04（認可サーバと nonce）。**
- **このステージは単体で完結し、単体で検証できる。** ゲート（Stage 05）が無くても、
  nonce を渡して `wk read` を叩けば濾過を確認できる。
  **実装順は 11 → 05 である** — 先にゲートを入れると、
  Read を deny されたエージェントに代替手段が無い状態が生まれる。
- 後続の Stage 05（ゲート）が「`wk` 以外の経路を deny する」ことで、`wk` を**唯一の**窓口にする。
  **このステージだけでは「窓口が 1 つ」は成立しない。** それは Stage 05 の担当である。
- **`<acl>` の自動挿入ロジック（`wk write` の手順 3〜5）は Stage 06 の担当。**
  ここでは呼び出し順序と、落ちたら書かないことまで。
- 対象は `cli/` のみ。`agents-local/` の配置は Stage 07。

### 読むべきもの

- [ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する) — この設計の根拠と却下案
- [ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする) /
  [ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する) — 呼ぶ関数の選び方
- `docs/plans/10-page-acl-spans.md` — **特に §0「権限の代数」**。5 値は全順序ではない
- `docs/agents-local-mvp/index.md` §4「Cursor ハーネス」

### 再利用する既存実装（書き直さない）

- `cli/internal/wiki/hooks/acl.ts`（Stage 01 の `build:acl` 生成物）— **クラス版評価器**
  `canClassesAccessSource` / `canClassesSeePage` / `canMutatePage`、
  および `parseAclSpans` / `redactAclSpans` / `validateAclSpans`。
  **スパンのパーサも判定も自前で書かない**
- `wiki/app/lib/acl-spans.server.ts` の `buildAclSpanPolicy`（`:133`）
  — **スパン述語の形の手本**。`src` を AND で評価し、引けない id は拒否側に倒す。
  `wk` の濾過はこれと同じ形をクラス集合で行う（§4）
- `wiki/app/lib/acl-spans.ts` の `redactAclSpans`（`:278`）— 濾過の実体。
  許可されたスパンでもタグを剥がし、拒否されたスパンを `⬛︎⬛︎⬛︎` にする
- `cli/internal/wiki/hooks/acl-gate.ts` — **書き方の手本**（Node ネイティブ TypeScript、依存ゼロ、
  `findCloneRoot` で `.gdgwiki/config.json` まで遡る、`spawnSync`）
- `cli/internal/wiki/local.go` の `LocalPages` / `FrontMatter`（`yaml.v3`）
  — **front matter の再パーサを自前で書かない**
- `cli/internal/wiki/state.go` — `state.Manifest.Documents[]` の
  `SourceID` / `Path` / `Visibility` / `ChapterID`（Stage 02 §7 で追加）
- `cli/internal/wiki/hooks.go` — `//go:embed` と冪等な設置

---

## Design — 設計

### 1. 実体

| 項目 | 決定 |
|---|---|
| 配置 | 本体は `/opt/gdg-agent/lib/wk.ts`（`root:root` `0444`）。`/opt/gdg-agent/bin/wk` は本体を `node` で起動する root 所有 `0755` の薄い launcher（Stage 00 §5 / Stage 07 §1）。**`lib/` は平坦な 1 ディレクトリで、相対 import が `./acl-core.ts` / `./acl.ts` のまま解決する** |
| 実装 | Node ネイティブ TypeScript。`./acl.ts`（Stage 01 の `build:acl` 生成物）を import する |
| クラス解決 | `XANGI_AUTHZ_NONCE` + `XANGI_AUTHZ_SOCKET`（Stage 04）。**クラスと `channelAudience` の両方を引く。引数でどちらも受け取らない** |
| run 識別 | `GDG_WIKI_RUN_ID`（固定ランチャが設定。Stage 07 §3）。トレースの単位（§8） |
| 共有コア | `/opt/gdg-agent/lib/acl-core.ts`（新規）— パス分類・front matter 読み・manifest 解決・スパン解決・クラス解決。**ゲート（Stage 05）と `wk` が同じものを `./acl-core.ts` で import する** |
| 実装場所 | `cli/internal/wiki/hooks/` に `.ts` として置き、`//go:embed` で配布する（既存 `acl-gate.ts` と同じ流儀） |

サブコマンドは以下だけ。**逃げ道を作らない**（§制約）。

| コマンド | 動作 |
|---|---|
| `wk read <path> [--offset N] [--limit N]` | §3 の read 判定 → 不可なら非ゼロ終了。可なら §4 の濾過を通して出力 |
| `wk grep <pattern> [path...]` | 各ファイルに read 判定と濾過を適用してから照合する。**黒塗り部分は一致させない** |
| `wk ls <path>` | read 判定を通ったエントリだけを返す |
| `wk write <path>` | 本文を **stdin** から受け取る。§5 の順序で処理する |
| `wk rm <path>` | §5 の手順 1 と 2 を適用する（変更権限とスパン検査） |
| `wk git <status\|add\|commit\|diff>` | `git show` / `git diff` の生出力を出さない。diff は濾過して返す |

**`wk git` は git のフックとフィルタを無効にして起動する。**
`git -c core.hooksPath=/dev/null` を必ず付け、`commit` には `--no-verify` を渡す
（tripwire は `wk` 側にあり、`.git/hooks/` に依存しない。Stage 05 §5）。
clone 内に実行可能な `.git/hooks/*` や `.gitattributes` の filter driver が仮に存在しても、
**`wk git` がそれを実行する経路にならない**ようにする。
Stage 05 §2 がそれらの作成を deny しているので通常は空だが、
**`wk` はそこに依存する側に回らない。**

**`wk write` の入力は stdin 固定**（argv に本文を載せない）。
Stage 05 の argv allowlist は here-doc を deny するが、
**`wk write` 1 本の単純コマンドで区切りがクォートされている（`<<'EOF'`）場合だけ**を例外にする。

**`wk git` が要る理由。** 素の `git` を許すと `git show HEAD:<path>` と `git diff` が
**スパンの生本文を出す**。濾過を迂回する経路になるので、git もこの窓口を通す。

### 2. 判定に使う関数

**生成物 `./acl.ts` の評価器を直接呼ぶ。`wk` 側に判定ロジックを書かない。**
`acl.ts` は Stage 01 §5-5 の `agent.ts` から作られるので、
**そもそもクラス版の裸の評価器は import できない。**

**読み取りは 2 つの制約の AND である。**

| 対象 | 呼ぶ関数 |
|---|---|
| ページ（`pages/**`） | **`canClassesSeePageInChannel(page, classes, channelAudience)`** |
| ソース（`raw/**` / `memories/**` / スパンの `src`） | **`canClassesAccessSourceInChannel(source, classes, channelAudience)`** |
| 変更（`wk write` / `wk rm`） | **`canMutatePage(classes, page)`** — チャンネルで絞らない（§5） |

- 第 2 の制約（`channelAudience`）が要る理由は Stage 04 §2-2 にある。
  **クラス集合だけでは、全国写像のチャンネルの天井を表現できない。**
  `member` 写像のチャンネルで `{tokyo, member}` が残るので、
  クラス版だけを見ると `chapter-member` + `tokyo` の材料が読めてしまう。
- **`canAccessSource` を呼ばない**（そもそも見えない）。あれは `user.isAdmin` と
  `source.addedBy === user.id` を先頭で見るが、nonce が返すのはクラス集合と
  チャンネル audience だけで、user id も admin フラグも無い
  （[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)、
  変更権限は [ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する)）。
- **`audienceContains` も呼ばない。** あれはソース audience の包含を答える関数で、
  行為者の権限を表現しない。チャンネルの天井は `…InChannel` 版の内側にある
  `audienceKeyContains` / `pageAudienceIncludesChannel` が見る（Stage 01 §5-4）。

### 3. read 判定（ファイル単位）

#### 3-0. パスの正規化と封じ込め（判定より先に行う）

**判定表はパス種別で分岐する。したがって、分類する前にパスを確定させなければ意味が無い。**

1. 入力パスを clone root 基準で解決する。**`realpath` 相当で symlink も解決する。**
2. **解決後のパスが clone root の外に出たら拒否する**（非ゼロ終了）。
   **素通りにしない。** `wk` は clone のメディエータであって、
   操作者ホームの読み取りプリミティブではない。
   外部を読む必要が生じたら **明示的な正規パスの allowlist**（既定は空）で足す。
   workdir 外を守るのは Stage 07 の uid 分離とサンドボックスだが、
   **`wk` がそこに穴を開ける側に回らない。**
3. 判定表の照合は **解決後の clone 相対パス**に対して行う。
4. clone 内の symlink が clone 外を指す場合も拒否する。

**なぜ要るか。** 素通り行（`.gdgwiki/**`・`AGENTS.md`・`INGEST_QUEUE.md`）を
前方一致で照合すると、`wk read .gdgwiki/../raw/<secret>.md` が
**素通り行に当たって `raw/` の判定と濾過を丸ごと飛ばす。**
`pages/../..` のような形も同じ。**正規化を落とすと、判定表そのものが迂回可能になる。**

#### 3-1. 判定表

| パス | 判定 |
|---|---|
| `pages/**/page.md` | front matter の `visibility` / `chapter_id` / `access` → **`canClassesSeePageInChannel`** |
| `raw/**` | `.gdgwiki/state.json` の `manifest.documents[]` から該当エントリの `visibility` / `chapterId` を引き、**`canClassesAccessSourceInChannel`** |
| `memories/**` | ファイルの front matter の `visibility` / `chapter_id` → **`canClassesAccessSourceInChannel`** |
| `AGENTS.md`, `INGEST_QUEUE.md`, catalog / `log` ページ | 素通り |
| `.gdgwiki/**` | 素通り（下の注記を読むこと） |
| clone 内のその他 | 素通り |
| **clone root の外** | **拒否**（§3-0） |

**`chapterId` はマニフェストに Stage 02 §7 で追加される。**
それ以前のクローンのマニフェストには `chapterId` が無い。
**欠落を「チャプター無し」と読まない** — 欠落は未解決であり、下の fail closed で拒否する。
`gdg wiki raw pull` を 1 回回せば解決する。

> **`.gdgwiki/**` と `INGEST_QUEUE.md` の素通りについて。**
> この 2 つは「機密を含まない」わけではない。`state.json` の `manifest` と
> `INGEST_QUEUE.md` は、運用者から見える和集合**全件**の
> ソース名・パス・`source_id`・`visibility` を含む
> （`cli/internal/wiki/state.go:16`、`cli/internal/wiki/raw.go:445-455`）。
> 素通りにしているのは、**チャプター横断のメタデータ露出を受容した**からである。
> 根拠と、その受容が何を弱めるかは
> [ADR-004 の脅威モデル](adr.md#脅威モデル)の「守らないもの」に書いてある。
> **「機密を含まないから素通り」と読み替えないこと。** 前提が変わったらそちらを先に直す。
>
> **判定が素通りであることと、経路が `wk` に限られることは別である。**
> `cat .gdgwiki/state.json` は Stage 05 の argv allowlist で deny される。
> 読むなら `wk read .gdgwiki/state.json` を使う。

**fail closed。** 認可サーバに繋がらない・nonce が無効・**`channelAudience` が応答に無い**・
front matter が壊れている・manifest にエントリが無い、のいずれでも
**何も出力せず非ゼロ終了**する。
`channelAudience` の欠落を「制約なし」と読まない —
古い形の nonce も**同じく拒否**する（Stage 04 §2-2）。
判定材料はすべてローカルなので、`docs/plans/11-ingest-acl-hooks.md` が fail open にした理由
（ネットワーク障害で ingest が止まる）はここには当てはまらない。

### 4. スパンの濾過（`wk read` の中核）

**ファイル単位の判定を通ったあと、本文の `<acl>` スパンをクラスごとに濾す。**
ここが `<acl>` を「ページ可視性より狭い記述」として実際に機能させている唯一の場所である。

- `redactAclSpans(markdown, allow)`（Stage 01 で `gdg-lib` に移設）を使う。
  **スパンのパーサを自前で書かない。**
- `allow` は各スパンの `src` を **AND** で評価する
  （`span.srcIds.every(id => canClassesAccessSourceInChannel(source(id), classes, channelAudience))`）。
  サーバ側 `buildAclSpanPolicy` と同じ形に、チャンネルの天井を足したものである。
  **「どちらが厳しいか」を選ぼうとしない** — 5 値は全順序ではない。
- **許可されたスパンでもタグは剥がす。** 拒否されたスパンは `⬛︎⬛︎⬛︎` に置換する
  （`redactAclSpans` の既存仕様どおり）。**出力に `<acl` が現れてはいけない。**
- **`--offset` / `--limit` は濾過後の本文に対して適用する。** 濾過前に切ると行番号がズレる。
- `wk grep` も**濾過後の本文に対して照合する**。濾過前に照合すると、
  黒塗りの中身をヒットの有無で当てられる。

#### `source.id` → `visibility` のローカル解決

サーバ側の述語は `sources` テーブルを引くが、ローカルには無い。

- **`.gdgwiki/acl-sources.json`（新規）** に
  `{ "<sourceId>": { "visibility", "chapterId" } }` **だけ**を持つ。
  **パスも本文もタイトルも持たない**（メタデータ露出をこれ以上広げない）。
- `gdg wiki raw pull` がマニフェストから生成・更新する。
- `kind: "conversation"` はマニフェストに出ない（Stage 02 §4）ので、
  **xangi が `uploadMemory` 成功時に追記する**（Stage 08 §4）。
- **id が引けないスパンは拒否側に倒す。** サーバ側の
  「missing/deleted src → admin only（fail closed）」と同じ側である。

### 5. `wk write` の順序

stdin の新本文とディスク上の現在の本文を突き合わせ、**この順で**処理する。
**1 つでも落ちたら 1 バイトも書かずに非ゼロ終了する。**部分適用しない。

**先にリポジトリロックを取る。** `wk` の**最初の変更操作**
（`write` / `rm` / `git add` / `git commit`）で、認可サーバ経由で xangi に
リポジトリトランザクションミューテックスの取得を依頼する（[Stage 10](10-sleep-scheduler.md) §1a）。
**握るのは xangi である。`wk` はロックファイルを自分で持たない**
（`wk` は 1 コマンドごとに終了するので、保持者になれない）。
取れなければ**非ゼロ終了**し、stderr に理由と再試行の案内を出す。
読み取り操作（`read` / `grep` / `ls` / `git status` / `git diff`）は依頼しない。

0. **書き込み先のパス allowlist。**
   **通すのは `pages/**/page.md` だけ**（catalog / `log` はその中の例外）。
   **それ以外のパスはすべて拒否する。**
   「拒否リストに無ければ通す」形にしない — `wk` は clone の中の
   **任意の**ファイルを作れてはいけない。
   とくに `.cursor/mcp.json` / `.mcp.json` / `.cursor/sandbox.json` を workdir に
   置ける経路を、ここで構造的に閉じる（Cursor は `<projectRoot>/.cursor/mcp.json` を
   読み、projectRoot は共有 workdir である。Stage 05 の「確認済みの事実」を見よ）。
   §3-0 の正規化を先に通したパスに対して判定する。
1. **変更権限。**
   - 既存ページ → **`canMutatePage(classes, page)`**
     （organizer は全チャプター、member は自チャプター + `public` / `unlisted`）。
   - **新規ページ** → front matter の `visibility` / `chapter_id` を読み、
     **依頼者のクラスがその可視性を割り当てられるか**を検査する
     （`canAssignSourceVisibility` と同じ意味の判定をクラス集合で行う）。
     front matter が読めない・`visibility` が無い場合も拒否（fail closed）。
   - catalog ページと `log` は**常に許可**（航行が壊れるため。ADR-018 でも例外）。
   - `memories/**` / `raw/**` / `.gdgwiki/**` / `INGEST_QUEUE.md` は**常に拒否**
     （手順 0 の allowlist で既に落ちるが、理由を名指しで出す。§6）。
   - **`channelAudience` は変更権限に効かせない。**
     書き込みはチャンネルへの開示ではないので、天井を掛ける対象ではない。
     掛けると、`chapter-organizer` 写像のチャンネルから `public` ページを
     更新できなくなり、**ingest が 1 枚も書けなくなる。**
     開示側（read と濾過）だけがチャンネルで絞られる。
2. **読めなかったスパンの再合成。**
   ディスク側のスパンのうち依頼者が読めなかったものを、
   新本文の対応する `⬛︎⬛︎⬛︎` の位置に **元のバイト列のまま差し戻す**。
   プレースホルダが消えている・数が合わない・順序が入れ替わっている場合は **拒否する**。
   理由に「読めないスパンを動かした・消した」と出す。
   **これがあるので、濾過された読み取りをしたファイルでも書ける。**
   ここが無いと、黒塗りを見たエージェントの書き戻しが
   **スパンごと機密を消す**か、`⬛︎⬛︎⬛︎` を本文として commit する。
3. **`<acl>` の自動挿入。**（Stage 06）
4. **[ADR-020](adr.md#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) の拒否。**（Stage 06）
5. **`validateAclSpans`。** 通らなければ拒否（壊れた Markdown を書かない）。（Stage 06）
6. 書き込む。**`git add` は代行しない**（ADR-008）。

3〜5 の実装は Stage 06 の担当である。**ここでは順序と、落ちたら書かないことを決める。**

### 6. `memories/**` への書き込みを必ず拒否する

記憶ファイルを書くのは **xangi だけ**である（Stage 08）。
エージェントに書かせる理由が 1 つも無い一方、書けると次が起きる。

睡眠（Stage 10）は `memories/<file>` の front matter の `visibility` / `chapter_id` を
そのままアップロード時の可視性に使う。つまり**エージェントが front matter を偽造すると、
翌晩の ingest がその内容を任意の可視性のソースとしてサーバに登録する。**
`chapter-organizer` を名乗る記憶を置けば、それは organizer 限定の材料として扱われ、
以降その `source.id` で `<acl src>` タグが付く。

**この経路は成功時に何のエラーも出さない。** 拒否をテストで固定する。

### 7. 出力

`wk` は**通常の CLI として振る舞う**。Stage 05 のフックのような JSON は出さない。

- 本文は **stdout**。理由・診断は **stderr**。
- 拒否は **非ゼロ終了**で表す。`agent_message` 相当の説明を stderr に書く。
- 拒否のメッセージには**次に何をすればよいか**を書く。
  「読めないスパンを消した」「この visibility は割り当てられない（割り当て可能なのは …）」など。
  **理由の分からない拒否を返さない** — エージェントは同じことを繰り返す。

### 8. トレースの単位 — invocation ごとに 1 ファイル

**ここが `<acl>` 自動挿入（Stage 06）と `verify-acl` の入力なので、`wk` 側で単位を決める。**

現状は clone に 1 ファイル・`runId` 1 つである
（`cli/internal/wiki/trace.go:25-33` の `IngestTrace`）。
`gdg wiki ingest`（非 commit）が `ResetIngestTrace` で `reads` を切り詰め
（`cli/internal/command/wiki.go:557`）、`AppendTraceRead` はロック無しの read-modify-write である。
**Stage 07 はスロットを 4 つ用意し、全スロットが同じワークツリーで走る。**
したがって同時に走る 2 つの invocation は、互いの `reads` を消す。

消えたときの症状が問題である。`reads` が足りないと Stage 06 の自動挿入が
**タグを打たない**。しかも `verify-acl` に渡る `readSourceIds` は
**ローカルのトレースから作ってクライアントが送る値**である
（`cli/internal/wiki/verify.go:36` → `wiki/app/routes/api.cli.wiki.validate-acl.ts:151`）。
つまり **サーバ側のバックストップにも検出できない形で、機密派生行が未タグで push される。**

- トレースを **`.gdgwiki/ingest-trace/<runId>.json`** にする。
- `<runId>` は invocation スコープの識別子で、**固定ランチャが `GDG_WIKI_RUN_ID` で渡す**
  （Stage 07 §3。nonce と同じライフサイクル）。
- `wk` の read 記録・`wk git commit` の tripwire・`ResolveReadSourceIDs` / `VerifyACL` が
  **同じ `<runId>` のファイルだけ**を見る。
- **`GDG_WIKI_RUN_ID` が無い実行は非ゼロ終了する**（fail closed）。
  「無ければ共有ファイルにフォールバック」を作らない — それは元の穴である。
- push 成功後に xangi が当該ファイルを消す（`ClearIngestTrace` 相当を run 単位にする）。

**これは多重防御であって、リポジトリミューテックス（Stage 10 §1a）の代わりではない。**
git index / HEAD / `INGEST_QUEUE.md` の競合はミューテックスが閉じる。
トレースだけは、ミューテックスにバグがあっても静かに壊れない形にしておく。

### 制約

- **`wk` に生出力モードを作らない。** `--raw` / `wk cat` / `wk sh -c` を作らない。
  1 つでも作れば、Stage 05 の argv allowlist が無意味になる。
- **`wk write` に検査を飛ばすフラグを作らない。** `--no-verify` / `--force` を作らない。
  睡眠（Stage 10）用の例外も作らない — 睡眠こそ全チャプターの材料を横断する工程である。
- **`wk write` は落ちたら 1 バイトも書かない。** 途中まで書いて拒否すると、
  壊れた Markdown が残って以降の全 commit が落ちる。
- **読めなかったスパンの再合成を省かない**（§5 手順 2）。
- **判定ロジックを `wk` に書かない。** 生成物の `./acl.ts` を呼ぶ。
  **スパンのパーサも書かない。**
- **`wk git` から `core.hooksPath` の無効化を外さない**（§1）。
  外すと、`.git/hooks/` に置かれたスクリプトが `wk git commit` で実行される。
- **読み取りの判定でチャンネルの天井を落とさない**（§2）。
  クラス版の裸の評価器は `acl.ts` から見えないので、
  **それを迂回するために自前で `visibility` を比較する実装を書かない。**
  落とすと `member` 写像の全国チャンネルに `chapter-member` の材料が出る。
- **`channelAudience` の欠落を「制約なし」に倒さない。** 非ゼロ終了である（§3）。
- **パスの正規化を省かない**（§3-0）。素通り行への `..` 侵入は、判定表そのものの迂回である。
- **clone 外を素通りにしない。** `wk` を汎用の読み取りプリミティブにしない（§3-0）。
- **`wk write` / `wk rm` を「拒否リスト」形に戻さない。**
  `pages/**/page.md` の allowlist である（§5 手順 0）。
  戻すと、workdir 内に `.cursor/mcp.json` を置く経路が開く。
- **`GDG_WIKI_RUN_ID` の無い実行を共有トレースにフォールバックさせない**（§8）。
- **`wk` にリポジトリロックを握らせない。** 取得を依頼するだけである（§5 手順 0a）。
  1 コマンドで終了するプロセスが保持者になると、解放されないロックが残る。
- **`canAccessSource` / `audienceContains` を呼ばない。** 前者は user id と admin フラグを
  要求するので、`{ id: "", isAdmin: false }` のような値をでっち上げると
  **`addedBy === ""` のソースが誰にでも読めるようになる。**
- **`wk rm` を read 判定だけで通さない。** 削除は変更である。
- **`memories/**` への書き込みを例外的にでも許さない**（§6）。
- **新規ページ作成を無条件に許可しない。** front matter の可視性を作成の瞬間に検査する。
  `AGENTS.md`（自己申告）と `verify-acl`（fail open）は、ここの代わりにならない。
- **read 判定は fail closed。** `wk git commit` から呼ばれる `verify-acl` だけが fail open である
  （Stage 05 §5）。混ぜない。
- **`acl-core.ts` をゲートと共有する。** 判定を 2 箇所に書くと必ずドリフトし、
  ドリフトした瞬間にゲートは嘘をつく。
- **front matter を自前で再パースしない。** `cli/internal/wiki/local.go` の規約に合わせる。
- **5 値を全順序として扱わない**（`docs/plans/10-page-acl-spans.md` §0）。
  複数ソースは常に AND。
- Stage 00 の Node ネイティブ TypeScript、依存ゼロ、`execFileSync` / `spawnSync`
  （シェル文字列を組み立てない）。
- `cli/internal/wiki/remote_helper.go` の push 制限を緩めない。

---

## Files to touch — 変更ファイル

### `cli/`

- `internal/wiki/hooks/wk.ts`（新規）— `wk` 本体。サブコマンドのディスパッチと
  `read` / `grep` / `ls` / `write` / `rm` / `git`
- `internal/wiki/hooks/acl-core.ts`（新規）— パス分類・front matter 読み・
  manifest 解決・`acl-sources.json` 解決・nonce によるクラス解決。
  **ゲート（Stage 05）と共有する**
- `internal/wiki/raw.go` — `raw pull` で `.gdgwiki/acl-sources.json` を生成・更新する（§4）
- `internal/wiki/state.go` — `acl-sources.json` の読み書き
- `internal/wiki/trace.go` — トレースを `.gdgwiki/ingest-trace/<runId>.json` に分ける（§8）。
  `LoadTrace` / `WriteTrace` / `ResetIngestTrace` / `ClearIngestTrace` /
  `AppendTraceRead` / `AppendTraceWrite` が `runId` を受け取る形にする
- `internal/wiki/verify.go` — `ResolveReadSourceIDs` / `VerifyACL` が
  run 単位のトレースを読む（§8）
- `internal/command/wiki.go` — `ingest` の `ResetIngestTrace` 呼び出し（`:557`）を
  run 単位にする。`GDG_WIKI_RUN_ID` の無い実行を拒否する
- `internal/wiki/hooks.go` — `//go:embed` に `wk.ts` / `acl-core.ts` を追加し、
  `/opt/gdg-agent/bin/wk` launcher、`/opt/gdg-agent/lib/wk.ts`、
  `/opt/gdg-agent/lib/acl-core.ts` の設置を検査する。
  **生成物の `acl.ts` は embed しない**（[Stage 00](00-typescript-runtime.md) §5）
- `internal/wiki/hooks_test.go`, `internal/wiki/state_test.go`（新規）

---

## Verification — 完了条件と検証

### 完了条件

**ゲート（Stage 05）が無い状態で、`wk` を直接叩いて確認する。**

1. `wk read` が、権限クラスで読めないページ・raw・記憶に対して**非ゼロ終了**する。
2. **読めるページの中の、読めない `<acl>` スパンだけが `⬛︎⬛︎⬛︎` になる。**
   同じページを、そのスパンを読めるクラスで読むと**中身が見える**。
   **どちらの場合も出力に `<acl` が現れない。**
3. `wk grep` が黒塗り部分に一致しない。`wk ls` が読めないエントリを返さない。
4. `--offset` / `--limit` が**濾過後の本文**に対して効く（行番号がズレない）。
4a. **`member` 写像のチャンネルの nonce で、`chapter-member` + 自分のチャプターの
   raw が `wk read` できない。** 同じユーザー・同じソースを
   `chapter-member` 写像のチャンネルの nonce では読める。
   `organizer` 写像 × `chapter-organizer` でも同じ。
4b. `channelAudience` を欠いた `/resolve` 応答を返すと、
   すべてのサブコマンドが**非ゼロ終了**する。
4c. **clone 外のパス（`~/.config/gdg/credentials.json` など）を `wk read` すると
   非ゼロ終了する。** 素通りしない。
4d. **`wk read .gdgwiki/../raw/<secret>.md` が拒否される。**
   `wk read pages/../../etc/passwd`、clone 内の外向き symlink も拒否される。
5. 認可サーバを止めると、すべてのサブコマンドが**非ゼロ終了**する（fail closed）。
6. **`member` のみのクラスが、他チャプターの `restricted` ページを `wk write` できない。**
   同じクラスで `public` ページと自チャプターのページは `wk write` **できる**
   （[ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する) の意図的な選択）。
6a. `organizer` を含むクラスは、他チャプターのページも `wk write` できる（同上）。
6b. **`wk rm` が変更判定を通る。** 読めるだけのページを削除できない。
6c. **`memories/**` への `wk write` が、どのクラスでも拒否される。**
6d. 新規ページを、依頼者のクラスが割り当てられない `visibility` で作ろうとすると拒否される。
6e. **`pages/**/page.md` 以外への `wk write` がすべて拒否される** —
   `.cursor/mcp.json`、`.mcp.json`、`AGENTS.md`、`INGEST_QUEUE.md` を名指しで確認する。
6f. **`chapter-organizer` 写像のチャンネルの nonce で `public` ページを `wk write` できる。**
   書き込みにチャンネルの天井が掛かっていないこと（§5）。
7. **黒塗りを見たクラスが `wk write` で書き戻したとき、
   読めなかったスパンが元のバイト列のまま残る**（§5 手順 2）。
7a. **`⬛︎⬛︎⬛︎` を消して書き戻すと拒否される。**
8. **どの拒否でも、ファイルがバイト単位で変わっていない。**
9. `.gdgwiki/acl-sources.json` が `raw pull` で生成され、
   そこに無い `source.id` を持つスパンが**拒否側に倒れる**。
10. `wk git diff` がスパンの生本文を出さない。
11. **トレースが `.gdgwiki/ingest-trace/<runId>.json` に分かれている。**
   `GDG_WIKI_RUN_ID` の無い `wk` 実行が非ゼロ終了する。
   2 つの run を交互に動かしても、互いの `reads` が消えない。

### コマンド

```bash
cd /Users/hari/proj/gdgjp/cli && go test ./...
```

```bash
pnpm --filter @gdgjp/gdg-lib build:acl
```

生成先は `cli/internal/wiki/hooks/acl.ts` である（[Stage 00](00-typescript-runtime.md) §5）。
`go test` の前に必ず回す。

```bash
XANGI_AUTHZ_NONCE=... XANGI_AUTHZ_SOCKET=/run/gdg-agent/0/authz.sock /opt/gdg-agent/bin/wk read pages/x/page.md
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **スパンの濾過が効いている。** `public` ページに埋めた `chapter-organizer` の
  `<acl src>` が、そのソースを読めないクラスの `wk read` で `⬛︎⬛︎⬛︎` になること。
  **ここが抜けると、ページを読めるすべてのクラスに機密が平文で見える。**
  Stage 06 の自動挿入が workdir 内で意味を持たなくなる。
  **黒塗りが出ないことは、権限があるのか濾過が壊れているのか区別が付かない** —
  権限あり・権限なしの両方を同じテストに並べて固定する。
- **出力に `<acl` が現れない。** 許可・拒否のどちらでもタグは消えること。
  残ると、エージェントがそれを本文として書き戻し、ネストしたスパンができる。
- **引けない `source.id` を持つスパンが拒否側に倒れる。** `acl-sources.json` に
  無い id で「判定できないから通す」に倒れないこと。
- **再合成がバイト単位で正しい。** 読めなかったスパンが、書き戻し後も
  **1 バイトも変わっていない**こと。**壊れると、機密が消えるか `⬛︎⬛︎⬛︎` が commit される。
  どちらもエラーにならないので、ページを見るまで気づけない。**
- **拒否でファイルが変わらない。** 手順 1〜5 のどれで落ちても、
  ワークツリーが bit 単位で同一であること。
- **`--limit` が濾過前に効いていない。** 濾過前に切ると、
  黒塗りの分だけ行番号がズレて、インデックス（Stage 09）の行範囲と食い違う。
- **`wk grep` が濾過後に照合している。** 濾過前だと、
  ヒットの有無で黒塗りの中身を当てられる。
- **`wk git diff` / `wk git status` が生本文を出さない。** ここが素通りだと、
  `wk read` の濾過を丸ごと迂回できる。
- **チャンネルの天井が効いている。** `member` 写像のチャンネルの nonce で
  `chapter-member:<自分のチャプター>` の raw とスパンが読めないこと。
  **同じユーザーが `chapter-member` 写像のチャンネルでは読めること**を同じテストに並べる
  （読めないことだけを見ると、権限が無いのか天井が効いているのか区別が付かない）。
  **ここが抜けると、全国チャンネルにチャプター限定の材料が出る。漏れた側にエラーは出ない。**
- **`channelAudience` 欠落が fail closed。** 「無い = 制約なし」に反転しないこと。
- **書き込みにチャンネルの天井が掛かっていない。** `chapter-organizer` 写像の
  チャンネルから `public` ページを書けること。**締めると ingest が 1 枚も書けなくなる。**
- **パスの正規化。** `wk read .gdgwiki/../raw/<secret>.md` /
  `pages/../../etc/passwd` / clone 内の外向き symlink が**すべて拒否**されること。
  **素通り行への `..` 侵入が通ると、判定表を丸ごと迂回できる。**
- **clone 外が素通りになっていない。** `wk read` が clone 外のパスを拒否すること。
- **`wk write` が allowlist であること。** `pages/**/page.md` 以外
  （`.cursor/mcp.json` / `.mcp.json` / `AGENTS.md`）が拒否されること。
  **「拒否リストに無いものは通す」に戻すと、workdir 内に MCP 設定を置ける。**
- **トレースが run ごとに分かれている。** 2 つの `runId` で交互に
  `wk read` → `ingest` reset を行い、**双方の `reads` が生き残ること**。
  共有ファイルに戻すと、`verify-acl` はクライアント申告なので
  **サーバ側でも検出できないまま未タグの機密派生行が push される。**
- **`GDG_WIKI_RUN_ID` の無い実行が共有トレースにフォールバックしない。**
- **`wk` に生出力の抜け道が無い。** `--raw` / `wk cat` / `wk sh -c` /
  `wk write --no-verify` が存在しないこと（grep で固定する）。
- **`wk` が `./acl.ts` を呼んでいる。** `wk` 内に `visibility` の
  文字列比較やスパンの正規表現が再実装されていないこと（grep で固定する）。
- **`wk git` が `core.hooksPath=/dev/null` 付きで git を起動している。**
  `.git/hooks/pre-commit` を人為的に置いて、それが**実行されない**ことを固定する。
- **`canAccessSource` / `audienceContains` を呼んでいない。** grep で固定する。
- **`memories/**` への write が拒否される。** 通ると、偽造した front matter が
  翌晩の ingest で任意の可視性のソースとして登録される。
  **成功時は何のエラーも出ないので、ページが増えて初めて気づく。**
- **`wk rm` が変更判定を通る。** read 判定だけで通ると、
  **読めるページはすべて削除できる。**
- **`canMutatePage` の意図的な緩さが固定されている。** `organizer` クラスが他チャプターの
  ページを書けること、`member` のみのクラスが `public` ページを書けることを
  **明示的にテストする**。バグに見えるので、テストが無いと後から「修正」される。
- **正当な新規ページ作成が止まらない。** 依頼者のクラスで割り当て可能な `visibility` の
  新規ページは通ること。締めすぎると ingest が何も書けなくなる。
- **マニフェストに `chapterId` が無いエントリが拒否される。** 「無い = チャプター無し」と
  解釈して `chapter-member` を通してしまわないこと。
- **fail closed。** 認可サーバ停止・nonce 失効・front matter 破損のすべてで
  非ゼロ終了すること。

### 手動 E2E

**ゲートを入れる前に、ここまで全部通すこと。**

1. `pnpm --filter @gdgjp/wiki dev`（:5177）を起動し、`GDG_WIKI_URL` を向ける。
2. `organizer` visibility のソースを 1 件登録し、`gdg wiki clone` + `raw pull` する。
   `.gdgwiki/acl-sources.json` ができていることを確認する。
3. `member` クラスの nonce を発行し、その raw を `wk read` → **失敗する**ことを確認する。
4. `organizer` クラスの nonce で同じ操作 → 通ることを確認する。
5. **スパンの濾過。** `visibility: public` のページに
   `<acl src="<organizer ソースの id>">機密の一文</acl>` を仕込む。
   - `member` クラスで `wk read` → 本文は読めるが該当箇所が `⬛︎⬛︎⬛︎` になる。
   - `organizer` クラスで `wk read` → 中身が見える。
   - どちらも出力に `<acl` が無い。
6. **書き戻し。** 5 の `member` クラスのまま、黒塗りを含む本文に 1 行足して
   `wk write` → **通り**、`⬛︎⬛︎⬛︎` の位置に元のスパンが**バイト単位で復元**されている
   ことを確認する（`organizer` クラスで `wk read` して見る）。
6a. `⬛︎⬛︎⬛︎` を消して `wk write` → **拒否され、ファイルが変わっていない**ことを確認する。
7. 認可サーバを止めて 3 を再実行 → 失敗することを確認する（fail closed）。
8. `member` のみのクラスで、**他チャプターの** `restricted` ページを `wk write` →
   拒否されることを確認する。
8a. 同じクラスで `visibility: public` のページを `wk write` → **通る**ことを確認する。
8b. `organizer` を含むクラスで、他チャプターのページを `wk write` → **通る**ことを確認する。
8c. どのクラスでも `memories/` 配下に `wk write` → 拒否されることを確認する。
8d. `wk write .cursor/mcp.json` → 拒否されることを確認する（§5 手順 0）。
9. `wk git diff` を実行し、黒塗りされるべきスパンの中身が出ないことを確認する。
10. **チャンネルの天井。** 同じユーザーで nonce を 2 つ発行する
   （`member` 写像のチャンネル / `chapter-member` 写像のチャンネル）。
   `chapter-member` の raw を `wk read` すると、**前者では失敗し、後者では通る**ことを確認する。
11. `wk read ~/.config/gdg/credentials.json` と
   `wk read .gdgwiki/../raw/<secret>.md` が拒否されることを確認する。
