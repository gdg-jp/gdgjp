# Stage 05 — Cursor preToolUse gate

## Context — 背景とリポジトリ状況

### なぜやるか

中央 1 台・共有 workdir の上で、複数チャプターの複数ロールのユーザーが同じ clone を触る。
`gdg wiki clone` の作業ツリーは **ログインした人間が見えるもの全部の和集合** であり、
CLI に chapter スコープは無い。したがって
**ファイルシステムに到達させない仕組みが無ければ、Discord の全員が運用者の全権限を得る。**

現行の ACL ゲート（`cli/internal/wiki/hooks/acl-gate.ts`）は、
`beforeShellExecution` で `git commit|push` にマッチしたときだけ `gdg wiki verify-acl` を呼び、
exit 1 なら deny する。それ以外は何も止めない。read も write もトレースに記録するだけである。
**これは lint ゲートであって、読み取りの境界ではない。**

このステージで **`preToolUse` 1 本のゲート**を作る。
責務は 1 つ — **`wk`（[Stage 11](11-wk-mediator.md)）以外の読み書き経路を deny する。**
判定は持たない。

読み書きの実体と `<acl>` の濾過は `wk` にある。
**このステージは、それを「唯一の窓口」にする係である。**

**ページ可視性だけでは足りない。** `public` / `member` のページに
`chapter-organizer` 由来の `<acl>` スパンが埋まっているとき、
ページ単位の判定しかしないゲートは**そのスパンの中身を全員に見せる。**
スパンはページ可視性より狭い記述を表すための仕組みなので、ここが抜けると
Stage 06 の自動挿入が workdir 内では意味を持たない
（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

### Cursor CLI の実装から確認済みの事実（設計の土台）

`cursor-agent 2026.08.11-e8db854` のバンドルを読んで確認した。**docs と食い違う点がある。**

1. **`Read(...)` / `Write(...)` の deny は Cursor 自身の Read/Write ツールしか覆わない。**
   パスルール照合器の呼び出し元は `shouldBlockRead` と `shouldBlockWrite` の 2 箇所だけで、
   shell 側は `Shell(...)` 形式のルールのみを抽出する別経路。
   `deny: ["Read(/x/secret)"]` は `cat /x/secret` に何の効果もない。
   `Grep` / `List` / `Fetch` も `Read()` の管轄外。
2. **`beforeReadFile` は名前に反してディスク読み取りの後に走る**（`runPostExecutionHooks` の中）。
   フックには読み終えた `content` が渡される。deny はモデルへの配送を止めるだけ。
   かつ Read ツールにしか発火しない。
3. **`preToolUse` は `Shell` / `Read` / `Write` / `Delete` / `Grep` / `List` / `Fetch` /
   `MCP:<tool>` / `task` などを全部捕まえ、`{"permission":"deny"}` で拒否できる。**
   Shell の `tool_input` は `{command, cwd}`、Read は `{file_path}`。
4. **glob エンジンは docs より弱い。** ワイルドカードは `*` のみで `/` を跨ぎ、
   `**` は `*` と同義、**`?` はリテラル**。照合は解決済み絶対パスに完全アンカー。
   `Read(raw/*)` は永久にマッチしない。
5. **`failClosed: true` は enterprise / team / project / user 由来の設定でのみ有効。**
   `.claude/settings.json` 由来は除外される。
   既定でも exit 2 と不正 JSON はブロック、その他の非ゼロ・タイムアウト・空出力は fail open。
6. **Cursor の設定機構はどれも信頼境界ではない。** すべて同一 uid のプロセス設定であり、
   shell を持つエージェントは自分を縛る `cli-config.json` も `hooks.json` も書き換えられる。
   **所有権による保護が要る（Stage 07）。**
7. **フックはツールの出力を書き換えられない。** `preToolUse` が返せるのは
   `permission` / `user_message` / `agent_message` / **`updated_input`** の 4 つ。
   `postToolUse` の `updated_mcp_tool_output` は **MCP ツール限定**。
   書き換えられるのは**入力**であって、読み取った本文ではない。
   **だから `<acl>` の濾過はフックではできず、`wk` が要る。**
8. **`preToolUse` に渡る MCP の情報はツール名だけで、サーバ名が無い。**
   `190.index.js` の MCP executor は `` tool_name: `MCP:${t.toolName}` `` を渡す。
   `mcp_server_name`（と `mcp_server_url`）が入るのは
   **`beforeMCPExecution` イベントだけ**である。
   **したがって `preToolUse` はサーバ同一性で allowlist できない。**
   ツール名の allowlist + 設定の所有権で閉じる（§3-5）。
9. **MCP 設定は user と project の両方が読まれる。**
   `~/.cursor/mcp.json` と **`<projectRoot>/.cursor/mcp.json`**（および `.mcp.json`）を
   マージする実装である。`projectRoot` は **共有 workdir**（`/srv/gdg-agent/wiki`、
   `gdgwiki` グループで全スロットが書ける）なので、
   **workdir にファイルを作れる経路が 1 つでもあれば MCP サーバを増やせる。**
   書き込み経路は `wk write` の allowlist（[Stage 11](11-wk-mediator.md) §5 手順 0）で閉じ、
   設定自体は root 所有 + `--mcp-config` で固定する（Stage 07 §6）。
10. **クローンの本文は「clone した人間 1 人」の clearance で決まる。**
   `wiki/app/routes/api.cli.wiki.snapshot.ts:73` は `fullClearance` なら
   `<acl>` タグごと全文を返し、そうでなければページ全体に `removeAclSpans` を掛ける。
   **all-or-nothing であり、invocation ごとではない。**
   運用者は広い clearance でクローンするので、ディスクにはスパン本文が載っている。

### 依存と対象範囲

- **先行ステージ: [Stage 00](00-typescript-runtime.md) と
  [Stage 11](11-wk-mediator.md)（`wk` 本体）。** Stage 00 で既存ゲートを
  `acl-gate.ts` へ rename してから、このステージで全面改修する。
  間接的に Stage 01（ACL 評価器）、Stage 02（マニフェストの `chapterId`）、
  Stage 04（認可サーバと nonce）にも依存する。
  **番号は ID であって実装順ではない — 11 を先に作る。**
  ゲートを先に入れると、Read を deny されたエージェントに代替手段が無い状態が生まれる。
- 後続の Stage 06（`<acl>` 自動挿入）と Stage 07（uid 分離）が本ステージのフックを拡張する。
- 対象は `cli/`（フックスクリプトと設置ロジック）と `agents-local/`（設定）。
- **`wk` の仕様は [Stage 11](11-wk-mediator.md) の担当。**
  read 判定・スパンの濾過・`wk write` の順序はそちらにある。
- **`<acl>` の自動挿入は Stage 06 の担当。**
- **uid 分離・所有権の実施・OS サンドボックスは Stage 07 の担当。**

### 実装前に疎通確認すること

**5 つある。どれも通らなければ止まって報告する。ここが通らないと権限モデル全体が成立しない。**

1. `~/.cursor/hooks.json` に登録した `preToolUse` が `failClosed: true` 付きで実際に発火し、
   `{"permission":"deny"}` で Shell と Read を止められること。
2. `cursor-agent` に `--force`/`--yolo` を渡さない状態で headless（`-p`）が実用に耐えること。
3. **`cursor-agent` が、Read ツールの deny と `agent_message` を受けて
   `wk read` に切り替えるか。** 切り替えずに同じ Read を繰り返すループに入らないか。
4. **Write / Edit ツールを deny した状態で、`wk write` による全文書き込みだけで
   ingest 相当の作業が完走するか。**
5. **`--mcp-config <path>` を渡したとき、`<projectRoot>/.cursor/mcp.json` と
   `~/.cursor/mcp.json` が無視されるか**（§3-5）。
   無視されないなら `beforeMCPExecution` を足す判断になる。
6. **変更系ツールと未知のツール名を既定 deny にした状態で、headless の作業が完走するか**（§2）。
   落ちた場合は、**ファイルシステム・ネットワーク・プロセスのいずれにも触らないツール名だけ**を
   素通りリストに足す。**足すたびに、その根拠を §2 に 1 行書く。**
   「不便だから」で `Write` / `Edit` / `Fetch` を戻さない。

**3 と 4 が最も危うい。** Cursor のエージェントは自前の編集ツールに強く依存しており、
`wk write` を here-doc で呼ぶ形に馴染めない可能性がある。

**4 が通らなかった場合の代替案**（採用は疎通確認の結果次第。先に実装しない）:
`preToolUse` が Write ツールに対して `updated_input` を返し、
`content` を §4-5 と同じ手順で書き換えてから通す。
フックが出力ではなく**入力**を書き換える形なので、上の事実 7 には抵触しない。
ただし **Edit 系ツールは救えない** — 濾過されたファイルでは `old_string` が
ディスクの実体（スパン本文）と一致せず、照合そのものが失敗する。

### 読むべきもの

- `~/.cursor/skills-cursor/create-hook/SKILL.md` — Cursor フックの一次資料
  （`https://cursor.com/docs/cli/reference/hooks` は **404**。この SKILL.md とバイナリが唯一の資料）
- `~/.cursor/skills-cursor/update-cli-config/SKILL.md` — permissions と `cli-config.json`
- `docs/plans/11-ingest-acl-hooks.md` — 現行ゲートの設計と fail open の理由
- `docs/agents-local-mvp/index.md` §4「Cursor ハーネス」

### 再利用する既存実装（書き直さない）

- `cli/internal/wiki/hooks/acl-gate.ts` — **書き方の手本**（Node ネイティブ TypeScript、依存ゼロ、
  stdin を JSON で読む、`spawnSync`、`findCloneRoot` で `.gdgwiki/config.json` まで遡る）
- `cli/internal/wiki/hooks.go` — `//go:embed` と冪等な設置（`EnsureCursorHooks`）
- `cli/internal/wiki/trace.go` — トレースの読み書き（Stage 11 §8 で
  `.gdgwiki/ingest-trace/<runId>.json` に分かれる）
- `cli/internal/wiki/verify.go` — `VerifyACL`、変更ページ収集、`ResolveReadSourceIDs`
- `cli/internal/wiki/local.go` の `LocalPages` / `FrontMatter`（`yaml.v3`）
  — **front matter の再パーサを自前で書かない**
- `cli/internal/wiki/hooks/wk.ts` と `acl-core.ts`（[Stage 11](11-wk-mediator.md)）
  — **判定はここにある。ゲートから ACL 評価器を直接呼ばない**（§2）
- `.codex/hooks/pre-commit-ci.ts` — リポジトリのフック規約

---

## Design — 設計

### 1. 二層構造 — 強制は `preToolUse`、実施は `wk`

読み書きの実体を **`wk` コマンド 1 本**に集約し、フックは
**「`wk` 以外の経路を deny する」**係にする（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

| 層 | 実体 | 責務 | fail 方針 |
|---|---|---|---|
| **強制** | `preToolUse`（`acl-gate.ts`） | `wk` 以外の読み書き経路を deny する。**それだけ** | `failClosed: true` |
| **実施** | `wk`（`/opt/gdg-agent/bin/wk`） | 濾過（read）・再合成と挿入（write）・変更権限の判定 | 落ちたら何もしない（読まない・書かない） |

**なぜ 2 層に分けるか。** フックは**ツールの出力を書き換えられない**。
`preToolUse` が返せるのは `permission` / `user_message` / `agent_message` / `updated_input` で、
`postToolUse` の出力書き換えは MCP ツール限定である
（`~/.cursor/skills-cursor/create-hook/SKILL.md` の Event Output Cheat Sheet）。
したがって **「Read したら `<acl>` が自動で消える」はフックでは実装できない。**
濾過ができるのは、自分が本文を出す側に立ったときだけである。

**使うフックは `preToolUse` 1 本だけ。**
`beforeShellExecution` / `beforeReadFile` / `afterFileEdit` はどれも使わない
（[ADR-004 のフックの役割分担](adr.md#フックの役割分担)）。

```jsonc
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "command": "node /opt/gdg-agent/lib/acl-gate.ts", "timeout": 10, "failClosed": true }
    ]
  }
}
```

- `matcher` は付けない（全ツールに発火させ、スクリプト側で `tool_name` を見て分岐する）。
  Cursor の matcher は **未アンカーの `RegExp.test`** で、不正な正規表現は fail open するため、
  絞り込みをそこに任せない。
- フック本体・`wk`・共有ライブラリは **絶対パス**に置く。clone 内の `.cursor/hooks.json` は使わない
  （エージェントが書けるディレクトリの中にあるため）。
- `gdg wiki ingest --agent cursor` が clone に `.cursor/hooks.json` を書く現行の挙動を **やめる**。
  `EnsureCursorHooks` は「user hooks が正しく設置されているかを検査して警告する」だけにする。

### 2. ゲートの判定（`acl-gate.ts`）

stdin の JSON から `tool_name` / `tool_input` / `cwd` を読む。**ゲートは ACL を判定しない。**

| `tool_name` | 判定 |
|---|---|
| `Read` / `Grep` / `List` | 対象が clone root 内の `pages/**` / `raw/**` / `memories/**` なら **deny**。`agent_message` に `wk read <path>` を案内する。それ以外は素通り |
| `Shell` | **§3 の argv allowlist**。加えて `git commit` 相当なら §5 の tripwire |
| `MCP:<tool>` | **§3-5 のツール名 allowlist（既定 deny）** |
| **上記以外のすべて** | **deny。パスを見ない** |

**最終行に落ちるのは `Write` / `Delete` / `Edit` 系 / `Fetch` / `task`、および
将来 Cursor が増やす未知のツール名である。** deny メッセージには `wk write` / `wk rm` を載せる。

**これは責務の追加ではなく削減である。** 変更系の判定からパス分類が消え、
ゲートは「この経路は `wk` か」だけを見る形になる。

**なぜパス条件を残さないか。** 変更系ツールを `pages/**` / `raw/**` / `memories/**` だけに
限って deny すると、clone 内の残り全部が書ける。そこから作れるものが次である。

| 作れるファイル | 帰結 |
|---|---|
| `.git/hooks/pre-commit`、`.gitattributes` の filter driver | `wk git commit` が任意コードを実行する。**§3 の argv allowlist が丸ごと無効化され、サンドボックス下でも workdir 全体（＝全チャプターの平文）が読める** |
| `<workdir>/.cursor/sandbox.json` | `additionalReadonlyPaths` が次回 invocation にマージされ、**`readBoundary: "workspace"` が破れる**。`mcp.json` と違い `--mcp-config` に相当する無効化手段が無い（[Stage 07](07-agent-uid-isolation.md) §4） |
| `.gdgwiki/acl-sources.json`、`.gdgwiki/state.json` | スパンの `src` 解決とマニフェスト判定の材料が偽造される（[Stage 11](11-wk-mediator.md) §3-1 / §4） |

前 2 者が壊すのは、[ADR-004 の脅威モデル](adr.md#脅威モデル)が**守るもの**に挙げた機構
（argv allowlist、uid 分離 + `readBoundary`）そのものである。受容事項ではない。

**素通りは名指しの allowlist にする。「その他は素通り」に戻さない。**
ツール名は Cursor のバージョンで増えるので、既定が素通りだと
**新しい編集ツールが追加された日に静かに穴が開く。**
`Write` / `Edit` の名前の揺れ（§確認済みの事実 3 は `Write` を挙げ、
疎通確認の項目 4 と `index.md` は「Write / Edit ツール」と書いている）も、
既定 deny にすればツール名への依存が消える。

**`canClassesSeePage` / `canClassesAccessSource` / `canMutatePage` をゲートから呼ばない。**
判定は全部 `wk` 側にある。ゲートに残るのは「この経路は `wk` か」だけである。
**強制（ゲート）と実施（`wk`）を層で分ける** — 両方が判定を持つと、必ずドリフトする。

deny のメッセージには**そのまま実行できるコマンド**を書く。
`Read(/srv/gdg-agent/wiki/pages/x/page.md)` を deny したら、
`wk read pages/x/page.md` と返す。**エージェントが次に何をすればよいか分からない deny を出さない。**

### 3. shell — argv allowlist

`tool_input.command` を分解し、**すべての単純コマンドの `argv[0]` が `wk` であること**を要求する。

| 入力 | 結果 |
|---|---|
| `wk read pages/x/page.md` | 通す |
| `wk grep '締切' pages/` | 通す |
| `wk git add -A && wk git commit -m x` | 通す（両方 `wk`） |
| `cat pages/x/page.md` | **deny** |
| `wk read x \| head -20` | **deny**（`head` は `wk` ではない。`wk read --limit` を使う） |
| `sed -i s/a/b/ pages/x/page.md` | **deny** |
| `python3 - <<EOF ... EOF` | **deny** |
| `wk read $(ls raw)` | **deny**（コマンド置換） |
| `FOO=bar wk read x` | **deny**（変数代入の前置。`argv[0]` に `=` がある） |
| `./wk read x` / `wkx read x` | **deny**（`wk` の完全一致ではない） |
| `wk read a; wk read b` | **deny**（`;` は文字集合で落ちる。連結は `&&` だけ） |
| `wk write p <<EOF`（クォート無し） | **deny** |
| `wk write p <<'EOF' … EOF; rm x` | **deny**（終端行の後に文字がある） |
| パースできない文字列 | **deny** |

#### 受理する文法

**「shell を正しくパースする」実装にしない。** 汎用の shell 構文を解釈する実装は
原理的に不完全で、不完全さがそのまま迂回路になる。
**受け付ける形を先に狭め、それ以外をすべて deny する。**

```
script  := simple ( '&&' simple )*
simple  := WK arg*
WK      := 'wk' | '/opt/gdg-agent/bin/wk'
arg     := bare | "'" <単一クォート内の任意のバイト> "'"
bare    := [A-Za-z0-9._/@:,+=-]+
```

実装は 2 段にする。

1. **文字集合の事前検査。** 単一クォートの内側と here-doc の本体を除いて、
   次のいずれかが 1 つでも現れたら **即 deny する**。

   ```
   $  `  "  (  )  {  }  |  ;  <  >  \  *  ?  [  ]  ~  !  #  改行
   および & （ただし && の 2 連は許す）
   ```

2. 残りを上の文法でトークナイズし、**すべての `simple` の `argv[0]` が `WK` に
   一致すること**を要求する。一致しない、またはトークナイズできなければ deny。

- **`argv[0]` に `=` を含むものは deny する。** `FOO=bar wk read x` の形の変数代入前置を
  「`wk` の呼び出し」と読まないためである。これを許すと `PATH` を差し替えられる。
- **`wk` の一致は完全一致である。** `wkx` / `./wk` / `/usr/local/bin/wk` は通さない。
- **PATH は固定ランチャが決める。** [Stage 07](07-agent-uid-isolation.md) §3 のランチャが
  `PATH=/opt/gdg-agent/bin:/usr/bin:/bin` を設定し、`wk` が root 所有 `0755` の
  `/opt/gdg-agent/bin/wk` に解決されることを保証する。
  変数代入前置を deny しているので、エージェントは PATH を差し替えられない。
- **リダイレクト（`>` `>>`）とコマンド置換（`$()` / backtick）は上の文字集合で落ちる。**
  ダブルクォートも落ちる（内側で展開が起きるため、単一クォートだけを許す）。
- **here-doc は 1 例外だけ許す** — コマンド全体が `wk write <path> <<'DELIM'` の
  単純コマンド 1 本で、`DELIM` が `[A-Za-z0-9_]+`、かつ**終端行の後に文字が無い**場合。
  **本体は検査しない**（stdin に渡るだけで、区切りがクォートされているので展開が起きない）。
  クォート無しの here-doc と、終端行の後に続きがある形は deny する。
  この例外が要るのは、[Stage 11](11-wk-mediator.md) §1 が `wk write` の入力を
  stdin 固定にしているためである。
- **shell の AST パーサをバンドルして解く方向に倒さない。**
  [Stage 00](00-typescript-runtime.md) §1 の「フックは依存ゼロ、`node:` 組み込みだけ」に反し、
  かつ大きな外部バンドルを root 所有の security-critical なフックに入れることになる。
  受理する形を狭めるほうが、検査対象も小さい。
- **これは現行のパス抽出の置き換えである。** 旧設計は
  `pages/` / `raw/` / `memories/` に見えるパスを正規表現で抽出していたが、
  `$(...)`・`xargs`・`find -exec`・here-doc の python は素通りしていた。
  **allowlist にすると、この不完全さが安全側に反転する** — 解釈できないものは deny になる。
- **allowlist を安易に広げない。** 「`head` が使えなくて不便」は `wk` 側にオプションを足して解く。
  1 つ広げるごとに、そのコマンドが gated path を読まないことを自分で証明する義務が生じる。

### 3-5. MCP — ツール名の allowlist（既定 deny）

**`MCP:*` を素通りにしない。** 素通りは「名前の形で許す」ことであり、
FS / shell / git 能力を持つ MCP サーバが 1 つ増えた瞬間に **`wk` が丸ごと迂回される。**
ゲートの原則（解釈できないものは deny）を MCP にも適用する。

| 入力 | 結果 |
|---|---|
| `MCP:search`（[Stage 09](09-agents-index.md) のインデックス） | 通す |
| その他の `MCP:<tool>` | **deny**。`agent_message` に「このエージェントで使える MCP は `search` だけ」と返す |

- **allowlist はツール名で書く。** 上の「確認済みの事実 8」のとおり、
  `preToolUse` にサーバ名は渡らない。**サーバ同一性はフックでは検査できない。**
- **したがって、この allowlist はサーバ設定が固定されていることを前提にする。**
  前提の実施は Stage 07 §6 — MCP 設定を **root 所有 `0444`** で置き、
  固定ランチャが **`--mcp-config <root 所有パス>`** を渡す。
  **どちらか一方でも崩れると、`search` という名前のツールを持つ別のサーバが混ざりうる。**
- 疎通確認で「`--mcp-config` を渡したとき `<projectRoot>/.cursor/mcp.json` が
  無視されるか」を確認する（確認済みの事実 9）。
  **無視されないなら**、`beforeMCPExecution`（`mcp_server_name` が渡る唯一のイベント）を
  `failClosed: true` で 1 本足し、サーバ名を検査する。
  これは「使うフックは `preToolUse` 1 本」の**唯一の例外**であり、
  理由（このイベントだけがサーバ名を持ち、かつ deny を返せる）を
  [ADR-004](adr.md#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く) に書く。
  **`beforeReadFile` / `beforeShellExecution` / `afterFileEdit` の復活とは別の話である。**
- **allowlist を「読み取り専用そうな名前」に広げない。**
  1 つ広げるごとに、そのツールが gated path を読まないことを証明する義務が生じる
  （argv allowlist と同じ規律）。

### 4. `wk` は別ステージ

**`wk` の仕様と実装は [Stage 11](11-wk-mediator.md) の担当である。**
ここで扱うのは「`wk` 以外の経路を deny する」ことだけであり、
read 判定・スパンの濾過・`wk write` の順序・`memories/**` の拒否は Stage 11 §3〜§6 にある。

ゲートが知っておくべきことは 2 つだけ。

- `wk` は `/opt/gdg-agent/bin/wk`（本体は `lib/wk.ts`）にあり、agent uid から書けない（Stage 07）。
- ゲートと `wk` は `/opt/gdg-agent/lib/acl-core.ts` を共有し、`./acl-core.ts` で import する。
  **判定を両方に置かない** — ドリフトした瞬間にゲートは嘘をつく。

**実装順は Stage 11 → Stage 05 である。** 先にゲートを入れると、
Read を deny されたエージェントに代替手段が無い状態が生まれる。

### 5. commit の tripwire

`wk git commit` が呼ばれたら、**`git diff --cached`（index）**に未タグの追加行が無いかを見る。

- **あったら deny する。挿入はしない。**
  書き込み経路は `wk write` 1 本で、`wk write` は常にタグ済みの内容しか書かない。
  したがって**未タグの staged blob が存在すること自体が、`wk` を通らない書き込みが
  成立したという意味**である。`agent_message` と stderr に
  **「ゲート違反の可能性」**として出す。restage を促すだけの文言にしない。
- **検査対象をワークツリーにしない。** `git commit -a` / pathspec 指定 / `git add -p` を
  跨いで正しいのは index である。ワークツリーだけを見ると、
  「ワークツリーはタグ済み・index は未タグ」の状態を見逃す。
- 加えて `gdg wiki verify-acl` を実行する（Stage 06）。
  **この commit ゲートだけは fail open のまま**にする
  （サーバ往復が必要で、実効境界はサーバの `/sync` 側にあるため）。
  read 判定の fail closed と混ぜない。
- Stage 07 で `git push` は xangi 側の工程になるので、**ゲートの発火点は commit だけ**である。

### 6. 出力

**ゲート**は Cursor のフラット形式。**stdout には JSON だけ、診断は stderr。**
stdout の JSON パーサは末尾の `{...}` を拾う実装なので、ログ行に `}` を混ぜない。

```js
process.stdout.write(JSON.stringify({
  permission: "deny",
  agent_message: "pages/ は wk 経由で読む: wk read pages/x/page.md",
  user_message: "ACL gate blocked a tool call.",
}));
process.exit(0);
```

許可のときは何も出力せず exit 0。

**`wk`** は通常の CLI として振る舞う。本文は stdout、理由は stderr、
拒否は**非ゼロ終了**で表す（JSON を出さない）。

### 7. `cli-config.json` の permissions

`--force` を渡さない前提（Stage 03）なので `approvalMode` は `"allowlist"` になる。
headless（`-p`）でも allowlist は効く。ingest に必要な最小限を `allow` に入れる。

**パスルールは必ず解決済み絶対パスで書く**（`Read(/home/agent/wiki/pages/*)`）。
相対パスで書いたルールは永久にマッチせず、**静かに全許可になる**。

`deny` は補助として使うが、**これを境界として数えない**
（`--force` 下のパース失敗バイパスが実在するため）。

多重防御として `deny` に `Write(<clone root>/*)` を入れてよい
（Cursor の glob は `*` が `/` を跨ぐので、これで clone 配下全体に当たる）。
ただし**これは §2 の既定 deny の代わりにならない** — パスルールは
Cursor 自身の Read/Write ツールしか覆わず（§確認済みの事実 1）、
別名の編集ツールにも `Fetch` にも効かない。

### 制約

- **強制は `preToolUse` 1 本に集約する。** `beforeReadFile` / `beforeShellExecution` に戻さない。
  前者はディスク読み取り後に走り、後者は shell しか見ない。
- **`afterFileEdit` を使わない。** Cursor の Write / Edit ツールを deny する以上
  発火する余地が無く、`failClosed` を持てないので deny も返せない。
  **「保険として残す」もしない** — 挿入ロジックが 2 箇所になり、除外規則がズレる。
- **ゲートに ACL 判定を書かない。** ゲートは「`wk` か否か」だけを見る。
  判定を両方に置くと必ずドリフトし、ドリフトした瞬間にゲートは嘘をつく。
- **argv allowlist を安易に広げない。** 広げるコマンドごとに、
  そのコマンドが gated path を読まないことを示す。
  「`head` が使えなくて不便」は `wk` 側にオプションを足して解く（Stage 11）。
- **`MCP:*` を素通りに戻さない**（§3-5）。既定 deny + ツール名 allowlist である。
  戻すと、MCP サーバを 1 つ足すだけで `wk` を迂回できる。
  **`search` 以外を足すときは、そのツールが gated path を読まないことを示す。**
- **MCP のツール名 allowlist を「サーバ名で判定する」に書き換えない。**
  `preToolUse` にサーバ名は渡らない（確認済みの事実 8）。
  サーバ同一性は設定の所有権と `--mcp-config`（Stage 07 §6）で担保する。
- **`Read` / `Grep` / `List` の deny を「一部のパスだけ」に緩めない。**
  `pages/**` / `raw/**` / `memories/**` は全部 `wk` 経由にする。
  1 つでも直接読める種別を残すと、そこがスパン濾過の迂回路になる。
- **変更系ツールにパス条件を付け直さない**（§2）。`Write` / `Delete` / `Edit` 系は
  clone の内でも外でも無条件 deny である。パス条件を戻すと、`.git/hooks/pre-commit` /
  `.gitattributes` / `<workdir>/.cursor/sandbox.json` が書ける経路が復活し、
  **argv allowlist と `readBoundary` が同時に無効化される。**
- **ゲートの素通りを「その他は素通り」に戻さない**（§2）。既定 deny + 名指しの allowlist である。
  戻すと、Cursor が編集ツールを 1 つ増やした日に静かに穴が開く。
- **shell の文法を「パーサを書く」方向に戻さない**（§3）。受理する形を狭める側である。
  外部の shell パーサをバンドルする案も採らない（依存ゼロの規約に反する）。
- **deny のメッセージに実行可能な `wk` コマンドを載せる。**
  代替手段の分からない deny は、エージェントを同じ Read の繰り返しに追い込む。
- **`wk` の仕様をこのファイルに書き戻さない。** Stage 11 が唯一の記述である。
  二重に書くと、片方だけが更新されて実装がどちらを信じるか分からなくなる。
- **read 判定は fail closed（Stage 11）、commit の `verify-acl` は fail open。** 混ぜない。
- **フック本体・`wk`・`acl-core.ts` はエージェント uid から書けないこと**（Stage 07）。
  これが崩れると `rm` 一発でゲートが消え、**画面上は正常に見える**。
- **Cursor の permission ルールを境界として数えない。** 補助として使う。
- フックは Stage 00 の Node ネイティブ TypeScript、依存ゼロ、`execFileSync`/`spawnSync`
  （シェル文字列を組み立てない）。
- `cli/internal/wiki/remote_helper.go` の push 制限を緩めない。

---

## Files to touch — 変更ファイル

### `cli/`

- `internal/wiki/hooks/acl-gate.ts` — `preToolUse` 版に全面書き直し。
  **ACL 判定を持たない**（`wk` か否かの判定、argv allowlist、commit の tripwire）
- `internal/wiki/hooks.go` — user hooks の検査に変更（clone への書き込みをやめる）、
  `hooks.json` の内容から `afterFileEdit` を落とす、
  `wk` / `acl-core.ts` / `acl.ts` が設置済みかの検査
- `internal/wiki/verify.go` — `memories/` 由来のパス解決を追加
- `internal/wiki/config.go` — `CloneGitignore()` から `.cursor/` を外すか検討
  （clone に `.cursor/` を作らなくなるため）
- `internal/command/wiki.go` — `--agent cursor` のメッセージ更新
- `internal/wiki/hooks_test.go`, `internal/wiki/verify_test.go`

**`wk.ts` と `acl-core.ts` は [Stage 11](11-wk-mediator.md) が作る。**
このステージでは既に在るものとして扱い、設置の検査だけを足す。

### `agents-local/`

- `setup.sh` — `~/.cursor/hooks.json` と `/opt/gdg-agent/`（`hooks/` `bin/` `lib/`）の配置
- `.cursor/hooks.json` — **削除**（user hooks に移行するため）
- `AGENTS.md` — **`wk` の使い方**（読み書きは `wk` 経由であること、
  黒塗り `⬛︎⬛︎⬛︎` の意味、拒否されたときの直し方）

---

## Verification — 完了条件と検証

### 完了条件

**[Stage 11](11-wk-mediator.md) の完了条件がすべて通っていることが前提である。**

1. `~/.cursor/hooks.json` の `preToolUse` が全ツールコールで発火する。
   `hooks.json` に `afterFileEdit` が**無い**。
2. **`Read` / `Grep` / `List` が `pages/**` / `raw/**` / `memories/**` に
   対して deny され、`agent_message` にそのまま実行できる `wk` コマンドが出る。**
   それ以外のパス（`AGENTS.md` 等）への `Read` は通る。
2a. **`Write` / `Delete` / `Edit` 系が、パスによらず常に deny される。**
   `.git/hooks/pre-commit`、`.gitattributes`、`<workdir>/.cursor/sandbox.json`、
   `.gdgwiki/acl-sources.json` を名指しで確認する。
2b. **実在しないツール名（`FooBar`）を投げると deny される**（既定 deny）。
   素通りするツール名がスクリプト内で名指しの allowlist になっている。
3. **`cat` / `sed -i` / `python` / パイプ / リダイレクト / コマンド置換が deny される。**
   `wk read` と `wk git add -A && wk git commit -m x` は通る。
   `wk write <path> <<'EOF'` も通る（唯一の here-doc 例外）。
4. **`MCP:search` が通り、それ以外の `MCP:<tool>` が deny される。**
4a. **`<projectRoot>/.cursor/mcp.json` に別の MCP サーバを書いても、
   そのツールがゲートで deny される**（かつ `--mcp-config` 指定下ではそもそも読まれない）。
5. フックを非ゼロ終了・タイムアウト・空出力・不正 JSON にすると、すべて deny になる
   （`failClosed`）。
6. index に未タグの blob を人為的に作って `wk git commit` すると、
   **ゲート違反の疑いとして deny される**（挿入はしない）。
   ワークツリーがタグ済みでも deny される。
7. ネットワークを落とした状態で `wk git commit` が **通る**（`verify-acl` は fail open）。
8. **ゲート経由で、Stage 11 の E2E がそのまま通る。**
   `cursor-agent` から `wk` を使って ingest 相当の作業が完走する。

### コマンド

```bash
cd /Users/hari/proj/gdgjp/cli && go test ./...
```

```bash
node /opt/gdg-agent/lib/acl-gate.ts <<< '{"hook_event_name":"preToolUse","tool_name":"Read","tool_input":{"file_path":"/srv/gdg-agent/wiki/pages/x/page.md"}}'
```

```bash
node /opt/gdg-agent/lib/acl-gate.ts <<< '{"hook_event_name":"preToolUse","tool_name":"Shell","tool_input":{"command":"cat pages/x/page.md"}}'
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **フックが実際に発火する。** `~/.cursor/hooks.json` の位置・所有権・`failClosed` を
  変えたときにフックが読まれず、ゲートが黙って無効化される経路を固定する。
  **画面上は完全に正常に見える。** 発火の有無を観測できる仕組み（監査ログ）を併せて置く。
- **`failClosed` が効いている。** 非ゼロ終了・タイムアウト・空出力・不正 JSON の
  すべてが deny になること。fail open に反転すると全チャプターが素通しになる。
- **argv allowlist の網。** `cat` / `sed -i` / `$()` / backtick / リダイレクト /
  クォート無し here-doc / `wk read x | head` / `;` 連結 / `FOO=bar wk read x` /
  `./wk` / `wkx` がすべて deny されること。
  **1 つでも通ると、そこが Stage 11 の濾過を迂回する恒久的な穴になる。**
- **here-doc 例外が広がっていない。** 許すのは
  `wk write <path> <<'EOF'` の単純コマンド 1 本だけで、
  **終端行の後に文字が無い**こと。続きがある形が deny されること。
- **変更系ツールが常に deny される。** `Write` / `Delete` / `Edit` 系が
  **clone 外のパスに対しても** deny されること（パス条件が復活していないことの固定）。
  とくに `.git/hooks/pre-commit` と `<workdir>/.cursor/sandbox.json` を名指しで置く。
  **通ると、argv allowlist と `readBoundary` が同時に無効化される。**
- **未知の `tool_name` が deny される。** 実在しない名前を投げて deny になること、
  素通りするツール名が grep で列挙できる名指しの allowlist であること。
  **「その他は素通り」に戻すと、Cursor が編集ツールを増やした日に静かに穴が開く。**
- **`Read` / `Grep` / `List` の deny が 3 種別すべてを覆う。** `pages/**` だけ、
  `raw/**` だけ、のような取りこぼしが無いこと。
- **ゲートに ACL 判定が無い。** `acl-gate.ts` に `canClasses*` / `canMutatePage` /
  `visibility` の文字列比較・`<acl` の正規表現が現れないこと（grep で固定する）。
  **両方が判定を持つとドリフトし、ドリフトした瞬間にゲートは嘘をつく。**
- **deny のメッセージに `wk` コマンドが載っている。** 載っていないと、
  エージェントが代替手段を見つけられず同じ Read を繰り返す
  （疎通確認の項目 3 が落ちる原因になる）。
- **`hooks.json` に `afterFileEdit` が無い。** 復活すると挿入が 2 箇所になる
  （[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。
- **commit の tripwire が index を見ている。** ワークツリーではなく
  `git diff --cached` を見ること。**「ワークツリーはタグ済み・index は未タグ」を
  人為的に作って deny されること**を固定する。
  通常経路（`wk write` → `wk git add` → `wk git commit`）では **1 回も deny が出ない**こと。
- **read の fail closed と commit の fail open が混ざっていない。**
  片方をもう片方に合わせる変更が入ると、どちらかが必ず壊れる。
- **Cursor の glob の落とし穴。** 相対パスの `Read(pages/*)` 形式のルールが
  **マッチしない** ことをテストで固定する。相対パスの deny は静かに全許可になる。
- **MCP が既定 deny で、`search` だけが通る。** 「`MCP:` で始まるものは通す」に
  戻っていないこと（grep で固定する）。
  **戻すと、MCP サーバを 1 つ足すだけで濾過を迂回する恒久的な穴になる。**
  同時に **`search` が deny されていない**ことも固定する（止めるとインデックスが使えない）。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）を起動し、`GDG_WIKI_URL` を向ける。
2. `organizer` visibility のソースを 1 件登録し、`gdg wiki clone` + `raw pull` する。
3. `member` クラスの nonce を発行した状態で `cursor-agent` を起動し、
   その raw を `cat` させる → **deny され、`wk read` が案内される**ことを確認する。
4. 同じことを `Read` ツールでさせる → deny されることを確認する。
5. エージェントが自分で `wk read` に切り替えることを確認する
   （**疎通確認の項目 3 の本番確認**。ループに入らないこと）。
6. エージェントに `wk write` でページを書かせる → 通ることを確認する
   （**疎通確認の項目 4 の本番確認**）。
7. エージェントに `sed -i` / `python` でファイルを書かせる → deny されることを確認する。
7b. エージェントに **Write ツール**で `.git/hooks/pre-commit` と
   `<workdir>/.cursor/sandbox.json` を作らせる → **deny されることを確認する**。
   `AGENTS.md` のような gated path 外への Write も deny されることを確認する。
7a. `<workdir>/.cursor/mcp.json` に filesystem 系の MCP サーバを**手で**書いてから
   エージェントにそのツールを呼ばせる → deny されることを確認する。
8. `wk git add -A && wk git commit` → 通ることを確認する。
9. ゲートを外して shell から未タグの行を書き、`git add` してからゲートを戻して
   `wk git commit` → **ゲート違反の疑いとして deny される**ことを確認する。
10. ネットワークを落として `wk git commit` → 警告だけ出て通ることを確認する。
11. **Stage 11 の手動 E2E をゲート越しにもう一度通す。**
   ここで落ちるなら、ゲートが `wk` の正常系を止めている。
