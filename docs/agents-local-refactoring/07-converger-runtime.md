# Stage 07 — systemd/apparmor/パッケージ系リソース、bootstrap 新設、install.sh の撤去

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 07。**依存: Stage 06。並行可: Stage 13。**

Stage 06 でファイル・ユーザー・sudoers・tmpfiles が収束エンジンに乗った。
このステージで残りのリソース（systemd / apparmor / パッケージ取得）を移し、
**`agent-host/install.sh`（853 行）を削除する**。

> **順序が重要**: `install.sh` を消すと、ホストに `gdg` を持ち込む手段が無くなる。
> したがって **bootstrap（`scripts/install-gdg-agent-host.sh`）を先に作り、
> まっさらな VM で動くことを検証してから** `install.sh` を削除する。
> 本ステージ内でこの順序を守ること（bootstrap → 検証 → 削除）。

### 移す対象（`install.sh` の残り）

| 関数 | 行 | 内容 |
|---|---|---|
| `install_apt_packages` | :116-121 | `apt-get install -y git ca-certificates curl unzip` |
| `install_node_if_needed` | :123-139 | NodeSource `setup_22.x` + `apt-get install nodejs` |
| `ensure_gws` | :158-210 | **正しくピンできている唯一の実装**。version + per-arch SHA256 + `--version` 再検証 |
| `ensure_gdg_system` | :366-393 | `gdg` 取得 + `git-remote-gdg-wiki` symlink |
| `ensure_cursor_cli` | :444-455 | Stage 04 でピン留め済み |
| `ensure_xangi_fork` | :457-484 | Stage 04 で ref ピン済み。clone + `npm ci` + symlink |
| `ensure_langfuse_forwarder` | :486-503 | **毎回 `rm -rf` + `npm ci`**（数分、変更検出なし） |
| `write_xangi_user_unit` | :645-678 | systemd user unit + `model.conf` drop-in |
| `write_langfuse_forwarder_unit` | :505-539 | `.service` + `.timer` |
| `start_xangi_service` | :680-688 | secrets.json に `DISCORD_TOKEN` があるときだけ start |
| `copy_operator_runtime_secrets` | :619-643 | `$SUDO_USER` の home から secrets をコピー |
| `prompt_langfuse_credentials` | :541-596 | **対話 TTY プロンプト** |
| `ensure_svc_gdg_login` | :395-421 | `gdg login --device`（TTY 必須） |
| `ensure_wiki_clone_and_seed` | :423-442 | `gdg wiki clone` + workspace 配布 |
| apparmor | 旧 `apply-ownership.sh:44-52` | プロファイル配置 + `apparmor_parser -r` |

### 設計上の難所

**1. 対話プロンプトは `--dry-run`/apply モデルと両立しない。**
`prompt_langfuse_credentials`（:541-596）は TTY で 4 項目を 1 つずつ聞き、`node -e` で JSON を書く。
`ensure_svc_gdg_login`（:395-421）も TTY を要求する。収束の途中で人間の入力を待つ設計は
GitOps では成立しない。**収束処理の外へ出す。**

**2. secrets は spec に入らない。**
`copy_operator_runtime_secrets` は `$SUDO_USER` の home から `auth.json` / `secrets.json` /
`credentials.json` を読む。つまりホストの状態が「誰が sudo したか」に依存する唯一の箇所。
Lima VM は `SUDO_USER=root` を渡してこれを抑止している（`dev/provision.sh:40`、
`operator_home`(:286-288) が空を返す）。

**3. systemd user scope が最も面倒。**
`gdgagent-svc` の `systemctl --user` を root から操作するには `loginctl enable-linger` と
適切な `XDG_RUNTIME_DIR` が要る。`install.sh` は `as_svc` ヘルパーでこれを扱っている。

**4. `gdg` 自身が収束エンジンになることによる自己更新のフットガン。**
現状 `ensure_gdg_system:371` は無条件 `gdg update -y` を、しかも `ensure_svc_gdg_login` の**前**に
実行している（Stage 04 でピン留め済み）。apply の途中で自分自身が入れ替わるのは危険。

**5. `ensure_langfuse_forwarder` は毎回全部やり直しており、しかもチェックアウトに依存する。**
`rm -rf /opt/langfuse-forwarder` → `cp -a "$layout_dir/lib/langfuse-forwarder"` → `npm ci`。
数分かかり、変更検出が無い。加えて **コピー元が monorepo チェックアウトなので、
`/opt/gdgjp` の消費者の 1 つになっている**（Stage 13 の clone 撤去の前提）。

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `docs/agents-local-refactoring/06-converger-core.md` — 前段。エンジンとリソース抽象
- `agent-host/install.sh` — 全体（このステージで削除する）
- `agent-host/lib/verify.sh` — Stage 04 で退避した 13 検査（`verify` サブコマンドの元ネタ）
- `agent-host/config/apparmor.d-cursor-agent-cursorsandbox` — `/opt/cursor-agent/cursorsandbox` に
  `userns` を許可するプロファイル。Ubuntu 24.04+ で `sandbox.mode=enabled` に必要
- `agent-host/dev/provision.sh:46-53` — Lima だけが持つ `xangi.service.d/harness.conf` drop-in

### 再利用する既存実装

- **`agent-host/install.sh:158-210` `ensure_gws`** — `tarball@sha256` リソースの雛形。
  version 比較 → 不一致なら再取得 → `sha256sum -c -` → インストール後 `--version` 再検証。
  この「望ましい状態 vs 実際」の比較が収束エンジンのあるべき形
- **`cli/internal/update/`** — `gdg` 自身の更新経路。tarball 取得とチェックサム検証を再利用する
- **`agent-host/lib/verify.sh`** — 13 検査。`gdg agent-host verify` に移送する
- **Stage 06 の `resource.go` / `plan.go` / `apply.go`** — このステージのリソースは同じ抽象に乗る

## Design — 設計

### 1. 追加するリソース（約 560 行）

| リソース | 見積 | 内容 |
|---|---|---|
| `systemd`（system + **user scope**） | ~200 | unit 書き込み、変更時のみ `daemon-reload`、`enable`、条件付き `start`、`enable-linger`、`XDG_RUNTIME_DIR` の解決 |
| `apparmor` | ~30 | `file` + 変更時のみ `apparmor_parser -r` |
| `apt` | ~60 | `dpkg-query -W` で確認 → 不足時のみ `apt-get install -y` |
| `tarball@sha256` | ~100 | `ensure_gws` の移植。version 比較 → 取得 → sha256 検証 → 検証コマンド実行 |
| `git@ref` | ~80 | clone/fetch/`checkout --detach <ref>` + `rev-parse HEAD` 照合 |
| `exec` | ~60 | `npm ci` など。cwd/env/リトライ。**変更検出条件を明示的に持つ** |
| **小計** | **~530** | Stage 06 の ~780 と合わせて ~1,310 |

`exec` リソースは危険なので、「いつ実行するか」の条件（例: `package-lock.json` のハッシュが変わったとき）を
必須の属性にする。無条件実行を許すと `ensure_langfuse_forwarder` の毎回 `npm ci` が再現する。

**あわせて `langfuse-forwarder` を自己完結した成果物にする。** チェックアウトからの
`cp -a` + `npm ci` をやめ、ビルド済み成果物を `pins.langfuseForwarder` として
version + sha256 でピンするか、Tier 2 のリリースバンドルに同梱する。
**これは Stage 13 で `/opt/gdgjp` を削除するための前提条件**であり、
残したままだと clone 削除時に forwarder が動かなくなる。

### 2. secrets を収束処理から分離する

```
gdg agent-host secrets set langfuse    # 対話で公開鍵/秘密鍵/host/idSalt を受け取る
gdg agent-host secrets set discord     # DISCORD_TOKEN
gdg agent-host secrets import --from-operator   # $SUDO_USER の home からコピー（現行動作）
gdg agent-host secrets status          # 何が揃っていて何が欠けているか
```

- `apply` は secrets を**読むが書かない**。不足していれば「何が足りないか」を報告して
  該当サービスを start しない（現行 `start_xangi_service:681-682` と `print_remaining:690-722` の動作を踏襲）
- `secrets status` が `print_remaining` の後継になる
- `ensure_svc_gdg_login` の `gdg login --device` も `secrets` 系に寄せる（TTY が要るため）

### 3. 自己更新の順序を固定する

`gdg agent-host apply` の冒頭で:

1. spec の `pins.gdgCli` と自分自身のバージョンを比較する
2. 不一致なら**ピンされたバイナリを取得して `exec` で入れ替わる**（re-exec）
3. 一致していれば収束を続行する

apply の途中で `gdg` を差し替えない。

### 4. Lima overlay の統合

`dev/provision.sh:46-53` が持つ VM 専用 drop-in（`GDG_AGENT_HARNESS=true`,
`SCHEDULER_ENABLED=false`, `XANGI_AGENT_SLOT_COUNT`, `GDG_WIKI_LOCK_OWNER`）を
`agent-host/agent-host.dev.json`（Stage 04 で作成）の overlay として表現する。

**これが dev/prod 乖離の解消そのもの。** 現状 `dev/provision.sh` は rsync-from-host、slot 2、
IAM fixture、drop-in 追加、secret コピー抑止を**fork したコードで**行っており、
本番と別のシステムをテストしている。overlay 化により差分がデータになる。

`dev/provision.sh` と `dev/activate.sh` は残してよいが、中身は
「Lima 固有の前準備 + `gdg agent-host apply --spec agent-host.dev.json`」に縮める。

### 5. `gdg agent-host verify`

`agent-host/lib/verify.sh` の 13 検査を Go に移す。内容（`setup.sh:143-185` 由来）:

- `gdgagent-run-0` から credentials が読めない
- wiki が slot と svc の双方から書ける
- `authz.sock` が slot から読めない
- `/opt/gdg-agent/bin/wk` / `lib/wk.ts` / `package.json` が slot から書けない
- `.cursor/projects` が書ける
- `mcp.json` / `sandbox.json` / `hooks.json` が書けない
- `cli-config.json` が書ける
- `DATA_DIR` が読めない
- `dataDir` と会話ログが worktree の下に無い

**これが Stage 10 のデプロイ後ヘルスチェックになる。** 失敗時に非ゼロを返すこと。

### 6. bootstrap を新設する（`install.sh` 削除の前提）

`scripts/install-gdg-agent-host.sh` を約 40 行で作る。**責務は 4 つだけ:**

```sh
#!/usr/bin/env bash
set -euo pipefail

# (a) Ubuntu 判定
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || { echo "Ubuntu only" >&2; exit 1; }

# (b) 最低限の前提パッケージ
apt-get update -qq
apt-get install -y -qq curl ca-certificates

# (c) ピンされた gdg を取得（version + sha256 をこのファイルのリテラルで固定）
GDG_VERSION="..."
GDG_SHA256_X86_64="..."
GDG_SHA256_AARCH64="..."
#   … ダウンロード、sha256sum -c、install -m 0755 /usr/local/bin/gdg
#   … ln -sfn /usr/local/bin/gdg /usr/local/bin/git-remote-gdg-wiki

# (d) 以降は全部 Go
exec gdg agent-host apply "$@"
```

**設計上のポイント**:

- **ピン値をこのファイルに持つ必要がある。** spec を読むには `gdg` が要り、`gdg` を取るにはピンが要る
  という循環がある。ここだけはリテラルで持ち、CI が spec の `pins.gdgCli` と一致することを検査する
- **これが public raw URL に置く必要がある唯一のファイル。**
  `agent-host/README.md:90` の 404 が構造的に解消する
- 第三者スクリプトの `| bash` を**しない**（Stage 04 の方針）
- `gdg agent-host apply` が spec を**埋め込みの既定値**から取れるようにしておく
  （bootstrap 段階では monorepo が無い可能性がある）
- **bootstrap を育てない。** 上記 4 責務以外を足さない。60 行を超えたら
  それは `gdg agent-host` に入れるべきロジック

### 7. `install.sh` の撤去

**bootstrap がまっさらな VM で動くことを検証してから**、`agent-host/install.sh`（853 行）を削除する。
`--activate` / `--reload-config` の各モードは以下に対応付ける:

| 旧 | 新 |
|---|---|
| `install.sh`（フル） | `gdg agent-host apply` |
| `install.sh --activate` | `gdg agent-host secrets import --from-operator` + `apply` + `verify` |
| `install.sh --reload-config` | `gdg agent-host apply --only systemd,git`（xangi 再取得 + unit 再生成） |

### 制約

- **3 層の信頼境界を弱めない**（`docs/agents-local-mvp/07-agent-uid-isolation.md`）
- **`exec` リソースに無条件実行を許さない。** 変更検出条件を必須属性にする
- **apply の途中で `gdg` を自己更新しない。** 冒頭で re-exec する
- **spec に secrets を入れない**
- **`start` は条件付きのまま。** secrets が揃っていないサービスを起動しない
  （現行 `start_xangi_service` の動作。GitOps で無条件 start にすると壊れた状態で起動する）
- Lima の差分は overlay データで表現し、`dev/` にロジックを fork しない
- GitOps の配信機構（署名リリース、タイマー、ロールバック）は **Stage 09/10 の担当**。ここでは作らない

## Files to touch — 変更ファイル

### 新規
- `scripts/install-gdg-agent-host.sh`（**bootstrap。`install.sh` 削除の前に作り検証する**）
- `cli/internal/agenthost/resource_systemd.go`
- `cli/internal/agenthost/resource_apparmor.go`
- `cli/internal/agenthost/resource_apt.go`
- `cli/internal/agenthost/resource_tarball.go`
- `cli/internal/agenthost/resource_git.go`
- `cli/internal/agenthost/resource_exec.go`
- `cli/internal/agenthost/verify.go`
- `cli/internal/agenthost/secrets.go`
- 対応する `*_test.go`

### 更新
- `cli/internal/command/agent_host.go`（`verify` / `secrets` サブコマンド、self re-exec）
- `cli/internal/agenthost/spec.go`（overlay 適用）
- `agent-host/agent-host.dev.json`（Lima の drop-in を overlay として表現）
- `agent-host/dev/provision.sh`, `agent-host/dev/activate.sh`（`apply` 呼び出しに縮小）
- `cli/internal/agenthost/testdata/golden/`（systemd unit / apparmor を含む全量に拡張）
- `.github/scripts/gdg-agent-layout.test.mjs`（**ソース正規表現アサーションを golden テストに置換して削除**）

### 削除
- `agent-host/install.sh`（853 行）
- `agent-host/lib/verify.sh`（Stage 04 で退避した 13 検査。Go の `verify` へ移送）

## Verification — 完了条件と検証

### 完了条件

- `gdg agent-host apply --dry-run --diff` が本番ホストで**変更なし**を報告する
- `scripts/install-gdg-agent-host.sh` が存在し、**まっさらな Ubuntu VM で `gdg` を導入して
  `gdg agent-host apply` まで到達できることが検証されている**
- `agent-host/install.sh` と `agent-host/lib/verify.sh` が存在しない
  （**プロビジョニング用シェル 3 本 → 2 本**。残るのは bootstrap と `agents-index/install.sh`。
  最後の 1 本は Stage 08 で吸収する）
- `gdg agent-host verify` の 13 検査が `verify.sh` と同じ結果を返す
- 対話プロンプトが `apply` の経路から消え、`secrets` サブコマンドに分離されている
- `.github/scripts/gdg-agent-layout.test.mjs` のシェルソース正規表現アサーションが
  golden テストに置き換わっている

### コマンド

```bash
pnpm build:acl && (cd cli && go test ./internal/agenthost/...)
```

```bash
(cd cli && go test ./internal/agenthost/... -run GoldenTree -v)
# 差分は testdata/golden/tree.json との比較(UPDATE_GOLDEN=1 go test ... で更新)
```

```bash
sudo gdg agent-host apply --spec agent-host/agent-host.json --dry-run --diff
```

```bash
sudo gdg agent-host verify
```

### 回帰として固定すべきテスト

- **`apply` を 2 回実行して 2 回目が 0 変更**（冪等性。systemd の `daemon-reload` や
  `apparmor_parser -r` が毎回走ると「変更あり」になり続けるので、変更検出が正しいことの担保）
- **`gdg agent-host verify` の 13 検査が `verify.sh` と同じ結果を返す**（移送の等価性）
- **secrets が欠けているとき `apply` が該当サービスを start せず、非ゼロで落ちもしない**
  （現行 `start_xangi_service` + `print_remaining` の動作。GitOps で無条件 start にすると
  壊れた状態で起動してしまう静かな経路）
- **`exec` リソースが変更検出条件を満たさないとき実行されない**
  （`ensure_langfuse_forwarder` の毎回 `npm ci` の再発防止）
- **`langfuse-forwarder.service` の `ExecStart` と収束リソースに `/opt/gdgjp` が現れない**
  （チェックアウト依存の断ち切り。Stage 13 の前提）
- **`pins.gdgCli` が自分自身と不一致のとき、apply が re-exec してから収束する**
  （途中で自己更新しないこと）
- **`agent-host.dev.json` overlay を適用すると Lima 専用の drop-in が生成され、
  本番 spec では生成されない**（dev/prod 乖離の overlay 化）
- **bootstrap のピンが spec の `pins.gdgCli` と全項目一致する** —
  `GDG_VERSION` = `version`、`GDG_SHA256_X86_64` / `GDG_SHA256_AARCH64` = `sha256` の各アーキ、
  および asset 名。**バージョンだけを比較しない**（どちらかのアーキのダイジェストが
  黙ってずれる。それは循環依存を許した唯一の箇所であり、ずれると bootstrap が
  検証をすり抜けた `gdg` を入れるか、そのアーキで一切インストールできなくなる）
- **bootstrap が 60 行を超えたら CI が落ちる**（責務を育てない担保）
- **golden 出力に `AGENT_MODEL` の値がリテラルとして現れ、spec を変えると追随する**

### 手動 E2E

1. Lima VM で Stage 06 完了時点の状態を作る
2. 本ステージを実装する
3. VM で `sudo gdg agent-host apply --spec agent-host/agent-host.dev.json --dry-run --diff` が
   **変更なし**であることを確認する
4. `apply` を 2 回実行し、2 回目が 0 変更であることを確認する
5. `sudo gdg agent-host verify` が 13 項目すべて ok を返すことを確認する
6. `gdg agent-host secrets status` が欠けている secrets を正しく列挙することを確認する
7. `agent-host.json` の `backend.model` を変更 → `apply --only systemd` →
   `systemctl --user show xangi.service` の `AGENT_MODEL` が追随することを確認する
8. **`install.sh` を削除する前に**、VM を破棄して**まっさらな状態から**
   `curl <bootstrap> | sudo bash` 相当を実行し、`gdg` が導入されて
   `gdg agent-host apply` が完走することを確認する
9. 8 が通ってはじめて `agent-host/install.sh` を削除する
10. **本番 `mincra-srv` ではリソース種別ごとに `--dry-run --diff` → `apply --only` を進める。**
    systemd は最後に回し、適用直後に `verify` を実行する
