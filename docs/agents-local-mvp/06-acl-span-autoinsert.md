# Stage 06 — Automatic acl span insertion in `wk write`

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 10（`docs/plans/10-page-acl-spans.md`）が導入した `<acl src="…">` スパンは、
**エージェントが自分で書くこと** を前提にしている。書き忘れると、
機密ソース由来の記述が全員の読めるページに平文で残る。
検出点は `git push` 時のサーバ（`acl_required`）と、
`docs/plans/11-ingest-acl-hooks.md` が足した
`gdg wiki verify-acl` のクライアント側検査だけで、どちらも
**「書き忘れを見つけて突き返す」** ものである。

突き返された後、エージェントは「どの文がどのソース由来か」を自力で逆算して囲み直す。
往復が高く、しかも逆算の精度は「囲み忘れた当人と同種のモデル」に依存する。

このステージで、**書き込みの唯一の窓口（Stage 05 の `wk write`）が
タグを自動で挿入する**。検証は挿入後、書き込みの前に走る。

### 設計方針 — 保守的な過剰タグ

フックはプロヴェナンス（どの文がどのソース由来か）を知らない。知っているのは
「この run で `member` より狭いソース S を読んだ」ことと「差分でこの行が増えた」ことだけである。

したがって **正確さではなく、保守側に倒した過剰タグ** しか原理的に提供できない。

- 追加行を丸ごと `<acl src>` で包む。
- **n-gram で raw と一致する行だけを包む、といった絞り込みはしない。**
  言い換えたら漏れるので、保守側に倒すという趣旨に反する。
- **エージェントに「広く公開してよい行は自分で外せ」と指示しない。**
  外す判断を再び LLM の自己申告に戻すことになる。

過剰タグの副作用（本来公開してよい記述が黒塗りになる）は、
**人間が後から `<acl>` を外す** ことで解消する。これは wiki の編集画面でできる。

### 依存と対象範囲

- **先行ステージ: [Stage 11](11-wk-mediator.md)（`wk` 本体）。**
  本ステージは **`wk write` の手順 3〜5**（[Stage 11](11-wk-mediator.md) §5）の中身を実装する。
  手順 1（変更権限）と手順 2（読めなかったスパンの再合成）は Stage 11 の担当である。
  ゲート（Stage 05）とは独立に着手できる。
- 対象は `cli/`（フックスクリプトと `verify-acl`）と `docs/plans/03a-agents-md.md`。
- **記憶由来の run（`memories/` 起点）も同じ機構で扱う。** 記憶は Stage 08 で
  サーバの `sources` 行になり `source.id` を持つので、`src=` がそのまま使える。
  **`<acl level="…">` の逃げ道は使わない。**
- `wiki/` のサーバ側の検証（`validatePageAclForSync`）は **変更しない**。

### 読むべきもの

- `docs/plans/10-page-acl-spans.md` — **特に §0「権限の代数」と §1「構文」**
- `docs/plans/11-ingest-acl-hooks.md` — `verify-acl` の exit code 規約とトレースの扱い
- `docs/plans/03a-agents-md.md` — `AGENTS.md` 全文。`## Confidentiality and Span ACLs` 節
- `docs/agents-local-mvp/index.md` §6

### 再利用する既存実装（書き直さない）

- `cli/internal/wiki/hooks/acl.ts`（Stage 01 の `build:acl` 生成物）—
  `parseAclSpans` / `validateAclSpans` /
  `aclSpanSourceIds`。**スパンのパーサを自前で書かない**
- `cli/internal/wiki/trace.go` — トレース（`reads[]` と `BaseRev`）。
  **単位は invocation ごと**（`.gdgwiki/ingest-trace/<runId>.json`）である。
  ファイルの単位と `GDG_WIKI_RUN_ID` の扱いは
  [Stage 11](11-wk-mediator.md) §8 が唯一の記述 — **このファイルに書き戻さない**
- `cli/internal/wiki/verify.go` — `CollectChangedPageRels`、`ResolveReadSourceIDs`、
  `VerifyACL`。**変更ページの収集は git から取るのが権威**
- `cli/internal/wiki/state.go` — `state.Manifest.Documents[]` の
  `SourceID` / `Path` / `Visibility`
- `cli/internal/wiki/local.go` — `LocalPages` / `FrontMatter`（`yaml.v3`）
- `wiki/app/routes/api.cli.wiki.validate-acl.ts` — サーバ側 dry-run。**変更しない**

---

## Design — 設計

### 1. 起動点 — 書き込みの唯一の窓口で挿入する

挿入は **`wk write`**、すなわち**バイトがディスクに着く直前**に行う。

**理由は 3 つある**（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

1. **staged blob の穴が構造的に生じない。** commit 時にだけ挿入すると、
   エージェントが `git add` を済ませていた場合、書き換わるのはワークツリーだけで
   **staged blob はタグ無しのまま commit される**。
   書き込み時に挿入すれば、`git add` の時点でディスク上のファイルが既にタグ済みである。
2. **捕まえられない書き込み経路が無い。** Stage 05 は Cursor の Write / Edit ツールを
   deny し、shell を argv allowlist（`wk` のみ）にした。
   `cat > file` / `sed -i` / `python` は**そもそも実行できない**。
   `afterFileEdit` フックが必要だった理由（Cursor の編集ツールにしか発火しない）が消える。
3. **同期的に拒否できる。** `afterFileEdit` は `failClosed` を持てないので deny を返せず、
   §3 の拒否が「検出は 2 箇所・deny は 1 箇所」に割れる原因だった。
   `wk write` は非ゼロ終了で拒否できる。

| 起動点 | 対象 | 結果 |
|---|---|---|
| **`wk write`**（唯一） | 書き込まれる `pages/**/page.md` 1 件 | 挿入・検査してから書く。**落ちたら 1 バイトも書かない** |

**`afterFileEdit` を使わない。** 「保険として残す」もしない —
挿入ロジックが 2 箇所になり、除外規則がズレて片方だけが catalog を包む。

`git add` を代行して index を直す案も採らない。
index を書き換える副作用があり、`git commit -- <path>` / `-a` /
`git add -p` の組み合わせを網羅できない。

#### commit 時の検査は tripwire として残す

`wk git commit` は **`git diff --cached`（index）** に未タグの追加行が無いかを見る。

- **あったら deny する。挿入はしない。**
  書き込み経路は `wk write` 1 本なので、**未タグの staged blob が存在すること自体が、
  `wk` を通らない書き込みが成立したという意味**である。
  `agent_message` と stderr に **「ゲート違反の可能性」**として出す。
- **検査対象をワークツリーにしない。** `git commit -a` / pathspec 指定 / `git add -p` を
  跨いで正しいのは index である。ワークツリーだけを見ると
  **「ワークツリーはタグ済み・index は未タグ」を見逃す。**
- 未タグが無ければ `gdg wiki verify-acl` を呼び、exit 1 なら deny、
  それ以外は許可（fail open は §6）。
- **通常経路では deny は 1 回も起きない。**

### 2. 対象の決定

**包むソース ID の集合 S**:

- **この run のトレース**（`.gdgwiki/ingest-trace/<runId>.json`、[Stage 11](11-wk-mediator.md) §8）の
  `reads[]` を `state.Manifest.Documents[].Path` と前方一致で照合して `SourceID` に解決したもの。
  **共有ファイルを読まない** — 他の invocation の `reads` が混ざるか、
  逆に自分の `reads` が消える
- `BuildIngestQueue` の `pending` のうち **ロック済みのエントリ** の `SourceID`
  （現行の `ResolveReadSourceIDs` は `pending[0]`（キュー先頭）を無条件に足すが、
  並列 ingest では自分がロックした ID とズレる。**ここを直す**）
- このうち `visibility` が `member` より狭いものだけを残す
  （`member` / それより広いものはタグ不要）

S が空なら何もせず 2 に進む。

**包む範囲**:

- 対象は **`wk write` が書こうとしている 1 ファイル**である。
  `BaseRev` 版とこれから書く本文との差分の **追加行** を取る。
- 新規ページは本文全体が追加行。
- **`CollectChangedPageRels` はここでは使わない。** あれは変更ページの集合を求める関数で、
  commit 時の tripwire と `verify-acl` の側が使う。

### 3. 除外規則（守らないと wiki が壊れる）

以下は **絶対に包まない**。

| 除外対象 | 理由 |
|---|---|
| front matter（`---` に挟まれた領域） | `<acl>` は本文専用。メタデータに入ると `acl_in_metadata` |
| コードフェンス（```` ``` ````）の内側 | パーサが ACL タグとして解釈してはいけない領域 |
| catalog ページ（namespace 直下の一覧） | 全員が読めないと航行が壊れる |
| `log` | 同上 |
| 見出し行（`#` で始まる行） | 目次が黒塗りだらけになる |
| 既に `<acl>` の内側にある行 | ネストは禁止（`acl_malformed`） |
| 空行・リスト記号だけの行 | 意味を持たない |

判定には `gdg-lib` の `parseAclSpans` を使って既存スパンの範囲を取り、
その外側の追加行だけを対象にする。

> **front matter・catalog・`log` は「包まない」だけで、拒否もしない。**
> 見出しとフェンス内側は下の §「包めない位置に落ちた…」で**拒否する**のに、
> この 3 つは通す。差の理由（拒否すると `chapter-organizer` 由来の ingest が
> ページを 1 枚も作れなくなる／page ACL に対応する可視性が無い）は
> [ADR-020](adr.md#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) にある。
> **`title` / `summary` / `tags` と catalog エントリからの漏洩は受容事項である** —
> [ADR-004 の脅威モデル](adr.md#脅威モデル)の「守らないもの」を読むこと。
> 「包まないから安全」と読み替えないこと。

#### 包めない位置に落ちた機密派生行は、飛ばさずに**拒否する**

上の表のうち **見出し行**と**コードフェンスの内側**は、
「包まない」だけでは済まない。**内容がそのまま残るからである。**

サーバ側の `validatePageAclForSync` が保証するのは
「引用された各ソースが、ページの audience に覆われているか、
**本文のどこかに** `<acl src>` として現れること」だけである
（`wiki/app/lib/acl-spans.server.ts:295-300`）。
**行ごとに包まれたことは検証していないし、原理的にできない。**
したがって、機密ソース由来のイベント名を見出しに書き、
別の場所に `<acl src>` が 1 つでもあれば、**その見出しは公開されたまま検査を通る。**

**規則:** S が空でない run で、包む対象になるはずの追加行が
見出し行またはフェンス内側にあったら、**その編集を失敗させる。**

- `agent_message` に **ファイル・行番号・該当 `source_id`** を挙げる。
- 「この内容は `<acl>` で包める位置（本文の段落）に移してから書き直すこと」と指示する。
- 空行・リスト記号だけの行・catalog・`log` は対象外のまま（そもそも包む必要が無い）。

**この検査は `wk write` の中で走り、そこで拒否する。**
書き込みの窓口が 1 つになったので、**検出と拒否が同じ場所で起きる**（§1）。
拒否は `wk write` の非ゼロ終了であり、**ファイルは 1 バイトも変わらない。**

**検査を 2 箇所に分けない。** 分けると除外規則がズレて、片方だけが catalog を包む。

根拠は [ADR-020](adr.md#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する)。

### 4. 挿入の形

連続する追加行を 1 つのブロックにまとめ、**ブロック形式** で包む。

```markdown
<acl src="7sLHj_rsleSlrEd1yH6CN AbCdEf01234567890abcd">
（追加された連続行）
</acl>
```

- **複数ソースは AND**（スペース区切り）。「どちらが厳しいか」を機械が選ばない。
  5 値は全順序ではないので、選ぼうとした瞬間に設計が壊れる。
- インライン形式は使わない（行の途中に挿入すると Markdown の構造を壊しやすい）。
- 挿入後に `validateAclSpans` を通し、`ok: false` なら **`wk write` 全体を拒否する**
  （壊れた Markdown を書かない）。巻き戻しは要らない — まだ書いていない。
- 検査を全部通ってから書き込む。**`git add` は代行しない**（§1）。
  エージェントがこの後に `wk git add` するので、
  **staged blob には既にタグが入っている。**

### 5. 記憶由来の run

`memories/` 起点の run（Stage 10 の睡眠）でも、記憶は Stage 08 で
`POST /api/agent/sources/inline` に登録され `source.id` を持つ。

**この `source.id` は `state.Manifest` には現れない。** `kind: "conversation"` は
CLI マニフェストから除外されており（Stage 02 §4）、`raw pull` でも `raw/` に落ちてこない。
エージェントが読むのはローカルの `memories/<file>` である。

- 睡眠は記憶をアップロードして得た `source.id` を
  **その run のトレース**（`.gdgwiki/ingest-trace/<runId>.json`）に直接記録する
  （`trace.go` に `AppendTraceSource(runID, sourceID)` を足す）。
  **`state.Manifest` を引いてパスから解決する既存経路（`ResolveReadSourceIDs`）は使わない** —
  manifest に無いので解決できない。ID を直接積む口が要る。
- **同じ `source.id` を `.gdgwiki/acl-sources.json`（[Stage 11](11-wk-mediator.md) §4）にも積む。**
  トレースは「この run が何を読んだか」、`acl-sources.json` は
  「その id の可視性は何か」であって、役割が違う。
  積み忘れると、挿入したタグを `wk read` が解決できず、
  **翌日以降そのページ全体が拒否側に倒れる。**（Stage 08 §4 の担当。）
- それ以降は raw 由来と同じ。`<acl>` の自動挿入も `verify-acl` も、
  トレースに載った `source.id` を見るだけなので区別しない。
- **`INGEST_QUEUE.md` を経由しない。** キューは `raw/` 由来のソース専用である。

### 6. 失敗時の扱い

**挿入時（`wk write`）と commit 時で方針が違う。混ぜない。**

`wk write` の挿入（**fail closed**）:

- 例外・`state.json` 欠損・`BaseRev` が取れない・`validateAclSpans` が落ちる →
  **1 バイトも書かずに非ゼロ終了する。**
- **「挿入できなかったからタグ無しで書く」に倒さない。**
  ここが fail open だと、機密派生行が素のまま `pages/` に載る。
  取りこぼしを拾う後段（旧 backstop）はもう挿入しないので、**ここが最後の砦である。**
- 拒否のメッセージには理由と対処を書く。エージェントは書き直せる。

commit の tripwire（**fail open**）:

- `state.json` が無い・`BaseRev` が取れない・git が失敗する・
  `gdg` が PATH に無い・`verify-acl` がネットワークで落ちる →
  **stderr に 1 行警告して許可する**。
  実効境界はサーバの `/sync` 側にあるので、ここで通しても漏洩にはならない。
- deny の理由は 2 つだけ: **①index に未タグの追加行がある**（ゲート違反の疑い）、
  **②`verify-acl` の exit 1**（ACL 違反）。この規約を崩さない。
  **「挿入した」は理由から消える** — tripwire は挿入しない（§1）。

### 7. `AGENTS.md` の更新

`docs/plans/03a-agents-md.md` の `## Confidentiality and Span ACLs` 節に追記する。

- `<acl>` は **`wk write` が自動で挿入する**こと。
- 自動挿入は保守的で、公開してよい記述まで包むことがあること。
- **エージェントが自分でタグを外してはいけない**こと（人間が編集画面で外す）。
- それでも拒否されたときの直し方（`wk write` の stderr に出たファイル・行・
  `source_id` を見て、本文の段落に移して書き直す）。
- **`⬛︎⬛︎⬛︎` は「読む権限が無いスパン」であり、消してはいけない**こと。
  消して `wk write` すると拒否される（[Stage 11](11-wk-mediator.md) §5）。

`AGENTS.md` は DB 行（`wiki_agent_instructions`）が正なので、
管理者の push で既存環境に反映される。

### 制約

- **n-gram その他の絞り込みをしない。** 保守側に倒す。
- **エージェントにタグを外させない。** 自己申告に戻る。
- **複数ソースは常に AND。** visibility を大小比較しない（`10-page-acl-spans.md` §0）。
- **front matter / catalog / `log` / 見出しを包まない。** 包むと wiki の航行が壊れる。
- **ただし「包まない」を「黙って通す」にしない。** 見出しとフェンス内側に
  機密派生行が落ちたら、§3 のとおり**編集を拒否する**。
  ここを素通りにすると、サーバ側の検査は
  「ページのどこかに `<acl src>` があるか」しか見ないので**通ってしまう**
  （[ADR-020](adr.md#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する)）。
- **拒否を `afterFileEdit` に戻さない。** あのフックはもう使わない
  （[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。
  **検出も拒否も `wk write` の 1 箇所。**
- **`validateAclSpans` が通らない挿入は書き込み全体を拒否する。**
  壊れた Markdown を残さない。
- **`wk write` の挿入は fail closed、commit の tripwire は fail open。** 混ぜない。
  挿入を fail open にすると、機密派生行がタグ無しで `pages/` に載る。
- **`verify-acl` の exit 1 は「ACL 違反」だけを意味する。** インフラ的失敗を 1 で返さない。
- **Go 側に `<acl>` パーサを書かない**（`docs/plans/11-ingest-acl-hooks.md` の制約）。
  挿入は `.ts` 側で `gdg-lib` を使って行う。
- **`ResolveReadSourceIDs` の「キュー先頭を無条件に足す」を、
  「自分がロックした ID を足す」に直す。** 並列 ingest で他人のソースの
  タグを要求してしまう既存のバグである。

---

## Files to touch — 変更ファイル

### `cli/`

- `internal/wiki/hooks/acl-insert-core.ts`（新規）— 挿入ロジックの実体。
  対象行の決定（§2）、除外規則（§3）、ADR-020 の拒否、挿入の形（§4）。
  **`wk write` から呼ぶ。挿入の実装はここ 1 箇所だけに置く**
- `internal/wiki/hooks/wk.ts`（Stage 11 で新設）— `write` サブコマンドの手順 3〜5 で
  `acl-insert-core.ts` を呼ぶ
- `internal/wiki/hooks/acl-gate.ts` — `wk git commit` 検出時の tripwire
  （`git diff --cached` の検査と `verify-acl`。**挿入はしない**）
- `internal/wiki/trace.go` — `AppendTraceSource(runID, sourceID)`、`BaseRev` の初期化タイミング。
  **run 単位のファイル分割そのものは [Stage 11](11-wk-mediator.md) §8 の担当**
- `internal/wiki/verify.go` — `ResolveReadSourceIDs` をロック済み ID ベースに修正
- `internal/wiki/locks.go` — ロック済み document → source の解決を公開
- `internal/command/wiki.go` — `ingest lock` でトレースの `BaseRev` を確実に初期化する
  （現在は bare `gdg wiki ingest` でしか `ResetIngestTrace` が走らない）
- `internal/wiki/verify_test.go`, `internal/wiki/trace_test.go`

### `docs/`

- `docs/plans/03a-agents-md.md` — `## Confidentiality and Span ACLs` に自動挿入の説明を追記

---

## Verification — 完了条件と検証

### 完了条件

1. **通常経路。** `organizer` visibility のソースを読んだ run が `wk write` で
   `<acl>` 無しの本文を書くと、**書かれたファイルの追加行が
   `<acl src="…">` に包まれている**。続く `wk git add` と `wk git commit` は
   **deny されずに通り、`git show HEAD:<path>` にタグが入っている**。
2. **tripwire。** index に未タグの blob を人為的に作って `wk git commit` すると
   **deny され**、`agent_message` に対象パスと「ゲート違反の可能性」が出る。
   **ワークツリーがタグ済みでも deny される**（検査対象が index であること）。
3. 挿入されたスパンで `gdg wiki verify-acl` が通り、`git push` がサーバに
   `acl_required` で拒否されない。
4. 複数の機密ソースを読んだ run では `src="<id1> <id2>"` の形になる。
5. front matter・catalog ページ・`log`・見出し行に `<acl>` が挿入されない。
5a. **機密派生行が見出し行またはフェンス内側に落ちた場合、`wk write` が拒否され**、
   stderr にファイル・行番号・`source_id` が出る。**ファイルは 1 バイトも変わっていない。**
   本文の段落に移して書き直すと通る。
6. `member` 以上のソースしか読んでいない run では何も挿入されない。
   **5a の拒否も起きない**（S が空なら包む対象が無いため）。
7. **挿入が失敗したら書き込みも失敗する。** `state.json` 欠損・`BaseRev` 不在で
   `wk write` が非ゼロ終了し、ファイルが変わっていないこと。
   一方で **commit の tripwire はネットワーク障害・`gdg` 不在で commit をブロックしない。**

### コマンド

```bash
cd /Users/hari/proj/gdgjp/cli && go test ./...
```

```bash
pnpm --filter @gdgjp/gdg-lib build:acl
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **commit された blob にタグが入っている。** ワークツリーではなく
  `git show HEAD:<path>` を検査すること。**ワークツリーだけを見るテストは、
  `git add` 済みの staged blob がタグ無しで commit される経路を検出できない。**
  これが挿入を書き込み時に置いた理由そのものである。
- **tripwire が index を見ている。** 「ワークツリーはタグ済み・index は未タグ」を
  人為的に作って deny されること。**ワークツリーを見る実装に戻すと、
  `git commit -a` / pathspec / `git add -p` の組み合わせで未タグが commit される。**
- **通常経路で deny が起きない。** `wk write` → `wk git add` → `wk git commit` が
  1 回で通ること。ここで deny が出るなら、`wk write` が挿入していない。
- **tripwire が挿入していない。** deny したときにワークツリーが変わっていないこと。
  挿入してしまうと「ゲート違反の疑い」という意味が消え、
  **`wk` を通らない書き込み経路が存在することを隠してしまう。**
- **`wk write` の挿入が fail closed。** `state.json` 欠損・例外で
  **タグ無しのまま書かれない**こと。ここが fail open に倒れると、
  機密派生行が素のまま `pages/` に載る。**後段はもう挿入しない。**
- **除外規則。** front matter / catalog / `log` / 見出し / コードフェンス内 /
  既存スパンの内側が包まれないこと。**catalog と `log` を包むと wiki の航行が壊れる。**
- **ネストが発生しない。** 2 回書いたときに `<acl>` が二重にならないこと。
  既存スパンの範囲を `parseAclSpans` で取っていること。
- **拒否時にファイルが変わっていない。** `validateAclSpans` が落ちたときに、
  ワークツリーが bit 単位で同一であること。
  **壊れた Markdown を書くと以降の全 commit が落ちる。**
- **複数ソースが AND になる。** 「厳しい方を選ぶ」ロジックが混入していないこと。
- **`member` 以上のソースだけの run では何も挿入されない。**
  全部包むと wiki 全体が黒塗りになる。
- **記憶由来の `source.id` が `acl-sources.json` にも積まれている。**
  トレースにだけ積むと、挿入したタグを `wk read` が解決できず、
  **翌日以降そのページ全体が拒否側に倒れる。**症状は「昨日書いたページが読めない」。
- **`ResolveReadSourceIDs` がロック済み ID を使う。** キュー先頭固定に戻ると、
  並列 ingest で agent #3 が item 1 のソースでタグを要求される。
- **`BaseRev` が `ingest lock` でも初期化される。** 未初期化だと
  `CollectCommittedPageRels` が nil を返し、検査が「提出ページ無し」で
  **静かに OK を返す**。
- **commit tripwire の fail open。** トークン失効・オフライン・`gdg` 不在で
  commit がブロックされないこと。
- **`verify-acl` の exit code 規約。** ACL 違反のみ 1、インフラ的失敗はすべて 0。
- **挿入ロジックが 1 箇所にある。** `acl-insert-core.ts` 以外に
  除外規則や `<acl src=` の組み立てが現れないこと（grep で固定する）。
  **2 箇所になると、片方だけが catalog を包む。**

### 見出し・フェンスの拒否について固定すべきこと

- **機密派生行が見出しに落ちたら `wk write` が拒否される。**
  ここが素通りだと、機密のイベント名がページタイトルや小見出しとして公開され、
  **サーバ側の検査は通ってしまう**（ページのどこかに `<acl src>` があれば足りるため）。
  **公開されたことに誰も気づかない。**
- **フェンス内側についても同じ。** 設定値や識別子をコードブロックにコピーした場合。
- **S が空の run では拒否が起きない。** `member` 以上しか読んでいない run で
  見出しを書いただけで拒否されると、通常の編集が全部止まる。
- **拒否でファイルが変わらない。** 拒否と同時に一部だけ書かれると、
  次の `wk write` の差分計算が狂う。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）。`GDG_WIKI_URL` を向ける。
2. `organizer` visibility のソースを 1 件登録し、fetch 完了まで待つ。
3. `gdg wiki clone --lang ja /tmp/wiki-autoacl && cd /tmp/wiki-autoacl && gdg wiki raw pull`。
4. `gdg wiki ingest lock` でソースを 1 件ロックする。
5. `wk read` でその raw を読み、**`wk write` で** `pages/` のページに
   `<acl>` 無しで内容を書く。書いた直後にファイルを開き、
   **その時点で既に `<acl src="…">` が入っている**ことを確認する。
6. `wk git add -A && wk git commit -m x` → **deny されずに通る**ことを確認する。

   ```bash
   git show HEAD:pages/<slug>/page.md | grep -c '<acl src='
   ```

   **ワークツリーではなく commit 済み blob を見る。** 1 以上であること。
7. `git push` → サーバに拒否されないことを確認する
   （Stage 07 以降は xangi が代行するので、そちら経由で確認する）。
8. **tripwire の確認。** ゲートを一時的に外した状態で shell からファイルに直接追記し、
   `git add` してからゲートを戻して `wk git commit` する。

   ```bash
   printf '%s\n' "機密由来の一文" >> pages/<slug>/page.md
   git add -A
   wk git commit -m y     # → deny される（ゲート違反の疑い）
   ```

   **ワークツリー側をタグ済みに戻しても deny されること**（検査対象が index であること）を確認する。
9. catalog ページと `log` に 1 行ずつ足して再度 commit → **包まれない** ことを確認する。
10. もう一度 `wk write` → `<acl>` が二重にならないことを確認する。
11. `state.json` を退避して `wk write` → **拒否され、ファイルが変わらない**ことを確認する。
12. ネットワークを落として 5〜6 を再実行 → 挿入は通り、
   commit は警告だけ出て通ることを確認する。
