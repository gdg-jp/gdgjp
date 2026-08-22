# Local test environment for agents-local — Ubuntu VM + Discord-less agent invocation

## Context — 背景とリポジトリ状況

### なぜやるか

`agents-local/` は現在 **mincra-srv 1 台の本番でしか動かない**。挙動を確かめる唯一の方法が
「Discord で xangi bot にメッセージを送る」なので、次が全部できない。

- 本番ギルドを汚さずに `preToolUse` ゲート / `wk` / uid 分離を試す
- `docs/agents-local-mvp/todos.md` に未チェックで残っている **関門**を回す
  （05 の「Read が deny されたら `wk read` に切り替わる」、07 の「sandbox 有効で ingest 相当が完走する」）
- `install.sh` そのものを検証する（本番ホストは 6 項目の逸脱を抱えている。`ENVIRONMENT.md`「Host-specific deviations」）

目指す結果は「**ローカルの Mac から、Discord を経由せずに、本番と同じ経路で cursor-agent を 1 ターン走らせて結果を読む**」こと。

### 結論 — Docker はこのケースではベストではない

ユーザ判断は「限りなく本番に近く」「実 `cursor-agent` のみ」「production wiki」。この 3 つの前提の下では Docker は不利になる。

| | Ubuntu VM (Lima) | Docker (Ubuntu 24.04 image) |
|---|---|---|
| `install.sh` をそのまま実行 | できる | できない（systemd `--user` + linger、`systemd-tmpfiles`、`useradd` 前提が崩れる） |
| systemd `--user` unit（本番の起動形態） | 実物 | 別経路（`ExecStart` を手で叩く）を維持することになる |
| AppArmor プロファイル（`config/apparmor.d-cursor-agent-cursorsandbox`） | ロードできる | Docker Desktop の LinuxKit では不可 |
| Cursor の OS サンドボックス（`sandbox.mode: enabled` / `readBoundary: workspace`）の入れ子 | 実カーネルでそのまま | user namespace / seccomp の入れ子で壊れる可能性が高い |
| `/run/gdg-agent` tmpfiles、uid 分離、sudoers | 実物 | uid と sudoers は動くが tmpfiles は systemd 経由でない |
| CI に載る | 載らない | 載る |

Docker の唯一の優位は CI だが、**実 `cursor-agent`（課金・非決定的）と production wiki を使う時点でこの環境は CI に載らない**。
そのために「本番と違うセットアップ経路」をもう 1 本作って維持するのは、検証したい当のもの（`install.sh` と 3 層の信頼境界）を検証対象から外すことになる。

したがって **Lima の Ubuntu 24.04 VM を採る**。macOS 側の既存 tier（`pnpm test` の純関数テスト、`GDG_SETUP_PREFIX` を使った `lib/install-layout.sh` の配置テスト）はそのまま残し、境界の主張はしない（`index.md` §対象環境、`00-typescript-runtime.md` §7 の方針を変えない）。

### 本当のブロッカーは VM ではなく xangi 側にある

環境を作っただけでは Discord は外れない。コードを読んで確認した事実:

1. **認可スタック一式が Discord トークンの有無で gate されている。**
   `xangi/src/index.ts:173` の `if (config.discord.enabled)` の中に、authz サーバ起動・`loadDiscordAuthorization`・
   slot pool・`SleepScheduler` が全部入っている。`config.discord.enabled` は `config.ts:285` で
   `!!discordToken`。**Discord トークンなしでは nonce も slot も存在しない** → `wk` もゲートも fail-closed で全部落ちる。
2. **既存の Discord 非依存入口は使えない。**
   - `POST /api/trigger`（`src/event-trigger.ts`）は `scheduler.getAgentRunner('discord')` を呼ぶが、
     その実体（`src/discord/scheduler-bridge.ts:122`）は `createPrincipal({platform:'scheduler'})` を渡すだけで
     `classes: []`・nonce なし。認可経路を通らない。しかも Discord クライアント（`client.channels.fetch`）に依存する。
   - Web Chat（`src/web-chat.ts:388`）も `createPrincipal({platform:'web', userId:'web'})` で classes 空。IAM を通らない。
3. **一方、忠実な入口を作るための部品は既に揃っている。**
   - `src/scheduler/sleep.ts:486` `createSleepAgentRunner` — nonce 発行 → slot 取得 → `agentRunner.run` → revoke。
     **睡眠は既に Discord なしで本番経路を走っている。**
   - `src/discord/principal.ts:166` `buildDiscordPrincipal` は discord.js の invocation から
     `userId / channelId / guildId / parentChannelId / roleIds` の 5 つしか読まない。残りは
     `resolveClassesFromRoles` / `resolveClassesFromAccount` / `unionClasses` / `channelPolicy` /
     `applyChannelPolicy` / `channelAudienceOf`（すべて `src/iam.ts`）という **discord.js 非依存の関数**。
   - `src/discord/principal.ts:101` `issueDiscordPrincipalNonce` も Principal しか見ない。

つまり **discord.js のトランスポート層だけを差し替えれば、IAM 解決・nonce・slot・spawn・フック・`wk` は本番と同一のコードが走る。**

### 読むべきもの

- `agents-local/README.md`（信頼境界 3 層）、`agents-local/ENVIRONMENT.md`（本番の実配置と 6 つの逸脱）
- `docs/agents-local-mvp/index.md`、`todos.md`（未達の関門）、`adr.md` の ADR-004 / ADR-017 / ADR-021
- `docs/agents-local-mvp/05-cursor-harness-pretooluse.md` §「実装前に疎通確認すること」、`07-agent-uid-isolation.md`
- `agents-local/install.sh`、`setup.sh`、`lib/install-layout.sh`（`GDG_SETUP_PREFIX` の test seam が既にある）

### 再利用する既存実装 — 書き直さない

- `xangi/src/iam.ts` の class 解決関数一式。**ハーネスから同じものを呼ぶ**
- `xangi/src/discord/principal.ts` の `issueDiscordPrincipalNonce` / `revokeDiscordPrincipal`
- `xangi/src/scheduler/sleep.ts` の `createSleepAgentRunner`（nonce ライフサイクルの手本）
- `xangi/src/slot-runtime.ts`（`slotIsolationEnabled` / `writeNonceFile` / `writeSpawnSpec`）
- `agents-local/install.sh` — VM プロビジョニングは**これを呼ぶだけ**にする。並行の簡略セットアップを作らない
- `agents-local/lib/install-layout.sh` の `GDG_SETUP_PREFIX`
- `cli` の `GDG_WIKI_URL`（`internal/wiki/client.go:34`）、`GDG_WIKI_LOCK_OWNER`（`internal/wiki/locks.go:41`）

### 事前疎通確認（実装前にやり、通らなければ止まって報告する）

- `cursor-agent` の **linux/arm64** ビルドが本番と同じ `2026.08.11-e8db854` で取得でき、
  `sandbox.mode: enabled` + `readBoundary: workspace` が arm64 で動くこと
  （`https://cursor.com/install` の URL テンプレートは arm64 を含むことを確認済み。実行は未確認）

  **`install.sh` に任せるとバージョンが固定されない。** `ensure_cursor_cli`（`install.sh:374-384`）は
  xangi の **latest** リリースから `setup-ai-tools.sh` を取り、それが**版指定なしの** `https://cursor.com/install`
  を叩く。今日はたまたま `2026.08.11-e8db854` を配っているが、明日は新しい sandbox 実装を黙って掴む。
  `docs/agents-local-mvp/todos.md` の関門は「この版で」確認したものなので、それでは検証にならない。

  対処: `provision.sh` が **`install.sh` より先に**固定版を配置する。

  ```
  https://downloads.cursor.com/lab/2026.08.11-e8db854/linux/arm64/agent-cli-package.tar.gz
  → /opt/cursor-agent/ に展開し /usr/bin/cursor-agent にリンク
  ```

  `ensure_cursor_cli` は `install.sh:375-376` で「すでに在れば何もしない」ので、これで no-op になる。
  そのうえで `cursor-agent --version` が `2026.08.11-e8db854` と一致することを確認し、
  **一致しなければ provision を失敗させる**。

  **明示しておく: この経路では `install.sh` の `ensure_cursor_cli` は検証対象から外れる。**
  Cursor 版を固定することと `ensure_cursor_cli` を検証することは両立しないので、前者を採る。
  `ensure_cursor_cli` は本番ホストでの実行結果（`ENVIRONMENT.md` の Cursor CLI 行）で担保する。
- Lima の Ubuntu 24.04 で AppArmor が有効で、`config/apparmor.d-cursor-agent-cursorsandbox` が `apparmor_parser` を通ること

---

## Design — 設計

環境（VM）とハーネス（Discord 差し替え）は独立に作る。**Stage 2 が本質で、Stage 1 は器**。

### 1. Lima VM — 本番形状の Ubuntu をローカルに置く

`agents-local/dev/` を新設する（本番の live path には一切影響しない）。

| ファイル | 役割 |
|---|---|
| `agents-local/dev/lima-gdg-agent.yaml` | Ubuntu 24.04、vz + virtiofs、CPU 4 / mem 8GiB / disk 40GiB。`~/proj/gdgjp` を **`/mnt/gdgjp-src` に read-only** マウント（`/opt/gdgjp` にはマウントしない） |
| `agents-local/dev/provision.sh` | `install.sh` を呼び、そのあと VM 専用の systemd drop-in を置く。IAM を seed してから `activate.sh` がサービスを start する |
| `agents-local/dev/README.md` | 起動・秘密の投入・1 ターン実行・リセットの手順 |

決めごと:

- **`install.sh` を改変してローカル分岐を足さない。** VM 内では本番と同じ引数で走る。
  ローカル固有の値は環境変数（`GDG_AGENT_SLOT_COUNT` など既存のもの）だけで渡す。
- **`install.sh` は Discord トークンが無いとサービスを start しない**（`install.sh:470-474` が
  `secrets.json` に `DISCORD_TOKEN` が有るときだけ `systemctl --user start` する）。
  また `install.sh:217` の `--preserve-env` は自身の root 再 exec 用であって、サービスの環境ではない。
  **ここに `GDG_AGENT_HARNESS` を足さない。** `provision.sh` は start せず drop-in を置き、
  `seed-iam.sh` の後に `activate.sh` が起動する:

  ```ini
  # /home/gdgagent-svc/.config/systemd/user/xangi.service.d/harness.conf  (VM 専用)
  [Service]
  Environment=GDG_AGENT_HARNESS=true
  Environment=SCHEDULER_ENABLED=false
  Environment=GDG_WIKI_LOCK_OWNER=lima-gdg-agent
  ```

  `provision.sh` は `daemon-reload` までを `gdgagent-svc` として実行する。
  `activate.sh` が `systemctl --user start xangi.service` を実行し、`install.sh` の start 判定には依存しない。
- **`XDG_RUNTIME_DIR` の uid をハードコードしない。** `install.sh:179` の `useradd --system` は
  番号を固定しないので、`999` は mincra-srv でたまたまそうなっただけである
  （`ENVIRONMENT.md` の uid 表は「this host」の値）。Lima イメージや再プロビジョンでずれる。
  `install.sh:492` と同じく `$(id -u gdgagent-svc)` で解決するヘルパ関数に `systemctl --user`
  呼び出しごとまとめ、`dev/README.md` もそれを使う。
- **drop-in は VM の中だけに存在する。** リポジトリの `config/` や `install.sh` の配置対象に入れない。
- **read-only マウントの上で `install.sh` を走らせない。** `install.sh:77-78` は `$here/..` に
  `cli/internal/wiki/hooks/acl-gate.ts` を見つけると **そこを gdgjp root と判定して clone を飛ばす**。
  その後 `build_acl`（`install.sh:152-169`）が `cd "$root"` して
  `pnpm install --frozen-lockfile` と `esbuild --outfile=../cli/internal/wiki/hooks/acl.ts` を走らせるため、
  read-only では `node_modules/` も `acl.ts` も書けずに失敗する。

  したがって `provision.sh` の最初の仕事は **書き込み可能な `/opt/gdgjp` を作ること**:

  ```
  /mnt/gdgjp-src        host の ~/proj/gdgjp（read-only, virtiofs）
    → rsync -a --delete --exclude node_modules --exclude .git
  /opt/gdgjp            VM 内の書き込み可能なコピー。ここから install.sh を呼ぶ
  ```

  `install.sh` は `/opt/gdgjp/agents-local/install.sh` として起動する。`$here/..` = `/opt/gdgjp`（書ける）
  なので clone は飛び、`build:acl` は**検証対象のまま**走る。
  `GDG_SKIP_BUILD=1` で逃げない（`acl.ts` はコミット済みだが、それでは `build:acl` が検証から外れる）。
- host 側のツリーは read-only のまま。VM 内の編集は `/opt/gdgjp` に閉じ、host には戻さない。
- リセットは `limactl delete` + 再作成。スナップショット運用にしない（`install.sh` の冪等性が検証対象だから）。
- `/srv/gdg-agent/wiki` は VM 内で `gdg wiki clone` する。ホストからマウントしない
  （2770 + setgid + `gdgwiki` group が virtiofs で再現しない）。

### 2. xangi — 認可スタックを Discord から切り離す

`xangi/src/index.ts:173` の `if (config.discord.enabled)` を、**認可スタックの有効化条件**に置き換える。

```ts
// config.ts
gdgAuthz: { enabled: boolean }   // = discord.enabled || process.env.GDG_AGENT_HARNESS === 'true'
```

- authz サーバ / slot pool / `loadDiscordAuthorization` / `SleepScheduler` は `gdgAuthz.enabled` で起動する
- Discord クライアントのログインと `registerDiscordSchedulerBridge` は従来どおり `discord.enabled` のまま
- `loadDiscordAuthorization` は名前が実態と合わなくなるので `loadGdgAuthorization` にリネームし、
  `discord/principal.ts` → `src/gdg-authz.ts`（仮）へ移す。discord.js への import が残らないこと

これは test scaffolding ではなく設計上の分離である。「GDG の認可スタック」と「Discord アダプタ」は元々別物。

### 3. xangi — Principal 構築から discord.js を剥がす

`buildDiscordPrincipal` を 2 段に割る。

```ts
export interface InvocationIdentity {
  userId: string;
  channelId: string;
  guildId: string | null;
  parentChannelId: string | null;
  roleIds: readonly string[];
}

// discord.js を知らない。IAM 解決と context 記録はここに全部入る
export async function buildPrincipalFromIdentity(id: InvocationIdentity): Promise<Principal>;

// discord.js の invocation から 5 フィールドを抜いて上を呼ぶだけの薄いアダプタ
export async function buildDiscordPrincipal(invocation: DiscordInvocation): Promise<Principal>;
```

`resolveClassesFromRoles` / `resolveClassesFromAccount` / `unionClasses` / `channelPolicy` /
`applyChannelPolicy` / `channelAudienceOf` / `contexts.set(...)` の呼び方は**一切変えない**。
`getDiscordAuthorizationContext` の `denialReason` 判定もそのまま移す。

### 4. xangi — `xangi harness invoke`（Discord の代わりの入口）

**tool-server の `/api/execute` には載せない。** ソースを確認した事実:

- `src/tool-server.ts:302,318` — サーバは **`0.0.0.0`** で listen する
- `src/tool-server.ts:257` — `/api/execute` に**認証が一切無い**（`/api/trigger` は Bearer を見るが、こちらは見ない）
- `src/safe-env.ts:27` — `XANGI_TOOL_SERVER` は `ALLOWED_ENV_KEYS` に入っており、**起動された cursor-agent が URL を継承する**

ここに「呼び出し側が user id と role id を指定できる」operation を足すと、
**エージェント自身が `--roles <organizer>` で任意の IAM Principal を鋳造し、さらに自分を再帰起動できる**。
ADR-004 の信頼境界が入口ごと迂回される。したがって別面を用意する。

#### 4-1. 専用の operator 専用 Unix ソケット

```
/run/gdg-agent/harness/          gdgagent-svc:gdgagent-svc 0700   (tmpfiles で作る)
/run/gdg-agent/harness/ctl.sock  gdgagent-svc:gdgagent-svc 0600
```

**境界はファイルモードだけで完結させる。`SO_PEERCRED` は使わない。**
Node の `net` は Unix ドメインソケットの peer credential を公開していない。
これを要求するとネイティブアドオンか外部ヘルパが要り、「実装されないまま仕様だけ残る」危険がある。
代わりに OS 側で完全に閉じる:

- Linux では `connect(2)` に**ソケット inode への write 権限**が要り、到達には**親ディレクトリの x** が要る
- 親 0700 + ソケット 0600、どちらも `gdgagent-svc` 単独所有 → **どのスロット uid からも到達できない**
- root は接続できる。これは許容する（root を持つ者はすでに `wk` もフックも置き換えられる。ADR-004 の脅威モデル）

その他:

- `GDG_AGENT_HARNESS=true` のときだけ作成する。既定では存在しない。停止時に unlink する
- `/run/gdg-agent/<N>/` には置かない。あちらはスロットグループが読める（`ENVIRONMENT.md`「Per-slot sockets」0750）
- **`ALLOWED_ENV_KEYS` に何も足さない。** パスは固定なので env で配る必要がない。
  スロットに渡る環境にこのソケットを指す値を入れない
- 起動時に自分で `mkdir -m 0700` + `chmod 0600` し、**期待した mode/owner でなければ listen せずに落ちる**
  （tmpfiles の設定ミスで緩んだまま動き出さない）

#### 4-2. クライアント

`xangi tool` は使わない。`src/cli/tool-command.ts:55-60` が `XANGI_TOOL_SERVER` 必須で
「the target instance is never guessed」と fail-closed するため、xangi の子プロセス以外からは
そもそも呼べない。**この不変条件は緩めない。**

代わりに固定パスへ直接つなぐ別サブコマンドを足す:

```
sudo -u gdgagent-svc xangi harness invoke \
  --guild <guildId> --channel <channelId> --user <userId> --roles <id,id> \
  --message "<prompt>" [--json]
```

インスタンスの推測は起きない。ホストに 1 本しかない固定パスであり、**ソケットの存在自体がインスタンスである**。

#### 4-3. 1 ターンの処理

1. `buildPrincipalFromIdentity({...})` — 本番と同じ IAM 解決
2. `denialReason` が非 null なら **拒否理由をそのまま返して終了**（deny 側の検証がこれで回る）
3. `issueGdgPrincipalNonce(principal)` → slot lease + nonce ファイル + spawn spec
4. `repoLock` を取り、`agentRunner.run(prompt, { principal, authz: {...} })`
   — `createSleepAgentRunner` と同じ順序。共通化できるなら共通化する
5. `finally` で `revokeGdgPrincipal(principal)`
6. stdout に turn 結果、`--json` で `{ classes, channelAudience, slot, runId, denialReason, result }`

制約:

- **`GDG_AGENT_HARNESS=true` のときだけ listen する。** 本番の xangi.service にこの env は置かない
- Discord クライアントに触らない（sender も thinking message も無し）。`scheduler-bridge.ts` の
  `enqueueChannelTurn` に相当する直列化は repoLock と slot pool に任せる
- `platform` は `'discord'` として扱う。IAM の channel policy が platform 別に分岐していないことを確認した上で決める
- **`/api/execute` と `/api/trigger` からこの operation に到達できないこと**をテストで固定する

### 5. production wiki を使うことの安全装置

本番 wiki を相手にする以上、VM のエージェントが本番ページを壊せる。**ACL 自身で塞ぐ**。

- VM の `gdg login` は**専用の Accounts アカウント**で行う。そのアカウントの chapter role は
  検証用チャプター 1 つだけ。他チャプターは `wk write` / ingest が ACL で落ちる（本番の判定経路がそのまま防壁になる）
- VM の `xangi.json` に **Discord bot token を置かない**（`config.discord.enabled === false`）。
  本番 bot と二重ログインさせない（`ENVIRONMENT.md` の operator unit と同じ事故）
- `DATA_DIR` は本番と別（VM 内なので自然に別）。`GDG_WIKI_LOCK_OWNER` に `lima-<user>` を入れて
  ロック保持者がログで見分けられるようにする
- **sleep cron は `SCHEDULER_ENABLED=false` で止める。** `SLEEP_CRON` を未設定・空にしても
  `config.ts:506` の `process.env.SLEEP_CRON?.trim() || '0 4 * * *'` が既定の 04:00 を復活させるので、
  **`SLEEP_CRON` では止まらない**。`index.ts:518` が `if (config.scheduler.enabled) sleepScheduler.startCron(...)`
  なので `SCHEDULER_ENABLED=false` が効く（確認済み）。副作用として通常の Scheduler
  （`scheduler.startAll`）も止まるが、VM では許容する。sleep は手で叩くときだけ走らせる

### 6. ドキュメント

`docs/agents-local-mvp/` の慣習に合わせる。

- `12-local-test-environment.md` — このステージの仕様（上の 1〜5）
- `adr.md` に **ADR-023: ローカル検証環境を Ubuntu VM に置き、Docker を採らない** を追記。
  上の比較表と「実 cursor-agent + production wiki なので CI に載らない」という決め手を残す
- `todos.md` に Wave 8 として追加し、05 / 07 の未チェック関門に「VM で回す」と注記
- `agents-local/README.md` に `dev/` の 1 段落と `ENVIRONMENT.md` への相互参照

### 制約

- **`install.sh` / `setup.sh` / `lib/install-layout.sh` にローカル専用分岐を入れない。** 検証対象そのものだから
  （`00-typescript-runtime.md` §7「実行物に `process.platform` 分岐を入れない」）
- **macOS 上で権限境界を主張しない。** VM の外に uid 分離やサンドボックスを持ち出さない
- **`wk` に逃げ道を作らない。** ハーネスは Principal の作り方を変えるだけで、`wk` とゲートには一切触らない
  （`todos.md`「途中で崩れやすい前提」）
- `XANGI_AUTHZ_*` を `ALLOWED_ENV_KEYS` に足さない
- `harness invoke` に「classes を直接指定する」オプションを付けない。IAM を迂回する入口を作ると、
  検証しているものが本番と別物になる。fixture は **IAM ファイルと role id の側**で用意する
- xangi は別リポジトリ（`Harineko0/xangi`）。Stage 2〜4 はそちらの PR、Stage 1・5・6 は gdgjp の PR に分ける

---

## Files to touch — 変更ファイル

### `Harineko0/xangi`（別リポジトリ / ローカル `~/proj/xangi`）

- `src/config.ts` — `gdgAuthz.enabled` を追加（`discord.enabled || GDG_AGENT_HARNESS`）
- `src/index.ts` — L173 の gate を差し替え。authz / slot pool / sleep を `gdgAuthz.enabled` 配下へ
- `src/gdg-authz.ts`（新規）— `discord/principal.ts` から discord.js 非依存部分を移設。
  `buildPrincipalFromIdentity` / `issueGdgPrincipalNonce` / `revokeGdgPrincipal` / `loadGdgAuthorization`
- `src/discord/principal.ts` — 薄いアダプタだけ残す
- `src/harness-server.ts`（新規）— operator 専用 Unix ソケット。`GDG_AGENT_HARNESS=true` のときだけ listen。
  ソケット 0600 + 親ディレクトリ 0700（`gdgagent-svc` 単独所有）。mode/owner を起動時に自己検証
- `src/cli/harness-cmd.ts`（新規）, `src/cli/xangi.ts` — `xangi harness invoke` サブコマンド
- `src/tool-server.ts`, `src/cli/tool-command.ts` — **触らない**（`/api/execute` に足さないことが要件）
- `src/safe-env.ts` — **触らない**（`ALLOWED_ENV_KEYS` に何も足さない）
- `src/scheduler/sleep.ts` — nonce ライフサイクルを `harness invoke` と共通化できる箇所があれば抽出
- `tests/harness-invoke.test.ts`（新規）、`tests/discord-iam.test.ts` / `tests/principal.test.ts` — 既存の期待値が変わらないこと
- `docs/design.md`, `docs/usage.md`（+ `docs/en/`）— `tests/docs-consistency.test.ts` と
  `tests/docs-env-vars.test.ts` があるので `GDG_AGENT_HARNESS` の追記が必要

### `gdg-jp/gdgjp`

- `agents-local/dev/lima-gdg-agent.yaml`（新規）
- `agents-local/dev/provision.sh`（新規）— `/opt/gdgjp` への writable コピー、固定版 cursor-agent、
  `install.sh` 実行、drop-in 配置、`$(id -u gdgagent-svc)` を使った明示 start、`cursor-agent --version` 検証
- `agents-local/dev/README.md`（新規）
- `agents-local/README.md` — `dev/` の節を追加
- `docs/agents-local-mvp/12-local-test-environment.md`（新規）
- `docs/agents-local-mvp/adr.md` — ADR-023
- `docs/agents-local-mvp/todos.md` — Wave 8 と関門への注記
- `docs/agents-local-mvp/index.md` — ステージ表に 12 を追加

---

## Verification — 完了条件と検証

### 完了条件

1. Mac から `limactl start` → `provision.sh` → `seed-iam.sh` → `activate.sh` の四段階で、Discord
   トークンなしの xangi が VM 内で起動する。`seed-iam.sh` は committed の合成 IAM fixture
   (`agents-local/dev/iam-fixture.json`) を配置するだけで、env var や `provision.sh` の変更は不要。
   IAM は start-time-only なので seed は activate より前でなければならない。
2. `xangi harness invoke` 1 コマンドで cursor-agent が 1 ターン走り、結果が stdout に出る
3. その 1 ターンが本番と同じ経路を通る — IAM で class が解決され、nonce と slot が発行され、
   `gdgagent-run-N` の uid で `cursor-agent` が動き、`preToolUse` ゲートが発火する
4. `todos.md` の未チェック関門を VM で回して結果を記録できる
5. 本番 Discord・本番ホスト・他チャプターの wiki ページに一切影響しない

### コマンド

```bash
limactl start --name=gdg-agent agents-local/dev/lima-gdg-agent.yaml
```

```bash
limactl shell gdg-agent sudo /mnt/gdgjp-src/agents-local/dev/provision.sh
```

```bash
limactl shell gdg-agent sudo /opt/gdgjp/agents-local/dev/seed-iam.sh
```

```bash
limactl shell gdg-agent sudo /opt/gdgjp/agents-local/dev/activate.sh
```

```bash
limactl shell gdg-agent -- sudo -u gdgagent-svc XDG_RUNTIME_DIR=/run/user/$(id -u gdgagent-svc) systemctl --user status xangi.service
```

```bash
limactl shell gdg-agent -- sudo -u gdgagent-svc xangi harness invoke --guild test-guild --channel ch-chapter --user test-user --roles role-organizer --message "pages/ から会場費の扱いを調べて要約して" --json
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`buildDiscordPrincipal` のリファクタ後も、同じ invocation から同じ `classes` / `channelAudience` /
  `denialReason` が出る** — ここがずれると、Discord からの権限だけが静かに広がる
- **`GDG_AGENT_HARNESS` 未設定で harness ソケットが作られない** — 本番に入口が生えない
- **harness の operation が `/api/execute` と `/api/trigger` から到達できない**、かつ
  `ALLOWED_ENV_KEYS` にソケットを指す値が入っていない — **エージェント自身が Principal を鋳造できない**
- **harness ソケットとその親ディレクトリが `gdgagent-svc` 単独所有の 0600 / 0700 である**、かつ
  スロット uid（`gdgagent-run-0`）から `connect` が `EACCES` になる — 実際にスロット uid で叩いて確認する
- **mode/owner が緩んでいると listen せずに落ちる**
- **`xangi tool` の `XANGI_TOOL_SERVER` 必須 fail-closed（`tool-command.ts:55-60`）が緩んでいない**
- **`SCHEDULER_ENABLED=false` で `sleepScheduler.startCron` が呼ばれない** — 本番 wiki への 04:00 自動 sleep が
  VM から走らない（`SLEEP_CRON` 未設定では既定値が復活するので、これは `SLEEP_CRON` では固定できない）
- **harness invoke が `denialReason` 非 null の Principal で nonce を発行しない** — deny が allow に化けない
- **`gdgAuthz.enabled` を分離しても、Discord トークンありの構成では authz サーバ・slot pool・sleep が
  従来どおり起動する** — 本番構成の起動が静かに欠ける経路
- **harness invoke の異常終了で slot lease と nonce が必ず解放される**（`finally`）— slot が枯れる
- **`cursor-agent --version` が `2026.08.11-e8db854` でなければ provision が失敗する** —
  新しい Cursor sandbox を黙って検証してしまう経路
- **`provision.sh` が read-only な `/mnt/gdgjp-src` から `install.sh` を直接呼ばない** —
  `build_acl` が書き込みで落ちる。`/opt/gdgjp` が writable であることを実行前に確認する
- `lib/install-layout.sh` を `GDG_SETUP_PREFIX` 付きで回す既存の配置テストが、`dev/` 追加後も通る

### 手動 E2E（VM 内、`04-manual-e2e-cursor-linux.md` の checkpoint 形式で）

1. **allow 経路** — 検証チャプターの organizer role で `harness invoke`。`pages/**` を `wk read` で読めて要約が返る
2. **deny 経路** — role なしの user id で `harness invoke`。`denialReason` が返り、cursor-agent が**起動しない**
3. **チャンネル写像** — 全国写像チャンネルの channel id で叩き、`chapter-*` 限定の材料が読めないこと
4. **関門 05** — 素の `Read` が deny されたあと、cursor-agent が同じ `Read` を繰り返さず `wk read` に切り替わること。
   `Write` / `Edit` が deny の下で `wk write` だけで ingest 相当が完走すること
5. **関門 07** — `sandbox.mode: enabled` + `readBoundary: workspace` で `git` / `gdg wiki` / `pages/` 読み書きが完走すること。
   別スロットの `/proc/<pid>/environ` と `/home/gdgagent-svc/.config/gdg/credentials.json` が読めないこと
6. **arm64 の差分を記録** — 上の 4・5 が arm64 で本番（x86-64）と違う挙動をしたら、
   `12-local-test-environment.md` の「既知の乖離」に書く。VM で通ったことを本番の保証として扱わない
7. **書き込み封じ込め** — 検証チャプター外のページに `wk write` を試み、ACL で落ちることを確認する
