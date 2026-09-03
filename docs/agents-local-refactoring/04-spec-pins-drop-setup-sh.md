# Stage 04 — spec 導入・ピン留め・setup.sh 削除・sudoers バグ修正

## Context — 背景とリポジトリ状況

`docs/agents-local-refactoring/index.md` の Stage 04。**依存: Stage 03。**

**このステージではまだ Go を書かない。** リテラルを宣言的 spec に外出しし、bash が `node -e` で読む形にする。
Stage 06〜07 の収束エンジンは**この spec をそのまま消費する**ので、ここで決めたスキーマが後段の契約になる。

解く問題は 4 つ。

### 問題 1: 設定が命令的

`AGENT_MODEL=composer-2.5` と Discord UX フラグ 3 つは `agent-host/install.sh:669-672` の
**quoted heredoc 内のリテラル**。宣言的ソースが存在せず、モデル変更にシェル編集と `--reload-config` が要る。
systemd unit・sudoers・tmpfiles も同様に heredoc とシェルループで生成される。

### 問題 2: ピン留めが不統一（GitOps の直接の障害）

チェックサム検証は `install.sh:158-210` の `ensure_gws` 1 箇所のみ。それ以外は:

| 箇所 | 現状 | 危険度 |
|---|---|---|
| `ensure_cursor_cli`（:444-455） | **第三者**（`karaage0703/xangi`）の `releases/latest` を root で `\| bash` し、AppArmor プロファイルと uid 分離が依存する sandbox バイナリを再配置する | **最悪** |
| `ensure_xangi_fork`（:457-484） | ref ピン無しで `git pull --ff-only` on main。個人 private アカウントへの push が次回 install で本番に入る | 高 |
| `ensure_gdg_system`（:371） | 特権 `agent workspace-token` を持つバイナリを `ensure_svc_gdg_login` の**前**に無条件 `gdg update -y` | 高 |
| `npm ci` フォールバック（:470-478） | lockfile 不在時に黙って `npm install` に落ち、xangi の依存ツリー全体がピン外れになる | 中 |

**Lima 開発 VM は部分的にマシだが、手本にはならない。** `agent-host/dev/provision.sh:9-10, 35` は
`cursor_version=2026.08.11-e8db854` を URL に埋めて `downloads.cursor.com` から取得し、
インストール後に `cursor-agent --version` を照合する。ただし:

- **SHA256 検証は無い**（`grep sha256 dev/provision.sh` は空）。バージョン固定であって完全性検証ではない
- URL は **arm64 固定**（Lima on Apple Silicon）。本番は x86-64 なので URL もダイジェストも流用できない

つまり `dev/provision.sh` から持ち上げられるのは**バージョン値の考え方だけ**で、
**完全性検証の手本は `ensure_gws`（`install.sh:158-210`）のほうである**。
per-arch の信頼できるダイジェストは別途入手する必要がある
（配布元が公開していなければ、初回取得時のダイジェストを人が確認して spec に固定する手順を決める）。

### 問題 3: `setup.sh` は固有の中身をほとんど持たない

| `setup.sh` の部位 | 実態 |
|---|---|
| `[1/3]` gdg インストール（:31-51） | `install.sh:366-393` `ensure_gdg_system` と重複。しかも入れ先が違う（`$HOME/.local/bin` 対 `/usr/local/bin`） |
| `[2/3]` xangi/cursor（:53-62） | **死にコード**。`install.sh:843` が常に `GDG_SKIP_XANGI_INSTALL=1` を渡す。生きていたら *upstream* の xangi と、問題 2 で最悪と評価した `latest \| bash` を実行する |
| `[3/3]` レイアウト（:64-85） | `lib/install-layout.sh` を呼び、`lib/apply-ownership.sh` を source するだけ |
| 出力用 heredoc（:103-141） | `apply-ownership.sh` の複製。**既に drift している**（heredoc は `{hooks,sandbox,mcp}.json`、本体 `apply-ownership.sh:32-33` は `{hooks,sandbox,mcp,permissions}.json`） |
| 13 検査（:143-185） | **ここだけが固有** |

### 問題 4: sudoers 書き込みが実バグ

`agent-host/lib/install-layout.sh:110-123` は稼働中の `/etc/sudoers.d/gdg-agent` を
`> "$sudoers"` で**その場で truncate** し、`chmod 0440` はその後。`visudo -c` による検証は
**別スクリプト**（`lib/apply-ownership.sh:42`、`install.sh:850` 経由）で後から走る。
この間、壊れた sudoers が live になる。**`sudoers.d` の破損はホスト全体の `sudo` を壊す。**

### 読むべきもの

- `docs/agents-local-refactoring/index.md` — 全体方針
- `agent-host/install.sh` — 特に `ensure_gws`(:158-210), `ensure_cursor_cli`(:444-455),
  `ensure_xangi_fork`(:457-484), `ensure_gdg_system`(:366-393), `write_xangi_user_unit`(:645-678)
- `agent-host/setup.sh` — 全体（削除対象）
- `agent-host/lib/install-layout.sh:110-134` — sudoers と tmpfiles の生成
- `agent-host/dev/provision.sh:9-35` — 正しくピンできている実装例

### 再利用する既存実装

- **`agent-host/install.sh:158-210` `ensure_gws`** — 唯一正しくできているピン留め実装
  （version + per-arch SHA256 + `sha256sum -c -` + インストール後の `--version` 再検証）。
  **全ピンの雛形にする。新しい方式を発明しない**
- **`agent-host/dev/provision.sh:9-10, 35`** — cursor-agent の**バージョン固定**の実例
  （URL への埋め込みと `--version` 照合）。**SHA256 検証は含まれておらず、URL は arm64 固定**なので、
  完全性検証は `ensure_gws` から取ること
- `agent-host/setup.sh:143-185` の 13 検査 — 削除せず退避する（Stage 07 の `gdg agent-host verify` の元ネタ）

## Design — 設計

### 1. `agent-host/agent-host.json` + JSON Schema

```jsonc
{
  "slotCount": 4,
  "backend": { "name": "cursor", "model": "composer-2.5" },
  "discord": { "showThinking": false, "streaming": false, "completionNotify": "off" },
  "pins": {
    "cursorAgent": { "version": "2026.08.11-e8db854", "sha256": { "x86_64": "...", "aarch64": "..." } },
    "xangi":       { "repo": "https://github.com/Harineko0/xangi.git", "ref": "<commit sha>" },
    "gws":         { "version": "v0.22.5", "sha256": { "x86_64": "...", "aarch64": "..." } },
    "gdgCli":      { "version": "0.1.4", "asset": "gdg_linux_<arch>.tar.gz",
                     "sha256": { "x86_64": "...", "aarch64": "..." } },
    "node":        { "major": 22, "minMinor": 18 }
  },
  "paths": {
    "agentRoot": "/opt/gdg-agent",
    "workspace": "/srv/gdg-agent/wiki",
    "runRoot": "/run/gdg-agent"
  }
}
```

`backend.isolation` は Stage 11（能力契約）で追加する。ここでは `name` と `model` のみ。

bash 側は `node -e` で読む。例:

```sh
spec_get() { node -e 'const s=require(process.argv[1]);const p=process.argv[2].split(".");let v=s;for(const k of p)v=v[k];process.stdout.write(String(v))' "$SPEC" "$1"; }
AGENT_MODEL="$(spec_get backend.model)"
```

**Lima 用の overlay** `agent-host/agent-host.dev.json` も同時に作る（`slotCount: 2` など差分のみ）。
現状 `dev/provision.sh` は fork したコードで**本番と別のシステム**をテストしているので、
差分を overlay に閉じ込める。overlay の適用は Stage 07 で収束エンジンが行うが、
スキーマとファイルはここで用意する。

### 2. ピン留め修正（影響範囲順）

1. **`ensure_cursor_cli`** — 第三者インストーラの root パイプ実行をやめ、
   `downloads.cursor.com` から version 指定で取得する。**per-arch の SHA256 検証を追加する**
   （`dev/provision.sh` にはこれが無いので、`ensure_gws:158-210` のパターンに揃える）。
   ダイジェストの入手手順を `adr.md` に記録すること
2. **`ensure_xangi_fork`** — `git pull --ff-only` on main を
   `git fetch` + `git checkout --detach <ref>` + `git rev-parse HEAD` の照合に置換
3. **`ensure_gdg_system`** — 無条件 `gdg update -y` をやめ、spec の `pins.gdgCli` に固定する。
   バージョン不一致時のみ再インストールする（`ensure_gws:163-171` と同じ「望ましい状態 vs 実際」比較）。
   **`sha256` は per-arch で持つ**（bootstrap が `GDG_SHA256_X86_64` と `GDG_SHA256_AARCH64` を
   別々に持つため、単一文字列では突き合わせ不能になる）
4. **`npm ci` フォールバック** — `package-lock.json` 不在時に `npm install` へ落ちる分岐を削除し、
   lockfile 必須にして失敗させる

### 3. `setup.sh`（207 行）の削除 — 本数は 5 本のまま

> **`setup.sh` を消しても本数は減らない。** `:143-185` の 13 検査だけは固有のロジックなので
> `agent-host/lib/verify.sh` として退避する（Go の `verify` へ移す Stage 07 まで）。
> プロビジョニング用シェルは **5 本のまま**（`install.sh`, `lib/install-layout.sh`,
> `lib/apply-ownership.sh`, `lib/verify.sh`, `agents-index/install.sh`）。純減は Stage 05 で起きる。

- `[1/3]` を削除。`ensure_gdg_system` が正本
- `[2/3]` を削除（死にコード）
- `[3/3]` を `install.sh` にインライン化する。`install.sh:838-846` が既に同等の env ブロックで
  `setup.sh` を呼んでいるので、その呼び出しを `lib/install-layout.sh` の直接呼び出し +
  `lib/apply-ownership.sh` の source に置き換える
- `:103-141` の出力用 heredoc を削除（drift した複製）
- **`:143-185` の 13 検査を `agent-host/lib/verify.sh` に退避する。**
  Stage 07 で `gdg agent-host verify` に移送するまでの一時的な置き場。
  `install.sh` から呼べるようにしておく

参照元の更新:
- `cli/internal/wiki/hooks.go:161`（`run pnpm build:acl before setup.sh`）,
  `:179`（`run scripts/setup-gdg-agent.sh on Ubuntu`）
- `cli/internal/wiki/hooks_test.go:252-256`（`TestAgentsLocalSetupShFailsOffUbuntu`）
- `agents-index/install.sh:161`（`Run agents-local/setup.sh first.`）
- `.github/scripts/gdg-agent-layout.test.mjs:214-217`（`setup.sh` を読んでいる箇所）

### 4. sudoers の validate-then-rename

`agent-host/lib/install-layout.sh:110-123` を以下に変える:

1. 一時ファイル（同一ファイルシステム上）に内容を書く
2. `visudo -cf "$tmp"` で検証する
3. 検証が通った場合のみ `chmod 0440` して `mv` で置き換える
4. 失敗したら一時ファイルを削除し、非ゼロで終了する（**稼働中のファイルには触らない**）

`lib/apply-ownership.sh:42` の事後 `visudo -c` は残してよいが、もはや唯一の防御ではなくなる。

同じ扱いを `:125-135` の tmpfiles にも適用する（こちらは破損の影響が小さいが、方式を揃える）。

### 5. 付随して潰すもの

- **`debugGwsSnapshot` の削除** — `cli/internal/wiki/hooks/acl-gate.ts:273-299` と呼び出し `:311`。
  "TEMPORARY diagnostic" と明記されつつ、`gws` 呼び出しのたび無条件で
  `/tmp/gws-acl-debug-<pid>-<rand>.log` を **mode 0o644** で書き、`permissions.json` 全文と
  コマンド文字列を含める。根本原因（`docs/agents-local-gws/05-agent-workspace-token-401.md`）は解決済み
- **`skills-lock.json` の処遇決定** — root と `agent-host/` に 2 本あり、`computedHash` を記録するが
  照合するコードが存在しない。Stage 09 でスキルが配信物になるため、ここで
  `gdg skills verify`（照合する）か削除かを決める。**検証しない lockfile は残さない**
- **ADR 追記** — `docs/agents-local-mvp/adr.md` に、収束エンジンの選定（Go / `gdg` CLI）、
  Ansible・NixOS の不採用理由、Ansible への切替基準（2 台目 / inventory / 約 2,000 行超）、
  pull 型配信の選定理由を記録する

### 制約

- **spec に secrets を入れない。** `install.sh:619-643` `copy_operator_runtime_secrets` が扱う
  `auth.json` / `secrets.json` / `credentials.json` は spec の対象外。Stage 07 で
  `gdg agent-host secrets set` として収束処理の外に出す
- **`sandbox.json` / `permissions.json` / `hooks.json` の*中身*を spec でモデル化しない。**
  これらはバックエンド（Cursor）のスキーマであり、再モデル化すると相手の変更で必ず腐る。
  現行の `.in` + プレースホルダ置換（`__RUN_SLOT_DIR__` / `__INDEX_SOCKET__` / `__SLOT__`）が正しい。
  checked-in ファイルのまま置き、spec は**置換値だけ**を供給する
- **ホストの生成物を変えない。** ピン留めのバージョンは現在ホストで動いている値に合わせる
  （`agent-host/ENVIRONMENT.md` が記録している実測値、および `dev/provision.sh:9` の cursor 版）。
  アップグレードはこのステージの目的ではない
- Go は書かない。収束エンジンは Stage 06〜07 の担当

## Files to touch — 変更ファイル

### 新規
- `agent-host/agent-host.json`
- `agent-host/agent-host.schema.json`
- `agent-host/agent-host.dev.json`（Lima overlay）
- `agent-host/lib/verify.sh`（`setup.sh:143-185` の退避先）

### 削除
- `agent-host/setup.sh`（207 行）

### 更新
- `agent-host/install.sh` — `ensure_cursor_cli`, `ensure_xangi_fork`, `ensure_gdg_system`,
  `write_xangi_user_unit`, `write_langfuse_forwarder_unit`, `setup.sh` 呼び出しのインライン化
- `agent-host/lib/install-layout.sh` — sudoers/tmpfiles の validate-then-rename
- `agent-host/dev/provision.sh` — overlay 参照に切り替え（fork したロジックを減らす）
- `cli/internal/wiki/hooks/acl-gate.ts` — `debugGwsSnapshot` 削除
- `cli/internal/wiki/hooks.go`（:161, :179）
- `cli/internal/wiki/hooks_test.go`（:252-256）
- `agents-index/install.sh`（:161）
- `.github/scripts/gdg-agent-layout.test.mjs` — `setup.sh` 参照の削除、spec に対するアサーションへ移行
- `skills-lock.json`, `agent-host/skills-lock.json`
- `docs/agents-local-mvp/adr.md`

## Verification — 完了条件と検証

### 完了条件

- `agent-host/agent-host.json` 以外の場所にモデル名・slot 数・バージョンのリテラルが存在しない
- `cursor-agent` / `xangi` / `gws` / `gdg` の 4 つすべてが version + チェックサム（または commit sha）で固定されている
- `cursor-agent` について **per-arch の SHA256 が spec にあり、取得後に検証されている**
  （`dev/provision.sh` の `--version` 照合だけでは不十分）
- `agent-host/setup.sh` が存在せず、13 検査が `agent-host/lib/verify.sh` に退避している
  （プロビジョニング用シェルは **5 本のまま**）
- 不正な sudoers を生成しようとしても稼働中のファイルが壊れない
- `gws` 実行時に `/tmp/gws-acl-debug-*` が生成されない

### コマンド

```bash
pnpm ci:quick
```

```bash
node --test .github/scripts/*.test.mjs
```

```bash
npx ajv-cli validate -s agent-host/agent-host.schema.json -d agent-host/agent-host.json
```

```bash
GDG_SETUP_PREFIX=/tmp/layout-check agent-host/lib/install-layout.sh && ls -la /tmp/layout-check/etc/sudoers.d/
```

### 回帰として固定すべきテスト

- **不正な sudoers を生成しようとしたとき、稼働中の `/etc/sudoers.d/gdg-agent` が壊れない**
  （validate-then-rename。壊れるとホスト全体の `sudo` が死ぬ経路であり、静かに壊れる典型）
- **`agent-host.json` の `slotCount` を変えると sudoers / tmpfiles / スロット JSON がすべて追随する**
  （spec が単一の真実であることの担保）
- **`gws` 実行時に `/tmp/gws-acl-debug-*` が生成されない**（`debugGwsSnapshot` の再発防止）
- **`install.sh` のソースに `releases/latest` が現れない**（ピン留めの回帰防止。
  現行 `gdg-agent-layout.test.mjs` が既にソース正規表現アサーションを持っているので、
  同じ手法で当面固定してよい。Stage 06 で golden テストに移行する）
- **`agent-host/lib/verify.sh` の 13 検査が、`setup.sh` 削除前と同じ結果を返す**
  （退避したロジックの等価性）

### 手動 E2E

1. `GDG_SETUP_PREFIX=/tmp/before agent-host/lib/install-layout.sh` を変更**前**に実行し保存する
2. 本ステージの変更を実施する
3. `GDG_SETUP_PREFIX=/tmp/after agent-host/lib/install-layout.sh` を実行する
4. `diff -r /tmp/before /tmp/after` — sudoers/tmpfiles の**内容**に差分が無いことを確認する
   （書き込み方式だけが変わり、生成物は同一であること）
5. Lima VM で `agent-host/dev/provision.sh` → `seed-iam.sh` → `activate.sh` を通す
6. `agent-host/lib/verify.sh` の 13 検査がすべて ok になることを確認する
7. VM 上で `agent-host.json` の `backend.model` を変更 → `install.sh --reload-config` →
   `systemctl --user show xangi.service` の `AGENT_MODEL` が追随することを確認する
8. 本番 `mincra-srv` へ適用する前に、ピン留めしたバージョンが**現在動いている実測値と一致**
   していることを `agent-host/ENVIRONMENT.md` と突き合わせて確認する
