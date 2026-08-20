# Stage 07 host install log — Ubuntu 2026-08-20

本番 Ubuntu ホストで [Stage 07](07-agent-uid-isolation.md) の配置を進めた記録。
秘密（Discord token、gdg credentials、Cursor auth、`.env`）の値は書かない。
破壊的 git（`reset --hard`、force push、`clean -fdx`）は使っていない。

## Context — 何を目指したか

このマシンを Stage 07 の本番形にする。

- xangi は [Harineko0/xangi](https://github.com/Harineko0/xangi) フォークが `gdgagent-svc` の systemd `--user` で動く
- workspace は `/srv/gdg-agent/wiki`
- `cursor-agent` は `gdgagent-run-<N>` として `/opt/gdg-agent/bin/spawn-slot-<N>` 経由で起動できる
- 読み書きは `wk` + `preToolUse`。workdir は `gdgwiki` グループ **2770**

## 開始時点で既に入っていたもの

`agents-local/install.sh` / `setup.sh` 相当のレイアウトは済んでいた。

- OS ユーザー: `gdgagent-svc`、`gdgagent-run-0..3`。グループ `gdgwiki` に全員所属。linger 有効
- `/opt/gdg-agent/`（`wk`、`spawn-slot-0..3`、`lib/*.ts`、root 所有）
- スロット `~/.cursor/{hooks,cli-config,sandbox,mcp}.json` は root `0444`
- `/etc/sudoers.d/gdg-agent`（ランチャパス固定、wildcard なし）、`/etc/tmpfiles.d/gdg-agent.conf`
- `/srv/gdg-agent/wiki` は `gdgagent-svc:gdgwiki 2770` だが **空**（`.git` なし）
- `/opt/xangi` は Harineko0 フォーク（当時 HEAD `d9a5aa6`）、`/usr/local/bin/xangi` がそれを指す
- `/usr/bin/cursor-agent` → `/opt/cursor-agent/`
- 操作者 uid（`harineko`）に個人用 xangi systemd `--user` があったが **inactive**。workspace は `/home/harineko/agents`

足りなかったもの: `gdgagent-svc` 向けの gdg ログインと wiki clone、xangi.json、svc の systemd unit、システム Node 22。

`harineko` に passwordless sudo は無かった。以降の特権操作はホストの root で実行した。

## 実施したこと

日付は 2026-08-20 UTC。

### Node 22

`wk` と `spawn-slot-*` は `/usr/bin/node` 固定。[Stage 00](00-typescript-runtime.md) は **22.18+**。開始時の `/usr/bin/node` は Ubuntu の **v18.19.1** だった（操作者 PATH 上の Node 24 とは別）。

`install.sh` と同じ nodesource `setup_22.x` で入れ、`/usr/bin/node` は **v22.23.2**。Ubuntu の node 18 関連パッケージは nodesource の入れ替えで外れている。

### gdg CLI と wiki clone

- `/home/harineko/.local/bin/gdg` を `/usr/local/bin/gdg` に install（0755）
- `gdg wiki clone` は `git-remote-gdg-wiki` を **同じディレクトリ**に symlink しようとする。svc は `/usr/local/bin` に書けないので、root で `ln -sfn /usr/local/bin/gdg /usr/local/bin/git-remote-gdg-wiki` を先に置いた
- `gdgagent-svc` の credentials は操作者アカウントから **ファイルコピー**（中身は見ていない）。device login は対話が要るためこの日は使っていない
- `sudo` 相当で `gdg wiki clone /srv/gdg-agent/wiki` → `pages/` あり。clone 後も `gdgwiki` + setgid 2770 を掛け直し
- DATA_DIR が worktree 下に無いことを確認（`.xangi` / `speech` / `logs/sessions` なし）

### xangi（svc）

- `runuser -u gdgagent-svc xangi setup --apply --backend cursor --workspace /srv/gdg-agent/wiki --workspace-mode existing --web-chat-access local`
- `xangi.json`: `backend=cursor`、`workspacePath=/srv/gdg-agent/wiki`、`webChatAccess=local`、`webChatEnabled=true`
- secrets.json は操作者 `~/.config/xangi/secrets.json` からコピー（キー名のみ確認済み: `DISCORD_TOKEN`、`DISCORD_ALLOWED_USER`。値は未記載）
- systemd `--user` unit を `gdgagent-svc` に作成。`DATA_DIR` は `/home/gdgagent-svc/.local/share/xangi`（[Stage 07](07-agent-uid-isolation.md) の検証デフォルトと同じ。workdir の外）
- drop-in `xangi.service.d/model.conf`: `AGENT_MODEL=composer-2.5`、`DISCORD_SHOW_THINKING=false`、`DISCORD_STREAMING=false`、`DISCORD_COMPLETION_NOTIFY=off`
- 同一 Discord アプリの二重起動を避けるため、操作者 uid の `xangi.service` を **stop + disable**

### スロットの Cursor 認証

スロット HOME は `/home/gdgagent-run-<N>`。操作者の `~/.config/cursor/auth.json` を各スロットの同じ相対パスへコピー（0600、スロット uid 所有）。トークン refresh のためスロットから書き込める。エージェント uid から読める点は `CURSOR_API_KEY` を environ に載せるのと同種の限界。

### xangi 起動経路の現場判断

`/opt/xangi/dist/index.js` を `/usr/bin/node` で直実行すると:

`Cannot find module '/opt/gdgjp/gdg-lib/src/acl/access' imported from .../gdg-lib/src/acl/index.ts`

`@gdgjp/gdg-lib` は `file:../gdgjp/gdg-lib` で **TypeScript ソース**を指す。checkout の `bin/xangi` は tsx でソースを起動する。このホストの unit は次にした。

```
ExecStart=/usr/bin/node /opt/xangi/node_modules/tsx/dist/cli.mjs /opt/xangi/src/index.ts
WorkingDirectory=/opt/xangi
Environment=XANGI_SETUP_CONFIG_PATH=/home/gdgagent-svc/.config/xangi/xangi.json
Environment=XANGI_SETUP_STATE_DIR=/home/gdgagent-svc/.local/share/xangi
```

[ADR-022](adr.md#adr-022-ローカル実行物を-node-ネイティブ-typescript-に統一する) は本番で tsx を使わない。ここは **gdg-lib を Node が解決できる形にするまでのホスト回避**であり、設計の確定ではない。

`/opt/xangi` に `.env` は無かった（`dotenvConfig({ override: true })` が systemd の WORKSPACE / DATA_DIR を上書きする経路は、現状ファイルが無い）。

### authz.sock の chown

tsx 起動後、`chown('/run/gdg-agent/<N>/…', svc_uid, gdgagent-run-N gid)` が **EPERM**。Linux では非 root が gid を変えられるのは自分が属するグループだけ。

`usermod -aG gdgagent-run-0,gdgagent-run-1,gdgagent-run-2,gdgagent-run-3 gdgagent-svc` のあと `systemctl restart user@999.service` で linger セッションに補充グループを載せた。ソケットの **接続許可**は従来どおり `0660` の所有者 svc + そのスロットグループ。svc が全スロットグループに入っても、所有者として全ソケットに触れる前提は元から同じ。

### wiki 上の skills

`gdg wiki clone` は `.agents` / `.claude` / `.codex` を作らない。`agents-local/` からその 3 ディレクトリを `/srv/gdg-agent/wiki` へコピーし、`gdgwiki` + 2770 を付けた。

**workdir に `.cursor/` は置いていない**（per-repo `sandbox.json` / `mcp.json` のマージを避ける。[Stage 07](07-agent-uid-isolation.md) §4）。

## 検証したこと / まだやっていないこと

### この日に通したもの（所有権）

- `gdgagent-run-0` は `/home/gdgagent-svc/.config/gdg/credentials.json` を読めない
- `gdgagent-run-0` と `gdgagent-svc` の双方が `/srv/gdg-agent/wiki` に書ける
- スロット uid は `/opt/gdg-agent/bin/wk`、`lib/wk.ts`、`package.json`、スロット `~/.cursor/*.json` を書けない
- スロット uid は `/home/gdgagent-svc/.local/share/xangi` を読めない
- `visudo -c -f /etc/sudoers.d/gdg-agent` OK
- `wk` はスロットから起動できるが、ランチャ無しでは `GDG_WIKI_RUN_ID` 不足で fail closed

### 通していない Stage 07 完了条件

Discord が落ちるため、invocation 実走に依存するものは未実施。例:

- `cursor-agent` が `gdgagent-run-<N>` でフック発火
- `--mcp-config` が argv に載ること、nonce のライフサイクル、スロット間 `/proc` 分離
- サンドボックス有効の ingest 相当、shell から workdir 外 / 外向き HTTP の拒否
- `gdg wiki raw pull` / `git push` を svc から通す確認

手動 E2E（[07 §手動 E2E](07-agent-uid-isolation.md)）も未実施。

## 未完了: Discord Privileged Intents

authz 起動のあと Gateway が **`Used disallowed intents`**。xangi は `Guilds` / `GuildMessages` / `GuildMembers` / `MessageContent` を要求する。

Developer Portal で当該ボットに **Server Members Intent** と **Message Content Intent** を付ける必要がある。crash loop を避けるため、この日の終わりに `xangi.service` は **stop**（**enable のまま**）。

Intents を直したあとの起動（秘密は引数に載せない）:

```bash
sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/999 systemctl --user start xangi.service
sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/999 systemctl --user status xangi.service
```

## 運用メモ

| パス | 役割 |
|---|---|
| `/opt/xangi` | Harineko0 フォークの checkout。systemd の WorkingDirectory |
| `/home/gdgagent-svc/.config/xangi/` | `xangi.json` / `secrets.json`（0700） |
| `/home/gdgagent-svc/.local/share/xangi` | DATA_DIR（会話ログ。workdir に置かない） |
| `/home/gdgagent-svc/.config/systemd/user/xangi.service` | svc の unit |
| `/opt/gdg-agent/bin/spawn-slot-<N>` | sudoers が許可する唯一の spawn |
| `/usr/local/bin/gdg` | svc が使う CLI |
| `/home/harineko/.config/systemd/user/xangi.service` | 操作者個人。この日 disable。別ボットにするときだけ戻す |

操作者の個人 xangi を同じ `DISCORD_TOKEN` で enable し直すと、本番 svc と取り合う。
