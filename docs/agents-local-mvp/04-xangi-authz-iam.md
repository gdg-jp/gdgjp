# Stage 04 — xangi authorization server and Discord IAM

## Context — 背景とリポジトリ状況

### なぜやるか

Stage 03 で `Principal` が runner まで届くようになったが、`classes` はまだ空である。
このステージで 2 つを作る。

1. **権限クラスの解決** — Discord のロールと GDG アカウントのクレームから
   `PermissionClass[]` を決める。
2. **偽装耐性のある受け渡し** — フック（Stage 05）とインデックスサーバ（Stage 09）に
   「今この実行は誰の依頼か」を伝える。

2 が難しい。エージェントは shell を持つ（設計判断として残すと決めた）ので、
環境変数やファイルで権限クラスを渡すと `XANGI_ACTOR_CLASS=admin node ...` で偽装できる。
**「エージェントが自分の権限を宣言する」形にしてはいけない。**

現在 xangi にある認可は `DISCORD_ALLOWED_USER`（ユーザー ID の CSV、`*` 可）を
`src/discord/message-handler.ts` と `src/discord/slash-commands.ts` の 3 箇所で
インライン照合しているだけである。ロールもチャンネルもギルドも見ていない。

### 依存と対象範囲

- **先行ステージ: Stage 03（`Principal` の配管）。**
- 後続の Stage 05（ハーネス）、08（記憶）、09（インデックス）、10（睡眠）が
  本ステージの認可サーバと IAM 設定を使う。
- 対象は `~/proj/xangi` のみ。
- **フックの判定ロジックは Stage 05 の担当。ここでは「nonce → 権限クラス」を返す
  サーバまで。**
- **uid 分離とファイル所有権の実施は Stage 07 の担当。**
  ここでは「IAM 設定を `ALLOWED_ENV_KEYS` に載せない」という設計上の分離まで。

### この設計が置く前提（明示する）

**すべての GDG organizer は相互に信頼する。**
`guild → chapter` の束縛も、その内側の `roleId → (chapter, role)` 写像も、
**いずれかのチャプターで `role === "organizer"` を持つユーザーなら誰でも** 設定できる。
どのサーバーがどのチャプターに対応するかを機械的に厳密化できないための緩和である。
権限クラスの合成が **和集合** であることと合わせると、
この前提が崩れた場合の被害範囲は全チャプターに及ぶ。README に明記する。

### 読むべきもの

- `docs/agents-local-mvp/index.md` §1「権限クラス」§3「IAM 設定」
- `docs/plans/09-source-visibility-acl.md` — `SourceVisibility` の 5 値
- `~/proj/xangi/src/backend-resolver.ts` — **文脈 → 実効ポリシー解決器の手本**。
  3 層の優先順位、`config-validate.ts` による検証、`.env` 永続化
- `~/proj/xangi/src/settings.ts` — normalize-on-load パターンの手本

### 再利用する既存実装（書き直さない）

- `src/principal.ts`（Stage 03 で新設）— `Principal` / `PermissionClass` / `classKey`
- `src/backend-resolver.ts` の `resolve` と `src/config-validate.ts` の
  `validateChannelOverrides` — 構造化設定の検証パターン
- `src/settings.ts:42` 付近の `normalizeDiscordBooleanChannels` — 正規化の書き方
- `src/tool-server.ts` — ローカル HTTP サーバの雛形（`server.listen`、
  `authorization` ヘッダ検査）。**ただしバインド先は `0.0.0.0` ではなく UNIX ソケットにする**
- `src/setup/schema.ts` の `ALLOWED_KEYS` — 閉じたスキーマ検証の手本
- `src/safe-env.ts` の `ALLOWED_ENV_KEYS`
- `gdg-lib/src/acl`（Stage 01）— `SourceVisibility` の語彙をここから借りる。
  xangi 側で 5 値を再定義しない

---

## Design — 設計

### 1. IAM 設定

保存先は **エージェントの uid から読めない場所**（実施は Stage 07）。
`resolveAppLayout`（`src/installer/layout.ts`）が返す config ディレクトリの隣に
`iam.json` を新設する（Linux: `$XDG_CONFIG_HOME/xangi/iam.json`）。

`src/setup/store.ts` と同じ作法（atomic write、mode `0600`）で読み書きする。

```jsonc
{
  "version": 1,
  "guilds": {
    "<guildId>": {
      "chapterId": "<accounts chapter id>",
      "boundBy": "<GDG user id>",
      "boundAt": "<ISO8601>",
      "roles": {
        "<roleId>": { "chapterId": "…", "role": "organizer" }
      },
      "channels": {
        "<channelId>": { "visibility": "chapter-organizer", "chapterId": "…" }
      }
    }
  }
}
```

- `chapterId` は **accounts のチャプター ID**。wiki のローカル `chapters` テーブルは
  同期されていないので参照しない（`wiki/migrations/0056_drop_sources_chapter_fk.sql` の先例）。
- `roles` に無いロールは何も与えない。
- `channels` に無いチャンネルは `{ visibility: "chapter-organizer", chapterId: <guild の chapterId> }`
  にフォールバックする（**未設定は最も狭く**）。
- 読み込み時に normalize + 検証する。未知のキー・未知の `role`・
  未知の `visibility`（`gdg-lib` の `isSourceVisibility` で判定）は **その項目だけ捨てる**。
  ファイル全体を無効化しない（1 ギルドの設定ミスで全体が止まると運用できない）。

`~/.config/xangi/iam.json` のパスを **`ALLOWED_ENV_KEYS` に載せない。**
子プロセスがこのファイルの場所を知る手段を与えない。

### 2. 権限クラスの解決

`src/iam.ts`（新規）に置く。

```ts
export function resolveClassesFromRoles(iam: IamConfig, guildId: string, roleIds: readonly string[]): PermissionClass[];
export async function resolveClassesFromAccount(discordUserId: string): Promise<PermissionClass[]>;
export function unionClasses(a: readonly PermissionClass[], b: readonly PermissionClass[]): PermissionClass[];
export function resolveMemoryVisibility(iam: IamConfig, guildId: string, channelId: string, parentChannelId: string | null): { visibility: SourceVisibility; chapterId: string } | null;

/** チャンネル写像の visibility（＝そのチャンネルのポリシー）を引く。 */
export function channelPolicy(iam: IamConfig, guildId: string, channelId: string, parentChannelId: string | null): { visibility: SourceVisibility; chapterId: string };

/** チャンネルのポリシーを保有クラスに適用する。ADR-002 の実効クラス。 */
export function applyChannelPolicy(held: readonly PermissionClass[], policy: { visibility: SourceVisibility; chapterId: string }): PermissionClass[];

/** ポリシーを audience key にする。第 2 の認可制約（§2-2）。 */
export function channelAudienceOf(policy: { visibility: SourceVisibility; chapterId: string }): SourceAudienceKey | null;
```

- `resolveClassesFromRoles` — `roleIds` を `iam.guilds[guildId].roles` で写像する。
- `resolveClassesFromAccount` — Discord user id にリンクされた GDG アカウントの
  `chapters` クレームを引く（リンク機構は §4）。
- **`unionClasses` で和集合をとる。** 同じ `chapterId` に `organizer` と `member` が
  来たら `organizer` を採る（同一チャプター内は全順序なので比較してよい）。
  **異なる `chapterId` 同士は比較しない** — 5 値の visibility と同じく、
  チャプターを跨いだ大小関係は定義されない。
- `resolveMemoryVisibility` — チャンネル写像。スレッドは `parentChannelId` を継承する。
  **guild が未束縛なら `null` を返す**（戻り値型に `| null` が要る）。
  呼び出し側が記憶の書き出しを見送る（Stage 08）。
  **`null` を「既定の可視性」で埋めない** — 未束縛 guild の会話に
  チャプターを割り当てることになる。

#### 2-1. 実効クラス = 保有クラスにチャンネルのポリシーを適用したもの

`Principal.classes` に入れるのは**和集合そのものではなく、チャンネル写像で抑えたもの**である
（[ADR-002](adr.md#adr-002-権限の単位をユーザーではなく権限クラスにする)）。

**理由: セッションを分けても投稿先チャンネルは分かれない。**`contextKey` を
`channelId#classKey` にしても、organizer セッションの回答は同じチャンネルに投稿され、
そこに居る member の目に入る。読める範囲をチャンネルの audience で抑えるしか閉じ方がない。

```ts
const held      = unionClasses(fromRoles, fromAccount);        // その人が何を持つか
const policy    = channelPolicy(iam, guildId, channelId, parentChannelId);
const effective = applyChannelPolicy(held, policy);            // この場に出してよいもの
const audience  = channelAudienceOf(policy);                   // 天井（§2-2）。null なら実行しない
```

`applyChannelPolicy` の規則（ポリシーは `resolveMemoryVisibility` と**同じ写像を読む**）:

**ポリシーは 2 つのことを同時に行う — チャプターで絞り、ロールを上限で丸める。**
**ただし全国 2 行（`organizer` / `member`）ではチャプターを絞れない。**
天井の残り半分は §2-2 の `channelAudience` が担う。

| チャンネル写像の `visibility` | 実効クラス |
|---|---|
| `chapter-organizer` + `chapterId: C` | 保有のうち `chapterId === C` かつ `role === "organizer"` |
| `chapter-member` + `chapterId: C` | 保有のうち `chapterId === C`。**`role` は `member` に丸める** |
| `organizer` | 保有のうち `role === "organizer"` のもの**全部**（チャプターを絞らない） |
| `member` | **保有クラス全部。`role` は `member` に丸める** |
| `private` | 空集合（そのチャンネルではエージェントを使えない） |
| 未設定 | `chapter-organizer` + guild の `chapterId` にフォールバック |

- **ポリシーを保有クラスに直接適用する。「audience の集合を先に列挙して交差をとる」形にしない。**
  全国 audience（`organizer` / `member`）を「束縛済み全チャプター」から列挙すると、
  **IAM に guild が束縛されていないチャプターのクラスが消える。**
  大阪の Discord サーバーがまだ無いというだけで、
  アカウント由来の正当な `{osaka, member}` が `#announce`（`member` 写像）で落ちる。
  ギルドの束縛状況は**その人が何を持つかとは無関係**である。
- **`SourceVisibility` を大小比較しない** — 5 値は全順序ではなく、
  `chapter-member:tokyo` と `chapter-member:osaka` は比較不能
  （`docs/plans/10-page-acl-spans.md` §0）。上の表はポリシーごとの
  **述語**であって、値の大小ではない。
- **ロールの丸めを落とさない。** 同一チャプター内のロールだけは全順序なので
  丸めてよい（`unionClasses` が `organizer` を採るのと同じ根拠を逆向きに使う）。
  丸めを落とすと、`chapter-member` 写像のチャンネルで organizer が質問したときに
  `{C, organizer}` が残り、**organizer 限定の材料を読んだ回答が、
  同じチャンネルに居る member の目に入る。**
  これは ADR-002 が「チャンネル単位」案を却下した理由そのものである。
- **丸めはロールにだけ効く。チャプターを跨いだ丸めはしない。**
  `{tokyo, organizer}` を `{osaka, member}` に変換するような操作は定義されない。

#### 2-2. クラス集合だけではチャンネルの天井を表現できない

**上の表の全国 2 行は、チャプターの天井を表現していない。**
`member` 写像のチャンネルで、東京メンバー兼大阪メンバーの実効クラスは
`[{tokyo, member}, {osaka, member}]` になる。
これを `canClassesAccessSource` に渡すと、`chapter-member` + `tokyo` のソースは**通る**。
その回答は全国チャンネルに投稿され、**東京に属さないメンバーの目に入る。**
`organizer` 写像と `chapter-organizer` + C の組でも同じである。

**これは表の書き方の問題ではない。** チャプターを絞れば
未束縛チャプターの保有クラスが落ちる（上の 1 つ目の項目）ので、
`PermissionClass[]` はこの 2 つを同時に満たせない。
[ADR-002](adr.md#adr-002-権限の単位をユーザーではなく権限クラスにする) が当初書いた
「audience を `PermissionClass` 集合に変換して交差する」形でも同じ穴が残る
（`member` 写像 → 束縛済み全チャプター × member → 保有と交差 → `{tokyo, member}` が生き残る）。

**したがってチャンネル audience を、クラス集合とは別の第 2 の制約として持ち回る。**

- `Principal` に `channelAudience: SourceAudienceKey` を持たせる。
  値は `channelPolicy` が返す `{ visibility, chapterId }` を
  `@gdgjp/gdg-lib/acl` の `sourceAudienceKey` で key 化したものである。
  **`resolveMemoryVisibility` と同じ写像から作る**（既存の不変条件をそのまま使う）。
- **`applyChannelPolicy` は残す。** ロールの丸めとチャプター写像のチャンネルでの絞りは
  そのまま正しく効く。天井の残り半分を `channelAudience` が閉じる。
- エージェント側の判定は **2 つの制約の AND** になる
  （`canClassesAccessSourceInChannel` / `canClassesSeePageInChannel`、Stage 01 §5-4）。
  適用点は `wk`（Stage 11）とインデックス（Stage 09）である。
- **運用上の帰結**: 全国写像（`member` / `organizer`）のチャンネルでは、
  チャプター限定の材料に到達できない。チャプターの話はチャプター写像のチャンネルで訊く。
  `/iam channel` の応答と `/whoami` にこれを書く。

`classes`（＝実効クラス）が空なら `processPrompt` を実行せず、
理由に応じた返信だけを返す:

- 保有が空 → `/login` と IAM 設定を促す
- 保有はあるが交差が空 → 「このチャンネルではあなたの権限で使えない」と、
  どのチャンネルなら使えるかを案内する

### 3. 認可サーバと nonce

`src/authz-server.ts`（新規）。

- **UNIX ドメインソケット** で待ち受ける（`0.0.0.0` にバインドしない）。
  **スロットごとに別のソケットを開く** — パスは `/run/gdg-agent/<slot>/authz.sock`、
  mode `0660`、所有 `gdgagent-svc:gdgagent-run-<N>`（uid プールと配置は Stage 07）。
  `<stateDir>/authz.sock` に置かない。**あそこは `0700` のサービス専有ディレクトリの中で、
  エージェント uid が通り抜けられない。**
- invocation ごとに **短命・invocation スコープの nonce** を発行する。
  `crypto.randomUUID()` を 2 つ連結した程度の長さ、メモリ上の `Map<nonce, entry>`。
  **「ワンタイム」と呼ばない。** フックはツールコールごとに引くので、一度きりではない。
  一度きりなのは **invocation** であって、解決回数ではない。
- `entry = { classes, channelAudience, guildId, channelId, slot, expiresAt, revoked }`。
  TTL は invocation のタイムアウト（既定 `DEFAULT_TIMEOUT_MS`）+ 60 秒。
  **`channelAudience` を省略可能にしない**（§2-2）。
  欠けた entry を発行できると、`wk` とインデックスが天井なしで走る。
- **`entry.slot` と、リクエストが到着したソケットのスロットが一致しない解決を拒否する。**
  これが [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) の実体である。
- invocation 終了時に `revoke(nonce)` する。プロセス再起動で全部消えてよい
  （ディスクに永続化しない）。
- API は 1 本だけ:

```
GET /resolve?nonce=<nonce>
→ 200 { classes: [{chapterId, role}], channelAudience, guildId, channelId }
→ 404 { error: "unknown_or_expired" }
```

- **nonce から引けるのは「その invocation の本当のクラスと本当のチャンネル audience」だけ。**
  API に任意のクラスや任意の audience を指定する口を開けない。
- **`channelAudience` を常に返す。** 消費側（`wk`・インデックス）は、
  欠けていたら fail closed で止まる（Stage 11 §3、Stage 09 §4）。

**ただし「盗んでも昇格できない」は成り立たない。**
[ADR-005](adr.md#adr-005-エージェントに-shell-を残す) はそう書いたが、
盗む側が**別の invocation**なら、得られるのは自分より広い他人のクラスである。
単一 uid では同時に走る 2 つの agent が互いの `/proc/<pid>/environ` を読めるので、
`#main` の `member` が organizer invocation の nonce を解決できてしまう。
これを塞ぐのは nonce の性質ではなく **uid とソケットの分離**である
（[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)、実装は Stage 07）。

#### nonce を環境変数で渡す前提の 2 つの穴

**どちらも配管の形の問題であり、Stage 07 の uid 分離では塞がらない。**

- **常駐プロセスは env を作り直さない。** `PersistentRunner.ensureProcess()` は
  生存中の子プロセスをそのまま返し、`buildEnv()` は spawn 時にしか走らない
  （`~/proj/xangi/src/persistent-runner.ts:169,268`）。
  **2 ターン目は 1 ターン目の失効済み nonce を持ったまま動き、フックが fail closed で全部 deny する。**
  → **agents-local の経路では `PersistentRunner` を使わない。**
  `CliRunnerBase` の one-shot spawn（`src/cli-runner-core.ts:180,236`）だけを使う。
  `CursorRunner` は元から one-shot なので、これは「そのままにする」ことの明文化である。
- **`buildCliEnv` に nonce を渡す口が無い。** 現在の署名は
  `buildCliEnv(channelId?, platform?)` で、値は `getSafeEnv()`＝**親の `process.env`** から作る
  （`src/cli-process.ts:8`）。invocation ごとに変わる値を運べない。
  → **署名を `buildCliEnv(channelId?, platform?, authz?: { nonce: string; socket: string })` にする。**
  `ALLOWED_ENV_KEYS` への追加だけでは足りない — あの allowlist は
  「親の env のどれを子に渡すか」であって、生成した値を入れる場所ではない。
- レート制限を入れる（同一 nonce で 1 秒あたり 50 回まで）。
  フックは 1 ツールコールにつき 1 回引く想定なので十分広い。

**`ALLOWED_ENV_KEYS` には追加しない。**あの allowlist は
「親の `process.env` のどれを子に渡すか」であって、invocation ごとの値を入れる場所ではない
（上の 2 つ目の穴）。載せると、**親に残った古い値が、明示指定の無い経路で子に流れる。**
そちらは前の invocation のものなので、フックはそれを解決して
**前の依頼者のクラスで判定する**（失効後なら fail closed で止まるが、
TTL 内に次の invocation が始まれば止まらない）。

受け渡しは `src/cli-process.ts` の `buildCliEnv` の第 3 引数**だけ**にする。
`sudo` を跨いだ受け渡しは Stage 07 §3 の固定ランチャが担う
（`env_reset` があるので、環境変数をそのまま渡しても落ちる）。

### 4. Discord ↔ GDG アカウントのリンク

accounts には Discord の概念が **一切ない**（`grep -rni discord accounts/` が 0 件）。
新規に IdP を改造せず、**既存の device code フローを使う**。

- `/login` スラッシュコマンドで、`gdg-cli` と同じ RFC 8628 device authorization を開始する
  （`accounts/migrations/0020_add_gdg_cli_device_grant.sql` で `gdg-cli` クライアントに
  device grant が付いている）。ユーザーコードを DM ではなく **ephemeral 返信** で見せる。
- 取得したトークンから `/api/auth/oauth2/userinfo` を引き、
  `sub` と `https://gdgs.jp/claims/chapters` を保存する。
- 保存先は `iam.json` と同じディレクトリの `links.json`（mode `0600`、
  `ALLOWED_ENV_KEYS` に載せない）。`{ discordUserId: { sub, chapters, refreshToken, expiresAt } }`。
- **refresh token は暗号化して保存する。** 鍵は xangi の設定ディレクトリに置く。
- `chapters` はトークン更新のたびに引き直す。キャッシュ TTL は 5 分。
  **claims の取得に失敗したら空配列** にする（fail closed）。

### 5. スラッシュコマンド

`src/discord/slash-commands.ts` に追加する。すべて ephemeral 返信。

| コマンド | 権限 | 動作 |
|---|---|---|
| `/login` | 誰でも | device code フローを開始する |
| `/whoami` | 誰でも | 自分の権限クラス（ロール由来 / ログイン由来 / 和集合）を表示する |
| `/iam bind <chapter>` | いずれかのチャプターの organizer | このギルドをチャプターに束縛する |
| `/iam role <@role> <chapter> <organizer\|member>` | 同上 | ロール写像を設定する |
| `/iam channel <#channel> <visibility> [chapter]` | 同上 | チャンネル → visibility 写像を設定する |
| `/iam show` | 同上 | このギルドの IAM 設定を表示する |

- `/iam *` の権限判定は **ログイン由来のクラスのみ** で行う。
  Discord ロール由来で `/iam` を許すと自己昇格の循環ができる。
- `/whoami` は運用上いちばん使うコマンドになる。**5 つの内訳を分けて出す** —
  ロール由来・ログイン由来・和集合・そのチャンネルでの実効クラス・
  **そのチャンネルの `channelAudience`**。
  最後の 1 つが「このチャンネルではどこまでの材料が読めるか」の唯一の説明になる。
- `/iam channel` で全国写像（`member` / `organizer`）を設定したときは、
  **「このチャンネルではチャプター限定の材料が読めなくなる」**ことを応答に書く（§2-2）。

### 制約

- **`Principal.classes` に和集合を直接入れない。** 必ずチャンネルのポリシーを適用したものを入れる。
  ここを飛ばすと、混在チャンネルで organizer の回答が member に見える経路が復活する
  （ADR-002 が「チャンネル単位」案を却下した理由そのもの）。**画面上は正常に見える。**
- **`channelAudience` を「クラス集合があるから要らない」で落とさない。**
  クラス集合は全国 2 行のチャプター天井を表現できない（§2-2）。
  落とすと `member` 写像の全国チャンネルに `chapter-member` の材料が出る。
  **漏れた側にはエラーが出ないので、テストが無ければ気づけない。**
- **`channelAudience` を invocation の外から指定できるようにしない。**
  `channelPolicy` の写像からのみ作る。`/resolve` にパラメータを生やさない。

- **エージェントに IAM 設定と links.json のパスを渡さない。** `ALLOWED_ENV_KEYS` に載せない。
- **`XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` も `ALLOWED_ENV_KEYS` に載せない。**
  invocation ごとの値なので、ambient な allowlist に置くと親の古い値が漏れる。
  経路は `buildCliEnv` の第 3 引数と Stage 07 の固定ランチャの 2 段だけにする。
- **`/iam *` の権限判定にロール由来のクラスを使わない。** 自己昇格の循環を作らない。
- **nonce から任意のクラスを引けるようにしない。** `resolve` は入力の nonce に
  紐づいたクラスだけを返す。クラス指定のパラメータを生やさない。
- **nonce をディスクに永続化しない。** プロセス再起動で全部無効になってよい。
- **`PersistentRunner` を agents-local の経路で使わない。** 常駐プロセスは env を作り直さないので、
  2 ターン目が失効済み nonce を持つ。**症状は「2 回目以降だけ全部 deny」という形で出る。**
- **`buildCliEnv` の署名変更を `ALLOWED_ENV_KEYS` への追加で代用しない。**
  allowlist は親の env を通すための仕組みであって、invocation ごとの値を入れる場所ではない。
- **nonce を単一のソケットで解決できるようにしない。** スロットごとにソケットを分け、
  `entry.slot` と到着ソケットの一致を検査する。ここを 1 本にすると、
  盗んだ nonce がそのまま使えるので [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) が空文になる。
- **認可サーバを TCP にバインドしない。** UNIX ソケットのみ。
  `src/tool-server.ts` と `src/web-chat.ts` が `0.0.0.0` にバインドしている先例に倣わない。
- **`classes` が空の invocation を実行しない。** 「空 = 制限なし」に倒さない。
- **異なる `chapterId` の `PermissionClass` を大小比較しない。** 和集合は集合演算として扱う。
- 5 値の visibility 語彙を xangi 側で再定義せず、`@gdgjp/gdg-lib/acl` から借りる。
- eslint + prettier。husky が commit 時に全 vitest と `tsc --noEmit` を走らせる。

---

## Files to touch — 変更ファイル

すべて `~/proj/xangi` 配下。

- `src/iam.ts`（新規）— IAM 設定の読み書き・正規化・クラス解決
- `src/iam-schema.ts`（新規）— 閉じたスキーマ検証（`src/config-validate.ts` の流儀）
- `src/authz-server.ts`（新規）— UNIX ソケット、nonce 発行・解決・失効
- `src/account-link.ts`（新規）— device code フロー、`links.json`、トークン暗号化
- `src/installer/layout.ts` — `iam.json` / `links.json` のパス解決を追加
- `src/safe-env.ts` — **触らない**（`XANGI_AUTHZ_*` を `ALLOWED_ENV_KEYS` に足さない。§3）
- `src/cli-process.ts` — **`buildCliEnv` に第 3 引数 `authz?: { nonce, socket }` を足す**。
  現署名では invocation ごとの値を運べない
- `src/cli-runner-core.ts` — `buildEnv` から `authz` を通す（one-shot spawn の 2 箇所）
- `src/discord/principal.ts` — `classes` / `channelAudience` / `nonce` を埋める
- `src/discord/message-handler.ts` — `classes` が空なら実行せず案内を返す
- `src/discord/slash-commands.ts` — `/login` `/whoami` `/iam *`
- `src/index.ts` — 認可サーバの起動と停止
- `package.json` — `@gdgjp/gdg-lib` の参照（vendoring か file: 依存。Stage 01 の `acl/agent` 面）
- `tests/iam.test.ts`, `tests/authz-server.test.ts`（新規）
- `README.md` — 「全 GDG organizer は相互に信頼する」前提と IAM の設定手順

---

## Verification — 完了条件と検証

### 完了条件

1. `/iam bind` でギルドをチャプターに束縛でき、`/iam role` でロール写像を設定できる。
   いずれも **いずれかのチャプターの organizer** であるログイン済みユーザーだけが実行できる。
2. `/whoami` がロール由来・ログイン由来・和集合・**そのチャンネルでの実効クラス**・
   **そのチャンネルの `channelAudience`** の 5 つを分けて表示する。
3. 未リンクかつロール写像も無いユーザーの invocation が実行されず、案内が返る。
3a. **保有はあるがチャンネル audience との交差が空**のとき、
   invocation が実行されず、上記 3 とは別の案内（どのチャンネルなら使えるか）が返る。
3b. `chapter-member` 写像のチャンネルで organizer が質問したとき、
   `Principal.classes` の role が `member` に**降格している**。
3c. **`member` 写像のチャンネルの nonce で `/resolve` が返す `channelAudience` が
   `{ kind: "member" }` である。** `chapter-member` 写像のチャンネルでは
   `{ kind: "chapter-member", chapterId }` である。
4. 子プロセスの env に `XANGI_AUTHZ_NONCE` と `XANGI_AUTHZ_SOCKET` が入り、
   `GET /resolve?nonce=…` が正しいクラス**と `channelAudience`** を返す。
5. invocation 終了後、同じ nonce が 404 になる。
5a. **同じチャンネルで 2 ターン続けて質問しても、2 ターン目が deny されない。**
   常駐プロセスの再利用で失効済み nonce を持ち越していないこと
   （one-shot spawn になっていれば自然に満たされる）。
5b. **別スロットのソケットに nonce を投げると 404 になる。**
   スロットをまたいだ解決ができないこと。
6. 子プロセスの env に `iam.json` / `links.json` のパスが **入っていない**。
6a. `ALLOWED_ENV_KEYS` に `XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` が
   **含まれていない**（受け渡しは `buildCliEnv` の第 3 引数と Stage 07 のランチャだけ）。

### コマンド

```bash
cd ~/proj/xangi && npm test
```

```bash
cd ~/proj/xangi && npx tsc --noEmit && npm run lint
```

```bash
cd ~/proj/xangi && node -e "console.log(require('./dist/safe-env.js').ALLOWED_ENV_KEYS)"
```

`ALLOWED_ENV_KEYS` に `XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` /
`iam.json` / `links.json` のいずれも**現れないこと**を目視で確認する。

### 回帰として固定すべきテスト（静かに壊れる経路）

- **`classes` が空の invocation が実行されない。** 空配列が「制限なし」に反転しないこと。
  **反転しても画面上は完全に正常に見える。**
- **和集合が交差に劣化しない / 交差が和集合に膨らまない。** ロール由来とログイン由来が
  食い違うケースを両方向で固定する。
- **`Principal.classes` に和集合がそのまま入っていない。** チャンネルのポリシーを
  必ず通していること。飛ばすと混在チャンネルで organizer の回答が member に見える
  経路が復活し、**画面上は完全に正常に見える**。
- **`channelPolicy` と `resolveMemoryVisibility` が同じ写像を読む。**
  片方だけ更新されると、記憶の visibility と回答の到達範囲がズレる。
- **`/resolve` の応答に `channelAudience` が必ず入る。** 欠けた応答を返せないこと。
  欠けたまま消費側が fail closed に倒れず動くと、
  **全国チャンネルの天井が消える**（§2-2）。**漏れる側にエラーは出ない。**
- **`channelAudience` が `channelPolicy` の写像から作られている。**
  `applyChannelPolicy` の結果（クラス集合）から逆算していないこと。
  クラス集合には全国 2 行のチャプター情報が残っているので、逆算すると天井が広がる。
- **全国ポリシー（`organizer` / `member`）が IAM の束縛済みチャプター一覧を参照しない。**
  guild が 1 つも束縛されていないチャプターの保有クラスが、
  `member` 写像のチャンネルで**落ちない**こと。
  ここを「束縛済み全チャプターを列挙して交差」に戻すと、
  **そのチャプターの Discord サーバーが無いというだけで本人の権限が消える。**
  症状は「特定の人だけ、特定のチャンネルで使えない」で、IAM の設定ミスに見える。
- **`applyChannelPolicy` に `SourceVisibility` の大小比較が無い。** grep で固定する。
  比較を入れた瞬間に `chapter-member:tokyo` と `chapter-member:osaka` で破綻する。
- **同一チャプター内では organizer が member を吸収し、異なるチャプター間では吸収しない。**
- **nonce の失効。** invocation 終了後・TTL 経過後に 404 になること。
  失効しないと、過去の nonce で後からクラスを引ける。
- **nonce の解決にクラス指定パラメータが無い。** `GET /resolve` が
  nonce 以外の入力でクラスを変えられないこと。API に穴を開けた瞬間に全体が壊れる。
- **2 ターン目の nonce が有効。** 同じ contextKey で連続 2 回 invocation を回し、
  2 回目のフックがクラスを引けること。**常駐プロセスに戻すとここだけが落ちる。**
  症状は「初回は動くのに 2 回目から全部 deny」で、権限設定の間違いに見える。
- **スロットをまたいだ nonce 解決が 404。** スロット A の nonce をスロット B の
  ソケットに投げて拒否されること。ここが通ると
  [ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) の分離が名前だけになる。
- **`buildCliEnv` が第 3 引数なしでも既存の呼び出し元を壊さない。**
  かつ、第 3 引数を渡したときに `getSafeEnv()` の値を上書きしないこと
  （nonce は親の env に無いので衝突しないはずだが、固定しておく）。
- **`ALLOWED_ENV_KEYS` に `XANGI_AUTHZ_NONCE` / `XANGI_AUTHZ_SOCKET` が入っていない。**
  入れると、親に残った失効前の nonce が第 3 引数なしの経路で子に届き、
  **前の依頼者のクラスで判定される。**成功時の挙動は何も変わらないので気づけない。
- **`iam.json` の壊れたエントリが、その項目だけ捨てられる。** ファイル全体が
  無効化されて全ギルドが止まらないこと。逆に、壊れたエントリが
  「検証をすり抜けて通る」ことも無いこと。
- **未設定チャンネルが `chapter-organizer` にフォールバックする。** `member` に
  落ちると、記憶が全国の GDG メンバーに公開される。
- **`/iam *` がロール由来のクラスでは通らない。** 自己昇格の循環が閉じていること。
- **`ALLOWED_ENV_KEYS` に `iam.json` / `links.json` のパスが含まれない。**
- **claims 取得失敗が空配列になる。** IdP 障害時に「全部許可」に倒れないこと。

### 手動 E2E

1. テスト用 Discord サーバー 2 つ（別チャプター相当）で bot を起動する。
2. 未リンクかつロール写像なしのユーザーが `@bot` する → 実行されず案内が返ることを確認する。
3. `/login` で device code フローを完走し、`/whoami` にログイン由来のクラスが出ることを確認する。
4. organizer で `/iam bind` と `/iam role` を設定し、
   別の未リンクユーザーがそのロールを持つときに `/whoami` にロール由来のクラスが出ることを確認する。
5. ロール由来とログイン由来が食い違うユーザーで `/whoami` を実行し、
   **和集合** になっていることを確認する。
6. `/iam` を **ログインしていない** organizer ロール保持者が実行し、拒否されることを確認する。
7. 実行中に `curl --unix-socket /run/gdg-agent/<slot>/authz.sock 'http://x/resolve?nonce=<nonce>'` を叩き、
   クラスが返ることを確認する。invocation 終了後に同じ nonce で 404 になることを確認する。
