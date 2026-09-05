# Stage 07 — Agent uid isolation and OS sandbox

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 05 のハーネスは、**同一 uid のプロセス設定** の上に立っている。
Cursor CLI の実装を読んだ結論をそのまま引くと、`cli-config.json` も `hooks.json` も
`CURSOR_CONFIG_DIR` も、shell を持つエージェントが読み書きできる。
つまりハーネスは **協力的なエージェントに対する事故防止** であって、
混乱した、あるいは敵対的なエージェントに対する封じ込めではない。

現在の xangi はサービスとして **操作者本人の uid** で走り
（systemd `--user` / LaunchAgent、`User=` 指定なし）、`cursor-agent` も同じ uid の子プロセスである。
その結果、エージェントは以下すべてに到達できる。

- `~/.config/gdg/credentials.json` — headless Linux には keyring が無いので
  `gdg` の access token と refresh token が **平文** で置かれる
- `~/.config/xangi/iam.json` と `links.json`（Stage 04）
- 認可サーバのソケットと nonce ストア
- `~/.cursor/hooks.json` とフック本体
- 操作者の SSH 鍵、その他ホームの全内容

さらに workdir の中では、クローンが「操作者が見えるもの全部の和集合」である。
Stage 05 の shell パス抽出は正規表現なので原理的に不完全であり、
**workdir 内部のチャプター間 ACL を実効的に守るのはハーネスだけ** という状態が残る。

このステージで 2 つの境界を足す。

1. **uid 分離** — workdir の外（認証情報・ポリシー・フック）を守る
2. **OS サンドボックス** — workdir の外への shell 経由の読み取りを止める

**workdir の内部については、引き続きハーネスが唯一の境界である。**
`sandbox.readBoundary` はワークスペース単位の境界であって、ファイル単位のポリシーではない。
この限界を README と `AGENTS.md` に明記する。

### 依存と対象範囲

- **先行ステージ: Stage 05（ハーネス）。** Stage 00 の Node ネイティブ TypeScript
  実行契約と Stage 04（認可サーバ）とも密接に関わる。
- 対象は `agents-local/setup.sh`、`~/proj/xangi` の spawn 経路、
  および Ubuntu サーバ上の OS 設定。
- **判定ロジックは触らない。** ここは配置と権限だけの作業である。
- **このステージは Ubuntu 専用である。** uid 分離・sudoers・systemd・`/run` を macOS に持ち込まない。
  macOS は開発機であり、**このステージが作る境界は macOS 上では存在しない**
  （[Stage 00](00-typescript-runtime.md) §7）。§9 の検証はすべて Ubuntu で回す。
- **配置先のパスを決めるのはこのステージと `setup.sh` だけである。**
  実行物は絶対パスを埋め込まず、引数で受け取る（[Stage 00](00-typescript-runtime.md) §6）。

### 読むべきもの

- `~/.cursor/skills-cursor/update-cli-config/SKILL.md` — `cli-config.json` と sandbox
- `docs/agents-local-mvp/index.md` §2-4「uid 分離とサンドボックス」
- `docs/agents-local-mvp/05-cursor-harness-pretooluse.md` — ハーネスの前提
- `~/proj/xangi/src/cli-runner-core.ts` — `spawn(..., {cwd, env})` の呼び出し 2 箇所
- `~/proj/xangi/src/installer/platform/linux.ts` — systemd user unit の生成

### Cursor の sandbox について確認済みの事実

- `cli-config.json` の `sandbox` スキーマは
  `{ mode: "disabled"|"enabled", networkAccess: …, networkAllowlist: [], readBoundary: "system"|"workspace" }`。
  **`readBoundary` は未文書**。
- `mode: "enabled"` + `readBoundary: "workspace"` で
  `workspace_readonly` / `workspace_readwrite` ポリシーが同梱の `cursorsandbox` バイナリで強制される。
- `~/.cursor/sandbox.json`（per-user）と `<workspace>/.cursor/sandbox.json`（per-repo）が
  `additionalReadonlyPaths` / `additionalReadwritePaths` でマージされる。**どちらも未文書。**
- 現在の `~/.cursor/cli-config.json` は `sandbox.mode: "disabled"`。

### 実装前に疎通確認すること

`sandbox.mode: "enabled"` + `readBoundary: "workspace"` の状態で、
`cursor-agent` が `-p` の headless で ingest 相当の作業（`git`、`gdg wiki`、
`pages/` の読み書き）を完走できることを先に確認する。
**完走しなければ止まって報告する。** 未文書機能なので、
必要な `additionalReadwritePaths`（`.gdgwiki/`、`~/.config/gdg/` の扱いなど）が
事前には確定できない。

併せて **`cli-config.json` を `root:root 0444`（読み取り専用）にした状態で
`cursor-agent` が起動し、書き戻し失敗で落ちないこと**を確認する（§1、§4）。

**落ちた場合の代替**（採用は疎通確認の結果次第。先に実装しない）:
固定ランチャ（§3）が invocation ごとに `/run/gdg-agent/<N>/home/.cursor/` を作り直し、
`hooks.json` / `mcp.json` / `sandbox.json` を root 所有 `0444` でコピーしたうえで、
`cli-config.json` だけスロットの uid が書ける形で置き、`HOME` をそこへ向ける。
書き戻しは invocation 終了で捨てられるので、**次回のポリシーには持ち越さない。**
副次的に「Always allow」が principal を跨がなくなる。

---

## Design — 設計

### 1. uid とディレクトリのレイアウト

| 主体 | uid | 役割 |
|---|---|---|
| `xangi` サービス | `gdgagent-svc` | Discord 接続、IAM、認可サーバ、nonce 発行、睡眠の起動 |
| `cursor-agent` | `gdgagent-run-0` … `gdgagent-run-N` | ワークツリーの読み書きのみ。**同時実行スロット 1 つにつき uid 1 つ** |

**uid を 1 つにしない。**単一 uid だと、同時に走る 2 つの agent が互いの
`/proc/<pid>/environ` を読めるので、`member` invocation が organizer invocation の
nonce を盗んで解決できる。根拠と却下案は
[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)。
既定は `N = 4` 程度。上限に達した invocation はスロットが空くまで待つ。

**スロット数はリポジトリの同時実行数ではない。**
全スロットは同じワークツリー（`/srv/gdg-agent/wiki`）で走る（[ADR-006](adr.md#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)）ので、
git index / HEAD / `INGEST_QUEUE.md` / トレースは共有である。
**リポジトリを変更する invocation は同時に 1 つだけ**にする —
リポジトリトランザクションミューテックス（[Stage 10](10-sleep-scheduler.md) §1a）を
xangi 側が握る。スロットを分けたのは **nonce と `/proc` の分離**のためであって、
リポジトリの並行変更を許すためではない。

グループを 2 つ使う。

| グループ | メンバー | 用途 |
|---|---|---|
| `gdgwiki` | `gdgagent-svc` + 全 `gdgagent-run-<N>` | **ワークツリーの共有**。svc も agent も読み書きする |
| `gdgagent-run-<N>` | 各 `gdgagent-run-<N>` のみ | スロットごとのソケット許可 |

```
/opt/gdg-agent/                       root:root  0755
  package.json                        root:root  0444   ← Stage 00 の ESM boundary
  bin/wk                              root:root  0755   ← lib/wk.ts だけを起動する launcher
  bin/spawn-slot-<N>                  root:root  0755   ← sudoers が許可する固定ランチャ（§3）
  lib/acl-gate.ts                     root:root  0444   ← preToolUse ゲート（Stage 05）
  lib/wk.ts                           root:root  0444   ← 読み書きの唯一の窓口（Stage 11）
  lib/acl-core.ts                     root:root  0444   ← ゲートと wk が共有する判定（Stage 11）
  lib/acl-insert-core.ts              root:root  0444   ← <acl> 挿入ロジック（Stage 06）
  lib/acl.ts                          root:root  0444   ← ACL 評価器（Stage 01 の生成物）
/srv/gdg-agent/wiki/                  gdgagent-svc:gdgwiki  2770   ← workdir（setgid）
/home/gdgagent-run-<N>/               root:gdgagent-run-<N>  0750
  .cursor/                            root:gdgagent-run-<N>  1775  ← sticky。runtime の mkdir 用
    hooks.json                        root:root  0444
    mcp.json                          root:root  0444   ← HOME 経由で読む（§6）
    cli-config.json                   root:root  0444   ← 書き戻させない（§4）
    sandbox.json                      root:root  0444   ← スロットごとに内容が違う（§4）
    projects/                         gdgagent-run-<N>:gdgagent-run-<N>  0755  ← CLI セッション状態
/run/gdg-agent/                       gdgagent-svc:gdgagent-svc  0755   ← 通り抜け可
  <slot>/                             gdgagent-svc:gdgagent-run-<N>  0750
    authz.sock                        gdgagent-svc:gdgagent-run-<N>  0660
    nonce                             gdgagent-svc:gdgagent-run-<N>  0640   ← §3
/home/gdgagent-svc/.config/xangi/     gdgagent-svc:gdgagent-svc  0700
  iam.json, links.json                gdgagent-svc:gdgagent-svc  0600
/home/gdgagent-svc/.config/gdg/       gdgagent-svc:gdgagent-svc  0700
  credentials.json                    gdgagent-svc:gdgagent-svc  0600
<xangi dataDir>/                      gdgagent-svc:gdgagent-svc  0700
  speech/, sessions/                  gdgagent-svc:gdgagent-svc  0600   ← 会話ログ（Stage 08）
```

**会話由来のログを workdir 配下に置かない。** `<workdir>/logs/sessions/`（transcript）と
発話ログ（Stage 08 §1）は、`gdgwiki` グループで共有されるワークツリーの中に落ちると
**全スロットから読める**。あれは ACL タグが付く前の生の会話であり、
Stage 05 の判定表のどのパス種別にも当たらないので**素通りする**。
xangi の `dataDir`（`0700 gdgagent-svc`）配下に置く。

**ワークツリーを agent のホーム配下に置かない。** `gdgagent-run:gdgagent-run 0700` にすると、
§2 で xangi 側の工程とした `gdg wiki clone` / `raw pull` / `ingest lock` /
`ingest --commit` / `git push` が**ディレクトリを通り抜けられない。**
`/srv/gdg-agent/wiki/` を `gdgagent-svc:gdgwiki 2770` にして、
svc と全スロットが同じグループで読み書きする。setgid を付けるのは、
どちらが作ったファイルでも group が `gdgwiki` のままになるようにするため
（付け忘れると、agent が作ったファイルを svc が触れなくなる）。

**ソケットを `~/.config/xangi/` に置かない。** あそこは `0700` の svc 専有ディレクトリで、
UNIX ソケットへの接続には**親ディレクトリすべての通り抜け権限が要る**ため、
`gdgagent-run-<N>` は到達できない。さらに §4 は
`~/.config/xangi/` を `additionalReadonlyPaths` に足すことを禁じている —
つまり同じ計画の中で、自分のソケットへの経路を 2 重に塞いでいた。
`/run/gdg-agent/` を通り抜け可能な `0755` にして、その下をスロットごとに切る。

要点:

- **`~/.cursor/hooks.json` とフック本体は root 所有 `0444`。**
  どのスロットからも書けない。Cursor は hooks.json に書き戻さないので読み取り専用で問題ない。
  ホームディレクトリ自体も root 所有にして、`.cursor` の作り直しを防ぐ。
  **スロットごとに同じ内容を配る**（`.cursor` は `homedir()` 由来なのでホームごとに要る）。
- **`.cursor` は実ディレクトリにする。** Cursor は
  「symlink を含む設定パスの読み込みを拒否する」ため、symlink farm を作ると
  **ゲートが静かに読まれなくなる**。
- **`.cursor` は `root:gdgagent-run-<N> 1775`（sticky）にする。**
  `cursor-agent` は起動時に `~/.cursor/projects/<workspace-id>/` を `mkdir` する。
  親を `0755` のままにすると `EACCES` で CLI が exit 1 する。
  sticky があるので、スロット uid は新しい runtime ディレクトリを作れるが、
  root 所有 `0444` の `hooks.json` / `mcp.json` / `cli-config.json` /
  `sandbox.json` は unlink できない。
  `projects/` はスロット uid 所有 `0755` で先に置く。
- **`cli-config.json` と `sandbox.json` も root 所有 `0444` にする。**
  この 2 つは `sandbox.mode` / `readBoundary` / `additionalReadonlyPaths` を持つ、
  **サンドボックスのポリシーそのもの**である。スロットの uid が書けると、
  1 回の invocation が `sandbox.mode: "disabled"` を書き戻して
  **次回以降の invocation のサンドボックスを無効化できる。**
  「Cursor が『Always allow』で書き戻すから可書きにする」は採らない —
  `approvalMode: "allowlist"` + headless（`-p`）では
  「Always allow」を人が押す場面が無く、書き戻す内容が無い。
  **読み取り専用で起動できることを疎通確認する**（§実装前に疎通確認すること）。
- `authz.sock` は**スロットのグループだけ**に共有する。
  スロット A の uid はスロット B のソケットに接続できない。
  これが [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) の
  「盗んだ nonce が有効なソケットに届かない」の実体である。
- **`/run` は tmpfs なので再起動で消える。** `systemd-tmpfiles` の設定か、
  xangi サービスの起動時処理でディレクトリを作り直す。
  **作り直しを忘れるとソケットが作れず、全 invocation が fail closed で止まる。**

### 2. `gdg` の認証情報

`gdg` CLI は `gdgagent-svc` としてログインする（`gdg login --device`）。
どのスロットからも `~/.config/gdg/credentials.json` は読めない
（`~/.config/gdg/` が `0700 gdgagent-svc`）。
**ワークツリーは `gdgwiki` グループで共有されているので、xangi 側の代行実行はできる**
（§1 でホーム配下から `/srv/gdg-agent/wiki/` に移した理由がこれである）。

**そのため、`gdg wiki *` を必要とする工程は xangi 側が代行する。**

- `gdg wiki clone` / `raw pull` / `ingest lock` / `ingest --commit` — xangi が実行する
- `git push`（remote helper が `gdg` のトークンを使う）— xangi が実行する
- **エージェントが直接実行するのは、ワークツリー内の `git` 操作までにする。**
  ただしそれも **`wk git <status|add|commit|diff>`** 経由である（[Stage 11](11-wk-mediator.md)）。
  素の `git` は argv allowlist に無いので実行できない
  （`git show` / `git diff` が `<acl>` スパンの生本文を出してしまうため）。

ゲートの commit tripwire（Stage 05 §5 / Stage 06 §1）は、エージェントが
`wk git commit` を実行する時点で発火する。`git push` は xangi 側の工程になるので、
**ゲートの発火点は commit だけ**になる。この前提は Stage 05 / 06 に反映済みである。

`gdg wiki verify-acl` はサーバへのトークンが要るので、**xangi 側に
`GET /verify-acl` を認可サーバの隣に生やし**、フックがそこに投げる形にする。
（実装が重ければ、スロットの uid が `sudo -u gdgagent-svc gdg wiki verify-acl` を
実行できる sudoers 行を 1 本だけ足す形でもよい。**その場合コマンドを固定する。**）

### 3. spawn 経路の変更

`~/proj/xangi/src/cli-runner-core.ts` の `spawn` 2 箇所（`collectOutput` と
`executeStreamCore`）で、`cursor-agent` を別 uid で起動する。

**まず invocation にスロットを割り当てる。** xangi 側にスロットプール
（空き `0..N` の管理と、空きが無いときの待ち行列）を置く。
nonce の発行はスロット確定の**後**であり、`entry.slot` にそれを記録する（Stage 04 §3）。

- Node の `spawn` に `uid` / `gid` オプションを渡す方法は、xangi が root で
  走っていないと使えない。**`sudo` 経由で起動する。**

#### `sudo` は環境変数を落とす — 固定ランチャで渡す

**`sudo` の既定は `env_reset` である。**`sudo -u gdgagent-run-<N> --` に
`XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` を持たせても、**子には届かない。**
届かなければフックと `wk` はクラスを引けず、fail closed で
**全 invocation が deny になる。**（症状は派手なので気づくが、設計の穴として塞いでおく。）

`env_keep` で通す案は採らない — allowlist を広げる方向であり、
Stage 04 が「ambient な env に invocation ごとの値を置かない」と決めた向きに反する。

**固定の特権ランチャを置く。**

```
/opt/gdg-agent/bin/spawn-slot-<N>     root:root 0755
```

1. xangi は spawn の直前に `/run/gdg-agent/<N>/nonce`
   （`gdgagent-svc:gdgagent-run-<N>` `0640`）へ、その invocation の nonce だけを書く。
2. sudoers は **このランチャのパスだけ**を `NOPASSWD` で許可する
   （スロットごとに 1 行。引数を取らない）。
3. ランチャが `nonce` を読み、`XANGI_AUTHZ_NONCE` /
   `XANGI_AUTHZ_SOCKET=/run/gdg-agent/<N>/authz.sock` /
   **`GDG_WIKI_RUN_ID`**（トレースの単位。[Stage 11](11-wk-mediator.md) §8）/
   `HOME=/home/gdgagent-run-<N>` /
   **`PATH=/opt/gdg-agent/bin:/usr/bin:/bin`**（固定）を設定して
   `cursor-agent` を exec する。
   **`--mcp-config` は付けない。** `cursor-agent 2026.08.11-e8db854` には
   そのオプションが無く、付けると `unknown option '--mcp-config'` で exit 1 する。
   user 側の MCP 設定は `HOME` 経由の `~/.cursor/mcp.json`（§6）で読む。
4. **invocation 終了時に xangi が `nonce` を消す**（`revoke(nonce)` と同じタイミング）。

`GDG_WIKI_RUN_ID` は nonce と同じファイル（`/run/gdg-agent/<N>/nonce`）に
一緒に書いてよい。**nonce と同じライフサイクルであること**が要件である —
別のライフサイクルにすると、トレースが invocation 境界とズレる。

- **この形が成立するのは「1 スロット = 同時に 1 invocation」だからである。**
  スロットプール（下記）のこの不変条件が、ここで load-bearing になる。
  **崩すと、ランチャが別の invocation の nonce を読む。**
  プールを「1 スロットで複数同時実行」に変えるなら、この受け渡しから作り直すこと。
- `HOME` を `/home/gdgagent-run-<N>` に設定する。
  Cursor の `userConfigPath` は `homedir()` を直接読むので、これで
  `/home/gdgagent-run-<N>/.cursor/hooks.json` が使われる。
- **`PATH` はランチャが固定する。** [Stage 05](05-cursor-harness-pretooluse.md) §3 の
  argv allowlist は `argv[0] === "wk"` を名前で照合するので、
  それが root 所有 `0755` の `/opt/gdg-agent/bin/wk` に解決されることを
  ここで保証する。ゲートは変数代入の前置（`PATH=… wk …`）を deny するので、
  エージェント側から差し替える経路は無い。
- `cwd` は workdir（`/srv/gdg-agent/wiki`）。**全スロットで同じワークツリーである**
  （[ADR-006](adr.md#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)）。
  uid を分けたのは nonce と `/proc` の分離のためであって、作業領域を分けるためではない。
- `XANGI_AUTHZ_NONCE` と、**そのスロットの** `XANGI_AUTHZ_SOCKET`
  （`/run/gdg-agent/<N>/authz.sock`）を渡す。
- **`sudo` のコマンド固定を必ず入れる。** ワイルドカードを許すと uid 分離が意味を失う。
  ランチャ自身も引数を受け取らない（スロット番号はファイル名に埋め込む）。
- **one-shot spawn だけを使う。** 常駐プロセスに戻すと、env が作り直されず
  失効済み nonce を持ち越す（Stage 04 §3）。

### 4. Cursor サンドボックス

`/home/gdgagent-run-<N>/.cursor/cli-config.json`（スロットごとに同じ内容）:

```jsonc
{
  "permissions": { "allow": [ /* Stage 05 で決めた最小限。すべて絶対パス */ ], "deny": [] },
  "approvalMode": "allowlist",
  "sandbox": {
    "mode": "enabled",
    "readBoundary": "workspace",
    "networkAccess": "user_config_only",
    "networkAllowlist": []
  }
}
```

`/home/gdgagent-run-<N>/.cursor/sandbox.json` に、workdir 外で必要な最小限だけを
`additionalReadonlyPaths` として足す（`/opt/gdg-agent/lib`、Node の実行系、
**そのスロットの `/run/gdg-agent/<N>/`**）。
**`~/.config/gdg/` と `~/.config/xangi/` は絶対に足さない。**

**ソケットのパスは足す必要がある。**認可サーバへの接続はフックが行うので、
`readBoundary: "workspace"` の下でも `/run/gdg-agent/<N>/` に到達できなければ
**全 invocation が fail closed で止まる。**
足すのは**自分のスロットのディレクトリだけ**で、`/run/gdg-agent/` 全体を足さない。

`sandbox.json` はスロットごとに内容が違う（ソケットのパスが違う）ので、
`setup.sh` が**スロットごとに生成する**。**root 所有 `0444`** で置く（§1）。

**`<workdir>/.cursor/sandbox.json` に無効化手段が無い。**
Cursor は per-user の `~/.cursor/sandbox.json` と **per-repo の
`<workspace>/.cursor/sandbox.json`** をマージする（§確認済みの事実）。
`projectRoot` は `gdgwiki` グループで書ける共有 workdir なので、
そこにファイルを作れる経路が 1 つでもあれば `additionalReadonlyPaths` を足せる。
**`mcp.json` を 1 ファイルに固定する CLI フラグは、この Cursor 版には無い。**
sandbox 側にも per-repo マージを無効化するオプションは無い。
閉じているのは次の 2 枚だけである。

- [Stage 05](05-cursor-harness-pretooluse.md) §2 — 変更系ツールの無条件 deny
- [Stage 11](11-wk-mediator.md) §5 手順 0 — `wk write` の `pages/**/page.md` allowlist

**どちらかを緩めると、サンドボックスが次の invocation から静かに無効化される。**

`networkAccess: "user_config_only"` + 空の allowlist で、
エージェントからの外向き通信を止める。wiki への通信は xangi が代行するので不要である。
**疎通確認で問題が出たら、必要な宛先だけを allowlist に足す。**

### 5. setup.sh

`agents-local/setup.sh` に以下を足す。**冪等にする。**

0. **OS 判定。** Ubuntu 以外では何もせず失敗する。macOS で部分実行させない
   （[Stage 00](00-typescript-runtime.md) §7）
1. `gdgagent-svc` と `gdgagent-run-0..N` のユーザー作成、
   `gdgwiki` グループの作成と全員の追加
2. `/opt/gdg-agent/` の作成と、ESM marker、`lib/` 配下の `.ts` 全部
   （`acl-gate.ts` / `wk.ts` / `acl-core.ts` / `acl-insert-core.ts` / `acl.ts`）、
   `bin/wk` launcher の配置
   （marker と `lib/**` は `0444`、`bin/wk` と `bin/spawn-slot-<N>` は
   `0755`。いずれも root 所有）。
   **`lib/` は平坦な 1 ディレクトリである**（[Stage 00](00-typescript-runtime.md) §5-§6）。
   `acl.ts` は `pnpm --filter @gdgjp/gdg-lib build:acl` の生成物なので、
   配置前にビルド済みであることを検査する
3. **スロットごとに** `/home/gdgagent-run-<N>/.cursor/hooks.json` を配置（root 所有 `0444`）
3a. **スロットごとに** `mcp.json` を配置（root 所有 `0444`、内容はそのスロットの
   インデックスプロキシ 1 本だけ。§6）
4. **スロットごとに** `cli-config.json` と `sandbox.json` を配置（**root 所有 `0444`**）
   （`sandbox.json` はソケットパスが違うので内容もスロットごとに違う）
5. `/srv/gdg-agent/wiki/` を `gdgagent-svc:gdgwiki 2770` で作成（**setgid を忘れない**）
6. `/run/gdg-agent/` と各スロットのディレクトリ作成
   （tmpfs なので `systemd-tmpfiles` か起動時処理に載せる）
7. sudoers ドロップイン（`/etc/sudoers.d/gdg-agent`）を**スロットぶん**配置し、
   `visudo -c` で検証。許可するのは `/opt/gdg-agent/bin/spawn-slot-<N>` **だけ**（§3）
8. systemd user unit を `gdgagent-svc` 用に設定
9. **検証ステップ** — 次の 3 つを実際に走らせて結果を表示する。
   - `sudo -u gdgagent-run-0 cat /home/gdgagent-svc/.config/gdg/credentials.json` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /srv/gdg-agent/wiki` が**成功する**（共有グループの確認）
   - `sudo -u gdgagent-svc test -w /srv/gdg-agent/wiki` が**成功する**（代行実行の確認）
   - `sudo -u gdgagent-run-0 test -r /run/gdg-agent/1/authz.sock` が**失敗する**（スロット分離）
   - `sudo -u gdgagent-run-0 test -w /opt/gdg-agent/bin/wk` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /opt/gdg-agent/lib/wk.ts` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /opt/gdg-agent/package.json` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/projects` が**成功する**
   - `sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/mcp.json` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/cli-config.json` が**失敗する**
   - `sudo -u gdgagent-run-0 test -w /home/gdgagent-run-0/.cursor/sandbox.json` が**失敗する**
   - `sudo -u gdgagent-run-0 cat <xangi dataDir>/speech/` が**失敗する**（会話ログの隔離）

**root 権限が要る操作は自動化せず、実行すべきコマンドを表示するに留めてもよい**
（既存の `setup.sh` が `xangi setup` と `xangi service start` について取っている方針に合わせる）。

### 6. インデックス MCP の起動経路

Stage 09 は `index.db` を `gdgagent-run-*` から読めない所有権にすると決めている
（本文を丸ごと持つため、読めると read ゲートを迂回して全文が読める）。
同時に「MCP サーバはエージェントと同じ uid で走らせない」とも書いてある。

**この 2 つと、`~/.cursor/mcp.json` にデーモン本体を書く案は両立しない。**
その経路では **Cursor が MCP サーバの親になる**ので、
子プロセスはスロットの uid を継ぐ。`index.db` を開けない。

構成を 2 段にする。

| プロセス | uid | 役割 |
|---|---|---|
| インデクサ／MCP デーモン | `gdgagent-svc` | `index.db` を開く。検索と post-filter を実行する。UNIX ソケットで待つ |
| stdio プロキシ | `gdgagent-run-<N>` | Cursor が spawn する。stdio ↔ ソケットを中継するだけ |

- ソケットは `/run/gdg-agent/<slot>/index.sock`、`0660`、
  所有 `gdgagent-svc:gdgagent-run-<N>`。`authz.sock` と同じ置き方にする。
- **MCP 設定は `setup.sh` がスロットごとに置く静的ファイルである**
  （`/home/gdgagent-run-<N>/.cursor/mcp.json`、**root 所有 `0444`**）。
  中身はそのスロットのプロキシ 1 本だけ。ソケットパスがスロット固定なので内容も静的にできる。
  **xangi が invocation ごとに書く形にしない**（Stage 09 §5 から削除済み）—
  ポリシーファイルは root 所有なので svc も書けず、書ける場所に置けばエージェントも書ける。
- **ランチャは `HOME` をスロットホームに固定し、`--mcp-config` は渡さない**（§3）。
  Cursor は `~/.cursor/mcp.json` と **`<projectRoot>/.cursor/mcp.json`** の両方を読む
  （Stage 05 の「確認済みの事実 9」）。user 側は root 所有ファイルで固定できる。
  project 側は共有 workdir（`gdgwiki` 書き込み可）に残るので、
  `wk write` の allowlist（Stage 11 §5 手順 0）と
  `MCP:search` のツール名 deny（Stage 05 §3-5）で閉じる。
  サーバ同一性まで見るなら `beforeMCPExecution` が次の手である（ADR-004）。
- **Stage 05 の MCP allowlist はこの固定に依存する。**
  `preToolUse` にサーバ名は渡らないので、フックはツール名しか見られない（Stage 05 §3-5）。
  ここが崩れると、`search` という名前の別サーバが混ざりうる。
- **プロキシは検索要求を中継するだけで、判定も `index.db` へのアクセスも持たない。**
  プロキシが乗っ取られても、得られるのはデーモンが返す
  「パス + 行範囲 + score」だけである（Stage 09 §4）。
- デーモン側は nonce をプロキシ経由ではなく**リクエストに載せて**受け取り、
  自分で認可サーバに問い合わせて post-filter する。
  **プロキシの申告するクラスを信用しない。**

### 制約

- **`~/.cursor/hooks.json` とフック本体を agent uid から書けないこと。**
  これが崩れると `rm` 一発でゲートが消え、**画面上は正常に見える**。
- **`.cursor` を symlink にしない。** Cursor が設定の読み込みを拒否する。
- **sudoers のコマンドをワイルドカードにしない。** 固定する。スロットぶん行を書く。
- **`~/.config/gdg/` と `~/.config/xangi/` を `additionalReadonlyPaths` に足さない。**
  代わりに**そのスロットの `/run/gdg-agent/<N>/` だけ**を足す。
- **uid を 1 つに戻さない。** 単一 uid では `/proc/<pid>/environ` 経由の nonce 窃取が
  復活する（[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)）。
  **窃取が起きても成功時の挙動は何も変わらないので、テストが無ければ気づけない。**
- **ワークツリーを `0700` にしない。** svc 側の `gdg wiki *` 代行実行が通り抜けられなくなる。
  共有は `gdgwiki` グループ + setgid で行う。
- **setgid ビットを落とさない。** 落とすと agent が作ったファイルの group が
  そのスロットの個人グループになり、**svc が commit / push できなくなる**。
  症状は「ある日から push だけ失敗する」で、原因が権限だと気づきにくい。
- **`/run/gdg-agent/` 全体を sandbox に開けない。** 他スロットのソケットが見える。
- **スロットごとにワークツリーを分けない。** [ADR-006](adr.md#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)
  の「workdir は 1 つ」は維持する。uid を分けたのは nonce と `/proc` のためである。
- **スロット数をリポジトリの同時実行数として使わない**（§1）。
  リポジトリを変更する invocation は、[Stage 10](10-sleep-scheduler.md) §1a の
  ミューテックスで同時に 1 つに絞る。
  ここを緩めると、2 つの invocation が同じ git index とトレースを壊し、
  **`<acl>` タグが欠落したまま push される**（Stage 11 §8）。
- **`mcp.json` を agent uid から書けるようにしない。** root 所有 `0444`（§6）。
  書けると MCP サーバを足せて、Stage 05 のツール名 allowlist が前提を失う。
- **`cli-config.json` / `sandbox.json` を agent uid から書けるようにしない**（§1、§4）。
  あの 2 つは `sandbox.mode` と `readBoundary` を持つポリシー本体である。
  可書きにすると、1 回の invocation が**次回以降のサンドボックスを無効化できる。**
  「Cursor が書き戻すから」を理由に戻さない — 代替は §実装前に疎通確認することにある。
- **`<workdir>/.cursor/sandbox.json` を作れる経路を開けない**（§4）。
  per-repo マージを無効化する CLI フラグは無いので、
  Stage 05 §2 の変更系 deny と Stage 11 §5 手順 0 の allowlist が防御である。
- **`PATH` を固定ランチャから外さない**（§3）。外すと `argv[0] === "wk"` の
  照合先が不定になる。
- **`--mcp-config` をランチャに足し直さない。** この Cursor 版では未知オプションで落ちる。
  project `mcp.json` の混入は `wk` の書き込み拒否と MCP ツール名 allowlist で止める。
- **`.cursor` を `0755` に戻さない。** 戻すと `mkdir ~/.cursor/projects/...` が
  `EACCES` で落ちる。ポリシーファイルの保護は sticky + `0444` で行う。
- **`GDG_WIKI_RUN_ID` を nonce と別のライフサイクルにしない**（§3）。
  ズレると、トレースが invocation 境界と一致しなくなる。
- **MCP サーバを Cursor に直接 spawn させない**（§6）。
  `mcp.json` に実体を書くと、その子プロセスはスロットの uid を継いで
  `index.db` を開けない。**「開けないから権限を緩める」に倒すと、
  Stage 09 が kiri を却下した理由（本文が読める）に戻る。**
- **workdir 内部の ACL はサンドボックスでは表現できない。** この限界を
  README と `AGENTS.md` に明記する。「サンドボックスがあるからハーネスは不要」という
  後続の判断を防ぐ。
- **`sandbox.readBoundary` と `~/.cursor/sandbox.json` は未文書機能である。**
  Cursor のバージョン更新で壊れうる。バージョンを固定し、更新時に疎通確認を回す。
- **エージェントに `gdg` のトークンを渡さない。** `gdg wiki *` は xangi が代行する。
- **会話ログ（transcript と発話ログ）を workdir 配下に置かない**（§1）。
  あそこは `gdgwiki` グループで全スロットと共有される。
- **`sudo` に環境変数を託さない。** `env_reset` で落ちる。
  受け渡しは固定ランチャ + スロットの `nonce` ファイルだけにする（§3）。
- **`/opt/gdg-agent/bin/wk` を agent uid から書けるようにしない。**
  `wk` は読み書きの唯一の窓口なので、書き換えられると ACL 判定がまるごと迂回される。
  フック本体と同じ扱いにする。

---

## Files to touch — 変更ファイル

### `agents-local/`

- `setup.sh` — **スロットぶんの**ユーザー作成、`gdgwiki` グループ、
  `/srv/gdg-agent/wiki` の setgid 作成、`/run/gdg-agent/` の用意、
  スロットごとの `.cursor` 配置、sudoers、検証ステップ
- `README.md` — uid 分離の構成図、境界の範囲と限界
- `AGENTS.md` — 「workdir 外は読めない」「`gdg wiki *` は代行される」ことの明記
- `config/cli-config.json`（新規）— 配置元テンプレート
- `config/sandbox.json`（新規）
- `config/hooks.json`（新規）
- `config/mcp.json`（新規）— インデックスプロキシ 1 本だけ。スロットごとに生成（§6）
- `config/sudoers.d-gdg-agent`（新規）— 許可するのはランチャのパスだけ
- `config/spawn-slot.sh`（新規）— 固定ランチャのテンプレート（スロットごとに生成）

### `~/proj/xangi`

- `src/cli-runner-core.ts` — `sudo /opt/gdg-agent/bin/spawn-slot-<N>` 経由の spawn、
  one-shot spawn の維持（`HOME` と `XANGI_AUTHZ_*` はランチャ側が設定する。§3）
- `src/slot-pool.ts`（新規）— スロットの割り当て・返却・待ち行列。
  **1 スロットで同時に 1 invocation** の不変条件を保つ（§3 がこれに依存する）。
  **リポジトリミューテックス（Stage 10 §1a）とは別物**として実装する（§1）
- `src/cursor-cli.ts` — 実行パスの解決
- `src/authz-server.ts` — `verify-acl` の代行エンドポイント（§2）、
  `/run/gdg-agent/<N>/nonce` の書き出しと削除（§3）
- `src/installer/platform/linux.ts` — systemd user unit を `gdgagent-svc` 向けに
- `README.md` — uid 分離の前提

### `cli/`

- `internal/wiki/hooks/acl-gate.ts` — `verify-acl` の呼び出し先を
  認可サーバ経由に変更（§2）

---

本番 Ubuntu ホストへの配置記録（2026-08-20）:
[07-ubuntu-host-install-2026-08-20.md](07-ubuntu-host-install-2026-08-20.md)。
所有権と workdir は載った。Discord Privileged Intents と invocation 実走は未完了。

**Stage 12 での訂正**: 実装時、§3 の spawn 経路（`sudo -u gdgagent-run-<N>` 起動）は
`cli-runner-core.ts` ではなく `cursor-cli.ts` に溶接され、cursor 以外の 4 バックエンドには
uid 分離が存在しない状態になっていた。
[`docs/agents-local-refactoring/12-xangi-slot-isolation.md`](../agents-local-refactoring/12-xangi-slot-isolation.md)
がこの節の設計どおり `CliRunnerBase.resolveSpawn`（`cli-runner-core.ts`）へ引き上げ、
全アダプタに適用した。`slot-runtime.ts` の中身（`slotIsolationEnabled` /
`assertSlotLauncher` / `writeSpawnSpec` / `sudoLauncherArgs`）は変わっていない。

## Verification — 完了条件と検証

### 完了条件

1. `sudo -u gdgagent-run-0 cat /home/gdgagent-svc/.config/gdg/credentials.json` が失敗する。
2. `sudo -u gdgagent-run-0 rm /home/gdgagent-run-0/.cursor/hooks.json` が失敗する。
3. `sudo -u gdgagent-run-0 cat /opt/gdg-agent/lib/acl-gate.ts` は成功し、
   `sudo -u gdgagent-run-0 tee /opt/gdg-agent/lib/acl-gate.ts` は失敗する。
4. `cursor-agent` が `gdgagent-run-<N>` として起動し、`HOME=/home/gdgagent-run-<N>` で
   `~/.cursor/hooks.json` のフックが発火する。
4a. **`gdgagent-svc` と `gdgagent-run-0` の双方が `/srv/gdg-agent/wiki` に書ける。**
   svc 側で `gdg wiki raw pull` と `git push` が通る。
4b. **スロット 0 の uid がスロット 1 のソケットに接続できない。**
4c. **スロット 0 の agent がスロット 1 のプロセスの環境を読めない**
   （`sudo -u gdgagent-run-0 cat /proc/<slot1-pid>/environ` が失敗する）。
4d. **`sudo` 経由で起動した子プロセスの env に、現在の invocation の
   `XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` / `GDG_WIKI_RUN_ID` が入っている**
   （固定ランチャが効いている）。
4e. **invocation 終了後に `/run/gdg-agent/<N>/nonce` が残っていない。**
4f. `sudo -u gdgagent-run-0 tee /opt/gdg-agent/bin/wk` が失敗する。
    `/opt/gdg-agent/lib/wk.ts` と `/opt/gdg-agent/package.json` への書き込みも失敗する。
4g. `sudo -u gdgagent-run-0 tee /home/gdgagent-run-0/.cursor/mcp.json` が失敗する。
    `cli-config.json` と `sandbox.json` への書き込みも失敗する。
4g2. **`<workdir>/.cursor/sandbox.json` を手で書いても、次回 invocation の
    `readBoundary` が変わらない**（Stage 05 §2 の deny と Stage 11 §5 手順 0 で
    そもそも作れないことを、両方の経路で確認する）。
4h. **`cursor-agent` の argv に `--mcp-config` が無い**（§3）。
   `HOME` がスロットホームで、`~/.cursor/mcp.json` は root `0444`。
   `<workdir>/.cursor/mcp.json` に別サーバを書いても、そのツールは
   ゲートの `MCP:search` allowlist で deny される
   （サーバ名まで見るなら Stage 05 §3-5 の `beforeMCPExecution`）。
4h2. **`sudo -u gdgagent-run-0 test -w ~/.cursor/projects` が成功し、
    `rm ~/.cursor/hooks.json` は失敗する**（§1 の 1775 + sticky）。
4i. **2 つの invocation を同時に投げても、リポジトリを変更するのは 1 つずつである**
   （Stage 10 §1a のミューテックス）。片方は待つ。
5. サンドボックス有効のまま ingest 相当の作業が完走する。
6. エージェントの shell から workdir 外（`/etc/passwd` 以外の任意のパス）を
   読もうとして失敗する。
7. エージェントの shell から外部への HTTP が失敗する。

### コマンド

```bash
sudo visudo -c -f /etc/sudoers.d/gdg-agent
```

```bash
sudo -u gdgagent-run-0 env HOME=/home/gdgagent-run-0 cursor-agent --print 'echo test'
```

```bash
sudo -u gdgagent-run-0 stat -c '%U:%G %a' /home/gdgagent-run-0/.cursor/hooks.json /home/gdgagent-run-0/.cursor/cli-config.json /home/gdgagent-run-0/.cursor/sandbox.json /opt/gdg-agent/package.json /opt/gdg-agent/lib/acl-gate.ts /opt/gdg-agent/bin/wk /opt/gdg-agent/lib/wk.ts /srv/gdg-agent/wiki
```

```bash
cd ~/proj/xangi && npm test && npx tsc --noEmit
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **フックが発火し続けている。** uid を変え `HOME` を変えた結果、
  Cursor が別の `hooks.json` を見に行って **ゲートが黙って無効化される** 経路。
  `setup.sh` の検証ステップと、xangi 起動時のセルフチェックの両方で固定する。
  **画面上は完全に正常に見える。**
- **所有権の冪等性。** `setup.sh` を 2 回実行しても所有権とモードが変わらないこと。
- **sudoers のコマンド固定。** ワイルドカードが入っていないこと。
  `visudo -c` を CI かセットアップの一部として回す。
- **`.cursor` が実ディレクトリであること。** symlink 化されると設定が読まれなくなる。
- **`~/.config/gdg/` が `additionalReadonlyPaths` に入っていない。**
  入った瞬間に uid 分離の意味が消える。
- **`cli-config.json` / `sandbox.json` が root 所有 `0444` のままである。**
  可書きに戻ると、1 回の invocation が次回以降のサンドボックスを無効化できる。
  **無効化された側は正常に動いてしまうので、テストが無ければ気づけない。**
- **Cursor のバージョン固定。** `readBoundary` は未文書機能なので、
  バージョンを上げたら疎通確認を回す運用をドキュメント化する。
- **`gdg wiki *` の代行経路が動く。** エージェントが直接 `gdg` を叩けなくなった結果、
  ingest が完走しなくなっていないこと。
- **ワークツリーが svc と全スロットの双方から書ける。** 片方だけになると、
  agent は書けるが push できない（または逆）という状態になる。
  **setgid が落ちた場合は「しばらく動いてから急に壊れる」形で出る** —
  既存ファイルは正しい group を持ったままなので、
  新しく作られたファイルが commit に入るまで症状が出ない。
- **スロット間の分離。** スロット A の uid から
  スロット B の `/proc/<pid>/environ` と `/run/gdg-agent/<B>/` が読めないこと。
  ここが緩むと [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) が
  無効になるが、**盗まれても成功時の挙動は何も変わらないので気づけない。**
- **nonce が `sudo` を跨いで届いている。** `env_reset` の既定に戻したり、
  ランチャを経由しない `sudo -u ... cursor-agent` に戻すと、
  **全 invocation が fail closed で止まる。**
- **`nonce` ファイルが invocation ごとに書き換わり、終了後に消える。**
  残ると、次の invocation の前に前回の nonce をランチャが拾う経路ができる。
  **1 スロット = 同時に 1 invocation の不変条件をテストで固定する。**
- **会話ログが workdir 配下に無い。** transcript と発話ログの出力先が
  `dataDir` 配下であること。workdir に戻ると、全スロットから素通しで読める。
- **`/run/gdg-agent/` が再起動後に再作成される。** tmpfs なので消える。
  再作成を忘れると全 invocation が fail closed で止まる（症状は派手なので気づく）。
- **MCP デーモンが svc uid で走り、プロキシがスロット uid で走っている。**
  プロキシ側から `index.db` が開けないことを確認する。
- **`mcp.json` が root 所有で、ランチャが `--mcp-config` を付けていない。**
  フラグを足すと CLI が即死する。project `mcp.json` の混入は
  ツール名 allowlist 側で気づく（検索は動き続けるので、deny ログを見ること）。
- **スロットプールとリポジトリミューテックスが別物として動いている。**
  同時 2 invocation で、スロットは 2 つ使われ、リポジトリ変更は直列になること。
  **ミューテックスを外しても平常時は動いてしまう** — 壊れるのは競合したときだけで、
  そのとき失われるのは `reads`（＝ACL タグ）である。

### 手動 E2E

1. クリーンな Ubuntu で `setup.sh` を実行し、最後の検証ステップが全部通ることを確認する。
2. `setup.sh` をもう一度実行し、所有権・モード・ファイル内容が変わらないことを確認する。
3. Discord から質問を投げ、`ps -o user= -p $(pgrep -f cursor-agent)` が
   `gdgagent-run-<N>` を返すことを確認する。
3a. 2 つのチャンネルから**同時に**質問を投げ、2 つのプロセスが
   **別々のスロット uid** で走ることを確認する。
3b. その 2 つに `wk write` → `wk git commit` をさせ、
   **リポジトリ変更が直列になり、双方のトレース（`.gdgwiki/ingest-trace/<runId>.json`）が
   残っている**ことを確認する（Stage 10 §1a、Stage 11 §8）。
4. エージェントに `cat /home/gdgagent-svc/.config/gdg/credentials.json` を試させ、
   失敗することを確認する。
5. エージェントに `rm ~/.cursor/hooks.json` を試させ、失敗することを確認する。
6. エージェントに `curl https://example.com` を試させ、失敗することを確認する。
7. Stage 05 / 06 の E2E（ACL ゲートと自動挿入）を uid 分離済みの環境で
   もう一度全部通す。**ここで落ちるなら分離の設計が間違っている。**
