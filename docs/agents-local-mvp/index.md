# agents-local MVP — multi-chapter permissions, sleep, memory, index

## Context — 背景とリポジトリ状況

### なぜやるか

`agents-local/` は現在 PoC である。自前 Ubuntu 1 台の上で xangi が Discord メッセージを受け、
`cursor-agent`（Composer 2.5）を起動し、`gdg wiki clone` した wiki 作業ツリーを操作する。
これを多数の GDG チャプターに配る MVP にするために、5 つの穴を塞ぐ。

1. **権限が無い。** xangi から起動された Cursor エージェントは全権限を持つ。
2. **睡眠が無い。** active source の日次更新と、会話履歴の取り込みが自動化されていない。
3. **query が遅い。** エージェントが `ls`/`grep` で FS を辿る往復回数が多い。
4. **エピソード記憶が無い。**
5. **記憶に権限が無い。** 中央 1 台が複数チャプターの記憶を同居させる。

### 対象環境

**サポート対象は自前 Ubuntu 1 台だけである**（[ADR-001](adr.md#adr-001-中央-1-台全チャプター共有のトポロジを採る)）。
uid 分離・sudoers・systemd・`/run` の tmpfs は、この 1 台の上でだけ成立させる。

**macOS は開発機としてのみ扱う。** `wk`・ゲート・ACL コアの単体実行とテストは macOS で通るようにするが、
**macOS 上で権限境界を主張しない** — uid 分離もサンドボックスも Ubuntu でだけ検証する
（[Stage 00](00-typescript-runtime.md) §7、[Stage 07](07-agent-uid-isolation.md)「依存と対象範囲」）。

`/opt/gdg-agent/` と `/etc/sudoers.d/gdg-agent` は **配置先であって、実装の置き場ではない。**
実装はすべてリポジトリ内にあり（`cli/internal/wiki/hooks/*.ts`、`gdg-lib/`、`agents-local/config/*`）、
`agents-local/setup.sh` と `gdg` の `EnsureCursorHooks` がそれを配置する。
**絶対パスを解決するのはこの 2 つだけで、実行物は解決済みのパスを引数で受け取る**
（[Stage 00](00-typescript-runtime.md) §6）。

### 対象範囲と、この計画で確定済みの設計判断

グリル済みの決定事項。実装時にここを再検討しない。

| 論点 | 決定 |
|---|---|
| トポロジ | 中央 1 台・全チャプター共有。workdir は 1 つ、インデックスも 1 つ |
| 権限の単位 | ユーザーではなく**権限クラス** `(chapter, role)` |
| クラスの合成 | 保有 = ロール由来 ∪ ログイン由来（和集合）／実効 = 保有にチャンネル写像を適用したもの |
| チャンネルの天井 | **クラス集合とは別の制約** `channelAudience` として持ち回る（[ADR-002](adr.md#adr-002-権限の単位をユーザーではなく権限クラスにする)）。読み取りは「クラス ∧ audience 包含」の AND |
| IAM 編集権限 | guild→chapter 束縛も内側の role 写像も、**いずれかのチャプターの organizer** なら設定できる |
| 信頼境界 | ①`preToolUse` フック（`failClosed`）②**スロットごとの uid 分離**（[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)）③OS サンドボックス。Cursor の permission 設定は補助 |
| ワークツリーの読み書き | **`wk` コマンド 1 本に集約**（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。`<acl>` の濾過・再合成・挿入は `wk` が行い、フックは `wk` 以外の経路を deny する |
| ゲートの既定 | **既定 deny + 名指しの素通り allowlist**。変更系ツールと未知のツール名はパスを見ずに deny（[Stage 05](05-cursor-harness-pretooluse.md) §2） |
| shell の許可 | **argv allowlist**（`argv[0] === "wk"` のみ）。受理する文法を先に狭め、解釈できないものは deny（Stage 05 §3）。パス抽出の正規表現にも汎用 shell パーサにも戻さない |
| 脅威モデル | workdir **外**は攻撃を防ぐ層、workdir **内**は事故を防ぐ層。[ADR-004 の脅威モデル](adr.md#脅威モデル)が唯一の記述 |
| shell | **残す**。読み取り制御は `preToolUse` が担う |
| `skipPermissions` / `!skip` / `/skip` | フォークで既定 false に反転、`!skip` と `/skip`（Discord・Web）を**すべて削除** |
| 記憶の置き場 | `agents-local/memories/`。フラット、日時ファイル名、**gitignore** |
| 記憶の ACL | Discord チャンネル → `SourceVisibility` の静的写像。未設定は `chapter-organizer` |
| リポジトリの同時変更 | **ミューテックス 1 本**（xangi が保持）。スロット数は同時変更数ではない（[Stage 10](10-sleep-scheduler.md) §1a） |
| トレースの単位 | **invocation ごとに 1 ファイル**（`.gdgwiki/ingest-trace/<runId>.json`、[Stage 11](11-wk-mediator.md) §8） |
| MCP | **既定 deny + ツール名 allowlist**（`search` のみ）。設定は root 所有 + `--mcp-config` |
| 記憶の昇格 | 睡眠が `sources/inline` にアップロードして `source.id` を得てから ingest。人手を介さない |
| 記憶のアップローダ | 参加者から 1 人選び、**`upload_actor` に固定する**。`added_by` は冪等キーの一部なので選び直すと重複する |
| 既存ページの上書き | `canMutatePage` — organizer は全チャプター、member は自チャプター + public（[ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する)） |
| 評価器 | `gdg-lib/` に集約。**エージェント側はクラス集合だけを入力にする別関数**（[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)） |
| インデックス | kiri は**使わない**。自作の薄い MCP コンポーネント。出力はパス + 行範囲 |
| DM / 未マップ guild | 記憶を書かない。スレッドは親チャンネルの写像を継承 |
| Node 実行物 | **Node 22.18.0+ のネイティブ TypeScript**。erasable syntax のみ、ESM marker は root 所有。`tsx` や `.js` build fallback は作らない（[Stage 00](00-typescript-runtime.md)、[ADR-022](adr.md#adr-022-ローカル実行物を-node-ネイティブ-typescript-に統一する)） |
| 実行環境 | 本番は **Ubuntu 1 台のみ**。macOS は開発機で、typecheck と純関数テストだけを通す。`/opt`・`/etc` は配置先であり、絶対パスの解決は `setup.sh` と `hooks.go` に集約する（[Stage 00](00-typescript-runtime.md) §6-§7） |

**この計画は overview である。delegate しない。**
実装は下表のステージファイルを 1 つずつ `/cursor:from-plan` に渡す。
**進捗は [order.md](order.md)（実装順のチェックリスト）で追う。**

| # | ファイル | 内容 | 依存 |
|---|---|---|---|
| 00 | [00-typescript-runtime.md](00-typescript-runtime.md) | Node ネイティブ TypeScript の実行・型検査基盤と既存 2 ファイルの移行 | — |
| 01 | [01-acl-evaluator-gdg-lib.md](01-acl-evaluator-gdg-lib.md) | ACL 評価器を `gdg-lib/src/acl/` に切り出し、`wiki/` をラッパ化 | 00 |
| 02 | [02-wiki-inline-source-api.md](02-wiki-inline-source-api.md) | `sources.kind` に `conversation`、`POST /api/agent/sources/inline`、**マニフェストに `chapterId`** | — |
| 03 | [03-xangi-principal-plumbing.md](03-xangi-principal-plumbing.md) | `RunOptions.principal` 配管、ロール読み取り、既定権限を閉じる | — |
| 04 | [04-xangi-authz-iam.md](04-xangi-authz-iam.md) | nonce 認可サーバ、IAM 設定、権限クラス解決 | 03 |
| 11 | [11-wk-mediator.md](11-wk-mediator.md) | **`wk` コマンド** — 読み書きの唯一の窓口。`<acl>` の濾過と再合成 | 01, 02, 04 |
| 05 | [05-cursor-harness-pretooluse.md](05-cursor-harness-pretooluse.md) | `preToolUse` ゲート — `wk` 以外の経路を deny する。argv allowlist | 00, 11 |
| 06 | [06-acl-span-autoinsert.md](06-acl-span-autoinsert.md) | `wk write` の中の `<acl>` 差分ベース自動挿入 | 11 |
| 07 | [07-agent-uid-isolation.md](07-agent-uid-isolation.md) | uid 分離、OS サンドボックス、フック所有権 | 05 |
| 08 | [08-episodic-memory.md](08-episodic-memory.md) | `memories/` 書き出しとアップロード | 02, 04 |
| 09 | [09-agents-index.md](09-agents-index.md) | `agents-index/` ローカルインデックス | 01, 02, 04 |
| 10 | [10-sleep-scheduler.md](10-sleep-scheduler.md) | 睡眠ループ | 06, 08 |

**Stage 00 は最初に実施する。** Node ネイティブ TypeScript の実行契約を先に固定し、
後続ステージは実行物を最初から `.ts` で作る。

**番号は ID であって実装順ではない。** 依存列を見ること。
とくに **11 → 05** である（表の並びもその順にしてある）。
`wk` が無い状態でゲートを入れると、Read を deny されたエージェントに代替手段が無い。
`wk` は単体で作って単体で検証できるので、先に閉じる。

Stage 00 の完了後は、01・02・03 を並行して着手できる。
**02 は 11 と 09 の先行条件でもある** — マニフェストの `chapterId` が無いと、
`raw/**` の `chapter-*` ソースを評価できず fail closed で全部 deny になる。

上表の決定を**なぜそうしたか、何を却下したか**は [adr.md](adr.md) にある。
設計を変更したくなったら、まずそこを読むこと。

### 読むべきもの

- `CLAUDE.md`（リポジトリ直下）、`wiki/CLAUDE.md`
- `docs/plans/00-llm-wiki-overview.md` — 三層構造と全体方針
- `docs/plans/09-source-visibility-acl.md` — `SourceVisibility` の 5 値と `canAccessSource` の評価順
- `docs/plans/10-page-acl-spans.md` — **特に §0「権限の代数」**。5 値は全順序ではない
- `docs/plans/11-ingest-acl-hooks.md` — 現行 ACL ゲートの設計と fail-open の理由
- `docs/plans/03a-agents-md.md` — `AGENTS.md` 全文ドラフト
- `~/.cursor/skills-cursor/create-hook/SKILL.md` — Cursor フックの一次資料
- [07-ubuntu-host-install-2026-08-20.md](07-ubuntu-host-install-2026-08-20.md) — 本番 Ubuntu への Stage 07 配置ログ

### 再利用する既存実装（書き直さない）

- `wiki/app/lib/sources.server.ts` の `canAccessSource(source, user, chapters)`
  — ACL 判定の実体。**Stage 01 でここから純粋部分を `gdg-lib/` に移し、既存シグネチャは薄いラッパにする**
- `wiki/app/lib/acl-spans.ts` — `parseAclSpans` / `redactAclSpans` / `aclSpanSourceIds` /
  `computeAclSourceIdsJson`、および `audienceContains`（`acl-spans.server.ts`）
- `wiki/app/lib/sources.server.ts` の `createSource` — **登録の唯一の窓口**という構造を保つ
- `wiki/migrations/0047_source_kinds.sql` — SQLite で CHECK を変える 12-step 再構築の手本
- `cli/internal/wiki/hooks/acl-gate.ts` — フックスクリプトの書き方の手本
  （Node ネイティブ TypeScript、依存ゼロ、stdin を JSON で読む、`spawnSync`、
  壊れた入力で fail open）。Stage 00 で既存ファイルを rename する
- `cli/internal/wiki/{trace,verify,locks}.go` — トレース・変更ページ収集・ロックの既存実装
- `~/proj/xangi` の `src/discord/message-handler.ts` の `processPrompt`（`:206`）、
  `src/dynamic-runner.ts` の `run`/`runStream`（`:178`/`:198`）、
  `src/backend-resolver.ts` の `resolve(channelId, …)`（文脈→ポリシー解決器の雛形）、
  `src/settings.ts` の normalize-on-load パターン、`src/tool-server.ts`（ローカル HTTP の雛形）
- `wiki/workers/features/sources/fetch-source.ts` — 日次 cron `0 16 * * *` と
  `enqueueDueSourceRefreshes`。**source 再取得は既に動いているので作らない**

### 実装前に疎通確認すること

- `cursor-agent` の `preToolUse` フックが、`~/.cursor/hooks.json`（user hooks）から
  `failClosed: true` 付きで実際に発火し、`{"permission":"deny"}` で Shell と Read を止められること。
  **通らなければ止まって報告する。** ここが通らないと権限モデル全体が成立しない。
- `cursor-agent` に `--force`/`--yolo` を渡さない状態で headless（`-p`）が実用に耐えること。
- **`cursor-agent` が、Read ツールの deny と `agent_message` を受けて `wk read` に切り替えること。**
  同じ Read を繰り返すループに入らないこと。
- **Write / Edit ツールを deny した状態で、`wk write` による全文書き込みだけで
  ingest 相当の作業が完走すること。**
  **後ろの 2 つが最も危うい。** 通らなければ止まって報告する（Stage 05 に代替案がある）。

---

## Design — 設計

### 1. 権限クラス

`PermissionClass = { chapterId: string; role: "organizer" | "member" }` の集合として表現する。
1 回の invocation につき 1 つの集合が決まり、以降のすべての判定はこれだけを入力にする。

決定手順（`xangi` 側）:

1. **ロール由来** — guild の IAM 設定から `message.member.roles` を写像して得る集合。
2. **ログイン由来** — Discord user id にリンクされた GDG アカウントの `chapters` クレーム。
3. **和集合**をとる（＝その人の**保有**クラス）。
4. **チャンネル写像を適用する**（＝その invocation の**実効**クラス）。
   写像はチャンネル → `SourceVisibility` の静的写像である（未設定は `chapter-organizer`）。
   チャプター写像のチャンネルではチャプターで絞り、ロールを上限で丸める。
5. **同じ写像から `channelAudience`（audience key）を作り、クラス集合とは別に持ち回る。**
6. 保有が空なら `/login` と IAM 設定を促す。実効が空なら
   「このチャンネルではあなたの権限で使えない」と案内する。どちらも invocation は実行しない。

**4 が要る理由: セッションを分けても投稿先の Discord チャンネルは分かれない。**
`contextKey` を `channelId#classKey` にしても、organizer セッションの回答は同じチャンネルに
投稿され、そこに居る member の目に入る。読める範囲をチャンネルの写像で抑えるのが、
混在チャンネルで漏れを閉じる唯一の方法である。

**5 が要る理由: クラス集合だけでは全国写像の天井を表現できない。**
`member` / `organizer` 写像のチャンネルではチャプターを絞れない
（絞ると未束縛チャプターの保有クラスが落ちる）。その結果 `{tokyo, member}` が残り、
`chapter-member` + `tokyo` の材料が読めてしまう。
**読み取りは常に「クラスで読めるか」∧「このチャンネルに出してよいか」の AND** である
（[Stage 04](04-xangi-authz-iam.md) §2-2、[Stage 01](01-acl-evaluator-gdg-lib.md) §5-4）。
帰結として、**全国写像のチャンネルではチャプター限定の材料に到達できない。**

`memberships` は `(user_id, chapter_id)` が PK なので 1 人が複数チャプターに属しうる。
**集合であることを型で保ち、「代表クラス 1 つ」に丸めない。**5 値の visibility は全順序ではなく、
`chapter-member:tokyo` と `chapter-member:osaka` は比較不能である（`10-page-acl-spans.md` §0）。

### 2. xangi フォーク — identity の配管と認可サーバ

対象は `~/proj/xangi`（既に `Harineko0/xangi` としてフォーク済み）。

#### 2-1. identity を runner まで通す

現状 `RunOptions`（`src/agent-runner.ts:13`）は `channelId` しか持たず、発言者は
プロンプト文字列の中の `[発言者: …]` という散文としてしか残らない。

- `RunOptions` に `principal: { guildId, channelId, userId, roleIds, classes }` を足す。
- `processPrompt`（`src/discord/message-handler.ts:206`）で組み立て、
  `DynamicRunnerManager.run`/`runStream`（`src/dynamic-runner.ts:178,198`）で強制する。
  この 2 箇所が Discord/Slack/Web/スケジューラの**全経路の choke point** である。
- Discord ロールを読むため `GatewayIntentBits.GuildMembers` を `src/index.ts:214` に追加する。
  `message.member.roles.cache` が空のときは `guild.members.fetch(id)` にフォールバックする。
- セッションを再キーする。`contextKey` を `channelId` から `channelId:<classKey>` にし、
  `src/runner-manager.ts:70`、`src/dynamic-runner.ts:100,101`、
  `src/discord/message-handler.ts:979`（実行中ミューテックス）を同じキーに揃える。
  **cursor バックエンドは 1 メッセージ 1 プロセスの one-shot なので、cwd の切り替えは不要。**

#### 2-2. 認可サーバと nonce

エージェントは shell を持つので、環境変数やファイルで権限クラスを渡すと偽装できる。

- xangi プロセス内に UNIX ドメインソケットの認可サーバを立てる（`src/tool-server.ts` が雛形）。
- invocation ごとに **短命・invocation スコープの nonce** を発行し、
  `XANGI_AUTHZ_NONCE` と `XANGI_AUTHZ_SOCKET` で子プロセスに渡す。
  **`ALLOWED_ENV_KEYS` には載せない** — あれは親の env を通す仕組みで、
  invocation ごとの値を置くと**親に残った古い nonce が漏れる**。
  経路は `buildCliEnv` の第 3 引数と、Stage 07 の固定ランチャ
  （`sudo` の `env_reset` を跨ぐため）の 2 段だけにする。
- `wk`・フック・インデックスサーバは
  `nonce → { PermissionClass[], channelAudience }` をサーバに問い合わせる。
  **`channelAudience` が欠けた応答は fail closed で扱う。**
- nonce は invocation 終了時に失効させる。
- **盗んだ nonce が昇格に使えないのは、nonce の性質ではなく uid とソケットの分離による。**
  単一 uid では同時に走る 2 つの agent が互いの `/proc/<pid>/environ` を読めるので、
  `member` が organizer の nonce を解決できる。スロットごとに uid とソケットを分ける
  （[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)）。

#### 2-3. 既定の権限を閉じる

- `src/config.ts:291` の `skipPermissions` の既定を **`false` に反転**する。
- `src/discord/message-handler.ts:907` の `!skip` 接頭辞を**削除**する。
  「許可ユーザーなら誰でも権限昇格できる」経路は多チャプター共有では残せない。
- `src/cursor-cli.ts:43-44` の `--force` / `--trust` の既定を off にする。
  `--force` 下には `shouldBlockShellCommand` にパース失敗時の deny バイパスが実在する。

#### 2-4. uid 分離とサンドボックス

- `cursor-agent` を**専用の非特権 uid** で spawn する（xangi は操作者 uid のまま）。
  `~/.config/gdg/credentials.json`（headless Linux では keyring が無く平文）、
  IAM 設定、nonce ストアが agent uid から読めなくなる。
- 併せて `cli-config.json` に `sandbox.mode: "enabled"` と `sandbox.readBoundary: "workspace"`
  を設定し、workdir 外への shell 経由の読み取りを OS レベルで止める。
  **workdir 内部のチャプター間 ACL はサンドボックスでは表現できない。**それは Stage 3 の担当。

### 3. IAM 設定

- 保存先はエージェントが到達できないパス（xangi uid 所有、agent uid から読めない）。
  `src/setup/schema.ts` の閉じた `ALLOWED_KEYS` を拡張するか、隣に `iam.json` を新設する。
  `ALLOWED_ENV_KEYS` にこのパスを**渡さない**。
- 編集は Discord のスラッシュコマンド経由で xangi 自身が行う。
- 形状:

```jsonc
{
  "guilds": {
    "<guildId>": {
      "chapterId": "<accounts chapter id>",
      "roles": { "<roleId>": { "chapterId": "…", "role": "organizer" | "member" } },
      "channels": {
        "<channelId>": { "visibility": "chapter-organizer", "chapterId": "…" }
      }
    }
  }
}
```

- **編集権限**: guild→chapter 束縛も `roles` 写像も、`chapters` クレームに
  `role === "organizer"` を 1 つでも持つユーザーなら設定できる。
  どのサーバーがどのチャプターかを厳密に決められないための緩和であり、
  **全 GDG organizer は相互に信頼する**という前提を明示的に置く。
- `channels` に無いチャンネルは `chapter-organizer` + guild の `chapterId` にフォールバックする。
- guild が未束縛のときは記憶を書かず、IAM 設定を促すメッセージだけ返す。
- DM は対象外（`DirectMessages` intent を要求しない現状のまま）。スレッドは親チャンネルを継承する。

### 4. Cursor ハーネス — 強制は `preToolUse`、実施は `wk`

ワークツリーの読み書きを **`wk` コマンド 1 本**に集約し、フックは
**「`wk` 以外の経路を deny する」**係にする（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

| 層 | 実体 | 責務 | fail 方針 |
|---|---|---|---|
| **強制** | `preToolUse` 1 本 | `wk` 以外の読み書き経路を deny する | `failClosed: true` |
| **実施** | `wk` | 濾過（read）・再合成と挿入（write）・変更権限の判定 | 落ちたら読まない・書かない |

**なぜ 2 層か。** フックは**ツールの出力を書き換えられない**
（`preToolUse` が返せるのは `permission` / `user_message` / `agent_message` / `updated_input`、
`postToolUse` の出力書き換えは MCP ツール限定）。
したがって「Read したら `<acl>` が自動で消える」はフックでは実装できない。
濾過ができるのは、自分が本文を出す側に立ったときだけである。

**使うフックは `preToolUse` 1 本だけ。**
`beforeShellExecution` / `beforeReadFile` / `afterFileEdit` はどれも使わない。

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

- **`failClosed: true`。** 判定材料はローカル完結（front matter + 認可サーバ）なので、
  `docs/plans/11-ingest-acl-hooks.md` が fail open にした理由
  （ネットワーク障害で ingest が止まる）は当てはまらない。
  ただし `git commit` 時のサーバ往復検査（`gdg wiki verify-acl`）は**従来どおり fail open** に保つ。
- `~/.cursor/hooks.json`・フック本体・**`wk`** は **agent uid から書けない所有権**にする
  （root 所有。`.cursor` は実ディレクトリ。Cursor は symlink を含むパスの読み込みを拒否する）。
  Cursor permission の `Write(...)` deny は Write ツールしか覆わず、`rm` は Shell ツールなので止まらない。
- ゲートの判定:

| `tool_name` | 動作 |
|---|---|
| `Read` / `Grep` / `List` | `pages/**` / `raw/**` / `memories/**` なら **deny**。`wk read` を案内 |
| `Shell` | **argv allowlist** — すべての単純コマンドの `argv[0]` が `wk` であること。加えて `wk git commit` なら tripwire |
| `MCP:<tool>` | **ツール名 allowlist（既定 deny）**。通すのは `search` だけ（Stage 05 §3-5） |
| **上記以外のすべて** | **deny。パスを見ない**（`Write` / `Delete` / `Edit` 系 / `Fetch` / `task` / 未知のツール名） |

**変更系にパス条件を付けない。** `pages/**` / `raw/**` / `memories/**` だけを deny すると、
Write ツールから `.git/hooks/pre-commit`・`.gitattributes` の filter・
`<workdir>/.cursor/sandbox.json` が作れる。前者は `wk git commit` で任意コードを実行させ
**argv allowlist を丸ごと無効化**し、後者は **`readBoundary` を破る。**
どちらも [ADR-004 の脅威モデル](adr.md#脅威モデル)が**守るもの**に挙げた機構である
（Stage 05 §2）。

- **ゲートは ACL を判定しない。** `canClassesSeePage` / `canClassesAccessSource` /
  `canMutatePage` は全部 `wk` 側にある。両方が判定を持つと必ずドリフトする。
- `wk` の中身:

| 段階 | 内容 |
|---|---|
| パス | **解決（`realpath`）してから分類する。clone 外は拒否**（Stage 11 §3-0） |
| read | ファイル単位の判定（front matter / manifest、**クラス ∧ `channelAudience`**）→ **`redactAclSpans` でスパンを濾す**。読めないスパンは `⬛︎⬛︎⬛︎` |
| write | ⓿書き込み先が `pages/**/page.md` か（allowlist）①変更権限（`canMutatePage` / 新規は可視性の割り当て可否。**チャンネルでは絞らない**）②**読めなかったスパンを元のバイト列で再合成** ③`<acl>` 自動挿入 ④[ADR-020](adr.md#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) の拒否 ⑤`validateAclSpans`。**1 つでも落ちたら 1 バイトも書かない** |

**`wk` の仕様は [Stage 11](11-wk-mediator.md)、ゲートは [Stage 05](05-cursor-harness-pretooluse.md)、
挿入ロジックは [Stage 06](06-acl-span-autoinsert.md) にある。**

- **`memories/**` への書き込みは常に拒否する。** 記憶を書くのは xangi だけである。
- catalog ページと `log` は変更の例外にする
  （狭いチャンネルからの更新も通さないと wiki の航行が壊れる）。
- **`wk` に逃げ道を作らない。** `--raw` / `wk cat` / `wk sh -c` / `wk write --no-verify` を作らない。
  1 つでも作れば、この層は無意味になる。
- スパンの `src` を解決するために `.gdgwiki/acl-sources.json`
  （`sourceId` → `visibility` / `chapterId` だけ）を `raw pull` が生成する。
  会話ソースは xangi がアップロード時に追記する。**引けない id は拒否側に倒す。**
- ゲートの出力は stdout に JSON、診断は stderr。stdout の JSON パーサは末尾の `{...}` を拾う
  実装なので、ログ行に `}` を混ぜない。`wk` は通常の CLI（本文は stdout、拒否は非ゼロ終了）。

### 5. 共有 ACL 評価器

同じ判定が 3 箇所で必要になる: ①**`wk`**（フックは判定を持たない）②インデックスサーバ
③`wiki/` のサーバ側。
現在ローカルとサーバの判定がズレるため `git push` が散発的に落ちる。

- `gdg-lib/src/acl/` に**純粋関数**として切り出す。依存ゼロ、`import type` を使う。
  - `canAccessSource(source, user, chapters)` — `wiki/app/lib/sources.server.ts:145` から移設
    （**サーバ側専用**。user id と admin フラグを要求するのでエージェント側からは呼べない）
  - `canClassesAccessSource` / `canClassesSeePage` / `canMutatePage` — **新規**
    （[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)）
  - `audienceKeyContains` / `pageAudienceIncludesChannel` /
    **`canClassesAccessSourceInChannel` / `canClassesSeePageInChannel`** — **新規**。
    **エージェント側（`wk`・インデックス）が使うのはこの `…InChannel` 版だけ**である。
    クラス版の裸の評価器は `acl/agent`（と生成物 `acl.ts`）から **export しない**
    （Stage 01 §5-4 / §5-5）
  - `audienceContains(source, page)`、`sourceAudienceKey`、`parseLevelAudienceKey`
  - `parseAclSpans` / `aclSpanSourceIds` / `redactAclSpans`（`wiki/app/lib/acl-spans.ts` から移設）
- `wiki/` 側は既存シグネチャを保った薄いラッパにする。**呼び出し側 6 箇所を変えない。**
- **`wk`** は Node ネイティブ TypeScript として生成物 `./acl.ts` を import する
  （フックは ACL を判定しないので import しない）。
  `gdg-lib` は source-only（`main: "./src/index.ts"`）なので、**このためにだけ
  `build:acl`（esbuild、エントリは `src/acl/agent.ts`）が要る**（Stage 01）。
  **outfile は `cli/internal/wiki/hooks/acl.ts`** — 実行物と同じディレクトリに出すことで、
  相対 import がリポジトリ上でも `/opt/gdg-agent/lib/` 配置後でも同じ形で解決する
  （Stage 00 §5-§6）。
  Worker は `src/acl/`（完全な面）、
  インデックスサーバは `src/acl/agent.ts`（絞った面）を直接使う。
- `wk` の濾過は `redactAclSpans` + クラス版述語で行う。
  形は `wiki/app/lib/acl-spans.server.ts` の `buildAclSpanPolicy` と同じ
  （`src` を AND で評価し、引けない id は拒否側）。

### 6. `<acl>` 自動挿入（差分ベース）— `wk write` で挿入する

**挿入は `wk write`、つまりバイトがディスクに着く直前に行う。**
commit 時にだけ挿入すると、エージェントが `git add` を済ませていた場合に
書き換わるのはワークツリーだけで、**staged blob はタグ無しのまま commit される**。
書き込み時に挿入すれば `git add` の時点でタグ済みなので、この穴が構造的に生じない。

`afterFileEdit` フックは使わない。Cursor の Write / Edit ツールを deny する以上
発火する余地が無く、`failClosed` を持てないので拒否も返せない
（[ADR-021](adr.md#adr-021-ワークツリーの読み書きを-wk-に集約する)）。

| 起動点 | 対象 | 結果 |
|---|---|---|
| `wk write`（唯一） | 書き込まれる 1 ファイル | 挿入・検査してから書く。**落ちたら 1 バイトも書かない** |
| `wk git commit` の tripwire | `git diff --cached`（index） | 未タグの追加行があれば **deny**。**挿入はしない** |

tripwire で未タグが見つかることは、**`wk` を通らない書き込みが成立した**という意味である
（ゲート違反の疑い）。検査対象を index にするのは、`git commit -a` / pathspec /
`git add -p` を跨いで正しいのが index だからである。

- 対象は `pages/**/page.md` の**本文のみ**。front matter、catalog ページ、`log` は常に除外。
- `BaseRev..新本文` の**追加行**のうち、上記対象に入るものを
  `<acl src="<id1> <id2>">…</acl>` で包む。id はその run で読んだ
  `member` より狭いソース（**その run のトレース**
  `.gdgwiki/ingest-trace/<runId>.json` の `reads` + ロック済みエントリ）。
- 複数ソースは **AND**（`src` にスペース区切りで並べる）。
  「どちらが厳しいか」を機械が選ばない — 5 値は全順序ではない。
- n-gram による絞り込みは**しない**。言い換えを取り逃すので、保守側に倒すという趣旨に反する。
- 見出し行とコードフェンス内側に機密派生行が落ちたら**拒否する**（ADR-020）。
  **front matter の `title` / `summary` / `tags`、catalog、`log` は拒否しない** —
  拒否すると `chapter-organizer` 由来の ingest がページを 1 枚も作れなくなる。
  ここからの漏洩は[受容事項](adr.md#脅威モデル)である。
- **検証は `git show HEAD:<path>` で commit 済み blob を見る。** ワークツリーではない。

### 7. エピソード記憶

- xangi がセッション終了時に会話ログを
  `agents-local/memories/<ISO8601>-<sessionId>-<segmentSeq>.md` に書く。
  再開後のセグメントは別ファイル・別の冪等キーになる（Stage 08）。
  フラット構造、日時ファイル名。`.gitignore` に `memories/` を追加する。
- front matter に `visibility` / `chapterId` / `guildId` / `channelId` を持つ。
  `visibility` は IAM のチャンネル写像から決まる。
- 睡眠時に、**そのファイルを ingest する直前に** `POST /api/agent/sources/inline`
  （Stage 02 で新設）へアップロードし、返ってきた `source.id` を得る。
  `raw pull` の往復は挟まない。
- ingest は**ローカルの `memories/` ファイルを読み**、書いたページのスパンを
  その `source.id` で `<acl src>` タグ付けする。push 成功後にローカルファイルを削除する。
- **`kind: "conversation"` は `/sources` からも CLI マニフェストからも除外する。**
  マニフェストに出すと `raw pull` が同じ内容を `raw/` に落とし、
  ローカルの `memories/` と合わせて同じ会話ログが 2 回 ingest される。
  サーバ上の行は `<acl src>` が参照する id と恒久記録のために存在する。

#### `POST /api/agent/sources/inline`（`wiki/` 新設）

現行 `POST /api/agent/sources`（`wiki/app/routes/api.agent.sources.ts`）は **URL しか受け取らず**、
`createSource` が URL から `kind` を導出する。本文を渡す経路が存在しない。

- リクエスト: `{ title, content, visibility, chapter, kind: "conversation" }`
- `sources` 行 1 件と、R2 上の `source_documents` 1 件を作る。
- `createSource` を「URL 経路」と「本文経路」に分岐させない。
  **本文経路の唯一の窓口**として作る（`docs/plans/09-source-visibility-acl.md` が
  `createSource` について強調した構造の同型）。
- `sources.kind` に `conversation` を追加する（`0047_source_kinds.sql` の 12-step 再構築に倣う）。
  **`/sources`・`GET /api/sources`・CLI manifest（`GET /api/cli/wiki/sources`）の 3 つすべてから除外する。**
  ingest はローカルの `memories/` ファイルを直接読むので、manifest に出す必要が無い
  （出すと `raw pull` が `raw/` にも落として二重 ingest になる。§7 の 4 つ目の項目と同じ理由）。
- `fetch-source.ts` の fetchable kind に**加えない**（取りに行く先が無い）。

### 8. インデックス

kiri（`kiri-mcp-server`）は要件を満たさない。本文を DuckDB の `blob` に丸ごと持ち
（`~/proj/wiki` で 7.3 GB）、`snippets_get` が FS を経由しないので read ゲートを迂回し、
"semantic" は sha256 ベースの 64 次元ハッシュ化 bag-of-tokens で日本語の言い換えに効かず、
フィルタは deny のみで allowlist 機構が無い。**使わない。**

自作の薄い MCP コンポーネントを作る。

- 埋め込みはローカルの多言語モデル（multilingual-e5 / Ruri など）。外部送信しない。
- ストアは sqlite-vec。追尾は chokidar。**インデックスは 1 つだけ**（workdir も 1 つ）。
  実体は monorepo の新ワークスペース `agents-index/`。
- 対象は `pages/` / `raw/` / `memories/` の**すべて**。対象を絞ることは禁止
  （絞るとセマンティック検索の意味が消える）。
- 入力は自然言語、**出力はパス + 行範囲 + score のみ。本文を返さない。**
- 呼び出し時に nonce を受け取り、認可サーバでクラスを引き、
  **Stage 5 の共有評価器で結果を post-filter してから返す。**
  フィルタ前に `limit` で切らない。固定倍率のオーバーサンプリングにもしない
  （権限内が `limit` 件たまるまでページングする）。
- 本文はエージェントが **`wk read`** で取りに行く（`Read` ツールは deny される）。
  **ACL の判定点が 1 つに保たれる。**
- **DB は `/var/lib/agents-index/index.db`。workdir の中に置かない。**
  本文を保存するので、workdir に置くと shell から全文が読めて read ゲートが無意味になる。
  「フィルタが漏れても被害はパス名に限定される」は、
  API が本文を返さないことと DB が agent 可読範囲外にあることの**両方**で成立する。
- 記憶のファイル名は `<ISO8601>-<sessionId>` とし、主題を書かない（パス名からの漏洩を無害化する）。

### 9. 睡眠

xangi の**内部スケジューラ**として実装する（`scope: 'scheduler'` のセッションが既にある）。
systemd timer の独立プロセスにしない — フックを通らない実行経路を作らないため。

日次で以下を回す（サーバ側の source 再取得 cron `0 16 * * *` は既に動いているので作らない）。

1. `gdg wiki raw pull` → 通常ソースの取り込み。
2. `memories/` の各ファイルについて、**アップロード → そのファイルを直接 ingest →
   push → ローカル削除**。1 ファイルずつ閉じる。
3. `INGEST_QUEUE.md` の未 ingest（`raw/` 由来）を消化する。
4. サマリを運用チャンネルに投稿する。

**アップロードは、そのファイルを ingest する直前に行う。**
まとめてアップロードしてからキューを回すと、キュー再構築より後に生まれたソースは
その run では処理されない。

**`system` はエージェントに渡さない。** `system`（束縛済み全チャプターの organizer）は
スケジューラ本体がキューとギルドを列挙するためのクラスである。
**個々の ingest エージェント invocation には、そのソース 1 件に必要なクラスだけを載せた
nonce を発行する** — 全チャプター権限を載せると、プロンプト注入されたソース 1 件が
他チャプターの `raw/` と記憶に到達できてしまう。

**リポジトリトランザクションミューテックスを設ける**（Stage 10 §1a）。
睡眠と対話は同じワークツリー・git index・HEAD・トレース・キューを変更するので、
その部分は独立ではない。**しかも Stage 07 はスロットを 4 つ用意し、
全スロットが同じワークツリーで走るので、対話同士の競合も稀ではない。**
競合したときに失われるのはトレースの `reads`（＝ACL タグ）であり、
`verify-acl` はクライアント申告なので**サーバ側でも検出できない**。
頻度では受容できない。**保持者は xangi。対話も睡眠も同じロックを取る。**
併せてトレースを invocation ごとのファイルに分ける（Stage 11 §8）。

**統合の不変条件**: `visibility` が異なるエピソードを 1 つのページに統合しない。
5 値は全順序ではないので「最も狭い値に丸める」は定義できない。

### 制約

- **`10-page-acl-spans.md` §0 の権限代数を破らない。** visibility を大小比較しない。
  ページ全体の source 上界を計算しない。複数ソースは常に AND。
- **判定器を増やさない。** `wk`・インデックスサーバ・`wiki/` は `gdg-lib/` の同じ関数を呼ぶ。
  二重実装は必ずドリフトし、ドリフトした瞬間にゲートは嘘をつく。
- **読み取りの判定からチャンネルの天井を落とさない。** `wk` とインデックスは
  `…InChannel` 版だけを使う。落とすと全国チャンネルにチャプター限定の材料が出る。
- **`MCP:*` を素通りにしない。** 既定 deny + ツール名 allowlist（Stage 05 §3-5）。
  `preToolUse` にサーバ名は渡らないので、**設定の所有権と `--mcp-config` が前提条件**である。
- **`wk` のパス分類を正規化前のパスで行わない。** `.gdgwiki/../raw/x` が素通り行に
  当たると、判定表を丸ごと迂回できる（Stage 11 §3-0）。
- **`wk write` を「拒否リスト」形にしない。** `pages/**/page.md` の allowlist である。
- **リポジトリミューテックスを「頻度が低いから」で外さない**（Stage 10 §1a）。
- **ゲート（`acl-gate.ts`）に ACL 判定を書かない。** ゲートは「`wk` か否か」だけを見る。
  判定は `wk` に 1 本化する。
- **`wk` に逃げ道を作らない。** `--raw` / `wk cat` / `wk sh -c` / `wk write --no-verify`。
  1 つでも作れば、読み書きを 1 本にした意味が消える。
- **`afterFileEdit` を使わない。**「保険として残す」もしない。挿入は `wk write` の 1 箇所。
- **`cli/internal/wiki/remote_helper.go` の「`pages/**` と `AGENTS.md` 以外の push を拒否する」検査を緩めない。**
- **`wiki/schema.sql` と `wiki/worker-configuration.d.ts` は生成物。** 手編集せず
  `migrate:local` / `cf-typegen` で再生成する。
- **`~/.cursor/hooks.json`・フック本体・`wk` は agent uid から書けないこと。** これが崩れると
  ゲートは `rm` 一発で消え、画面上は正常に見える。
  **`cli-config.json` と `sandbox.json` も同じ**（Stage 07 §1）— あれは
  `sandbox.mode` / `readBoundary` を持つポリシー本体なので、可書きにすると
  1 回の invocation が次回以降のサンドボックスを無効化できる。
- **ゲートの変更系ツール deny にパス条件を付けない**（Stage 05 §2）。
  未知の `tool_name` も deny 側に倒す。「その他は素通り」に戻さない。
- **Cursor の glob は `*` のみで `/` を跨ぎ、`?` はリテラル、`**` は `*` と同義。**
  照合は解決済み絶対パスに完全アンカーされる。`Read(raw/*)` は永久にマッチしない。
- **`Read(...)` / `Write(...)` の deny は Cursor 自身の Read/Write ツールしか覆わない。**
  shell 経由の読み書きは別経路であり、`preToolUse` でしか止まらない。
- **フックはツールの出力を書き換えられない。** 書き換えられるのは `updated_input`（入力）だけで、
  `postToolUse` の出力書き換えは MCP ツール限定。**濾過は `wk` にしか置けない。**
- **shell の許可は argv allowlist にする。** パス抽出の正規表現に戻さない。
  抽出は原理的に不完全で、`$(...)` / `xargs` / here-doc の python が素通りする。
- `agents-local/wiki/` で ingest を回すなら、`.cursor/hooks.json` の位置を直す
  （現在は外側 root にあり、`.gdgwiki/` は `wiki/` の中なので `findCloneRoot` が届かない）。
- Biome（2 スペース・ダブルクォート・セミコロン・100 桁）。`import type` を使う。
- `.dev.vars*` / secrets / 生成物 / `memories/` をコミットしない。

---

## Files to touch — 変更ファイル

### `~/proj/xangi`（ハードフォーク）

- `src/agent-runner.ts` — `RunOptions` に `principal`
- `src/discord/message-handler.ts` — `processPrompt` で principal 組み立て、`!skip` 削除、
  ロール読み取り、実行中ミューテックスの再キー
- `src/dynamic-runner.ts` / `src/runner-manager.ts` — プール鍵に権限クラスを含める
- `src/index.ts` — `GatewayIntentBits.GuildMembers` 追加
- `src/config.ts` — `skipPermissions` の既定反転
- `src/cursor-cli.ts` — `--force` / `--trust` の既定 off、別 uid での spawn
- `src/safe-env.ts` — `XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` を追加
- `src/authz-server.ts`（新規）— nonce → 権限クラス
- `src/iam.ts`（新規）+ `src/setup/schema.ts` — IAM 設定の保存と検証
- `src/discord/slash-commands.ts` — IAM 編集コマンド
- `src/scheduler/sleep.ts`（新規）— 睡眠ループ
- `src/memory-writer.ts`（新規）— セッション終了時の会話ログ書き出し

### `gdg-lib/`

- `src/acl/`（新規）— `canAccessSource` / `audienceContains` / `parseAclSpans` ほか純粋関数
- `src/index.ts` — export 追加

### `wiki/`

- `migrations/0059_conversation_source_kind.sql`（新規）— `sources.kind` に `conversation`
- `schema.sql`（`migrate:local` による再生成。手編集しない）
- `app/routes/api.agent.sources.inline.ts`（新規）、`app/routes.ts`（登録）
- `app/lib/sources.server.ts` — 本文経路の追加、`canAccessSource` を `gdg-lib` のラッパに
- `app/lib/acl-spans.ts` / `acl-spans.server.ts` — `gdg-lib` のラッパに
- `app/lib/sources-shared.ts` — `SourceKind` に `conversation`
- `app/routes/sources.tsx` — 一覧から `conversation` を除外
- `openapi/paths/sources.yaml` ほか + `openapi/types.generated.ts`（再生成）

### `cli/`

- `internal/wiki/hooks/acl-gate.ts` — `preToolUse` 版に書き直し（**ACL 判定は持たない**）
- `internal/wiki/hooks/wk.ts`（新規）— 読み書きの唯一の窓口
- `internal/wiki/hooks/acl-core.ts`（新規）— ゲートと `wk` が共有する判定
- `internal/wiki/hooks/acl-insert-core.ts`（新規）— `<acl>` 挿入ロジック
- `internal/wiki/hooks/acl.ts`（**生成物**、gitignore）— `build:acl` の出力（Stage 01）
- `internal/wiki/hooks.go` — `~/.cursor/hooks.json` と `/opt/gdg-agent/` への設置、所有権の扱い
- `internal/wiki/raw.go` / `state.go` — `.gdgwiki/acl-sources.json` の生成と読み書き
- `internal/wiki/verify.go` — `memories/` 由来の run に対応

### `agents-index/`（新規ワークスペース）

- 埋め込み + sqlite-vec + chokidar + MCP サーバ。`pnpm-workspace.yaml` に追加する。
  `@gdgjp/gdg-lib` を workspace 依存で参照し、ACL 評価器を直接 import する

### `agents-local/`

- `.gitignore` — `memories/` を追加
- `AGENTS.md` — **`wk` の使い方**（読み書きは `wk` 経由、`⬛︎⬛︎⬛︎` の意味、消してはいけないこと）、
  記憶・権限クラス・自動挿入の説明
- `setup.sh` — uid 分離、`~/.cursor/hooks.json` と `/opt/gdg-agent/`（`bin/` と平坦な `lib/`）の設置、
  固定ランチャと sudoers、サンドボックス設定

### `docs/`

- `docs/agents-local-mvp/` — この overview、00〜11 のステージファイル、
  [order.md](order.md)（実装順）、[adr.md](adr.md)
- `docs/plans/03a-agents-md.md` — `AGENTS.md` 本文に自動挿入と記憶の節を追記
- `docs/plans/00-llm-wiki-overview.md` — 依存グラフから `docs/agents-local-mvp/` を参照

---

## Verification — 完了条件と検証

### 完了条件

1. 別チャプターの Discord サーバーから `/ask` したユーザーが、自分の権限クラスで
   読めないページ・raw・記憶を読もうとしたとき、
   **`preToolUse` が deny する**（Read / Grep / List / Write / Shell のいずれの経路でも）。
   `wk read` に切り替えても **`wk` が拒否する**。
   インデックス検索の結果にもそのパスが**含まれない**。
   **これは「到達できない」ことの保証ではない** — `wk` 自体のバグは
   この保護の外にある（[ADR-004 の脅威モデル](adr.md#脅威モデル)）。
   保証しているのは「事故と誤操作を止めること」までである。
1b. **読めるページの中の、読めない `<acl>` スパンだけが `wk read` で `⬛︎⬛︎⬛︎` になる。**
   同じページを、そのスパンを読めるクラスで読むと中身が見える。
   どちらの場合も出力に `<acl` が現れない。
   黒塗りを含む本文を `wk write` で書き戻すと、**読めなかったスパンが
   元のバイト列のまま復元される**。`⬛︎⬛︎⬛︎` を消して書くと拒否される。
1c. **全国写像（`member` / `organizer`）のチャンネルからは、チャプター限定の
   ソース・ページ・記憶に到達できない。** `wk read` も `search` も返さない。
   同じユーザーがチャプター写像のチャンネルからは到達できる。
1a. workdir **外**（`~/.config/gdg/credentials.json`、`iam.json`、`links.json`、
   `/var/lib/agents-index/index.db`）は、**uid 分離と `readBoundary` により読めない**。
   こちらは敵対的なエージェントに対しても保つ。
   **`wk` も clone 外のパスを拒否する**（Stage 11 §3-0）。
2. `~/.cursor/hooks.json`・フック本体・`wk` を `rm`/上書きしようとすると deny される。
   agent uid では所有権上そもそも書けない。
2a. **`cat` / `sed -i` / `python` / パイプ / リダイレクト / コマンド置換が deny される。**
   通るのは `argv[0] === "wk"` のコマンドだけである。
2c. **`Write` / `Delete` / `Edit` 系がパスによらず deny される。**
   `.git/hooks/pre-commit` と `<workdir>/.cursor/sandbox.json` を名指しで確認する。
   実在しないツール名も deny される（既定 deny）。
2b. **`MCP:search` 以外の MCP ツールが deny される。**
   `mcp.json` は root 所有で、ランチャが `--mcp-config` を渡している。
3. `!skip` が存在せず、`cursor-agent` に `--force` が渡らない。
4. 機密ソースを読んだ run が `wk write` でページを書くと、
   **書かれた時点で追加行に `<acl src>` が挿入されている**。
   `wk git add -A && wk git commit` は deny されずに通り、
   **`git show HEAD:<path>` に タグが入っている**。
   push がサーバに `acl_required` で拒否されない。
4a. index に未タグの blob を人為的に作ると、`wk git commit` が
   **ゲート違反の疑いとして deny する**（挿入はしない）。
   ワークツリーがタグ済みでも deny される。
5. セッション終了で `memories/<ISO8601>-<sessionId>-<segmentSeq>.md` が生成され、
   `visibility` がチャンネル写像どおりに入る。未設定チャンネルは `chapter-organizer`。
6. 睡眠が記憶を `sources/inline` にアップロードし、ページに昇格させ、
   push 成功後にローカルファイルを削除する。
   その source は `/sources` にも `GET /api/sources` にも **CLI manifest にも出ない**
   （出すと `raw pull` が `raw/` にも落として二重 ingest になる）。
6a. 睡眠の各 ingest エージェントに渡る nonce が、そのソース 1 件に必要なクラス**と
   そのソース自身の audience** だけを持つ。
6b. **睡眠中に対話が来ても、リポジトリを変更する処理が直列になり、
   双方のトレースが失われない**（Stage 10 §1a、Stage 11 §8）。
7. インデックス検索が本文を返さず、パス + 行範囲のみを返し、
   呼び出し元のクラス**とチャンネル audience**で読めないパスが結果に含まれない。
8. `member` クラスのユーザーが、自分より広い読者を持つページを上書きできない。

### コマンド

```bash
pnpm ci:quick
```

```bash
cd cli && go test ./...
```

```bash
pnpm --filter @gdgjp/wiki migrate:local && pnpm --filter @gdgjp/wiki typecheck
```

```bash
cd ~/proj/xangi && npm test
```

`migrate:local` は `wiki/schema.sql` を再生成する。その差分をコミットに含めること。
`openapi/*.yaml` を触ったら `openapi/types.generated.ts` の再生成を必ず行う。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`preToolUse` フックが実際に発火する。** `~/.cursor/hooks.json` の位置・所有権・
  `failClosed` を変えたときに、フックが読まれずゲートが黙って無効化される経路を固定する。
  **画面上は完全に正常に見える。**
- **`failClosed` が効いている。** フックを非ゼロ終了・タイムアウト・空出力・不正 JSON に
  したとき、すべて deny になること。fail open に反転すると全チャプターが素通しになる。
- **Cursor の glob の落とし穴。** `Read(raw/*)` 形式の相対パスルールが**マッチしない**ことを
  テストで固定する。相対パスで書いた deny ルールは静かに全許可になる。
- **権限クラスが空の invocation は拒否される。** ロール由来もログイン由来も空のとき、
  「空 = 制限なし」に反転しないこと。
- **実効クラスに和集合がそのまま入っていない。** チャンネルのポリシーを
  必ず通していること。飛ばすと混在チャンネルで organizer の回答が member に見える。
- **全国ポリシー（`organizer` / `member`）が IAM の束縛済みチャプター一覧を参照しない。**
  guild が束縛されていないチャプターの保有クラスが落ちないこと。
- **全国ポリシーのチャンネルでチャプター限定の材料が読めない。**
  クラス集合には `{tokyo, member}` が残るので、
  **`channelAudience` を落とすとここだけが静かに漏れる。**
  同じユーザーがチャプター写像のチャンネルでは読めることを同じテストに並べる。
- **`channelAudience` の欠落が fail closed。** `wk` は非ゼロ終了、`search` は空配列。
- **和集合がポリシー適用に劣化しない / 適用後が和集合に膨らまない。** Discord ロール由来と
  ログイン由来が食い違うケースを両方向で固定する。
- **未知の `visibility` 文字列で `canAccessSource` が `false` を返す**（`gdg-lib` 移設後も）。
- **`canClassesAccessSource` が `canAccessSource` と一致する**（admin でも所有者でもない場合）。
  ズレると push が散発的に落ちる — 関数を 2 本にしたぶん、この等価性が唯一の担保になる。
- **`gdg-lib` の評価器と `wiki/` サーバの判定が一致する。** 同じページ・同じユーザーに対して
  ローカルフックと `/sync` が同じコードを返すこと。ここがズレると push が散発的に落ちる。
- **`<acl>` 自動挿入が catalog / `log` / front matter を包まない。** 包むと wiki の航行が壊れる。
- **`wk` のスパン濾過が効いている。** `public` ページに埋めた `chapter-organizer` の
  スパンが、そのソースを読めないクラスから `⬛︎⬛︎⬛︎` になること。
  **ここが抜けると、ページを読めるすべてのクラスに機密が平文で見える。**
  権限あり・権限なしを同じテストに並べる（黒塗りが出ないことは、
  権限があるのか濾過が壊れているのか区別が付かない）。
- **`wk write` の再合成が効いている。** 読めなかったスパンがバイト単位で復元されること。
  壊れると、機密が消えるか `⬛︎⬛︎⬛︎` が commit される。**どちらもエラーにならない。**
- **argv allowlist の網。** `cat` / `sed -i` / `$()` / here-doc / パイプが deny されること。
  1 つでも通ると、そこが濾過を迂回する恒久的な穴になる。
- **変更系ツールと未知の `tool_name` が deny される。** パス条件が復活していないこと、
  素通りが名指しの allowlist であること（Stage 05 §2）。
  **戻すと、Write ツール 1 本で argv allowlist と `readBoundary` が同時に無効化される。**
- **`cli-config.json` / `sandbox.json` が root 所有 `0444` である**（Stage 07 §1）。
  可書きに戻ると、1 回の invocation が次回以降のサンドボックスを無効化できる。
- **実行物の相対 import がリポジトリ上と配置後で同じ形である**（Stage 00 §5-§6）。
  ディレクトリを分け直すと、型検査が通ったまま本番で import に失敗する。
- **ゲートに ACL 判定が無く、`wk` に生出力モードが無い**（どちらも grep で固定する）。
- **MCP が既定 deny で `search` だけが通る。** `MCP:` 接頭辞で通す形に戻っていないこと。
  `<workdir>/.cursor/mcp.json` に別サーバを書いても通らないこと。
- **`wk` のパス正規化。** `.gdgwiki/../raw/x` / `pages/../../etc/passwd` /
  clone 内の外向き symlink / clone 外の絶対パスが**すべて拒否**されること。
- **`wk write` が `pages/**/page.md` の allowlist であること。**
- **リポジトリを変更する処理が直列である。** 同時 2 invocation で
  双方のトレースの `reads` が生き残ること。**失われても
  `verify-acl` はクライアント申告なのでサーバ側でも検出できない。**
- **トレースが invocation ごとに分かれている。** 共有ファイルに戻っていないこと。
- **異なる `visibility` の記憶が 1 ページに統合されない。**
- **脅威モデルの語彙が完了条件に一致している。** 各ステージの完了条件が
  「到達できない」ではなく「`preToolUse` が deny する」「uid 分離により読めない」と
  **機構名で**書かれていること。workdir 内側（事故を防ぐ層）と外側（攻撃を防ぐ層）の
  区別が保たれていること — [ADR-004 の脅威モデル](adr.md#脅威モデル)。
- **`afterFileEdit` を使う記述が残っていない。** 使うフックは `preToolUse` 1 本だけで、
  挿入は `wk write` にある。**「保険として残す」も禁止**（挿入が 2 箇所になる）。
- **インデックスの post-filter が漏れない。** 読めないクラスからのクエリで、
  狭い visibility のパスが結果に含まれないこと。
- **`kind: "conversation"` が `/sources` にも `GET /api/sources` にも CLI manifest にも出ない。**
  manifest に出すと `raw pull` が同じ内容を `raw/` に落とし、ローカルの `memories/` と
  合わせて同じ会話ログが 2 回 ingest される。**重複ページができるまで気づけない。**
- **`fetch-source.ts` が `conversation` を fetch しようとしない**（取りに行く先が無い）。

### 手動 E2E

1. テスト用 Discord サーバーを 2 つ用意し、それぞれ別チャプターに束縛する。
2. サーバー A の `#core-staff`（`chapter-organizer` 写像）で会話し、記憶を生成する。
3. サーバー B の `member` クラスのユーザーから、その記憶の内容を質問する →
   **答えられないこと**を確認する。インデックス検索の結果にもパスが出ないことを確認する。
4. サーバー B のユーザーが `cat` / `rg` で該当ファイルを読もうとする →
   `preToolUse` が deny し、`wk read` が案内されることを確認する。
   `wk read` に切り替えても `wk` が拒否することを確認する。
5. サーバー A の organizer が同じ質問をする → 答えられることを確認する。
5a. **サーバー A の全国写像チャンネル（`member`）で、同じ organizer が
   同じ質問をする → 答えられないこと**を確認する（チャンネルの天井）。
   案内が「このチャンネルには出せない」であることを確認する。
6. `organizer` visibility のソースを ingest 中に、`<acl>` 無しでページを `wk write` →
   **書かれた時点でタグが入っており**、commit が通り、push がサーバに拒否されないことを確認する。
6a. `public` ページに `chapter-organizer` のスパンを仕込み、
   `member` クラスで `wk read` → 黒塗りになることを確認する。
   その本文に 1 行足して `wk write` → 通り、スパンが復元されることを確認する。
7. 睡眠を手動起動し、`memories/` が空になり、対応するページが `<acl src>` 付きで
   push されていることを確認する。`/sources` にその source が出ないことを確認する。
7a. 睡眠中にサーバー A から質問を投げ、**リポジトリ変更が直列になり、
   双方のトレースが残る**ことを確認する（Stage 10 §1a）。
8. フック本体を agent uid から `rm` しようとして失敗することを確認する。
   `mcp.json` の上書きも失敗することを確認する。
8a. `<workdir>/.cursor/mcp.json` に別の MCP サーバを手で書き、
   そのツールが deny されることを確認する。
9. ネットワークを落として ingest を実行し、read ゲートは効いたまま
   （fail closed）、commit ゲートは警告だけ出て通る（fail open）ことを確認する。
