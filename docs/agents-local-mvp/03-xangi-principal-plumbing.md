# Stage 03 — xangi principal plumbing and closing default privileges

## Context — 背景とリポジトリ状況

### なぜやるか

xangi には **「ユーザー」という単位が存在しない**。

- セッションのキーは `contextKey` = チャンネル ID（スレッドならスレッド ID）で、
  `SessionEntry`（`src/sessions.ts:27`）に user id のフィールドが無い。
  同じチャンネルの 2 人は 1 つのセッション・1 つの runner・1 つの `--resume` 会話を共有する。
- `RunOptions`（`src/agent-runner.ts:13`）には `channelId` はあるが `userId` / `guildId` が無い。
  発言者は `[発言者: 名前 (ID: …)]` という **散文としてプロンプトに埋まるだけ** で、
  runner にも子プロセスにも構造化されて渡らない。
- `message.member.roles` は `src/` 全体で **0 回** しか参照されておらず、
  `GatewayIntentBits.GuildMembers` も要求していない（`src/index.ts` の Client 生成）。

権限クラスで読み書きを制御する（Stage 04・05）には、まず
**「今この実行は誰の依頼か」を runner まで構造化して運ぶ配管** が要る。

同時に、既定の権限が開いている。`config.ts:291` の
`skipPermissions: process.env.SKIP_PERMISSIONS !== 'false'` は **既定 true** で、
Cursor には `--force --trust` が付く（`src/cursor-cli.ts` のコンストラクタが
`CURSOR_FORCE` / `CURSOR_TRUST_WORKSPACE` を文字列 `'false'` と比較している）。
さらに `!skip` 接頭辞で **許可ユーザーなら誰でも** その場で権限昇格できる。
この 2 つが開いたままでは、後段のハーネスが何を書いても意味を持たない。

### 依存と対象範囲

- 先行ステージ: なし。**Stage 01 / 02 と並行して着手できる。**
- 後続の Stage 04（認可サーバ・IAM）、05（ハーネス）、08（記憶）、10（睡眠）が
  本ステージの `principal` に依存する。
- 対象は `~/proj/xangi`（`Harineko0/xangi` として既にフォーク済み、TypeScript / Node ≥22 / npm）。
  gdgjp モノレポは触らない。
- **権限クラスの「解決」（IAM 設定の読み込み、Discord ロールの写像、ログイン由来との和集合）は
  Stage 04 の担当。ここでは `principal` の器を作り、生の材料
  （`guildId` / `channelId` / `userId` / `roleIds`）を運ぶところまで。**

### 読むべきもの

- `~/proj/xangi/README.md`, `~/proj/xangi/.env.example`
- `docs/agents-local-mvp/index.md` §1「権限クラス」§2「xangi フォーク」
- `~/proj/xangi/src/backend-resolver.ts` — `resolve(channelId, requestDefault)`。
  **「文脈 → 実効ポリシー」の解決器としてすでに存在する。Stage 04 はこれを手本にする**

### 再利用する既存実装（書き直さない）

- `src/discord/message-handler.ts` の `processPrompt`（`:206`）
  — Discord のすべてのターンが通る funnel。呼び出し元は MessageCreate（`:986` 付近）と
  Web ブリッジ（`:1054` 付近）の 2 箇所だけ
- `src/dynamic-runner.ts` の `run`（`:178`）/ `runStream`（`:198`）
  — **Discord / Slack / Telegram / LINE / Web / スケジューラ / トリガの全経路** が通る choke point
- `src/discord/thread-context.ts` の `resolveConversationChannelId`
  — スレッドと親チャンネルの解決。**自前で書き直さない**
- `src/sessions.ts` の `ensureSession` / `SessionEntry` / `activeByContext`
- `src/runner-manager.ts:70` `getOrCreateRunner(channelId)` — LRU プール
- `src/cli-process.ts` の `buildCliEnv(channelId, platform)` — 子プロセス env の組み立て
- `src/safe-env.ts` の `ALLOWED_ENV_KEYS` — **よくできた既存の境界。壊さない**

---

## Design — 設計

### 1. `Principal` 型

`src/principal.ts`（新規）に置く。

```ts
export interface PermissionClass {
  chapterId: string;              // accounts の chapter id
  role: "organizer" | "member";
}

export interface Principal {
  // xangi の既存 ChatPlatform（discord | slack | web | line | telegram）+ scheduler。
  // union を xangi 側と別に定義しない。
  platform: ChatPlatform | "scheduler";
  guildId: string | null;
  channelId: string;
  parentChannelId: string | null; // スレッドのとき親
  userId: string;
  roleIds: readonly string[];     // Discord のロール ID。他プラットフォームでは空
  classes: readonly PermissionClass[];  // Stage 04 が埋める。本ステージでは空配列
  channelAudience: SourceAudienceKey | null;  // Stage 04 が埋める。第 2 の認可制約
  nonce: string | null;           // Stage 04 が埋める
}
```

`classes` / `channelAudience` / `nonce` は本ステージでは常に空 / null でよい。
**器と配管だけを通す。**

**`platform` の union を自前で書き直さない。** `~/proj/xangi/src/line.ts` と
`src/telegram.ts` は実在し、`prompts/xangi-commands.ts` の `ChatPlatform` は
`line` / `telegram` を含む。この 2 経路も §2 の choke point
（`dynamic-runner.ts` の `run` / `runStream`）を通るので、
**union から落とすと `Principal` を組めず、その 2 プラットフォームが即座に落ちる。**

**落ちるのが正しい既定ではない — 拒否されるのが正しい既定である。**
LINE / Telegram には guild という概念が無く IAM の写像も無いので、
`classes` は空になり、Stage 04 の「保有が空なら実行しない」でそのまま拒否される。
**「空 = 制限なし」に反転させない**（§制約）。

`channelAudience` は「この invocation の答えが到達しうる範囲」の上限であり、
**`classes` とは別の制約である**（クラス集合では表現できない。Stage 04 §2-2）。
型は `@gdgjp/gdg-lib/acl` の `SourceAudienceKey` を借りる（xangi 側で再定義しない）。

### 2. `RunOptions` に載せる

`src/agent-runner.ts:13` の `RunOptions` に `principal?: Principal` を追加する。

- `src/dynamic-runner.ts` の `run` / `runStream` で **`principal` が無い呼び出しを拒否する**
  （`throw new Error('principal required')`）。ここが全経路の choke point なので、
  1 箇所でも埋め忘れると即座に落ちて気づける。
  **例外は作らない。** スケジューラも Web も `platform: "scheduler"` / `"web"` の
  `Principal` を組み立てて渡す。
- `injectResolvedFields` / `dropMismatchedProviderSession` は `principal` を素通しする。

### 3. Discord 側で組み立てる

- `src/index.ts` の `Client` 生成に `GatewayIntentBits.GuildMembers` を追加する。
  Discord 開発者ポータルで **Server Members Intent を有効化する必要がある**
  （`MessageContent` と同じ privileged intent）。README とセットアップ手順に明記する。
- `src/discord/principal.ts`（新規）に `buildDiscordPrincipal(message | interaction)` を置く。
  - `roleIds` は `message.member?.roles.cache.map(r => r.id)` から取る。
    `message.member` が null のときは `guild.members.fetch(userId)` にフォールバックする。
    **fetch にも失敗したら `roleIds: []` にして続行する**（空 = 権限なし、fail closed）。
  - `parentChannelId` は既存のスレッド判定（`threadCh.isThread?.() ? threadCh.parentId : null`）
    をそのまま使う。
- `processPrompt` のシグネチャに `principal: Principal` を足す。
  `skipPermissions: boolean` の位置引数は **削除する**（§5 で常に false になるため）。
  呼び出し元 2 箇所を更新する。
- スラッシュコマンド経路（`src/discord/slash-commands.ts`）も同じ `Principal` を組み立てる。

### 4. セッションと runner プールの再キー

**同じチャンネルで権限クラスの違う 2 人が同じ runner を共有してはいけない。**
Cursor バックエンドは 1 メッセージ 1 プロセスの one-shot なのでプロセス自体の混線は無いが、
`--resume` される provider session は共有されるため、
**前のターンの機密な文脈が次のターンに漏れる**。

`classKey(principal)` を `src/principal.ts` に置く。
`classes` を `chapterId:role` に整形し、ソートして `|` で連結した安定文字列。
`classes` が空なら `"anon"`。

以下 4 箇所のキーを `channelId` から `${channelId}#${classKey}` にする。

| 箇所 | 現在のキー |
|---|---|
| `src/sessions.ts` の `contextKey` | `conversationChannelId` |
| `src/runner-manager.ts:70` の LRU プール | `channelId` |
| `src/dynamic-runner.ts` の `channelRunners` | `channelId` |
| `src/discord/message-handler.ts` の `processingRuns`（実行中ミューテックス） | `channelId` |

**`settingsChannelId` は再キーしない。** per-channel の backend / model 設定は
権限クラスで分ける必要がなく、分けると `/model` の設定が人によって効いたり効かなかったりする。

`src/backend-resolver.ts` の `resolve(settingsChannelId, …)` も現状のままでよい。

### 5. 既定の権限を閉じる

- `src/config.ts:291` を `skipPermissions: process.env.SKIP_PERMISSIONS === 'true'` に反転する
  （既定 false）。コメントも「既定で無効。有効化は明示的な env でのみ」に書き換える。
- `src/discord/message-handler.ts` の `!skip` 接頭辞の分岐（`:905` 付近）を **削除する**。
  プロンプトから `!skip` を剥がす `replace` も消す。
  併せて `:264-267` の `needsSkipRunner` /
  `new ClaudeCodeRunner(config.agent.config)` の分岐も消える。

#### `/skip` スラッシュコマンドも消す — **接頭辞だけでは足りない**

`!skip` は昇格経路の 1 つでしかない。`skipPermissions: true` を**強制的に**立てる箇所は
ソースツリーに **3 つ**あり、うち 2 つはスラッシュコマンドである。

| 場所 | 何をしているか |
|---|---|
| `src/discord/message-handler.ts:905-908` | `!skip` 接頭辞 |
| `src/discord/slash-commands.ts:207` / `:1160-1211` | **`/skip` スラッシュコマンド** |
| `src/web-slash-commands.ts:607-611` | **`/skip` の Web 版** |

- `src/discord/slash-commands.ts` — `.setName('skip')` のコマンド定義（`:207` 付近）と、
  `interaction.commandName === 'skip'` のハンドラ（`:1160-1211`）を**まるごと削除する**。
- `src/web-slash-commands.ts` — `case 'skip':`（`:607-611`）を削除し、
  結果型（`:330`）の `skipPermissions?: boolean` フィールドも消す。
  `src/web-chat.ts:2251` の `body.skipPermissions` の受け渡しも消す。

**Discord の `/skip` は単なる別 UI ではない。** ハンドラは

```ts
const skipRunner = new ClaudeCodeRunner(config.agent.config);
const runResult = await skipRunner.run(skipMessage, { skipPermissions: true, … });
```

と**その場で runner を直接構築する**。つまり `DynamicRunnerManager.run` を通らない —
本ステージが `principal` を必須化する当の絞り込み点を迂回する。
`principal` を必須にしただけでは、この経路は**無権限のまま素通りし続ける。**

`src/slack.ts` / `src/discord/scheduler-bridge.ts` にも `skipPermissions` は現れるが、
どちらも `config.agent.config.skipPermissions ?? false` を読んでいるだけで、
`true` を強制していない。**既定を反転すれば自動的に閉じるので、削除は不要。**
- `src/cursor-cli.ts` のコンストラクタで `this.force` / `this.trustWorkspace` を
  `process.env.CURSOR_FORCE === 'true'` / `process.env.CURSOR_TRUST_WORKSPACE === 'true'`
  に反転する（既定 false）。
- **`CursorRunner` が `options.skipPermissions` を見ていない既存のギャップを塞ぐ。**
  `RunOptions.skipPermissions` は型に存在するのに `buildBaseArgs` が参照しておらず、
  コンストラクタ時点の env だけで決まっている。`buildBaseArgs(options)` の中で
  `this.force || options?.skipPermissions === true` を評価する形にする。
- `--force` を渡さない状態で Cursor の `approvalMode` は `"allowlist"` になる。
  **`cli-config.json` の `permissions.allow` に、ingest に必要な最小限だけを入れる**
  （具体的な内容は Stage 05 / 07 の担当。ここでは「`--force` を渡さない」ことだけ確定させる）。

### 制約

- **`principal` を optional のまま運用しない。** `DynamicRunnerManager.run`/`runStream` で
  必須にする。optional にすると埋め忘れた経路が黙って無権限で通る。
- **`roleIds` の取得に失敗したら空配列にする。** 「取れなかったから全部許可」に倒さない。
- **`settingsChannelId` を再キーしない。** backend / model 設定は権限と無関係。
- **`ALLOWED_ENV_KEYS`（`src/safe-env.ts`）にシークレットを足さない。**
  この allowlist は既存のよくできた境界であり、緩めない。
- **`!skip` を「organizer だけ有効」のような形で残さない。** 完全に削除する。
  権限昇格の抜け道を 1 つでも残すと、多チャプター共有では必ず使われる。
  **`/skip` スラッシュコマンド（Discord・Web の 2 つ）も同じ扱いである。**
  接頭辞だけ消してコマンドを残すと、UI が変わっただけで昇格は残る。
- **runner を直接構築する呼び出し元を新たに作らない。** `AgentRunner` の実体を
  `new` してよいのは `src/agent-runner.ts` のファクトリと
  `src/runner-manager.ts` のプールだけである。
  それ以外の場所で `new ClaudeCodeRunner(...)` / `new CursorRunner(...)` を書くと、
  `DynamicRunnerManager.run` の `principal` 必須化を**構造的に迂回できる**。
  `/skip` のハンドラがまさにそれをしていた。
- `dist/` はコミット済みだが **stale**。`src/` だけを読み、`dist/` は無視する。
- 既存のテスト（`tests/`、vitest 142 本）を壊さない。
  `processPrompt` のシグネチャ変更でスタブの更新が必要になる。
- eslint + prettier。husky が commit 時に全 vitest と `tsc --noEmit` を走らせる。

---

## Files to touch — 変更ファイル

すべて `~/proj/xangi` 配下。

- `src/principal.ts`（新規）— `Principal` / `PermissionClass` / `classKey`
- `src/discord/principal.ts`（新規）— `buildDiscordPrincipal`
- `src/agent-runner.ts` — `RunOptions.principal`
- `src/dynamic-runner.ts` — `run` / `runStream` で必須化、`channelRunners` の再キー
- `src/runner-manager.ts` — プールキーの再キー
- `src/sessions.ts` — `contextKey` の再キー、`SessionEntry` に `classKey` を記録
- `src/index.ts` — `GatewayIntentBits.GuildMembers` 追加
- `src/discord/message-handler.ts` — `processPrompt` シグネチャ、`principal` 組み立て、
  `!skip` 削除、`processingRuns` の再キー
- `src/discord/slash-commands.ts` — `principal` 組み立て、**`/skip` コマンドの定義と
  ハンドラの削除**（`:207`、`:1160-1211`）
- `src/web-slash-commands.ts` — **`case 'skip'` の削除**（`:607-611`）と、
  結果型の `skipPermissions` フィールド削除（`:330`）
- `src/web-chat.ts` — `body.skipPermissions` の受け渡し削除（`:2251`）
- `src/config.ts` — `skipPermissions` の既定反転
- `src/cursor-cli.ts` — `force` / `trustWorkspace` の既定反転、`options.skipPermissions` の反映
- `src/web-chat.ts`, `src/slack.ts`, `src/telegram.ts`, `src/line.ts`,
  `src/scheduler/*` — `Principal` の組み立て（必須化により全経路の更新が要る）
- `tests/` — 既存スタブの更新、`principal` 必須化と再キーのテスト追加
- `README.md`, `.env.example` — Server Members Intent の有効化手順、既定変更の記載

---

## Verification — 完了条件と検証

### 完了条件

1. `principal` を渡さずに `DynamicRunnerManager.run` を呼ぶと例外になる。
2. Discord のメッセージから `guildId` / `channelId` / `userId` / `roleIds` が
   `RunOptions.principal` に載って runner まで届く。
3. 同じチャンネルで `classKey` の異なる 2 つの `principal` が、
   **別のセッション・別の runner・別のミューテックス** を使う。
3a. `Principal` に `channelId` と `parentChannelId` が載っており、
   Stage 04 がチャンネル audience との交差を計算するのに足りている。
   **セッション分離だけでは回答の到達範囲を絞れない**（投稿先チャンネルは同じ）ため、
   実効クラスの決定は Stage 04 の責務である — 本ステージは器を通すところまで。
4. `SKIP_PERMISSIONS` 未設定で `cursor-agent` に `--force` も `--trust` も渡らない。
5. **昇格経路が 1 つも残っていない。** `!skip` 接頭辞、Discord の `/skip`、
   Web の `/skip` の 3 つがソースツリーから消えている。
5a. **`skipPermissions: true` をリテラルで渡している箇所が 0 件。**
   残る参照はすべて `config.agent.config.skipPermissions ?? false` 経由である。
5b. **runner を直接構築しているのが `agent-runner.ts` と `runner-manager.ts` だけ。**
   `/skip` のハンドラは grep をすり抜けたので、**テストで固定する**（下記）。
6. 既存の 142 本の vitest が通る。

### コマンド

```bash
cd ~/proj/xangi && npm test
```

```bash
cd ~/proj/xangi && npx tsc --noEmit
```

```bash
cd ~/proj/xangi && npm run lint
```

```bash
cd ~/proj/xangi && grep -rn "!skip\|CURSOR_FORCE\|SKIP_PERMISSIONS" src/
```

```bash
cd ~/proj/xangi && grep -rn "skipPermissions: true\|setName('skip')\|commandName === 'skip'\|case 'skip'" src/
```

```bash
cd ~/proj/xangi && grep -rn "new ClaudeCodeRunner\|new CursorRunner\|new CodexRunner\|new PersistentRunner" src/
```

**1 本目の grep だけでは `/skip` を検出できない。** 実際にこの見落としが起きた —
`!skip` を対象にした grep はスラッシュコマンドに一致しない。
2 本目と 3 本目を必ず併せて走らせる。
3 本目の結果が `agent-runner.ts` と `runner-manager.ts` の 2 ファイルに収まっていること。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`principal` の必須性。** `run` / `runStream` が `principal` 無しで例外を投げること。
  optional に戻ると、埋め忘れた経路が無権限で静かに通る。
- **`classKey` が異なると runner とセッションが分かれる。** ここが崩れると、
  organizer の会話文脈が `--resume` 経由で member のターンに引き継がれる。
  **画面上はまったく正常に見える。**
- **`classKey` が同じなら runner が再利用される。** 分かれすぎるとプロセスが増え、
  `MAX_PROCESSES` の LRU で有用なセッションが落ちる。
- **`roleIds` の取得失敗が空配列になる。** 例外で握りつぶして
  「ロール不明 = 制限なし」に倒れないこと。
- **`skipPermissions` の既定が false。** env 未設定で `--force` が付かないこと。
  ここが反転すると、後段のハーネスが全部無意味になる。
- **runner を直接構築する経路が無い。** `AgentRunner` の実体が生成されるのは
  `agent-runner.ts` のファクトリと `runner-manager.ts` のプールだけであること。
  **grep ではなくテストで固定する** — `/skip` のハンドラは
  `!skip` を対象にした grep をすり抜けて生き残っていた。
  ここが緩むと、`principal` を必須にした意味が経路 1 本ぶん消える。
  **その経路は成功時にまったく正常に動くので、気づけない。**
- **`/skip` が「不明なコマンド」になる。** Discord と Web の両方で、
  `/skip` が特別扱いされずエラーになること。
  片方だけ消すと、もう片方が昇格経路として残る。
- **`options.skipPermissions` が `CursorRunner` に効く。** 型にあるのに無視されていた
  既存のギャップを塞いだことを固定する。
- **`settingsChannelId` が再キーされていない。** `/model` 設定が権限クラスごとに
  バラバラにならないこと。

### 手動 E2E

1. テスト用 Discord サーバーで、Server Members Intent を有効にした bot を起動する。
2. `@bot` にメンションし、ログに `guildId` / `channelId` / `userId` / `roleIds` が
   出ることを確認する。
3. 同じチャンネルで、異なるロールを持つ 2 アカウントから続けて質問する。
   `sessions.json` に **2 つの別セッション** ができることを確認する。
4. 一方のセッションで「さっき何を話した?」と聞き、
   **もう一方の会話が引き継がれていない** ことを確認する。
4a. ただしこの時点では**両方の回答が同じチャンネルに投稿される**ことも確認する。
   セッション分離は文脈の混線を防ぐだけで、到達範囲は絞らない。
   到達範囲を絞るのは Stage 04 の実効クラス（保有 ∩ チャンネル audience）である。
5. `SKIP_PERMISSIONS` を未設定にして `ps aux | grep cursor-agent` を確認し、
   `--force` / `--trust` が付いていないことを確認する。
6. `!skip 何か` と送り、`!skip` が特別扱いされず**そのまま本文として扱われる**ことを確認する。
7. Discord のコマンド一覧に **`/skip` が出ていない**ことを確認する。
   出ている場合はコマンド定義の削除がギルドに反映されていない
   （再登録が要る）。Web UI でも `/skip` がエラーになることを確認する。
