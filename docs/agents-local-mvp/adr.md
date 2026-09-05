# ADR — agents-local MVP

`agents-local` を PoC から多チャプター運用可能な MVP にするにあたって下した決定の記録。
実装手順は [index.md](index.md) と `01`〜`10` のステージファイルにある。ここにあるのは
**なぜそうしたか、何を却下したか**である。

リポジトリに既存の ADR 規約が無いため、この 1 ファイルに連番で記録する。
規約が後から立ったら、そちらへ移す。決定を消さずに、新しい ADR で supersede すること。

| # | 決定 | Status |
|---|---|---|
| [001](#adr-001-中央-1-台全チャプター共有のトポロジを採る) | 中央 1 台・全チャプター共有 | Accepted |
| [002](#adr-002-権限の単位をユーザーではなく権限クラスにする) | 権限の単位は権限クラス `(chapter, role)` | Accepted |
| [003](#adr-003-権限クラスは-discord-ロール由来とログイン由来の和集合とする) | クラスは和集合 | Accepted |
| [004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く) | 信頼境界は `preToolUse` + uid 分離 + サンドボックス | Accepted |
| [005](#adr-005-エージェントに-shell-を残す) | shell を残す | Accepted（nonce の主張は 017 が訂正） |
| [006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) | workdir とインデックスは 1 つ | Accepted |
| [007](#adr-007-acl-評価器を-gdg-lib-の純粋関数-1-本に集約する) | ACL 評価器を `gdg-lib/` に集約 | Accepted |
| [008](#adr-008-acl-スパンをフックが差分ベースで自動挿入する) | `<acl>` はフックが自動挿入する | Accepted（020 が補強） |
| [009](#adr-009-読取ソースのタグ検査をサーバ側に置かない) | 読取ソースのタグ検査はフックの責務 | Accepted |
| [010](#adr-010-エピソード記憶をローカル-memories-に置き昇格時にサーバへアップロードする) | 記憶は `memories/` + `sources/inline` | Accepted |
| [011](#adr-011-記憶の-visibility-を-discord-チャンネルの静的写像で決める) | 記憶の visibility はチャンネル写像 | Accepted |
| [012](#adr-012-既存ページの上書きを閲覧者集合の包含で制限する) | 上書きは `audienceContains` で制限 | Superseded by [018](#adr-018-ページ変更権限をクラス集合から直接判定する) |
| [013](#adr-013-インデックスを自作しkiri-をそのまま使わない) | インデックスは自作 | Accepted |
| [014](#adr-014-睡眠を-xangi-の内部スケジューラとして実装する) | 睡眠は xangi 内部スケジューラ | Accepted |
| [015](#adr-015-xangi-の-skippermissions-既定を反転しskip-を削除する) | `skipPermissions` 反転、`!skip` 削除 | Accepted |
| [016](#adr-016-wiki-の-vectorize-埋め込み検索を-agents-local-の設計に組み込まない) | wiki の Vectorize を使わない | Accepted |
| [017](#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) | nonce を invocation ごとの uid に束ねる | Accepted |
| [018](#adr-018-ページ変更権限をクラス集合から直接判定する) | ページ変更権限は `canMutatePage` | Accepted |
| [019](#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする) | エージェントの判定入力はクラス集合のみ | Accepted |
| [020](#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) | 包めない機密派生行は拒否する | Accepted |
| [021](#adr-021-ワークツリーの読み書きを-wk-に集約する) | ワークツリーの読み書きを `wk` に集約する | Accepted |
| [022](#adr-022-ローカル実行物を-node-ネイティブ-typescript-に統一する) | ローカル実行物を Node ネイティブ TypeScript に統一する | Accepted |
| [023](#adr-023-ローカル検証環境を-ubuntu-vm-に置きdocker-を採らない) | ローカル検証環境を Ubuntu VM に置き、Docker を採らない | Accepted |
| [024](#adr-024-ci-の-script-tests-における-private-submodule-チェックアウトの失敗と暫定方針) | CI の script-tests における private submodule チェックアウトの失敗と暫定方針 | Accepted |
| [026](#adr-026-収束エンジンを-go-gdg-cli-とし宣言的-specピン留めpull-型配信を採用する) | 収束エンジンを Go (gdg CLI) とし宣言的 spec・ピン留め・pull 型配信を採用する | Accepted |
| [027](#adr-027-agents-index-を-spec-と収束エンジンへ吸収しプロビジョニング用シェルを-bootstrap-1-本に一本化する) | agents-index を spec と収束エンジンへ吸収し、プロビジョニング用シェルを bootstrap 1 本に一本化する | Accepted |
| [028](#adr-028-署名基盤アーカイブ防御mode-b-によるワークスペース同期tier-1を採用する) | 署名基盤・アーカイブ防御・Mode B によるワークスペース同期（Tier 1）を採用する | Accepted |
| [029](#adr-029-バックエンド能力契約fail-closedと二重化された本番防御下限を採用する) | バックエンド能力契約（fail-closed）と二重化された本番防御下限 | Accepted |
| [030](#adr-030-tier-2-署名リリースと-pull-型適用ロールバック) | Tier 2 署名リリースと pull 型適用、ロールバック | Accepted |
| [031](#adr-031-gdgjpgdg-lib-の-acl-評価器のみを-github-packages-へ-publish-する) | `@gdgjp/gdg-lib` の ACL 評価器のみを GitHub Packages へ publish する | Accepted |

---

## ADR-001: 中央 1 台・全チャプター共有のトポロジを採る

### Status

Accepted

### Date

2026-08-18

### Context

MVP を多くの GDG チャプターに配るとき、`agents-local`（xangi + `cursor-agent` + wiki clone）の
実体を何台にするかが、以降の権限設計の全前提を決める。

現状は自前 Ubuntu 1 台。`gdg wiki clone` は**チャプタースコープを持たない** — `clone` の引数は
ディレクトリだけで `--chapter` フラグは存在せず、サーバ側の `GET /api/cli/wiki/snapshot` も
全ページを引いて `getEffectivePagePermissions` で 1 件ずつ濾すだけである。`pages.slug` は
グローバル UNIQUE。つまり **1 つの clone は「ログインした人間が見えるものすべての和集合」**になる。

### Decision

中央 1 台に全チャプターの Discord サーバーを収容する。clone も `gdg` トークンも 1 組。

### Alternatives Considered

**チャプターごとに 1 台**

- Pros: 分離をデプロイ境界が担う。権限問題の大半が消える
- Cons: 各チャプターに Ubuntu 運用と Cursor サブスクリプションを要求する
- Rejected: 実際に運用できるチャプターがごく少数に限られ、「多くのチャプターに配る」という
  目的そのものを達成できない

**中央 1 台だが実行をユーザーごとに分離（clone を N 個持つ）**

- Pros: 権限が構造的に正しくなる
- Cons: clone がユーザー数ぶんに増える。ingest ロック（`.gdgwiki/ingest-locks.json`）は
  チェックアウトローカルなので checkout を跨いで機能しない
- Rejected: 容量と ingest の破綻。→ [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)

**自前ホストをやめて Cloudflare/Vercel に寄せる**

- Pros: 既存の `accounts/` + `wiki/` の ACL にそのまま乗れる
- Cons: 「コーディングエージェントのサブスクで重い合成を安く回す」という `agents-local` の
  存在理由そのものを捨てる
- Rejected: `docs/plans/00-llm-wiki-overview.md` の「理解と統合の高価な LLM 作業はローカルの
  サブスク内に留める」という全体方針と衝突する

### Consequences

- **権限は完全にプロセス内で分離するしかない。** これが MVP の最大の設計負荷になる。
- 1 台の侵害が全チャプターの機密に及ぶ。[ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く)
  の境界がそのままブラストラディウスの上限になる。
- `sources.visibility` の `member` / `organizer` は**チャプター横断**である
  （`canAccessSource` は `chapters.length > 0` / `some(role === "organizer")` で判定する）。
  中央 1 台では、チャプター内に閉じたい記憶は必ず `chapter-*` を使う必要がある。

---

## ADR-002: 権限の単位をユーザーではなく権限クラスにする

### Status

Accepted

### Date

2026-08-18

### Context

当初の要求は「Discord サーバーごと + Discord ロールごと + ユーザーログインごと」の 3 つの粒度だった。
一方 xangi にはそもそも**ユーザーという単位が存在しない** — `SessionEntry` のキーは `contextKey`
（チャンネル ID かスレッド ID）で user id のフィールドが無く、`RunOptions` にも `userId`/`guildId`
が無い。発言者はプロンプト文字列中の `[発言者: …]` という散文としてしか残らない。

ユーザー単位で分けると、セッション・runner プール・実行ミューテックス・workdir・transcript の
5 つがユーザー数ぶんに分裂する。

### Decision

権限の単位を `PermissionClass = { chapterId, role: "organizer" | "member" }` の**集合**とする。
3 つの粒度は「その人がどのクラスに属するかを決める入力」として統一する。

`memberships` は `(user_id, chapter_id)` が PK なので 1 人が複数チャプターに属しうる。
**集合であることを型で保ち、「代表クラス 1 つ」に丸めない。**

#### 実効クラス = 保有クラスにチャンネル写像を適用したもの ∧ チャンネル audience の包含

> **改訂（2026-08-19）。** 当初この節は
> 「実効クラス = (ロール由来 ∪ ログイン由来) ∩ チャンネルの audience」と書き、
> 上限を **`PermissionClass` 集合に変換して交差する**形で表現していた。
> **その形では全国 audience（`organizer` / `member`）の天井が表現できない。**
> `member` 写像 → 束縛済み全チャプター × `member` → 保有と交差 → `{tokyo, member}` が生き残り、
> `chapter-member` + `tokyo` の材料が読める。その回答は全国チャンネルに投稿される。
> **クラス集合は「その人が何を持つか」しか表せず、「この場に出してよい範囲」を表せない。**
> 下記のとおり、上限を**別の制約**として持ち回る形に改める。

**セッションを分けても、投稿先の Discord チャンネルは分かれない。**
`contextKey` を `channelId:<classKey>` に拡張しても、organizer セッションの回答は
同じチャンネルに投稿され、そこに居る member の目に入る。
つまり下の「チャンネル単位」案を却下した理由は、セッション分離だけでは解消しない。

したがって invocation の認可を **2 つの独立した制約**で決める。

1. **保有 → 実効クラス**: ロール由来 ∪ ログイン由来（[ADR-003](#adr-003-権限クラスは-discord-ロール由来とログイン由来の和集合とする)）に
   **チャンネル写像を適用**したもの（チャプター写像のチャンネルではチャプターで絞り、
   ロールを上限で丸める）— 「その人が何を持ち、この場でどのロールとして振る舞うか」。
   **全国写像ではチャプターを絞らない**（絞ると、Discord サーバーがまだ無いチャプターの
   正当な保有クラスが落ちる）。
2. **チャンネル audience（`channelAudience`）**: 同じチャンネル写像
   （[ADR-011](#adr-011-記憶の-visibility-を-discord-チャンネルの静的写像で決める)）を
   **audience key として**持ち回るもの — 「この場に出してよい範囲は何か」。
   未設定なら `chapter-organizer` + guild の `chapterId`。

**読み取りの可否 = 1 で読めるか ∧ 2 に出してよいか（AND）。**
実装は `canClassesAccessSourceInChannel` / `canClassesSeePageInChannel`
（Stage 01 §5-4）で、適用点は `wk`（Stage 11）とインデックス（Stage 09）である。
実効クラスが空なら invocation を拒否する
（ADR-003 の「空 = 制限なし に反転しない」と同じ扱い）。
**`channelAudience` が引けない invocation も同じく実行しない。**

**書き込みには 2 を適用しない。** 書き込みはチャンネルへの開示ではない。
掛けると、`chapter-organizer` 写像のチャンネルから `public` ページを更新できず ingest が壊れる。

これにより、**回答の到達範囲がチャンネルの audience を構造的に超えない** —
**ただしそれは 2 つの制約が揃っているときにだけ成立する。**
どちらか一方だけでは成立しない（1 だけでは全国写像で漏れ、
2 だけでは本人の保有を超えて読める）。
`#main`（`member` 写像）で organizer が質問しても、organizer 限定の材料も
チャプター限定の材料も読まれない。
狭い材料が要るならチャプター写像のチャンネルで訊く、という運用に落ちる。

`contextKey` の `channelId:<classKey>` 拡張は**維持する**。
organizer チャンネルに居る member のように、同じチャンネルでも実効クラスが違う 2 人は
会話セッションが分かれるべきである。

**どちらの制約も `SourceVisibility` の大小比較ではない。**
1 はクラス集合に対する述語であり、2 は **証明済みの包含だけを true にする表**
（`audienceKeyContains` / `pageAudienceIncludesChannel`）である。
5 値は全順序ではない（`docs/plans/10-page-acl-spans.md` §0）。

### Alternatives Considered

**ユーザー単位**

- Pros: 最も素直
- Cons: xangi の 3 つの `Map` の再キー化に加え、分離した実体が全部ユーザー数ぶんに増える
- Rejected: 同じ `kwansai-organizer` の 2 人を分ける理由が ACL 上ひとつも無い

**チャンネル単位（チャンネルの権限＝そこに書ける全員の権限の最大値）**

- Pros: 実装が最も軽い。xangi の現在のセッション粒度と一致する
- Cons: 保有権限をチャンネルで決めてしまうと、member しか持たない人が
  organizer チャンネルで organizer 相当の材料を読めてしまう
- Rejected: 保有はあくまで本人の membership とロールで決まる。
  ただし**チャンネルを「上限」として使う部分は採用した**（上記 Decision の制約 2）

**チャンネル audience を `PermissionClass` 集合に変換して交差する**（当初の形）

- Pros: 制約が 1 つで済み、判定点が増えない
- Cons: **全国 audience（`organizer` / `member`）の天井を表現できない。**
  束縛済み全チャプターから列挙して交差しても `{tokyo, member}` が生き残り、
  `chapter-member:tokyo` の材料が全国チャンネルに出る
- Cons: 列挙を「束縛済みチャプター」に頼るので、Discord サーバーがまだ無いチャプターの
  正当な保有クラスが落ちる（症状は「特定の人だけ特定のチャンネルで使えない」）
- Rejected: 2026-08-19 の改訂で、audience を**別の制約**として持ち回る形にした。
  クラス集合は「保有」を表す型であって、「開示してよい範囲」を表す型ではない

**機密を含む回答だけ ephemeral 返信 / DM に切り替える**

- Pros: チャンネルの audience を狭めずに、広いチャンネルでも機密の答えを返せる
- Cons: xangi の Discord 経路は `MessageCreate` ベースで、ephemeral は interaction
  （スラッシュコマンド）にしか使えない。IAM コマンドが ephemeral を使えている
  （Stage 04）のは経路が違うため。`/ask` 相当のスラッシュコマンドを別途作る話になる
- Cons: 「答えは返ったが誰にも見えない」状態が起こり、会話の文脈が壊れる
- Rejected: MVP では採らない。`/ask` スラッシュコマンドを導入するときに再検討する

### Consequences

- クラス数は現実的に一桁に収まる。分割が必要になったときのコストが線形に増えない。
- xangi 側で `RunOptions.principal` を通す配管が必須になる（ステージ 03）。
- **認可の入力が 2 つになる。** `Principal` と nonce の応答は
  `classes` と `channelAudience` の両方を運び、
  エージェント側の評価器は両方を要求する形（`…InChannel`）だけを公開する。
  **片方だけを呼べる関数をエージェント側に見せない**（Stage 01 §5-5）—
  見せると、落とした実装が動いてしまい、漏れた側にエラーが出ない。
- **全国写像（`member` / `organizer`）のチャンネルでは、チャプター限定の材料に到達できない。**
  `#announce` のような全国チャンネルでエージェントに訊けるのは
  `public` / `member`（organizer 写像なら加えて `organizer`）の範囲だけである。
  チャプターの話はチャプター写像のチャンネルで訊く運用になる。
  **これはオンボーディングで 2 番目に躓く点**なので、
  `/iam channel` の応答と `/whoami` に書く（Stage 04 §5）。
- **チャンネル写像が「記憶の visibility」と「回答の上限」の 2 つを兼ねる。**
  ADR-011 の写像に用途が 1 つ増える。IAM の UI と検証はこの両方を説明すること。
- 未束縛の guild・未設定チャンネルは `chapter-organizer` にフォールバックするので、
  **写像を書き忘れたチャンネルでは organizer しか使えない**。
  これは安全側だが、オンボーディングで最初に躓く点になる。設定を促すメッセージを出す。
- `contextKey` を `channelId` から `channelId:<classKey>` に拡張する必要がある。
  同じチャンネルでも organizer と member で会話セッションが分かれる。
- **`role` は `organizer` と `member` の 2 値しかない。** `accounts` の `memberships.role` の
  CHECK 制約がそうなっており、`gdg-lib` の `parseClaims` もこの 2 値以外を弾く。
  3 つ目のロールが要るなら `accounts/` 側の変更が先行する。

---

## ADR-003: 権限クラスは Discord ロール由来とログイン由来の和集合とする

### Status

Accepted

### Date

2026-08-18

### Context

`accounts/` には Discord に関する記述が**一件も存在しない**（`grep -rni discord accounts/` が 0 件）。
Discord user id → GDG アカウントの写像は `agents/` の Redis（TTL 31 日、flush で全員 unlink）と
`wiki/` の `user_preferences.discord_id` にしかない。

つまり「Discord ロール由来のクラス」と「ログイン由来のクラス」は独立に存在し、食い違いうる。
例: Discord で `@organizer` ロールを持つが、GDG アカウントでは kwansai の `member` でしかない人。

### Decision

**和集合**をとる。どちらか一方が認めれば、そのクラスを付与する。

併せて IAM 設定（`guildId → chapterId` の束縛と `roleId → (chapter, role)` の写像）は、
**いずれかのチャプターの organizer** であれば設定できるものとする。

### Alternatives Considered

**交差（両方が認めた権限だけ）**

- Pros: `accounts` の `memberships` が組織的な真実であり、Discord ロールはギルド管理者が
  自由に付け替えられるので、上限を accounts 側で抑えられる
- Cons: 未リンクユーザーが何もできない。オンボーディングの摩擦が大きい
- Rejected: 「どのサーバーがどのチャプターかを厳密に指定することはできない」以上、
  accounts 側の membership だけを真実とみなす前提が実態に合わない

**ログイン済みならログイン由来、未リンクならロール由来にフォールバック**

- Pros: 一見自然
- Cons: Discord ロールのほうが広い場合、**ログインすると権限が減る**逆インセンティブを作る
- Rejected: 上記

### Consequences

- **ギルド管理者ではなく「GDG organizer」が権限配布の根になる。** いずれかのチャプターの
  organizer なら、任意のギルドを任意のチャプターに束縛し、任意のロールを任意のクラスに写像できる。
- したがってこの設計は「**全 GDG organizer は相互に信頼する**」という前提の上に立つ。
  これは明示的な選択であり、前提が崩れたら ADR を書き直すこと。
- ロールを読むため `GatewayIntentBits.GuildMembers` が必要になる。現在 xangi は
  `Guilds` / `GuildMessages` / `MessageContent` しか要求していない。
- 未リンクかつロール写像も無いユーザーは、クラス集合が空になるので invocation ごと拒否される。
  **「空 = 制限なし」に反転しないことを回帰テストで固定する。**

---

## ADR-004: 信頼境界を `preToolUse` フック・uid 分離・OS サンドボックスの 3 点に置く

### Status

Accepted

### Date

2026-08-18

### Context

「Cursor の permission 設定でユーザーごとに権限を分けられる」という見立てを実装で検証したところ、
決定的な事実が 3 つ出た（`cursor-agent 2026.08.11-e8db854` のバンドルを読んだ結果）。

1. **`Read(...)` / `Write(...)` の deny は Cursor 自身の Read/Write ツールしか覆わない。**
   パスルール照合器の呼び出し元は `shouldBlockRead` と `shouldBlockWrite` の 2 箇所のみで、
   shell 側は `Shell(...)` 形式のルールだけを抽出する完全に別の経路。
   `"deny": ["Read(/path/secret)"]` は `cat /path/secret` に何の効果もない。
   `Grep` / `List` / `Fetch` も `Read()` の管轄外。
2. **`beforeReadFile` は名前に反してディスク読み取りの後に走る。** 実装は
   `runPostExecutionHooks` の中にあり、フックには読み終えた `content` が渡される。
   deny はモデルへの配送を止めるだけで、読み取り自体は止めない。
3. **Cursor の設定機構はどれ 1 つとして信頼境界ではない。** すべて同一 uid のプロセス設定で、
   shell を持つエージェントは自分を縛る `cli-config.json` も `hooks.json` も書き換えられる。

### Decision

境界を 3 点に置く。

1. **`preToolUse` フック 1 本**（`~/.cursor/hooks.json`、`failClosed: true`）。
   `Shell` / `Read` / `Write` / `Grep` / `List` / `Fetch` / `MCP:*` を**すべて**捕まえられる
   唯一のイベント。
2. **uid 分離。** `cursor-agent` を専用の非特権 uid で spawn する。フック本体と
   `~/.cursor/hooks.json` は agent uid から書けない所有権にする。
3. **OS サンドボックス。** `sandbox.mode: "enabled"` + `readBoundary: "workspace"` で
   workdir 外への shell 経由の読み取りを止める。

Cursor の `permissions.allow` / `deny` は補助として使う。境界とはみなさない。

#### フックの役割分担

**強制と変更を混ぜない。**

| 役割 | 実体 | 責務 |
|---|---|---|
| **強制（enforcement）** | `preToolUse` **1 本** | `wk` 以外の読み書き経路を deny する。`failClosed: true` |
| **変更（mutation）** | **`wk`**（[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)） | 濾過・`<acl>` の再合成と自動挿入・変更権限の判定 |

**フックとして使うのは `preToolUse` 1 本だけである。**
`beforeShellExecution` / `beforeReadFile` / `afterFileEdit` はどれも使わない。

- `beforeShellExecution` — `preToolUse` の `tool_name: "Shell"` が上位互換
- `beforeReadFile` — 名前に反してディスク読み取りの**後**に走り、Read ツールにしか発火しない
- `afterFileEdit` — Cursor の Write / Edit ツールを deny する以上、発火する余地が無い。
  かつ `failClosed` を持てないので deny を返せない。
  変更は `wk write` に寄せる（ADR-021、ADR-008）

**唯一の例外候補: `beforeMCPExecution`。**
`preToolUse` は MCP ツールについて `tool_name: "MCP:<toolName>"` しか受け取らず、
**サーバ名を持たない**（`cursor-agent` の MCP executor。Stage 05 の確認済みの事実 8）。
`mcp_server_name` が渡るのは `beforeMCPExecution` だけである。

- 既定は **ツール名 allowlist（`search` のみ）+ 設定の固定**
  （root 所有 `mcp.json`、`HOME` で選択。Stage 07 §6）で閉じる。
- `--mcp-config` は `cursor-agent 2026.08.11-e8db854` に無い。
  project `mcp.json` はマージされるので、サーバ同一性まで見るなら
  `beforeMCPExecution` を `failClosed: true` で 1 本足す。
- **この例外が上の 3 つと違う点**: `beforeMCPExecution` は deny を返せ、
  かつ **他のどのイベントからも得られない情報**（サーバ同一性）を持つ。
  「保険として残す」類の追加ではない。
- **`beforeShellExecution` / `beforeReadFile` / `afterFileEdit` の復活の根拠には使わない。**

### 脅威モデル

**この 3 点が何を守り、何を守らないかを 1 箇所に定める。**
[ADR-005](#adr-005-エージェントに-shell-を残す) と
[ADR-009](#adr-009-読取ソースのタグ検査をサーバ側に置かない) はここを参照する。
同じ話を 3 箇所に書かない。

**守るもの:**

| 対象 | 機構 |
|---|---|
| workdir **外**のホスト資格情報（`~/.config/gdg/credentials.json`、`iam.json`、`links.json`、nonce ストア、インデックス DB） | uid 分離 + `readBoundary: "workspace"` |
| 権限クラスの偽装（`XANGI_ACTOR_CLASS=admin` 型の自己申告） | nonce（[ADR-005](#adr-005-エージェントに-shell-を残す)） |
| 意図しないツール到達（誤操作、プロンプトの流れでの逸脱、ツールの取り違え） | `preToolUse` + `failClosed: true` |
| ハーネス自体の無効化（`rm ~/.cursor/hooks.json`、`wk` の書き換え、`cli-config.json` / `sandbox.json` / `<workdir>/.cursor/sandbox.json` によるサンドボックスの無効化、`.git/hooks/*` と `.gitattributes` filter による任意コード実行） | 所有権（root 所有）+ **ゲートの変更系ツール無条件 deny**（[Stage 05](05-cursor-harness-pretooluse.md) §2） |
| workdir 内側の**スパン単位**の読み書き分離 | `wk` + argv allowlist（[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)）。**`wk` 自身のバグはこの保護の外にある** |

**守らないもの:**

- **共有 workdir の内部でのチャプター間の分離を、敵対的またはプロンプト注入された
  エージェントに対して保証しない。**
  - `preToolUse` の `Shell` 判定は argv allowlist になり、解釈できないコマンドは deny される
    （[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)）。
    **不完全さは安全側に倒れたが、`wk` 自身の実装バグは別の穴として残る。**
  - ゲートは変更系ツールと未知の `tool_name` を**パスを見ずに deny する**
    （[Stage 05](05-cursor-harness-pretooluse.md) §2）。
    これは上の「守るもの」の最終行を成立させるための条件であって、
    workdir 内側のチャプター間分離をここで保証するものではない。
  - 読取ソースのタグ検査は**協力的なエージェントを前提とする**
    （[ADR-009](#adr-009-読取ソースのタグ検査をサーバ側に置かない)）。
  - `readBoundary` はワークスペース単位の境界であって、ファイル単位のポリシーではない。
- **`.gdgwiki/state.json` と `INGEST_QUEUE.md` のチャプター横断メタデータを秘匿しない。**
  この 2 つは全 invocation に対して素通りであり、運用者から見える和集合全件の
  **ソース名・パス・`source_id`・`visibility`** を含む。したがって次の 2 者に読まれる。
  - 対話 invocation — `#main` の `member` が `cat .gdgwiki/state.json` で全チャプターの
    ソース名を読める。workdir とフックは 1 つなので
    （[ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)）、
    素通りを ingest 工程だけに限る仕掛けは現状の設計に無い。
  - ingest invocation — [ADR-014](#adr-014-睡眠を-xangi-の内部スケジューラとして実装する) は
    1 ソース分のクラスしか nonce に載せないが、マニフェスト全体は読める。
    **`classesForSource` が渡すまいとしたチャプター横断の可視性が、ここから戻る。**

- **`<acl>` を持てない位置に落ちた機密派生の記述を保護しない。**
  スパンは本文にしか置けない（front matter に入ると `acl_in_metadata`）。したがって
  **ページの `title` / `summary` / `tags`、catalog ページのエントリ、`log`** は、
  機密ソース由来の記述がそこに落ちても**タグで覆えない**。
  ページ可視性で覆える場合を除いて、露出する。
  - 見出し行とコードフェンスの内側は
    [ADR-020](#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) が**拒否**する。
    上の 3 つを同じように拒否しない理由は ADR-020 に書いた
    （拒否すると ingest が新規ページを 1 枚も作れなくなる）。
  - **とくに catalog ページが効く。** 狭いページのタイトルが、
    広い catalog に一覧として現れる。
  - 追って直す道は 2 つある。①catalog を決定論的生成にしてエージェントに書かせない
    ②page ACL に「チャプター C の organizer だけ」を表す可視性を足す
    （現在は存在せず、そのために `audienceContains` が `chapter-organizer` に対して
    常に `false` を返す）。**どちらかが入れば、この受容は撤回できる。**

  **漏れるのはメタデータであって本文ではない**が、この受容は 2 つの主張を弱める。
  [ADR-013](#adr-013-インデックスを自作しkiri-をそのまま使わない) の
  「post-filter が漏れても被害はパス名に限定される」— パス名とタイトルはここで直接手に入る。
  [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) の
  記憶ファイル名から主題を除く規約 — 同じ情報が別経路で出る。
  **承知のうえで受容している。**本文の秘匿が崩れたら、この受容から先に見直すこと。

つまり **workdir の内側は「事故を防ぐ層」、workdir の外側は「攻撃を防ぐ層」**である。
ステージの完了条件は、この区別に沿って**機構名で**書くこと
（「到達できない」ではなく「`preToolUse` が deny する」「uid 分離により読めない」）。

前提が変わる（敵対的エージェントを想定する必要が出る）なら、
[ADR-001](#adr-001-中央-1-台全チャプター共有のトポロジを採る) の
中央 1 台・全チャプター共有まで遡って書き直すこと。

### Alternatives Considered

**Cursor の permission 設定だけを境界にする**

- Rejected: 上記 1。shell を残す（[ADR-005](#adr-005-エージェントに-shell-を残す)）以上、
  `Read()` は境界にならない

**`~/.cursor/hooks.json` を permission で読み書き不可にする**

- Cons: `Write(...)` deny は Write ツールしか覆わず、`rm ~/.cursor/hooks.json` は Shell ツール。
  `Shell(...)` はコマンドパターン照合なので「このパスに触る任意のコマンド」を表現できない。
  結果、フックを守るのがフック自身になり、判定材料はコマンド文字列の正規表現になる
- Rejected: 循環する。ファイルの所有権を root に寄せれば循環が消え、コストはほぼゼロ

**enterprise パス（`/etc/cursor/hooks.json`）に置く**

- Pros: root 所有がマシン全体の床になる
- Rejected: `~/.cursor/hooks.json`（user hooks）を選択。所有権だけ root に寄せれば
  同じ性質が得られ、設置先が 1 段浅くて済む

**サンドボックスだけで済ませる**

- Rejected: `readBoundary` はワークスペース単位の境界であって、ファイル単位のポリシーではない。
  **workdir 内部のチャプター間 ACL を表現できない**

### Consequences

- **`failClosed: true` を使う。** `docs/plans/11-ingest-acl-hooks.md` が fail open を選んだ理由は
  「ネットワーク障害で ingest が止まる」だったが、read ゲートの判定材料は front matter +
  ローカル認可サーバで完結するので当てはまらない。ただし `git commit`/`push` 時の
  サーバ往復検査（`gdg wiki verify-acl`）は**従来どおり fail open** に保つ。
- `--force` / `--yolo` を渡してはいけない。`shouldBlockShellCommand` には、unrestricted かつ
  シェルパーサが失敗したときに `hasHardDeny` が空配列を見て `false` を返す deny バイパスが実在する。
  → [ADR-015](#adr-015-xangi-の-skippermissions-既定を反転しskip-を削除する)
- **Cursor の glob は `*` のみで `/` を跨ぎ、`?` はリテラル、`**` は `*` と同義。** 照合は
  解決済み絶対パスに完全アンカーされるので、`Read(raw/*)` のような相対パスルールは
  **永久にマッチしない**。相対パスで書いた deny は静かに全許可になる。回帰テストで固定する。
- フックが読まれない構成に戻ると、ゲートは黙って無効化され**画面上は完全に正常に見える**。
  「フックが実際に発火する」ことをテストで固定する。

---

## ADR-005: エージェントに shell を残す

### Status

Accepted。ただし
[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する) が **shell の面を `wk` に狭めた**。
「shell を残す」という判断はそのままで、`argv[0]` が `wk` であるものだけを通す。
`$(...)` / `xargs` / here-doc の python などは deny 側に落ちる — つまり
本 ADR が「原理的に不完全」と書いたコマンド文字列の解析は、
allowlist にしたことで**不完全さが安全側に反転している**。。ただし **Consequences 末尾の nonce に関する主張は誤りであり、
[ADR-017](#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) が訂正する。**
shell を残すという決定そのものは有効である。

### Date

2026-08-18

### Context

ingest と query に必要な shell は実質 `git` と `gdg wiki *` だけで、どちらも xangi 側の工程として
代行できる。shell を消せば「コマンド文字列を正規表現で解析してパスを取り出す」という、
`$(echo raw)/x` / `xargs` / `find -exec` / here-doc の python で原理的に破れる戦いが設計から消える。

### Decision

shell を残す。読み取り制御は
[ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く) の
`preToolUse` が担う。

### Alternatives Considered

**shell を与えない（Read/Write/Edit/Grep/List と MCP ツールのみ）**

- Pros: コマンド文字列の解析という破れる戦いが消える
- Cons: `cursor-agent` に「shell ツールを外す」第一級の手段が無い。
  `--exclude-tools shell_tool_call` は存在するが、`x-cursor-agent-exclude-tools` という
  **HTTP ヘッダとしてサーバに送られる能力形成のヒント**であり、クライアント側の強制ではない。
  `deny: ["Shell(*)"]` は機構としては効くが `--force` 下のバイパスがある。
  エージェントの実用性も大きく落ちる
- Rejected: 実用性を優先

### Consequences

- **`preToolUse` の `Shell` 判定はコマンド文字列の解析に依存する。** これは原理的に完全ではない。
  この設計の既知の弱点であり、受容した上での選択である。
- 弱点を補うのが uid 分離と OS サンドボックス（workdir 外は OS が止める）。
  workdir 内部のチャプター間 ACL については、shell 経由の巧妙な読み取りが通りうる。
- **この受容は [ADR-004 の脅威モデル](#脅威モデル)に集約してある。**
  「workdir の内側は事故を防ぐ層、外側は攻撃を防ぐ層」— そちらを唯一の記述とする。
- **`XANGI_AUTHZ_NONCE` 方式が必要になる。** shell があるので、環境変数やファイルで
  権限クラスを渡すと `XANGI_ACTOR_CLASS=admin node ...` で偽装できる。
  nonce なら盗んでも自分の本当のクラスしか引けないので昇格に使えない。

---

## ADR-006: workdir とインデックスを 1 つに保ち、射影ビューを作らない

### Status

Accepted

### Date

2026-08-18

### Context

「読めないファイルはそこに無い」を実現するため、権限クラスごとに権限フィルタ済みの
git ワーキングツリーを射影し、クラスごとに別のインデックスを張る案を検討した。

しかし xangi の workspace は**プロセス起動時に 1 回決まる不変値**である。`RunOptions` に
`workdir` フィールドが無く、`spawn(..., {cwd: this.workdir})` は全 runner でコンストラクタ由来。
per-invocation に切り替えるには `RunOptions` の拡張に加えて 3 つの `Map`
（`runner-manager.ts:70`、`dynamic-runner.ts:100,101`、`message-handler.ts:979`）の
再キー化が要る。加えて `process.env.WORKSPACE_PATH` を直接読む箇所が約 20 モジュールある。

### Decision

workdir は 1 つ、インデックスも 1 つ。射影ビューを作らない。
権限は**出力側で濾す** — read は `preToolUse`、検索結果は評価器による post-filter。

### Alternatives Considered

**権限クラスごとの射影ワーキングツリー + クラスごとのインデックス**

- Pros: 「読めないものはそこに無い」は原理的に破れない
- Cons: xangi の 3 つの `Map` 再キー化に加え、射影ツリーの再構築と再インデックスが
  睡眠の時間を食い潰す。インデックスの容量がクラス数倍になる
- Rejected: 中央 1 台では現実的でない

### Consequences

- 検索インデックスは全チャプターの内容を 1 箇所に持つ。**インデックスの post-filter が
  漏れた瞬間に静かに壊れる。**回帰テストで固定する。
- 被害を限定するため、インデックスの**出力を本文なしのパス + 行範囲に絞る**
  （→ [ADR-013](#adr-013-インデックスを自作しkiri-をそのまま使わない)）。
  post-filter が漏れても、漏れる最大値がパス名になる。
- さらにパス名からの漏洩を無害化するため、記憶のファイル名は `<ISO8601>-<sessionId>` とし
  主題を書かない。
- **「出力側で濾す」の実体は `wk` である**
  （[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)）。
  `wk` はツリーを materialize しないので、本 ADR の「射影ビューを作らない」に反しない。
  **濾過を FS ではなくコマンド境界で行う**という読み方をする。
  `wk` を「ビュー」と呼び換えないこと — 呼び換えた後続が materialize 型に倒す。
- **workdir が 1 つなので、リポジトリの並行変更を許せない。**
  [Stage 07](07-agent-uid-isolation.md) はスロット（uid）を 4 つ用意するが、
  **スロット数はリポジトリの同時変更数ではない。** git index / HEAD /
  `INGEST_QUEUE.md` / ingest トレースは共有なので、
  リポジトリを変更する invocation は
  **リポジトリトランザクションミューテックス**（[Stage 10](10-sleep-scheduler.md) §1a）で
  同時に 1 つに絞る。uid を分けたのは nonce と `/proc` の分離のためである。
  - 競合したときに失われるのはトレースの `reads`（＝`<acl>` タグ）であり、
    `verify-acl` はクライアント申告なので**サーバ側でも検出できない**。
    「頻度が低いから受容する」は成立しない（Stage 10 の Context）。
  - 多重防御として、トレースは invocation ごとのファイルに分ける
    （[Stage 11](11-wk-mediator.md) §8）。
- **スケーリング経路（まだ採らない）: スロットごとに `git worktree` を分ける。**
  index と HEAD が worktree ごとになるので直列化が不要になり、`.git` は 1 つのままである。
  ただし**この ADR の「workdir は 1 つ」の改訂が必要**で、
  `agents-index` の監視対象（chokidar のルート）と行番号の同一性も分裂する。
  **同時実行を上げる必要が出てから、この ADR を改訂して移る。**
  ミューテックスの待ちが実用上の問題になったことが、移る条件である。

---

## ADR-007: ACL 評価器を `gdg-lib` の純粋関数 1 本に集約する

### Status

Accepted

### Date

2026-08-18

### Context

同じ ACL 判定が 3 箇所で必要になる。

1. ローカルの `preToolUse` フック（Node ESM）
2. インデックス MCP サーバ
3. `wiki/` のサーバ側（`canAccessSource` / `validatePageAclForSync`）

実運用で `agents-local/wiki/` から `git push` したときにサーバ側でエラーになることがある。
ローカルとサーバの判定がズレているのが原因である。

### Decision

`gdg-lib/src/acl/` に純粋関数として切り出し、3 者が同じものを import する。
`wiki/` 側は既存シグネチャを保った薄いラッパにして、呼び出し側 6 箇所を変えない。

移設対象: `canAccessSource`、`audienceContains`、`sourceAudienceKey`、`parseLevelAudienceKey`、
`parseAclSpans`、`aclSpanSourceIds`、`redactAclSpans`。

### Alternatives Considered

**`cli/` の Go 側に持たせ、フックは `gdg wiki` サブコマンド経由で問い合わせる**

- Pros: 現在の `verify-acl` と同じ流儀
- Rejected: `docs/plans/11-ingest-acl-hooks.md` が「Go 側に `<acl>` パーサを書かない。
  二重実装はドリフトし、`/sync` と判定が食い違った瞬間にこのゲートは嘘をつく」と明記した
  判断と正面から衝突する

**`wiki/` の HTTP エンドポイントを唯一の判定者にし、フックもインデックスも問い合わせる**

- Pros: 判定者が 1 つになるという点では最も強い
- Rejected: [ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く) で
  「read ゲートはローカル完結だから fail closed にできる」と決めた前提を壊す。
  ネットワークが判定に必要になった瞬間、fail closed はオフラインで ingest を止める

### Consequences

- `gdg-lib` は source-only の TS パッケージ（`main: "./src/index.ts"`）だが、
  **フックのために bundle が 1 つ要る。** `/opt/gdg-agent/` に node_modules や
  source package 全体を配置せず、エージェント向け export 面も `agent.ts` に絞るため、
  Stage 01 が `build:acl`
  （esbuild → `cli/internal/wiki/hooks/acl.ts`）を追加し、
  `/opt/gdg-agent/lib/acl.ts` に配置する。
  **生成先を実行物と同じディレクトリにするのは、相対 import が
  リポジトリ上でも配置後でも同じ形で解決するようにするためである**
  （[Stage 00](00-typescript-runtime.md) §5-§6）。
  - Worker（`wiki/`）は `src/acl/index.ts`（完全な面）を直接使う。
  - **インデックスサーバは `src/acl/agent.ts`（絞った面）を使う。**
  - **Node ネイティブ TypeScript の `wk` だけがこの bundle を使う**
    （エントリは `agent.ts`）。ゲートは ACL を判定しないので使わない。
  `verbatimModuleSyntax` に従い `import type` を使う。
- **エージェント側に見せる面を絞る**（Stage 01 §5-5）。
  `agent.ts` は `…InChannel` 版だけを export し、
  クラス版の裸の評価器（`canClassesAccessSource` / `canClassesSeePage`）と
  `canAccessSource` / `audienceContains` を **export しない**。
  [ADR-002](#adr-002-権限の単位をユーザーではなく権限クラスにする) の改訂で認可の入力が
  2 つ（クラス集合とチャンネル audience）になったので、
  **片方だけを呼べる関数が見えていると、落とした実装が静かに動く。**
  「判定器を 1 本にする」というこの ADR の趣旨を、面の分割で補強する。
- **`gdg-lib` の評価器と `wiki/` サーバの判定が一致することをテストで固定する。**
  ここがズレると push が散発的に落ちる — まさに今起きている症状である。
- **生成物 `acl.ts` と `src/acl/` がズレないことを、ビルド成果物に対するテストで固定する**
  （Stage 01 の検証項目）。ソースだけ直してビルドを忘れると、フックだけが古い判定で動く。
- `docs/plans/10-page-acl-spans.md` §0 の権限代数を破らない。visibility を大小比較せず、
  ページ全体の source 上界を計算せず、複数ソースは常に AND。5 値は全順序ではない
  （`chapter-member:tokyo` と `chapter-member:osaka` は比較不能）。

---

## ADR-008: ACL スパンを差分ベースで自動挿入する

### Status

Accepted。除外規則が残す穴は
[ADR-020](#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) が塞ぐ。
**挿入点は `afterFileEdit` から `wk write` に移した**
（[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)）。
差分ベースであること・過剰タグを受容すること・複数ソースは AND であることは変わらない。

### Date

2026-08-18

### Context

`docs/plans/10-page-acl-spans.md` は「`<acl>` スパンは LLM の自己申告に依存するので
セキュリティ境界ではない」と明記している。しかし運用上の意図はそうではなく、**`<acl>` は本来
`acl-gate.ts` が自動挿入するもの**であり、現在それが実装されていないことがバグである。

現行の `acl-gate.ts` に挿入ロジックは設計としても存在しない。`read`/`write` はトレースに
追記するだけ、`shell` は `git commit|push` の正規表現に当たったとき `gdg wiki verify-acl` を
呼んで exit 1 なら deny するだけである。

### Decision

**タグを自動挿入する。挿入は書き込みの唯一の窓口（`wk write`）で、
バイトがディスクに着く前に行う。**

- 対象は `pages/**/page.md` の**本文のみ**。front matter、catalog ページ、`log` は常に除外。
- `BaseRev..worktree` の**追加行**を `<acl src="<id1> <id2>">…</acl>` で包む。id はその run で
  読んだ `member` より狭いソース（`.gdgwiki/ingest-trace/<runId>.json` の `reads` + キュー先頭）。
- 複数ソースは **AND**（スペース区切り）。

**なぜ commit 時ではなく書き込み時か。** commit 時に挿入すると、
エージェントが `git add` を済ませていた場合、
書き換わるのはワークツリーだけで **staged blob はタグ無しのまま commit される**。
書き込み時に挿入すれば、`git add` の時点でディスク上のファイルが既にタグ済みなので、
**この穴が構造的に生じない。**

**なぜフック（`afterFileEdit`）ではなく `wk` か。** 3 つある。

1. `afterFileEdit` は Cursor の Write / Edit ツールにしか発火せず、
   shell 経由の書き込み（`cat > file`、`sed -i`、`python`）を捕まえられない。
   ADR-021 が書き込みを `wk write` に集約したので、**捕まえられない経路が無くなった。**
2. `afterFileEdit` は `failClosed` を持てないので **deny を返せない**。
   ADR-020 の拒否がフックと commit backstop の 2 箇所に割れる原因だった。
   `wk write` なら同期的に拒否できる。
3. 挿入が失敗したときに「書き込み自体は成功したまま」にする必要が無くなる。
   `wk write` は**落ちたら 1 バイトも書かない**。

**commit 時のパスは tripwire として残す。** `git diff --cached`（index）に
未タグの追加行があったら deny する。**そこで挿入はしない** —
検出されたということは `wk` を通らない書き込みが成立したということであり、
**ゲートが漏れている**という意味だからである。
検査対象をワークツリーではなく index にするのは、`git commit -a` / pathspec 指定 /
`git add -p` を跨いで正しいのが index だからである。

これにより `docs/plans/10-page-acl-spans.md` の「自己申告なので境界ではない」という記述は
**修正が必要**になる。タグの付与主体が LLM ではなくフックになるため。

### Alternatives Considered

**LLM の二次呼び出しで由来スパンを判定させる**

- Pros: 過剰タグが減る。精度が高い
- Cons: 書き込みのたびに LLM 呼び出しが増える。しかも判定者が「タグを付け忘れた当人と
  同種のモデル」なので、自己申告依存という問題が形を変えて残る
- Rejected: 上記

**n-gram で raw の内容と一致する追加行だけ包む**

- Pros: 過剰タグがさらに減る
- Cons: **言い換えたら漏れる**
- Rejected: 保守側に倒すという差分ベースの趣旨に反する

**検証のみ（現状維持）でエージェントに書かせる**

- Rejected: エージェントの自己申告に依存し続けることになる

**commit 時にだけ挿入する**

- Pros: 挿入点が 1 つで済む
- Cons: エージェントが `git add` を済ませていると、書き換わるのは
  ワークツリーだけで **staged blob はタグ無しのまま commit される**。
  ワークツリーを見る検証手順ではこの経路を検出できない
- Rejected: 書き込み時挿入なら穴が生じない。commit 時は tripwire に降格する

**`git add` を代行して staged blob を直す**

- Pros: commit 時挿入のまま穴を塞げる
- Cons: index を書き換える副作用があり、`git commit -- <path>` / `-a` /
  partial staging（`git add -p`）の組み合わせを網羅できない
- Rejected: 書き込み時挿入のほうが単純で、index に触らずに済む

**`afterFileEdit` フックで挿入する（当初の決定）**

- Pros: Cursor の Write / Edit ツールをそのまま使える
- Cons: shell 書き込みを捕まえられず、`failClosed` を持てないので deny も返せない
- Rejected: [ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する) が
  書き込みを `wk write` に集約したので、両方の欠点が消える

### Consequences

- **過剰タグになる。** これは意図的である。エージェントが「広く公開してよい行は自分で外せ」と
  判断する形に戻すと、自己申告依存が復活する。
- **挿入点は 1 つである**（[ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く)
  のフック役割分担を参照）。強制は `preToolUse`、変更は `wk` と役割で分ける。
  **`afterFileEdit` を「保険として」復活させない** — 挿入ロジックが 2 箇所になり、
  除外規則がズレて片方だけが catalog を包む。
- **エージェントの手元の内容とディスクの内容が一瞬ズレる。** format-on-save と同じ現象で、
  エージェントは次に `wk read` したときにタグ付き（かつ濾過済み）の内容を見る。
  実害は無いが挙動として書いておく。
- **検証はワークツリーではなく `git show` で commit 済み blob を見る。**
  ワークツリーだけを見る手順は、staged blob の穴を検出できない。
- catalog と `log` を包むと wiki の航行が壊れる。**除外をテストで固定する。**
- 「どちらのソースが厳しいか」を機械が選ぼうとしてはいけない。5 値は全順序ではない。
  複数ソースは AND で並べれば、最も狭いソースが自動的に支配する。

---

## ADR-009: 読取ソースのタグ検査をサーバ側に置かない

### Status

Accepted

### Date

2026-08-18

### Context

`validateReadSourcesTagged`（「`member` より狭いソースを読んだのに、どのページにも `<acl>` が
無い」を捕まえる run 単位の検査）は、現状 dry-run の `POST /api/cli/wiki/validate-acl` からしか
到達できず、その入力 `readSourceIds` は**エージェント自身が書ける** `.gdgwiki/ingest-trace/`
由来である。書き込み経路（`POST /api/cli/wiki/sync`）はこの検査を行わない。

### Decision

この検査はフック（agent hooks）の責務とする。サーバ側はこの検査に関心を持たない。

### Alternatives Considered

**サーバ側 `/sync` でも run 単位の検査を行う**

- Pros: エージェントが書き換えられないところで検査できる
- Cons: サーバは「エージェントが何を読んだか」を知らない。知るにはクライアント申告の
  `readSourceIds` を信じるしかなく、信頼性は変わらない
- Rejected: 責務の所在として、実行時のトレースを持つフック側が担うのが自然

### Consequences

- **既知の残存リスク:** エージェントが機密ソースを読み、言い換えて公開ページに書き、
  front matter の `sources[]` から出典を省くと、サーバ側の検査（`validatePageAclForSync` は
  本文中のスパンと引用済みソースしか見ない）を素通りする。
- したがってこの検査は**協力的なエージェントを前提とする**。
  敵対的・混乱したエージェントに対する封じ込めではない。
  **これは [ADR-004 の脅威モデル](#脅威モデル)が定める前提と同じものである。**
  そちらを唯一の記述とし、ここでは参照だけにとどめる。
- 実効境界は引き続き (a) `canAccessSource` による raw pull 制御と
  (b) `getEffectivePagePermissions` によるページ ACL の 2 つである。

---

## ADR-010: エピソード記憶をローカル `memories/` に置き、昇格時にサーバへアップロードする

### Status

Accepted

### Date

2026-08-18

### Context

エピソード記憶（xangi とユーザーの会話履歴）をどこに置くかで、ACL の効かせ方が決まる。

`raw/` は git push が拒否する（`remote_helper.go` が `pages/**` と `AGENTS.md` 以外を弾く）うえ、
`.gitignore` 済みでサーバ由来の materialize 先である。ローカルで直接書いたファイルは
次の `gdg wiki raw pull` と整合しない。

`POST /api/agent/sources` は **URL しか受け取らない** — `createSource` が URL から `kind` を
導出する作りで、本文を渡す経路が存在しない。

### Decision

二段構えにする。

1. xangi がセッション終了時に会話ログを `agents-local/memories/<ISO8601>-<sessionId>.md` に書く。
   フラット構造、日時ファイル名、`.gitignore` 済み。
2. 睡眠時に `POST /api/agent/sources/inline`（新設）へアップロードし、`source.id` を得る。
   ingest は**ローカルの `memories/` ファイルを読み**、書いたページのスパンをその id で
   `<acl src>` タグ付けする。push 後にローカルファイルを削除する。`raw pull` の往復は挟まない。

`sources.kind` に `conversation` を追加し、**`/sources` の一覧からも
CLI manifest（`GET /api/cli/wiki/sources`）からも除外する。**

manifest から除外する理由は、この二段構えの直接の帰結である。
ingest はローカルの `memories/` ファイルを読むので、manifest に出す必要が無い。
出すと `gdg wiki raw pull` が同じ内容を `raw/` にも materialize し、
`BuildIngestQueue` がそれを pending として並べるので、**同じ会話ログが 2 回 ingest される。**
さらに `.gdgwiki/state.json` は gitignore されたチェックアウトローカルの状態なので、
別マシンや作り直したクローンでは `Ingested` が空になり、
**過去の全会話ログが pending として復活して重複ページを作る。**

サーバ上の `sources` 行は次の 2 つのために存在する:

1. `<acl src="...">` が参照する `source.id`（サーバ側の `acl_unknown_source` 検査を通すため）
2. ローカルの `memories/` を削除したあとに残る恒久記録

### Alternatives Considered

**`memories/` をエピソード層と意味記憶層に物理分割する**

- Pros: 睡眠の「統合」が episodes → semantic の移送として観測可能になる
- Rejected: 複雑さとトークン消費が増えるだけで、対価が無い

**記憶を `wiki/raw/` に置く**

- Pros: `raw pull` の materialize 先と一致し、ingest が完全に既存経路になる
- Cons: アップロード → pull の往復が挟まる。サーバの正規化とローカル生成が二重になる
- Rejected: ややこしさに見合わない

**記憶をサーバに上げず、ローカル専用の独自 ingest 経路を作る**

- Cons: `source_id` が無いので `<acl src>` が使えず、ページ ACL でしか表現できない。
  キュー・ロック・トレース・`verify-acl` を作り直すことになる
- Rejected: 同じものを二度作る

**`memories/` を git にコミットする**

- Rejected: `agents-local` は `gdg-jp/agents` にひもづく実リポジトリ。コミットすると
  全チャプターの記憶が GitHub に載り、front matter の `visibility` はそこでは効力を持たない。
  中央 1 台では共有する相手もいない

### Consequences

- `wiki/` に新規エンドポイントが必要になる（ステージ 02）。`createSource` を
  「URL 経路」と「本文経路」に分岐させず、本文経路の唯一の窓口として作る
  （`docs/plans/09-source-visibility-acl.md` が強調した構造の同型）。
- `conversation` を `fetch-source.ts` の fetchable kind に**加えない**（取りに行く先が無い）。
- **`/sources`・`GET /api/sources`・CLI manifest の 3 つすべてから除外する。**
  manifest に出すと `raw pull` が `raw/` にも materialize し、ローカルの `memories/` と
  合わせて同じ会話ログが 2 回 ingest される（上の Decision）。テストで 3 つとも固定する。
- 記憶がサーバの `sources` になるので、`<acl level="...">` の逃げ道は不要。`src=` で足りる。

---

## ADR-011: 記憶の visibility を Discord チャンネルの静的写像で決める

### Status

Accepted

### Date

2026-08-18

### Context

会話終了時に記憶を書き出すとき、その記憶の権限を誰が決めるか。

### Decision

チャンネル → `SourceVisibility` の静的写像を IAM 設定に持つ。未設定のチャンネルは
`chapter-organizer` + guild の `chapterId` にフォールバックする（狭い側の既定）。

DM は記憶を書かない。スレッドは親チャンネルの写像を継承する。
guild が未束縛のときは記憶を書かず、IAM 設定を促すだけにする。

### Alternatives Considered

**会話の参加者の membership の共通部分から導く**

- Rejected: 「たまたま organizer が 1 人いただけ」で権限が跳ねる

**LLM に会話内容を見て判定させる**

- Rejected: `docs/plans/10-page-acl-spans.md` が「自己申告は境界にならない」と言ったのと同じ罠

**常に最も狭い値で書き、広げるのは人間の明示操作のみ**

- Rejected: 既定としては採用（未設定時のフォールバック）。ただし全件これにすると
  記憶が事実上使えない

### Consequences

- チャンネルは既に組織構造を反映している（`#core-staff` と `#main` は別物だと人間が知っている）。
  静的写像は監査可能である。
- DM は「誰の権限で書かれた記憶か」が曖昧なうえ、xangi は現状 `DirectMessages` intent を
  要求していないので DM イベントがそもそも届かない。MVP では対象外。
- **睡眠の統合では、`visibility` が異なるエピソードを 1 つのページに統合しない。**
  5 値は全順序ではないので「最も狭い値に丸める」は定義できない。

---

## ADR-012: 既存ページの上書きを閲覧者集合の包含で制限する

### Status

**Superseded by [ADR-018](#adr-018-ページ変更権限をクラス集合から直接判定する)。**
判定関数 `audienceContains` が書き込み権限を表現できないことが実装で判明した。
以下の記述は決定の記録として残す。

### Date

2026-08-18

### Context

書き込みは運用者のトークンで push される（clone は 1 つ、`gdg login` も 1 つ）。つまり
`member` クラスの Discord ユーザーが依頼した編集が、運用者（おそらく admin か organizer）の
権限で wiki に書き込まれる。サーバ側は `getEffectivePagePermissions().canEdit` を
**運用者に対して**評価するので、依頼者の権限は構造的に見えていない。

書き込みの内容は Discord チャットに由来するので、その権限はチャンネルの権限セットになる。

### Decision

`preToolUse` の `Write` 判定で、対象ページの現在の閲覧者集合 A(page) が依頼者クラスの
閲覧者集合に**含まれる**場合のみ許可する（`audienceContains`）。
catalog ページと `log` は明示的に例外とする。

### Alternatives Considered

**読めるページはすべて上書きできる**

- Rejected: `#core-staff`（organizer クラス）での会話が、全員が読む `index` や公開ページを
  書き換えられる。「狭いところの決定が広いところの記述を静かに変える」経路になる

**上書きは常に禁止し、新規ページのみ**

- Rejected: wiki の更新という目的そのものを達成できない

**書いたページの visibility を依頼者のクラスに合わせて狭める**

- Rejected: 新規ページには効くが、既存ページの上書きには効かない

### Consequences

- 読めないページはそもそも読めないので、上書き判定から自然に除外される。
- catalog と `log` を例外にしないと、狭いチャンネルからの更新が通らず wiki の航行が壊れる。
  [ADR-008](#adr-008-acl-スパンをフックが差分ベースで自動挿入する) で `<acl>` の対象外にしたのと同じ 2 つ。
- 判定は `gdg-lib` に移設した `audienceContains` をそのまま使う。

---

## ADR-013: インデックスを自作し、kiri をそのまま使わない

### Status

Accepted

### Date

2026-08-18

### Context

query が遅い原因はエージェントの往復回数（index を読む → namespace を ls → ページを cat を
LLM が逐次判断する）である。ただし「top-k を返す検索エンドポイント」は不適切で、
セマンティック検索（`ls`/`grep` による FS 探索）はそのままに、補助的なインデックスを足したい。

kiri（`kiri-mcp-server` v0.26.0）を候補として調べた結果:

- 本文を DuckDB の `blob` テーブルに丸ごと持つ（`~/proj/wiki` で 7.3 GB）
- `snippets_get` が FS を経由せず DB から返すので、read ゲートを**迂回する**
- "semantic" は sha256 ベースの 64 次元ハッシュ化 bag-of-tokens で、言語モデルの埋め込みではない
  （コード中のコメント自身がそう明記している）。日本語の言い換えに効かない
- フィルタは deny のみで allowlist 機構が無い。読むのは root の `.gitignore` と `denylist.yml` だけ
- 列挙が `git ls-files` 固定で FS walk のフォールバックが無い

### Decision

自作の薄い MCP コンポーネント（`agents-index/`）を作る。

- 埋め込みはローカルの多言語モデル。外部送信しない。ストアは sqlite-vec。追尾は chokidar。
- 対象は `pages/` / `raw/` / `memories/` の**すべて**。対象を絞ることは禁止。
- 入力は自然言語、**出力はパス + 行範囲 + score のみ。本文を返さない。**
- nonce で権限クラスを引き、`gdg-lib` の評価器で post-filter してから返す。

### Alternatives Considered

**kiri をそのまま使う**

- Rejected: 上記。特に `snippets_get` の read ゲート迂回と、権限フィルタが deny のみである点

**インデックス対象を「公開度の高いもの」に限定する**

- Rejected: セマンティック検索にしている意味が消える。狭いものが引けないなら索引の価値が無い

**単一インデックスを張り、`postToolUse` の `updated_mcp_tool_output` でフックが結果を検閲する**

- Pros: MCP ツールに限り出力の書き換えが可能という機構は実在する
- Rejected: 評価器が 2 箇所に増える（[ADR-007](#adr-007-acl-評価器を-gdg-lib-の純粋関数-1-本に集約する)）。
  かつ `postToolUse` は fail open 側の挙動が緩く境界に向かない。
  **ただしこの機構の存在は記録しておく** — 将来インデックスを差し替えたときの逃げ道になる

**権限クラスごとにインデックスを分割する**

- Rejected: [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない)

### Consequences

- 既存 OSS は例外なく「全部返す」前提で作られており、権限を後付けすると必ず漏れる。
  **フィルタを一級市民として持つ**ことが自作の理由である。
- post-filter が漏れても被害がパス名に限定されるのは、**2 つが揃っている場合だけ**である。
  1. API が本文を返さない（`snippets_get` 相当を作らない）
  2. **インデックス DB が agent の可読範囲外にある** — `/var/lib/agents-index/index.db` に置き、
     `gdgagent-run` から読めない所有権にする（Stage 07 の uid 分離）
  DB を workdir 配下に置くと、本文を保存している以上、shell を持つエージェントが
  `sqlite3` で全文を読める。**それは上で kiri を却下した理由そのものである。**
- **ADR-006（workdir とインデックスを 1 つに保つ）はこれと両立する。**
  インデックスが 1 つであることと、それが agent の可読範囲に在ることは独立した性質である。
- 記憶のファイル名から主題を除く規約（`<ISO8601>-<sessionId>`）と併用する。

---

## ADR-014: 睡眠を xangi の内部スケジューラとして実装する

### Status

Accepted

### Date

2026-08-18

### Context

睡眠は無人で走るので呼び出しユーザーが居らず、[ADR-005](#adr-005-エージェントに-shell-を残す) の
nonce も発行元がない。かつ睡眠中に Discord から対話が来ると、同じ clone・同じ workdir を触る。

サーバ側の source 再取得はすでに動いている（`wiki/wrangler.toml` の cron `0 16 * * *` →
`enqueueDueSourceRefreshes` → `SOURCE_FETCH_QUEUE` → `SourceImportDurableObject`）。
欠けているのはローカル側の ingest を無人で回すループだけである。

### Decision

xangi の内部スケジューラとして実装する（`scope: 'scheduler'` のセッションが既にある）。

日次の内容:

1. `gdg wiki raw pull` → 通常ソースの取り込み
2. `memories/` の各ファイルを **アップロード → そのファイルを直接 ingest → push → ローカル削除**
3. `INGEST_QUEUE.md` の未 ingest（`raw/` 由来）を消化
4. サマリを運用チャンネルに投稿

**アップロードは、そのファイルを ingest する直前に行う。**
`raw pull` の後にまとめてアップロードしてからキューを回す順序にすると、
その run でアップロードしたソースはキュー再構築より後に生まれるので**その run では処理されない**。
記憶の ingest はキューを介さず、ローカルの `memories/` ファイルを直接読む
（[ADR-010](#adr-010-エピソード記憶をローカル-memories-に置き昇格時にサーバへアップロードする)）。

#### nonce は invocation ごとにスコープする

`system` は**キューとギルドを列挙するためのクラス**であって、エージェントに渡す権限ではない。

- スケジューラ本体（キュー読み・アップロード・git 操作の代行）は `systemClasses` を使う。
- **個々の ingest エージェント invocation には、そのソース 1 件を扱うのに必要なクラスだけを
  載せた nonce を発行する。**ソースの `visibility` / `chapterId` は `INGEST_QUEUE.md` と
  `state.Manifest` に既に入っているので、追加の問い合わせは要らない。
  記憶由来の run はアップロード時の `visibility` / `chapterId` から導く。

全チャプターの organizer を 1 つの nonce に載せると、
プロンプト注入されたソース 1 件が他チャプターの `raw/` と記憶に到達できてしまう。
睡眠は全チャプターの材料を横断する唯一の工程なので、ここで ambient authority を作らない。

#### リポジトリトランザクションミューテックスを 1 本置く

> **改訂（2026-08-19）。** 当初この節は「ロックは設けない — 根拠は呼び出し頻度」であり、
> 「睡眠中に対話が来る確率が低い」ことを根拠に競合を受容していた。
> **この根拠は [ADR-017](#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) と矛盾する。**
> スロットは 4 つあり、**全スロットが同じワークツリーで走る**（ADR-006）。
> 対話同士の同時実行は設計に組み込まれていて、稀ではない。
> さらに、競合で失われるのは編集ではなく **ingest トレースの `reads`** であり、
> それは `<acl>` タグの欠落を意味する。`verify-acl` に渡る `readSourceIds` は
> **ローカルのトレースから作ってクライアントが送る値**なので、
> **サーバ側のバックストップにも検出されない。**
> 機密の問題を頻度で受容していたことになる。

エピソードの独立性は `state.Ingested` と `memories/` の削除については正しいが、
睡眠と対話は**同じワークツリー・git index・HEAD・ingest トレース・`INGEST_QUEUE.md`** を
変更するので、その部分は独立ではない。

**xangi 側にリポジトリトランザクションミューテックスを 1 本置く**（Stage 10 §1a）。

- 保持者は **xangi**。エージェントには渡さない（解放の責任が決まらなくなる）。
- 保持区間は変更ライフサイクルの全体（トレース初期化 → invocation → commit → push → 状態更新）。
- **対話も睡眠も同じロックを取る。** 睡眠を特権化しない。
- スロットプールとは別機構である。**スロットが空いていてもリポジトリ変更は 1 つずつ。**
- 多重防御として、トレースを invocation ごとのファイルに分ける（Stage 11 §8）。

`.gdgwiki/ingest-locks.json` は **document 単位のロックであって、リポジトリ状態を保護しない。**
`10:92` の多重起動フラグも睡眠同士の重複しか防がない。

### Alternatives Considered

**systemd timer で独立プロセスとして起動する**

- Cons: 排他機構が 2 系統になる（xangi は `dataDir` に `proper-lockfile`、ingest は
  `.gdgwiki/ingest-locks.json` を `hostname:pid` 単位で持つ）。かつ nonce の発行元が別になる
- Rejected: フックを通らない実行経路を増やしたくない

**睡眠だけフックを通さない特権実行にする**

- Rejected: 睡眠こそ全チャプターの記憶を横断する工程である。そこを特権化するのは逆

**睡眠中は Discord の受付を止める**

- Pros: 実装が最も簡単
- Rejected: 採用しないが、内部スケジューラが重ければ fallback として有効

**ロックを設けず、頻度で受容する**（当初の決定）

- Pros: 実装が要らない
- Cons: スロットが 4 つあり全スロットが同じワークツリーで走るので、
  **対話同士の競合が稀ではない**（ADR-006 / ADR-017）
- Cons: 失われるのがトレースの `reads`（＝`<acl>` タグ）であり、
  `verify-acl` はクライアント申告なので**サーバ側でも検出できない**
- Rejected: 2026-08-19 の改訂。機密の問題は頻度で受容できない

**git worktree をスロットごと（あるいは睡眠用）に分離する**

- Pros: 物理的に競合しないので直列化が要らない。index と HEAD は worktree ごとになる
- Cons: [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) の
  「workdir は 1 つ」の改訂が必要。`agents-index` の監視対象も分裂する
- Rejected（保留）: **同時実行を上げる必要が出たときの経路として ADR-006 に記録した。**
  ミューテックスの待ちが実用上の問題になったことが、移る条件である

**`system` nonce を 1 つ発行して全 invocation で使い回す**

- Pros: 実装が単純
- Rejected: 個々の ingest エージェントに全チャプターの権限が乗る（上記）

### Consequences

- nonce 発行・ハーネス・監査ログが対話と同じ配管に乗る。
- 会話履歴の取り込みは「セッション終了時に一時ファイルへ溜め、睡眠時に一気に ingest」となる。
  即時 ingest ではない。
- サーバ側の cron は既存のものを使う。**作らない。**
- **`systemClasses` を消さない。** スケジューラ本体の列挙には必要である。
  「列挙には使うが、エージェントには渡さない」の区別を実装とテストで保つ。
- **競合の受容は撤回した。** 睡眠中に対話が `pages/` を書くと、
  git index の取り合い、トレースの上書き、`INGEST_QUEUE.md` 再構築の
  競合が起こりうる。症状は commit 失敗・トレース欠損・キューの読み違いとして現れる。
  **当初は頻度を理由に受容していたが、[Stage 10](10-sleep-scheduler.md) の Context の
  とおり成立しない** — Stage 07 が同じワークツリーでスロットを 4 つ走らせるので
  対話同士の競合も稀ではなく、失われるのはトレースの `reads`（＝`<acl>` タグ）であり、
  `verify-acl` はクライアント申告なのでサーバ側でも検出できない。
  **リポジトリトランザクションミューテックス**（Stage 10 §1a）と
  **invocation ごとのトレースファイル**（[Stage 11](11-wk-mediator.md) §8）で閉じる。

---

## ADR-015: xangi の `skipPermissions` 既定を反転し、`!skip` を削除する

### Status

Accepted

### Date

2026-08-18

### Context

xangi の `src/config.ts:291` は `skipPermissions: process.env.SKIP_PERMISSIONS !== 'false'` で、
**既定が true** である。これにより `cursor-agent` には `--force --trust` が付く
（`src/cursor-cli.ts:43-44`。`CURSOR_TRUST_WORKSPACE` を文字列 `"false"` にしない限り有効）。

さらに `src/discord/message-handler.ts:907` の `!skip` というメッセージ接頭辞で、
**許可ユーザーなら誰でも**その場でスキップ実行に昇格できる。

`--force` 下には deny バイパスが実在する: `shouldBlockShellCommand` は `hasHardDeny` を
パース済みコマンド配列に対して評価するが、unrestricted かつシェルパーサが失敗すると
ユーザー確認分岐がスキップされたうえで配列が空になり、`hasHardDeny` が `false` を返す。

### Decision

フォークで `skipPermissions` の既定を `false` に反転し、`!skip` 接頭辞を**削除**する。
`--force` / `--trust` の既定も off にする。

### Alternatives Considered

**既定は false にするが `!skip` は organizer に残す**

- Rejected: 昇格経路が 1 つ残る。中央 1 台で他チャプターの機密に届く

**Cursor 側の permission 設定だけで縛る**

- Rejected: `--force` 下のバイパスがあるので、フォーク側で閉じないと確実でない

### Consequences

- `-p`（headless）単体では permission をバイパスしない。approval mode は `allowlist` のままで、
  `permissions.allow` が引き続きすべてを門番する。実用性の確認が必要
  （実装前の疎通確認項目に含める）。
- `deny` は `--force` 下でも勝つ（各 `shouldBlock*` が unrestricted 分岐より前に deny を見る）が、
  上記パース失敗のギャップがあるため、`--force` を渡さないことが前提である。

---

## ADR-016: wiki の Vectorize 埋め込み検索を agents-local の設計に組み込まない

### Status

Accepted

### Date

2026-08-18

### Context

`wiki/` には Vectorize（`gdgjp-wiki-pages`、1024 次元 cosine）と `page_embedding_status` テーブル、
`searchVector()` による RRF ハイブリッド検索が実装されている。

しかしこれは `agents-local` より前に作られたレガシーであり、現在誰も使っていない。**削除予定。**

（付随する事実として、書き込み側 `indexPageEmbeddings()` の実質的な呼び出し口は
`processTranslationMessage` の中にあり、`wrangler.toml` が `AUTO_TRANSLATE = "false"` なので
早期 return する。残るのは管理者が `POST /api/admin/backfill-embeddings` を叩く経路のみ。）

### Decision

`agents-local` の設計に組み込まない。`agents-local` の「セマンティック検索」は
`cursor-agent` が `ls`/`grep` で FS を探索することを指し、「インデックス」は
[ADR-013](#adr-013-インデックスを自作しkiri-をそのまま使わない) のローカル完結コンポーネントを指す。

### Consequences

- `docs/plans/00-llm-wiki-overview.md` の「Query は file exploration であって RAG ではない」
  という方針は維持される。
- wiki 側の Vectorize 削除は別作業であり、この MVP のスコープ外。

---

## ADR-017: nonce を invocation ごとの uid に束ねる

### Status

Accepted。[ADR-005](#adr-005-エージェントに-shell-を残す) の nonce に関する主張を訂正する。

### Date

2026-08-18

### Context

ADR-005 は「nonce なら盗んでも自分の本当のクラスしか引けないので昇格に使えない」と書いた。
**この主張は共有 uid の下では成り立たない。**

実装を当たった結果、次の 3 つが同時に成り立つ。

1. [ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く) の
   uid 分離は `cursor-agent` を**単一の** `gdgagent-run` で起動する。
   同一 uid のプロセスは互いの `/proc/<pid>/environ` を読める。
2. `authz.sock` は `0660` でそのグループに共有される。盗んだ nonce を解決する窓口が開いている。
3. したがって `#main` の `member` invocation は、同時に走っている organizer invocation の
   環境を読み、その nonce を解決できる。**得られるのは「自分の本当のクラス」ではなく他人のクラスである。**

ADR-005 の論証が守っていたのは「`XANGI_ACTOR_CLASS=admin` と自己申告する」経路だけであり、
**並行する別 invocation からの窃取**は視野に入っていなかった。

加えて、nonce を環境変数で渡す前提そのものに 2 つの穴がある。

- `PersistentRunner.ensureProcess()` は生存中の子プロセスを再利用し、
  `buildEnv()` は spawn 時にしか走らない（`~/proj/xangi/src/persistent-runner.ts:169,268`）。
  **2 ターン目は 1 ターン目の失効済み nonce を引き継ぐ。**
- `buildCliEnv(channelId, platform)` は値を `getSafeEnv()`（親の `process.env`）から作る
  （`src/cli-process.ts:8`）。**invocation ごとの秘密を運ぶ引数が構造的に無い。**

### Decision

**nonce の有効範囲を uid に束ねる。**

- `gdgagent-run` を **`gdgagent-run-0` 〜 `gdgagent-run-N` の uid プール**にする。
  同時実行スロット 1 つにつき uid 1 つ。
- **エージェント invocation は one-shot だけにする。**`CliRunnerBase` の spawn を使い、
  `PersistentRunner` は agents-local の経路で使わない。
- **ソケットをスロットごとに分ける。** `/run/gdg-agent/<slot>/authz.sock`、
  所有 `gdgagent-svc:gdgagent-run-<N>`、`0660`。
  他スロットの nonce を盗んでも、**それが有効なソケットに到達できない。**
- `buildCliEnv` に `authz?: { nonce, socket }` を足す。
- 呼称を**「invocation スコープ」**に統一する。「ワンタイム」と呼ばない —
  フックはツールコールごとに引くので、一度きりではない。

### Alternatives Considered

**invocation をグローバルに直列化する**

- Pros: 同時に走る agent が 1 つもないので窃取が原理的に起こらない。実装が最も軽い
- Cons: チャプター横断の同時実行がキューになる。Discord の応答性が落ちる
- Rejected: 中央 1 台に全チャプターを収容する（[ADR-001](#adr-001-中央-1-台全チャプター共有のトポロジを採る)）
  以上、全チャプターの会話を 1 本に直列化するのは配れる MVP の姿ではない
- **注記（2026-08-19）**: ADR-014 の改訂で
  **リポジトリを変更する** invocation は直列化されることになった（Stage 10 §1a）。
  ここで却下したのは**すべての** invocation の直列化である。
  読み取りだけの質問応答は並行のままなので、この却下は維持される

**単一 uid のまま、既知の残存リスクとして記録する**

- Pros: 実装コストがゼロ
- Rejected: 昇格経路が開いたままになる。
  [ADR-004 の脅威モデル](#脅威モデル)は「権限クラスの偽装」を**守るもの**に挙げており、
  そこを守れないなら脅威モデルのほうを書き換えることになる

### Consequences

- `setup.sh` が N 個の uid を冪等に作る。sudoers はスロットごとに 1 行ずつ、コマンド固定で増える。
- **N が同時実行数の上限になる。** 上限に達した invocation は待つ。
  N の既定と、待ちが発生したときのログを Stage 07 で決める。
- ワークツリーを `gdgagent-svc` と全スロットで共有する必要が出る。
  所有権は Stage 07 の共有グループ + setgid で解く。
- **ADR-005 の主張は「1 つの invocation の内側で自己申告による昇格ができない」に狭まる。**
  invocation をまたぐ窃取を止めるのは nonce ではなく uid である。

---

## ADR-018: ページ変更権限をクラス集合から直接判定する

### Status

Accepted。[ADR-012](#adr-012-既存ページの上書きを閲覧者集合の包含で制限する) を supersede する。

### Date

2026-08-18

### Context

ADR-012 は「A(page) が依頼者クラスの閲覧者集合に含まれる場合のみ許可する」と決め、
判定に `audienceContains` を使うとした。実装を当たると、この関数では表現できない。

- **問いが違う。** `audienceContains(source, page)` が答えるのは A(page) ⊆ A(**ソース**) であり、
  「その `<acl>` スパンが要るか」を判定する関数である。**行為者の書き込み権限ではない。**
- **型が違う。** 引数は `SourceAudienceKey` **1 つ**。依頼者の権限は
  `{chapterId, role}` の**集合**であり（[ADR-002](#adr-002-権限の単位をユーザーではなく権限クラスにする)）、
  集合を渡す口が無い。
- **既定クラスが必ず落ちる。** `case "chapter-organizer"` は無条件に `false` を返す
  （`wiki/app/lib/acl-spans.server.ts:64`）。`chapter-organizer` は
  [ADR-011](#adr-011-記憶の-visibility-を-discord-チャンネルの静的写像で決める) の
  未設定チャンネルのフォールバック、すなわち**最も普通の依頼者クラス**である。
  この経路では既存ページを 1 枚も上書きできない。**安全でないのではなく、動かない。**

さらに、A(page) ⊆ A(依頼者) を字義どおり実装すると、`public` / `unlisted` は匿名読者を含むので常に不許可、
`member` / `organizer` は全チャプターに跨るのでチャプター単位の依頼者では決して包含できない。
**残るのは依頼者のチャプターに限定された `restricted` ページだけ**になり、wiki の更新という目的を達しない。

### Decision

`gdg-lib` に専用の `canMutatePage(classes, page)` を作り、`audienceContains` を書き込み判定に流用しない。

```
canMutatePage(classes, page):
  classes が空                                    -> false   // 「空 = 制限なし」に倒さない
  classes に role === "organizer" が 1 つでもある  -> true    // チャプターを問わない
  // 以下 member のみを持つ依頼者
  page.visibility が "public" / "unlisted"        -> true
  page.chapterId を classes のいずれかが持つ       -> true
  それ以外                                        -> false
```

catalog ページと `log` は ADR-012 と同じく無条件の例外とする。
`Write` だけでなく **`Delete` と shell 経由の変更にも同じ関数を適用する。**

> **`unlisted` の扱いは要レビュー。** ここでは `public` と同じ側に置いた。
> どちらも membership 無しで読めるからである。
> `member` 相当に寄せる判断もありうる。運用して違和感があれば、この 1 行を変える。

### Alternatives Considered

**A(page) ⊆ A(依頼者) を厳密に実装する（ADR-012 の字義どおり）**

- Pros: 最も安全。ADR-012 の意図に最も忠実
- Cons: 上記のとおり、チャプター限定の `restricted` ページ以外は全部不許可になる。
  エージェントが触れるのが新規ページと catalog と `log` だけになる
- Rejected: wiki の更新という目的そのものを達成できない

**読めるページのうち、依頼者がクラスを持つチャプターのものは上書きできる**

- Pros: 最も単純で最も使いやすい
- Rejected: 上の Decision との差は「`member` が他チャプターの公開ページを触れるか」だけで、
  安全性の利得が小さいわりに規則が 1 つ増える

### Consequences

- **organizer はチャプターを越えて書ける。** `{tokyo, organizer}` を持つ依頼者が
  osaka のページを上書きできる。これは
  [ADR-003](#adr-003-権限クラスは-discord-ロール由来とログイン由来の和集合とする) の
  「全 GDG organizer は相互に信頼する」という既存の前提の上では一貫している。
- **`member` が `public` / `unlisted` ページを書ける。** これは ADR-012 が塞ごうとした
  「狭いところの決定が広いところの記述を静かに変える」経路そのものである。
  **利便性を優先して意図的に開けた。**見落としではない。
  ここを塞ぐなら Alternatives の 1 つ目に戻ること。
- 読めないページは読めないので、判定以前に除外される（ADR-012 と同じ）。
- 5 値の大小比較は行わない。チャプターを跨ぐ比較を一切しないので、全順序を仮定せずに済む。

---

## ADR-019: エージェントの ACL 判定はクラス集合のみを入力にする

### Status

Accepted。[ADR-007](#adr-007-acl-評価器を-gdg-lib-の純粋関数-1-本に集約する) を補う。

### Date

2026-08-18

### Context

ADR-007 は `canAccessSource` を 3 者で共有すると決めた。
ローカル側でこれを呼ぼうとすると、入力が揃わない。

`canAccessSource(source, user, chapters)` は先頭 2 行で
`user.isAdmin` と `source.addedBy === user.id` を見る（`wiki/app/lib/sources.server.ts:145`）。
一方 nonce が返すのは `{ classes, guildId, channelId }` だけで、
**user id も admin フラグも無い。**これは欠落ではなく、
[ADR-002](#adr-002-権限の単位をユーザーではなく権限クラスにする) が
「権限の単位はユーザーではなく権限クラス」と決めた帰結である。

加えて `SourcesManifestEntry`（`cli/internal/wiki/client.go:135`）には
`chapterId` も `addedBy` も無い。Stage 11 と Stage 09 は
マニフェストから `chapterId` を引く前提で書かれていたが、**そのフィールドは存在しない。**

### Decision

**クラス集合だけを入力にする評価器を `gdg-lib` に足す。**

```ts
canClassesAccessSource(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
): boolean
```

`canAccessSource` の `switch` をそのまま写し、`isAdmin` と `addedBy` の短絡だけを落とす。
`private` は**無条件に `false`**。

マニフェストには **`chapterId` だけ**を足す。`addedBy` は足さない —
所有者による判定をローカルで行わないと決めた以上、要らない。

### Alternatives Considered

**ユーザー同一性を通す（nonce が `sub` と `isAdmin` を返し、マニフェストが `addedBy` を持つ）**

- Pros: `canAccessSource` をそのまま使える。`private` の所有者アクセスがサーバと完全に一致する
- Cons: ADR-002 が意図して消したユーザーという単位が復活する。
  かつ **nonce を盗まれたときに漏れる情報が増える**（[ADR-017](#adr-017-nonce-を-invocation-ごとの-uid-に束ねる)）
- Rejected: 単位を 2 つ持つと、どちらが真実かを毎回決めることになる

### Consequences

- **`private` ソースはエージェントから決して読めない。**
  [ADR-014](#adr-014-睡眠を-xangi-の内部スケジューラとして実装する) の
  `classesForSource(private)`（「登録者本人のクラス」）は**実装せず削除する。**
  睡眠は `private` ソースを飛ばす。
- **等価性をテストで固定する。** admin でも所有者でもないユーザーについて、
  `canClassesAccessSource` と `canAccessSource` が全組み合わせで一致すること。
  ADR-007 が守ろうとした「ローカルとサーバで判定がズレる」症状は、
  関数が 1 本であることではなく**この等価性**が担保する。
- マニフェストへの `chapterId` 追加は `wiki/` のサーバと `cli/` の両方に及ぶ。
  Stage 02 の担当とし、Stage 11 と Stage 09 はこれに依存する。

---

## ADR-020: 見出しとコードフェンスに落ちた機密派生行は拒否する

### Status

Accepted。[ADR-008](#adr-008-acl-スパンをフックが差分ベースで自動挿入する) を補強する。

### Date

2026-08-18

### Context

ADR-008 は `<acl>` の自動挿入を決め、除外規則で**見出し行**（理由: 目次が黒塗りだらけになる）と
**コードフェンスの内側**（理由: パーサが解釈してはいけない）を「絶対に包まない」とした。

この 2 つは黙って包まれないだけで、**内容は残る。**
サーバ側の `validatePageAclForSync` が保証するのは
「引用された各ソースが、ページの audience に覆われているか、
**本文のどこかに** `<acl src>` として現れること」だけである
（`wiki/app/lib/acl-spans.server.ts:295-300`）。
**行ごとに包まれたことは検証していないし、できない。**

したがって、機密ソース由来のイベント名が見出しに書かれる、あるいは
機密の設定値がコードブロックにコピーされると、**公開ページにそのまま残る。**

**同じことが front matter の `title` / `summary` / `tags`、catalog ページのエントリ、
`log` にも言える。**そちらは扱いを変える。理由は Decision の末尾に書く。

### Decision

**包めない位置に機密派生行が落ちたら、その編集を拒否する。**

- 挿入パスは、包む必要のある追加行が見出し行またはフェンス内側にあることを検出したら、
  黙って飛ばさずに**編集を失敗させる。**
- `agent_message` にファイル・行・`source_id` を挙げ、
  **本文に移して書き直す**よう指示する。
- 検査と拒否は**書き込みの唯一の窓口**で行う
  （[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する) の `wk write`）。
  バイトがディスクに着く前に同期的に決まるので、検出と deny が 1 箇所に閉じる。

#### front matter・catalog・`log` を同じように拒否しない理由

**拒否すると ingest が成立しないからである。**

`title` を書かずに新規ページは作れない。そして
「そのタイトルは機密ソース由来ではない」ことを機械は判定できない
（挿入パスが知っているのは「この run で狭いソースを読んだ」ことと「この行が増えた」ことだけ。
ADR-008 の前提）。したがって「S が空でない run では metadata を触らせない」は
**`chapter-organizer` 由来の ingest がページを 1 枚も作れない**ことを意味する。
[ADR-011](#adr-011-記憶の-visibility-を-discord-チャンネルの静的写像で決める) の既定が
`chapter-organizer` なので、これは例外ケースではなく**通常ケース**である。

ページ可視性で覆う道も現状は閉じている。
`audienceContains` は `chapter-organizer` に対して**無条件に `false`** を返す
（`wiki/app/lib/acl-spans.server.ts:95`）。page ACL 側に
「チャプター C の organizer だけ」を表す可視性が存在しないためであり、
**A(page) ⊆ A(chapter-organizer ソース) を満たすページが作れない。**

よって現時点では**受容する**。受容していることは
[ADR-004 の脅威モデル](#脅威モデル)の「守らないもの」に書いた。
撤回する道は 2 つ（catalog の決定論的生成 / organizer 限定のページ可視性）で、
どちらかが入ったらこの節を書き直すこと。

### Alternatives Considered

**見出しとフェンスも包む**

- Pros: 拒否が発生せず、漏れもない
- Cons: 権限の無い読者から見た目次が黒塗りだらけになる。
  ADR-008 が見出しを除外したのはまさにこれを避けるためである。
  フェンス内側に `<acl>` を入れるとパーサの解釈も壊れうる
- Rejected: ADR-008 の除外規則と正面から衝突する

**包まずに、ページ全体の visibility をそのソースに合わせて狭める**

- Pros: 黒塗りが出ない。拒否も出ない
- Cons: **見出し 1 行で公開ページ全体が organizer 限定になる。**
  影響がページ単位に跳ねるうえ、[ADR-018](#adr-018-ページ変更権限をクラス集合から直接判定する) の
  変更権限の判定と噛み合わない
- Rejected: 静かに影響範囲が跳ねる変更は、後から誰も追えない

### Consequences

- **エージェントの手戻りが増える。** 機密由来の内容を見出しに置いた編集は 1 回失敗し、
  書き直しになる。過剰タグを受容した ADR-008 と同じ方向の割り切りである。
- **検査点は 1 つである。** 書き込みの唯一の窓口が `wk write` になったので
  （[ADR-021](#adr-021-ワークツリーの読み書きを-wk-に集約する)）、検出と deny が同じ場所で起きる。
  **2 箇所に分けない。**分けると除外規則がズレて、片方だけが catalog を包む。
- この決定は ADR-009 の「協力的なエージェントを前提とする」という限界を変えない。
  拒否できるのは**`wk` を通った書き込み**だけである。

---

## ADR-021: ワークツリーの読み書きを `wk` に集約する

### Status

Accepted。[ADR-005](#adr-005-エージェントに-shell-を残す) の shell の扱いを狭め、
[ADR-008](#adr-008-acl-スパンをフックが差分ベースで自動挿入する) の挿入点を移す。

### Date

2026-08-19

### Context

`<acl src="…">` スパンは、**ページ可視性より狭い記述**を表すための仕組みである。
ところが当初の read ゲートはページ単位の可視性しか見ていなかった。
その結果、`public` / `member` のページに埋まった `chapter-organizer` 由来のスパンが、
**そのページを読めるすべてのクラスに平文で見えていた。** 書き込み側も同じで、
スパンを読めないクラスがそのファイルを上書きできた。

「エージェントがファイルを読んだら、権限に応じて `<acl>` が自動で消える」形にしたい。
**しかしフックでは実装できない。**実装を確認した結果は次のとおり。

1. **フックはツール出力を書き換えられない。**
   `~/.cursor/skills-cursor/create-hook/SKILL.md` の Event Output Cheat Sheet —
   `preToolUse` が返せるのは `permission` / `user_message` / `agent_message` /
   **`updated_input`** の 4 つ。`postToolUse` の `updated_mcp_tool_output` は
   **MCP ツール限定**。`beforeReadFile` はディスク読み取りの後に走り、配送を止めるだけである
   （[ADR-004](#adr-004-信頼境界を-pretooluse-フックuid-分離os-サンドボックスの-3-点に置く)）。
   書き換えられるのは**入力**であって、読み取った本文ではない。
2. **shell の `cat` はそもそもフックの濾過対象にならない。**
3. **クローンの本文は「clone した人間 1 人」の clearance で決まる。**
   `wiki/app/routes/api.cli.wiki.snapshot.ts:73` は、`fullClearance` なら
   `<acl>` タグごと全文を返し、そうでなければページ全体に `removeAclSpans` を掛けて
   `aclRedacted: true` を立てる。**all-or-nothing であり、invocation ごとではない。**
   運用者は広い clearance でクローンするので、ディスクにはスパン本文が載る。

サーバ側の濾過（`redactAclSpans` + `buildAclSpanPolicy`）は閲覧者 1 人ぶんの述語で走るが、
述語が `sources` テーブルを引くので、そのままではローカルで使えない。

### Decision

**ワークツリーの読み取りと書き込みを `wk` コマンド 1 本に集約する。**
`preToolUse` は「`wk` 以外の経路を deny する」係になる。

| 層 | 実体 | 責務 | ステージ |
|---|---|---|---|
| **強制** | `preToolUse`（`acl-gate.ts`） | `wk` 以外の読み書き経路を deny する。それだけ | [05](05-cursor-harness-pretooluse.md) |
| **実施** | `wk`（`/opt/gdg-agent/bin/wk`） | 濾過（read）・再合成と挿入（write）・変更権限の判定 | [11](11-wk-mediator.md)、挿入は [06](06-acl-span-autoinsert.md) |

**実装順は 11 → 05 である。** `wk` は単体で作って単体で検証できるが、
ゲートを先に入れると Read を deny されたエージェントに代替手段が無い状態が生まれる。

- 両方とも **root 所有**で agent uid から書けない。両方とも
  `/opt/gdg-agent/lib/acl-core.ts` を共有し、判定を二重に持たない。
- ゲートは `Read` / `Grep` / `List` が
  `pages/**` / `raw/**` / `memories/**` を対象にしたら deny し、`wk` を案内する。
- **変更系ツール（`Write` / `Delete` / `Edit` 系）と未知の `tool_name` は、
  パスを見ずに無条件 deny する。** パス条件を付けると、gated path の外に
  `.git/hooks/pre-commit`・`.gitattributes` の filter driver・
  `<workdir>/.cursor/sandbox.json` を置く経路が残り、
  **argv allowlist と `readBoundary` が同時に無効化される**
  （[Stage 05](05-cursor-harness-pretooluse.md) §2）。
  書き込み経路は `wk write` の `pages/**/page.md` allowlist 1 本だけである。
- `Shell` は **argv allowlist** にする。分解したすべての単純コマンドの `argv[0]` が
  `wk` であることを要求し、解釈できないものは deny する。
  **受理する文法を先に狭める**実装であり、汎用の shell パーサを持ち込まない
  （Stage 05 §3）。
- `wk read` はページ可視性を判定したうえで、`redactAclSpans` で
  **読めないスパンだけを `⬛︎⬛︎⬛︎` に置換**して返す。
- `wk write` は、**読めなかったスパンを元のバイト列のまま差し戻してから**
  `<acl>` の自動挿入と検査を行い、1 つでも落ちたら 1 バイトも書かない。

これは [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) が
却下した射影ビューではない。**ツリーを materialize しない。**濾過は FS ではなく
コマンド境界で行うので、workdir もインデックスも 1 つのままである。

### Alternatives Considered

**読み取りだけ `wk` にし、書き込みは Cursor の Write + `afterFileEdit` のまま**

- Pros: 変更が小さい。エージェントは自前の編集ツールを使い続けられる
- Cons: 3 つの問題が残る。
  ①黒塗りを見たエージェントが書き戻すとスパンが消えるので
  「濾過されたファイルは書けない」規則が要る。過剰タグ設計（ADR-008）では
  **ほとんどのページが編集不能**になる。
  ②`afterFileEdit` は `failClosed` を持てないので deny を返せず、
  [ADR-020](#adr-020-見出しとコードフェンスに落ちた機密派生行は拒否する) の拒否が
  「検出は 2 箇所・deny は 1 箇所」に割れたままになる。
  ③shell 書き込みを拾うための commit backstop が要る
- Rejected: 書き込みも通せば 3 つとも消える

**スパン単位で fail closed（読めないスパンを含むファイルは丸ごと deny）**

- Pros: `wk` が要らない。ゲートの変更だけで閉じる
- Cons: 過剰タグ設計では、ページの大半がスパンになる。
  狭いクラスからは**ほとんどのページが読めなくなる**
- Rejected: 安全側ではあるが、wiki を引けなくなる

**権限クラスごとの射影ワーキングツリー**

- Rejected: [ADR-006](#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) のとおり。
  中央 1 台では再構築と再インデックスが睡眠の時間を食い潰す

**`preToolUse` の `updated_input` で Write ツールの `content` を書き換える**

- Pros: エージェントが自前の編集ツールを使い続けられる
- Cons: Edit 系ツールは救えない。濾過されたファイルでは `old_string` が
  ディスクの実体（スパン本文）と一致しないので、照合そのものが失敗する
- **却下ではなく保留。** Stage 05 の疎通確認で「Write / Edit の deny に
  エージェントが馴染めない」と分かった場合の代替案として残す

### Consequences

- **`afterFileEdit` が不要になる。** Cursor の Write / Edit ツールを deny する以上、
  発火する余地が無い。`~/.cursor/hooks.json` は `preToolUse` 1 本に戻る。
  ADR-004 のフック役割分担を「強制 = `preToolUse` / 変更 = `wk`」に改める。
- **commit backstop が tripwire に降格する。** 書き込み経路が 1 本になり、
  `wk write` は常にタグ済みの内容しか書かないので、ワークツリーが未タグになる経路が無い。
  backstop は「挿入して deny」ではなく「**staged blob に未タグの追加行があったら
  ゲート違反として deny**」になる。検査対象は `git diff --cached`（index）であって
  ワークツリーではない — `git commit -a` / pathspec / `git add -p` を跨いで正しいのは index である。
- **shell のパス抽出が要らなくなる。** ADR-005 は「コマンド文字列の解析は原理的に不完全」と
  書いたが、allowlist にすると**不完全さが安全側に反転する**。解釈できないコマンドは deny になる。
  ADR-005 の判断そのもの（shell を残す）は維持し、面を `wk` に狭める。
- **`wk` 自体が新しい単一障害点になる。** 生出力モード（`--raw`、`wk sh -c`）や
  検査を飛ばすフラグ（`--no-verify`）を 1 つでも作れば、境界が消える。**作らない。**
- **未検証の前提が 1 つ増える。** `cursor-agent` が Read / Write / Edit の deny を受けて
  `wk` に切り替えるかどうかは、実装前に疎通確認する。
  **通らなければ止まって報告する**（Stage 05 の疎通確認）。
- スパン id → `visibility` のローカル解決手段が要る。
  `.gdgwiki/acl-sources.json`（`sourceId` → `visibility` / `chapterId` だけ。
  パスも本文もタイトルも持たない）を `raw pull` が生成し、
  会話ソースは xangi がアップロード時に追記する。
  **id が引けないスパンは deny 扱い**（サーバ側の「missing → admin only」と同じ側）。

---

## ADR-022: ローカル実行物を Node ネイティブ TypeScript に統一する

### Status

Accepted。

### Date

2026-08-19

### Context

agents-local MVP では、既存の ACL gate に加えて `wk`、共有 ACL core、自動挿入 core、
ACL bundle を `/opt/gdg-agent/` から実行する。従来のゲートと Codex pre-commit hook は
JavaScript module だが、後続の設計は TypeScript 型で payload、権限クラス、トレースを表す。

JavaScript 実行物だけを残すと、開発時の型検査から信頼境界のコードが外れる。
一方、通常の TypeScript build やランタイム transpiler を必須にすると、root 所有で
依存ゼロにしたい `/opt/gdg-agent/` に node_modules または別の生成物が必要になる。
ソースと配布物が分かれると、ソースだけ更新してフックの実体が古いまま残る経路も増える。

Node 22.18.0 以降は type stripping が既定で有効であり、消去可能な TypeScript 構文だけなら
`node file.ts` で直接実行できる。ただし Node は `tsconfig.json` を実行時には読まず、
module system は最寄りの `package.json` で決まり、相対 import には `.ts` 拡張子が要る。

### Decision

**ローカルのフック・`wk`・ACL bundle を Node ネイティブ TypeScript に統一する。**
共通の実行契約は [Stage 00](00-typescript-runtime.md) に置く。

- Node.js の最低バージョンを `22.18.0` とする。
- 起動は `node <absolute-path>.ts` とし、`tsx`、`ts-node`、custom loader を使わない。
- `erasableSyntaxOnly` / `verbatimModuleSyntax` / `strict` で型検査する。
- `enum`、parameter property、runtime namespace など変換を要する構文は禁止する。
- 相対 import は `.ts` まで書き、型だけの依存は `import type` / `export type` にする。
- `.codex/hooks/`、`cli/internal/wiki/hooks/`、clone の `.gdgwiki/hooks/`、
  `/opt/gdg-agent/` に `{ "private": true, "type": "module" }` を置く。
  本番の marker と実行物は root 所有にする。
- `gdg-lib/src/acl/agent.ts` の bundle は `cli/internal/wiki/hooks/acl.ts` として生成し、
  `/opt/gdg-agent/lib/acl.ts` として配布する。
  **実行物は、リポジトリ上も配置後も平坦な 1 ディレクトリに揃える** —
  相対 import（`./acl-core.ts` / `./acl.ts`）が両方で同じ形のまま解決する必要がある。
- `wk` の本体は `/opt/gdg-agent/lib/wk.ts` とする。
  `/opt/gdg-agent/bin/wk` は argv allowlist を維持するための薄い root 所有 launcher であり、
  本体を `node` で起動する以外の責務を持たない。

Stage 00 で既存ファイルとして移行するのは ACL gate と Codex pre-commit hook の 2 つだけである。
`wk.ts`、`acl-core.ts`、`acl-insert-core.ts`、生成物 `acl.ts` は後続ステージが最初から
TypeScript として新規作成する。

### Alternatives Considered

**TypeScript source を JavaScript に compile して配布する**

- Pros: 古い Node でも動き、TypeScript 構文の制約が少ない
- Cons: source と配布物が分かれ、生成忘れ・古い embed・source map の管理が再び必要になる。
  このリポジトリの実行環境は Node 22 以上に揃えられる
- Rejected: 信頼境界の source と実体を 1 ファイルにする目的に反する

**`tsx` または `ts-node` を本番でも使う**

- Pros: TypeScript のほぼすべての構文と tsconfig 機能を使える
- Cons: `/opt/gdg-agent/` に third-party runtime と依存解決を持ち込み、インストール・更新・
  所有権の面を増やす
- Rejected: フックと `wk` の依存ゼロという制約に反する

**Node の transform flag で非 erasable 構文も許可する**

- Pros: `enum` や parameter property を使用できる
- Cons: Node version ごとの実験的挙動に依存し、typecheck と実行時変換の責務が曖昧になる
- Rejected: この小さな実行物に変換必須構文は必要ない

**ESM marker を置かず構文検出に任せる**

- Pros: package marker の設置処理が不要
- Cons: 配置場所や Node の検出規則で module system が変わりうる。root 所有の実行環境を
  決定論的に再現できない
- Rejected: セキュリティ境界の起動方式を暗黙の検出に依存させない

### Consequences

- 開発・テスト・本番が同じ `.ts` を起動し、生成物の取り違えが減る。
- Node ネイティブ実行は型検査をしないため、専用 `tsconfig.node-scripts.json` と
  `pnpm typecheck:node-scripts` を CI の必須項目にする。
- Node の最低バージョンは曖昧な `>=22` ではなく `>=22.18.0` になる。
- TypeScript 5.9 系と `@types/node` を root の直接 devDependency として管理する。
- `/opt/gdg-agent/package.json` もフック・library と同じく root 所有で設置・検査する。
- `wk` は extensionless command を維持するため launcher が 1 枚増えるが、launcher に
  ACL 判定、引数解釈、fallback を置かないことで判定の一元化は崩れない。

## ADR-023: ローカル検証環境を Ubuntu VM に置き、Docker を採らない

### Context

検証対象は `install.sh`、systemd user unit、tmpfiles、uid 分離、AppArmor、Cursor の OS
サンドボックスを含む本番経路である。さらに実 Cursor CLI と production wiki を使うため、課金と
非決定性の観点から CI には載せられない。

### Decision

macOS の Lima 上に Ubuntu 24.04 VM を作る。ホストの checkout は read-only でマウントし、VM 内の
書き込み可能な `/opt/gdgjp` コピーから無改変の `install.sh` を実行する。Discord は使わず、
service-user-only Unix socket の `xangi harness invoke` を operator entry point にする。

### Alternatives Considered

Docker は CI に向くが、Docker Desktop の LinuxKit では AppArmor と systemd user/linger/tmpfiles の
本番経路を再現できない。Cursor sandbox の nested namespace/seccomp も別経路になるため採用しない。

### Consequences

VM は使い捨てで `limactl delete` によりリセットする。固定 Cursor 版を事前配置するため、
`install.sh` の latest Cursor 取得だけはこの検証対象から外れる。arm64 VM の結果は x86-64 本番の
保証ではなく、差分を Stage 12 に記録する。

## ADR-024: CI の script-tests における private submodule チェックアウトの失敗と暫定方針

### Status

Accepted

### Date

2026-09-03

### Context

`.github/workflows/ci.yml:72-84` の `script-tests` ジョブは `actions/checkout@v4` で `submodules: true` を指定している。
しかし本リポジトリ `gdg-jp/gdgjp` は PUBLIC であり、submodule である `agents-local` のリモート `gdg-jp/agents` は PRIVATE である。
GitHub Actions の既定 `GITHUB_TOKEN` はパブリックリポジトリからプライベートリポジトリへの読み取り権限を持たないため、`git submodule update` が `fatal: repository 'https://github.com/gdg-jp/agents.git/' not found` で失敗する（run 33026067379 / job 98367586019 で実証確認済み）。
これまで `script-tests` の起動述語が `.github/scripts/*.mjs` に限定されていたためジョブがほとんど発火せず、この失敗が表面化していなかった。

さらに、仮に checkout の submodule 失敗を無視して後続ステップへ進んだとしても、`.github/scripts/gdg-agent-layout.test.mjs` の submodule 依存箇所（`:14-15` の `agents-local/lib/apply-ownership.sh` と `agents-local/install.sh` をガード無しで読む箇所、および `:184` の `.cursor/mcp.json`、`:190` の `AGENTS.md`、`:200` の `config/cli-config.json`、`:214` の `setup.sh`、`:217` の `setup.sh` 検査）が `ENOENT` でテスト失敗を引き起こす。

### Decision

**Stage 01 では `ci.yml` の `submodules: true` を外すことや PAT 注入などの恒久対処・暫定対処を行わず、事実の記録に留める。**

- Stage 03 (`03-consolidate-agent-host.md`) において `agents-local` submodule 自体を monorepo 内の `agent-host/` へ統合・ミラー解消し、submodule 依存そのものを撤廃する。
- したがって、submodule チェックアウトに起因する問題は Stage 03 で自然に解消されるため、Stage 01 でワークアラウンドを重ねることは避ける。
- `.github/scripts/gdg-agent-layout.test.mjs` に対しても、Stage 03 および Stage 05〜07 の担当であるためここでは中身を変更しない。

### Consequences

- GitHub Actions 上で `script-tests` ジョブが起動した場合、Stage 03 の submodule 統合が完了するまでは `actions/checkout@v4` の submodule clone 段階でジョブが失敗する（既知の制約）。
- ローカル環境（submodule が手動でチェックアウトされている環境）では `node --test .github/scripts/*.test.mjs` により `gdg-agent-layout.test.mjs` を含むすべてのテストが正常にパスする。

---

## ADR-025: 公開前コンテンツレビューと squash import による public 化

### Status

Accepted

### Date

2026-09-03

### Context

`docs/agents-local-refactoring/index.md` の全体方針において、`agents-local` を `gdgjp` monorepo 内の `agent-host/` へ統合して完全に public 化することが決定された。
しかし、統合元である `gdg-jp/agents` は PRIVATE リポジトリであり、統合先である `gdg-jp/gdgjp` は PUBLIC リポジトリである。一度公開された内容は検索インデックスやキャッシュに残るため、この操作は不可逆である。

機構面（sudoers 生成スクリプト、フック、uid 分離設定など）の多くは既に monorepo 側（`scripts/gdg-agent/` や `docs/`）で公開済みであったが、`agents-local` 側の運用ドキュメントやデータには以下の非公開情報・内部情報が含まれていた。

1. `agents-local/docs/devfest-2026-timetable-draft-v1.*`: 未公開の DevFest Kansai 2026 タイムテーブル草案、登壇交渉ステータス、private Google Sheets URL。
2. `agents-local/docs/discord/gdgkwansai.md`: GDG Greater Kwansai Discord サーバーのサーバー ID、カテゴリ ID、チャンネル ID 一覧。
3. `agents-local/ENVIRONMENT.md`: 本番ホスト名（`mincra-srv`）、operator アカウント名（`harineko`、uid 1000）、個人 git リモート、ホームディレクトリパス台帳。
4. `agents-local/.agents/skills/gws-*/SKILL.md`: `googleworkspace/cli` 由来のスキル定義。
5. `agents-local/AGENTS.md`: エージェントの人格・運用ルール。

また、`gdg-jp/agents` のリポジトリ自体の visibility を public に切り替えると、コミット履歴（100 commit 超）に含まれる過去の機密情報や下書き情報まで全て不可逆的に公開される。

### Decision

**1. 棚卸し対象の処遇**
- `devfest-2026-timetable-draft-v1.md` / `.csv`: **移設（作業ツリーから削除）**。未公開のイベント企画情報であり公開意図がないため。履歴は private な `gdg-jp/agents` に保持される。
- `docs/discord/gdgkwansai.md`: **移設（作業ツリーから削除）**。内部運用データであり、エージェント実行に必要な場合はホスト側の設定や IAM 経由で渡すこととする。これに伴い `AGENTS.md` 内の参照リンクも削除。
- `ENVIRONMENT.md`: **秘匿化**。systemd 構成、uid 分離、ソケット通信等の構成説明は Stage 03 以降も有用なため残すが、ホスト名（`<production-host>`）、operator 名（`<operator>`）、個人リモート URL 等をプレースホルダーに置換した。
- `.agents/skills/gws-*/SKILL.md`: **そのまま公開**。`googleworkspace/cli`（Apache 2.0 ライセンス）由来の汎用スキル定義であり、組織固有データや認証情報を含まないことを確認した。
- `AGENTS.md`: **そのまま公開**（軽微な参照削除のみ）。Stage 03 で `agent-host/workspace/` の正本となる。

**2. 公開方式: squash import の採用と `gdg-jp/agents` のアーカイブ**
- `gdg-jp/agents` の visibility は **public に切り替えない**。履歴アーカイブとして **private のまま archive** とする。
- Stage 03 では、本レビューおよび整理が完了した **HEAD のみを monorepo 内 `agent-host/` へ squash import**（単一コミット）する。これにより過去のコミット履歴は公開されない。

**3. Stage 10 以降の main ブランチ保護と root 相当権限の扱い**
- Stage 10 の pull 型自動適用（Tier 2）が稼働すると、public リポジトリである本リポジトリの `main` への push が実質的に本番ホストの root 相当の権限行使となる。
- したがって、Stage 10 以降は branch protection、コミット署名の強制、およびリリース署名鍵（Stage 09 で導入）の厳格な管理を前提条件とする。エージェント自身を含む非特権経路からリリース生成リポジトリへの push ができないことを不変条件としてテストで固定する。

### Consequences

- `agents-local` から未公開資料および Discord 内部 ID が除去され、Gitleaks および URL スキャンがクリーンな状態となった。
- `gdg-jp/agents` の git 履歴は monorepo 側には持ち込まれないが、削除済みファイルの復活防止等の不変条件は monorepo 側のテスト（`.github/scripts/gdg-agent-layout.test.mjs`）で担保される。
- Stage 03（`agent-host/` への統合）を開始する前提条件が満たされた。

---

## ADR-026: 収束エンジンを Go (gdg CLI) とし宣言的 spec・ピン留め・pull 型配信を採用する

### Status

Accepted

### Date

2026-09-04

### Context

`docs/agents-local-refactoring/index.md` の Stage 04 において、命令的なプロビジョニング用シェルスクリプト群（7 本・約 1,755 行）から GitOps が乗る宣言的な状態管理へと移行するための設計判断を記録する。

当時抱えていた問題は以下の通りであった:

1. **設定が命令的**: `AGENT_MODEL=composer-2.5` や Discord UX フラグが `install.sh` 内の quoted heredoc にハードコードされており、モデル変更や slot 変更にシェル編集が必要であった。
2. **ピン留めの不統一**: `cursor-agent` が第三者（`karaage0703/xangi`）の `releases/latest` を root パイプ実行（`| bash`）し、`xangi` は ref ピン無しで `git pull --ff-only`、`gdg` は無条件 `gdg update -y`、lockfile 不在時は `npm install` にフォールバックしていた。
3. **`setup.sh` の空洞化と重複**: `setup.sh` の大部分は `install.sh` や `lib/install-layout.sh` と重複しており、固有のロジックは 13 検査のみであった。また出力 heredoc も本体と drift していた。
4. **sudoers 書き込みの実バグ**: 稼働中の `/etc/sudoers.d/gdg-agent` を直接 truncate して書き込み、`visudo -c` の検証が事後に別スクリプトで走る構造であったため、書き込み途中の破損でホスト全体の `sudo` が死ぬ危険があった。
5. **一時診断コードの残存**: `cli/internal/wiki/hooks/acl-gate.ts` の `debugGwsSnapshot` が `gws` 呼び出しごとに `/tmp/gws-acl-debug-*` (mode 0o644) を生成していた。
6. **未検証 lockfile の存在**: root と `agent-host/` に `skills-lock.json` が存在するが、照合コードが存在せず放置されていた。

### Decision

**1. 収束エンジンの選定: `gdg` CLI の Go サブコマンド（Stage 06-07）**
- 収束エンジンはシェルではなく `gdg` CLI の Go サブコマンド（`gdg agent-host`）として実装する。
- 理由: 読み取り側（`cli/internal/wiki/hooks.go:131` の `inspectInstalledScripts`）が既に `gdg` の中に存在し、単一バイナリで TS+Go の既存スタックに収まるため。
- Ansible および NixOS は不採用とする。NixOS は cursor-agent の AppArmor がパス固定・sudoers/sandbox allowlist が安定パス前提・xangi が packaging 未解決で破綻する。Ansible は 1 台の自前ホストに対して過剰な抽象化とランタイム依存を持ち込む。
- Ansible への切替基準: 2 台目のホストが必要になる / inventory 管理が必要になる / Go 収束エンジンが約 2,000 行を超えた時点で再検討する。

**2. 配信方式: pull 型配信（Stage 09-10）**
- ホストが定期的にリポジトリのリリースまたは署名付きマニフェストを pull して収束する方式を採用する。
- 理由: public リポジトリにおいて self-hosted runner は fork PR からのコード実行経路となり極めて危険であり、ssh デプロイは CI に root 相当の秘密鍵を持たせる必要があるため。

**3. 宣言的 spec の導入**
- `agent-host/agent-host.json` を単一の真実（Single Source of Truth）とし、JSON Schema（`agent-host.schema.json`）で厳格に検証する。
- モデル名、slotCount、ピン留め（`cursorAgent`, `xangi`, `gws`, `gdgCli`, `node`）、パス（`agentRoot`, `workspace`, `runRoot`）を spec に外出しする。
- Lima 開発 VM 用の差分を overlay `agent-host.dev.json` に閉じ込める。
- Stage 04 では Go は書かず、シェル側から `node -e`（`spec_get`）経由で spec を読み取る。

**4. ピン留めとダイジェスト入手手順**
- **`cursor-agent`**: `downloads.cursor.com/lab/${version}/linux/${arch}/agent-cli-package.tar.gz` から取得し、per-arch（x86_64, aarch64）の SHA256 を検証した上で `/opt/cursor-agent` に展開・配置する。ダイジェストの入手手順は、公式 URL より対象アーカイブをダウンロードし、`sha256sum` で計算した値を spec に固定する。
- **`xangi`**: 指定コミット SHA (`pins.xangi.ref`) を `git checkout --detach` でチェックアウトし、`git rev-parse HEAD` で照合する。`package-lock.json` を必須とし、不在時の `npm install` フォールバックは廃止する。
- **`gws`**: spec の `pins.gws`（バージョン + per-arch SHA256）で照合・インストールする。
- **`gdgCli`**: spec の `pins.gdgCli`（バージョン + per-arch SHA256）で照合し、不一致時のみ GitHub Releases からダウンロード・検証・配置する。

**5. `setup.sh` の削除と `lib/verify.sh` への退避**
- `setup.sh` を削除し、固有の 13 検査を `agent-host/lib/verify.sh` に退避する（Stage 07 で Go の `verify` に移送するまでの一時退避）。
- プロビジョニング用シェルスクリプト本数は 5 本（`install.sh`, `lib/install-layout.sh`, `lib/apply-ownership.sh`, `lib/verify.sh`, `agents-index/install.sh`）を維持する。

**6. sudoers / tmpfiles の validate-then-rename**
- `/etc/sudoers.d/gdg-agent` の直接 truncate を廃止し、同一ファイルシステム上の一時ファイルに書き出した後、`visudo -cf "$tmp"` で構文検証を通してから `chmod 0440` して `mv -f` でアトミックに置換する。
- 一時ファイル検証が失敗した場合は稼働中の sudoers に触れず即座にエラー終了する。
- tmpfiles についても同様の方式とする。

**7. 不要コード・未検証ファイルの削除**
- `cli/internal/wiki/hooks/acl-gate.ts` の `debugGwsSnapshot` を削除し、`/tmp/gws-acl-debug-*` の生成を根絶する。
- 照合コードが存在せず実体ファイルもない `skills-lock.json`（root および `agent-host/`）を削除する（「検証しない lockfile は残さない」）。

### Consequences

- `agent-host` のモデル、slot 数、外部依存ピン留めがすべて宣言的 spec に一元化された。
- 第三者インストーラのパイプ実行が排除され、すべての依存の完全性と真正性が機械的に検証されるようになった。
- sudoers 生成時の実バグが解消され、不正な設定による sudo 破損が構造的に防止された。
- プロビジョニング用シェル本数 5 本が維持され、Stage 05（レイアウト Go 生成への移行）および Stage 06-07（Go 収束エンジン導入）への前提条件が整った。

---

## ADR-027: agents-index を spec と収束エンジンへ吸収し、プロビジョニング用シェルを bootstrap 1 本に一本化する

### Status

Accepted

### Date

2026-09-04

### Context

`docs/agents-local-refactoring/index.md` の Stage 08。同一ホスト上に 3 本目のインストーラ（`agents-index/install.sh`・252 行）が残っており、`agents-local/install.sh`（Stage 07 で撤去済み）との間に「先にこちらを走らせろ」という暗黙の実行順序と hard-fail があった。加えて `--slots 4` が spec の `slotCount` と二重管理になっていた。daemon は monorepo チェックアウト（`/opt/gdgjp/agents-index`）から `node src/cli.ts` で起動しており、Stage 13 の `/opt/gdgjp` 撤去をブロックしていた。

### Decision

**1. agents-index を宣言的 spec に載せる**

- `agent-host/agent-host.json` に `agentsIndex`（`enabled` / `dataDir` / `dbPath`）を追加し、`agent-host.schema.json` で検証する。
- `agents-index.service` の `--slots` と `SupplementaryGroups` は `spec.slotCount` から、`--run-root` は `spec.paths.runRoot` から導出する。リテラルで持たない。
- `agents-index.service` は **system unit**（`/etc/systemd/system/`、`User=gdgagent-svc`、`WantedBy=multi-user.target`）とする。xangi/langfuse は `systemctl --user` だが、agents-index は per-slot ソケットを `gdgagent-run-<N>` グループへ `chgrp` するため `SupplementaryGroups=` が必須で、非特権の `--user` マネージャはグループ資格情報を設定できない（`GROUP` ステップで失敗する）。収束エンジンに system scope の `SystemdUnitResource` 対応を追加した。

**2. 収束エンジンへ吸収する（新しいリソース型は足さない）**

- `cli/internal/agenthost/agentsindex.go` が既存の `dir` / `file` / `systemd` / `exec` リソースだけで agents-index を展開する。全リソースが 1 つの `plan` に入るため、旧 hard-fail（順序依存）は不要になった。
- `agents-index.service` の `[Unit]` にデプロイ成果物全体のダイジェスト（`# gdg-artifacts-rev:`）を埋め込む。ソース・ACL バンドル・lockfile のいずれかが変わると unit の内容が変わり、`SystemdUnitResource` が daemon-reload + restart を行う。新しい `gdg` バイナリを配っても古い Node プロセスが動き続けることはない。
- `agentsIndex.enabled` が `false` のときは撤去を宣言する。`SystemdUnitDeleteResource`（`FileDeleteResource` の systemd 版）で unit を停止・無効化・削除し、`/opt/agents-index` も消す。永続データ `/var/lib/agents-index` は残す。
- 収束エンジンへ渡す daemon ソースは、`agents-index/src` を再帰ミラー（削除も反映）した成果物にする。手書きのファイル一覧を持たない。
- `agents-index/install.sh` と `.github/scripts/agents-index-install.test.mjs` を削除し、アサーションを golden ツリーと `agentsindex_test.go` へ移した。

**3. 自己完結した成果物から起動する**

- `gdg agent-host apply` が `/opt/agents-index` へ daemon ソースを配置する。`@gdgjp/agents-index` workspace パッケージの `src/**` を verbatim でコピーし、`@gdgjp/gdg-lib/acl/agent` の import だけを、隣に置く esbuild バンドル（Stage 05 で `/opt/gdg-agent/lib/acl.ts` に配置しているものと同一）へ書き換える。
- 標準の `package.json` + `package-lock.json`（`workspace:*` 依存なし）を `agent-host/agents-index/` に置き、`npm ci` を `exec` リソースで回す（`/opt/xangi`・`/opt/langfuse-forwarder` と同じ方式）。
- `agents-index.service` の `ExecStart` に `/opt/gdgjp` は現れない。これが Stage 13 の `/opt/gdgjp` 撤去の前提を満たす。

**4. シェル一本化の到達点**

- agent-host のプロビジョニング用シェルは `scripts/install-gdg-agent-host.sh`（bootstrap・約 40 行）1 本のみ。
- CI の不変条件は `find` の総数ではなく、`.github/scripts/shell-allowlist.txt` との完全一致で表現する（`git ls-files '*.sh'` と照合）。新しいシェルを足すには allowlist の変更が PR の diff に現れる。

### Alternatives Considered

- **esbuild で agents-index を単一ファイルへバンドル**: ビルドツールの追加が必要。native 依存（`better-sqlite3` 等）は結局 `npm ci` になるため、import 書き換え方式の方が既存パターンに収まる。
- **`/opt/agents-index` へ専用 git clone**: チェックアウト依存が残り、Stage 13 の `/opt/gdgjp` 撤去と本質的に同じ問題を先送りするだけ。
- **`systemctl --user` unit（xangi と同じ）+ `SupplementaryGroups=` を落として親マネージャのグループ継承に頼る**: slot 追加時にユーザーマネージャの再起動（xangi も巻き添えで停止）が必要になり、収束が壊れる。system unit なら PID 1 が明示的にグループを設定できる。

### Consequences

- 1 コマンド（`gdg agent-host apply`）で agents-index を含むホスト全体が収束する。
- `slotCount` を変えると `agents-index.service` の `--slots` と `SupplementaryGroups` が追随する。二重管理の余地が消えた。
- agents-index が `/opt/gdgjp` を参照しなくなり、Stage 13 の clone 撤去の前提が整った。
- `ApplyPlan` の Phase 3（systemd）が Phase 2（exec）と同様にライブ状態で再 plan するようになった。`npm ci` が `node_modules` を作った直後の同一 apply で unit が起動するようになり、収束に追加の apply が要らなくなった。
- `SystemdUnitDeleteResource` の `systemctl` 失敗（`disable --now` / `daemon-reload`）を握り潰さず伝播する。unit が本当に存在しない場合のみ許容する。
- agent-host のプロビジョニング用シェルが 2 本 → 1 本（開始時点の 7 本からの到達点）。一本化が完了した。

---

## ADR-028: 署名基盤・アーカイブ防御・Mode B によるワークスペース同期（Tier 1）を採用する

### Status

Accepted

### Date

2026-09-04

### Context

全体方針の第 1 要求である「`agent-host/workspace/.agents/skills/` にスキルを追加して push したら、本番のエージェントが自動で使えるようになる」を実現するため、Tier 1 ワークスペース同期（`gdg agent-host sync-workspace`）を新設する。

旧 `agent-host/install.sh` の `seed_wiki_cursor_files` には以下の問題があった:
1. `rm -rf` + `cp -a` により、ホスト上のローカル変更が黙って破壊されていた。
2. 稼働中 worktree（`/srv/gdg-agent/wiki`）に対して wiki mutex を取得しておらず、sleep ingest（毎朝 04:00 JST）や Discord ターンの変更と競合する危険があった。
3. 配信物の署名検証がなく、真正性が担保されていなかった（SHA-256 マニフェストのみでは改竄者がマニフェストごと差し替え可能）。
4. 途中でプロセスが `SIGKILL` された場合の原子性が担保されておらず、新旧ファイルが混在した状態が残りうる。

また、Tier 1 はスキルの高速反映を目的とするため、ホスト実行時設定（`agent-host.json` や `config/`）を巻き込んではならず（それらは Tier 2 / Stage 10 の担当）、機械的な境界強制が求められる。

### Decision

**1. Ed25519 detached manifest envelope 形式と共通署名基盤の採用**
- `cli/internal/agenthost/signing.go` に、アーカイブ外の detached なマニフェストエンベロープ（`ManifestEnvelope`）形式と Ed25519 署名検証（`VerifyEnvelopeSignature`）を実装した。
- エンベロープはアーカイブ全体の `sha256` / `size` / `entryCount` / `uncompressedSize` と per-file ハッシュ一覧（`entries`）を保持し、アーカイブ自体には署名を含めない（自己 digest 依存の循環を防止）。
- この署名検証コードとマニフェスト形式は、Stage 10 の Tier 2 リリース管理でもそのまま再利用する。
- 署名鍵の管理方針: リリース/バンドル署名秘密鍵は CI Secret（`AGENT_HOST_SIGNING_KEY`）として保管し、検証用公開鍵は `/opt/gdg-agent/lib/release-key.pub`（root:root、0644）に配置する。`/opt/gdg-agent/lib` は 0755 root 所有のため、slot uid（`gdgagent-run-*`）から改竄・上書きできない。

**2. 多層アーカイブ展開防御の徹底**
- 署名は「誰が作ったか」のみを保証し中身の安全性を保証しないため、展開前に以下の防御を行う:
  - アーカイブに触れる前に Ed25519 署名を検証（無効なら即座に中止）。
  - アーカイブ実バイトの SHA-256 と size をエンベロープと照合。
  - 合計サイズとエントリ数の上限検査（zip bomb 防御）。
- 展開処理は `tar -xzf` に丸投げせず、`archive/tar` で 1 エントリずつ検査し、以下を検出した場合はスキップではなく即座に中止する:
  - 絶対パス（`/` で始まるパス）
  - パストラバーサル（`..` を含むパス）
  - シンボリックリンクおよびハードリンク
  - デバイスファイル・FIFO・ソケット等の非通常ファイル
  - 重複するエントリパス
  - エンベロープの `entries` allowlist に存在しないエントリ
- 展開は staging ディレクトリ（`/var/lib/agent-host/workspace-staging/<version>/`）に行い、per-file SHA-256 検証がすべて通過するまで live worktree には一切触れない。

**3. 原子性として「方式 B（Write-Ahead Journal + 実バイトバックアップ + 起動時リカバリ）」の採用**
- 方式 A（単一ディレクトリ + `renameat2(RENAME_EXCHANGE)`）と方式 B の比較検討の結果、**方式 B** を採用した。
  - 方式 A は Linux 固有（macOS で単体テスト不可）であり、`.agents/`、`.claude/`、`.codex/`、`.cursor/rules/local.mdc` という複数のトップレベルパスを 1 つのシステムコールで交換するには親コンテナディレクトリまたは symlink が必須となるが、これは Cursor CLI サンドボックス境界および xangi の `src/skills.ts` による直接相対パス解決と衝突する。
  - 方式 B は対象パスの現在の実バイトを `/var/lib/agent-host/workspace-backup/<txn-id>/` にバックアップし、write-ahead journal（`/var/lib/agent-host/workspace-journal/<txn-id>.json`）を書き `fsync` してから live worktree への temp-write + rename を行う。
  - 適用途中でプロセスが `SIGKILL` されても、次回の `sync-workspace` 起動時に **wiki mutex を取得した直後・外部ソース取得の前** にリカバリ処理が走り、バックアップから実バイトを完全復元する。
  - `gdg agent-host verify` にも未完了トランザクション検出を追加した。

**4. wiki mutex による直列化と clean yield**
- `/srv/gdg-agent/wiki` の既存 mutex（`filepath.Join(wikiRoot, ".gdgwiki/ingest-locks.json.mutex")`）を取得してから同期処理を行う。独自ロックは作らない。
- mutex が既に保持されている場合（sleep ingest 等が稼働中）、エラーで異常終了するのではなく、ログを出力して exit 0 でクリーンに終了し、次回のタイマー実行（5 分後）に処理を譲る（clean yield）。

**5. `--force` の厳格な契約**
- ローカル変更が検出された場合、`--force` が指定されていない限り適用を中止し、破壊を防ぐ。
- `--force` はローカル変更の上書きのみを許可し、署名検証・マニフェスト照合・アーカイブ検査・Tier 1 配信境界チェックを一切迂回しない。

**6. systemd タイマーによる定期実行**
- `agent-host-sync.service`（Type=oneshot）および `agent-host-sync.timer`（OnUnitActiveSec=5min, OnBootSec=2min）を `gdgagent-svc` の user scope unit として配置・収束させる。

### Consequences

- スキルを `agent-host/workspace/.agents/skills/` に push するだけで、最長 5 分で本番の `/srv/gdg-agent/wiki/.agents/skills/` に安全かつ自動的に反映される。
- `AGENTS.md` の更新に伴い、`.cursor/rules/local.mdc` が常に `---\nalwaysApply: true\n---\n\n` を前置して自動生成・追随する。
- 署名基盤・アーカイブ防御・マニフェストエンベロープ形式が確立され、Stage 10 の Tier 2 リリース管理に再利用可能となった。

---

## ADR-029: バックエンド能力契約（fail-closed）と二重化された本番防御下限を採用する

### Status

Accepted

### Date

2026-09-05

### Context

全体方針の第 2 要求は「spec の `backend.name` を `cursor` → `antigravity` に変えて push したら本番のバックエンドが入れ替わる」である。しかし現状のままバックエンドを切り替えると、本番運用において非オプション（"none of which is optional in production"）と定義されている 3 層の信頼境界（preToolUse ゲート、uid/slot 分離、OS サンドボックス）がすべて暗黙のうちに外れてしまう。

1. **preToolUse ゲート**: Cursor CLI の `~/.cursor/hooks.json`（`failClosed: true`）に依存しており、Antigravity（`agy` CLI）には同等のプログラム的 pre-tool フックが存在しない。
2. **uid/slot 分離**: `cursor-cli.ts` のみ `assertSlotLauncher` / `sudoLauncherArgs` 経由で slot ユーザーとして起動している。`antigravity-cli.ts` は素の `spawn()` であり分離がない。
3. **OS サンドボックス**: Cursor の `sandbox.mode: "enabled"` + `readBoundary: "workspace"` に依存している。`antigravity-cli.ts` はむしろ `--dangerously-skip-permissions` を渡す経路を持つ。

さらに、spec 内の `isolation` 定義だけでは、spec 側の要求レベルを下げることによって防御が外れてしまう。また、自己更新（re-exec）機能が悪意のある、あるいは下限の緩いバイナリへ re-exec してしまうと、バイナリ内にコンパイルされた下限すら無効化される危険（re-exec の穴）があった。

### Decision

**1. spec への `backend.isolation` の必須化**
- `agent-host.schema.json` および `agent-host.json` において、`backend.isolation` を必須フィールドとして定義した。
- `slotLauncher`（boolean）、`osSandbox`（`"workspace"` | `"none"`）、`toolGate`（`"preToolUse-failClosed"` | `"none"`）の 3 項目をすべて明示することを強制し、省略を禁止した。

**2. Go 収束エンジン内のバックエンド能力レジストリによる契約検証**
- `cli/internal/agenthost/backend.go` に、各バックエンドが実際に提供可能な能力を記述するレジストリ（`backends`）を設けた。
- `cursor`: `{SlotLauncher: true, OSSandbox: "workspace", ToolGate: "preToolUse-failClosed"}`
- `antigravity`: `{SlotLauncher: false, OSSandbox: "none", ToolGate: "none"}`（願望ではなく実装の事実を記録）
- spec の `backend.isolation` をバックエンド能力が満たさない場合、`apply` / `plan` は fail-closed で直ちに停止し、「どの層が、どのバックエンドで、なぜ足りないか」を明示する。
- 安全装置を迂回する `--force` や `--skip-capability-check` フラグは一切提供しない。

**3. リリース成果物から独立したバイナリコンパイル済み `productionMinimum`**
- 本番環境（`environment: "production"`、省略時の既定値）における下限 `productionMinimum` を `gdg` バイナリ内にコンパイルされた不変値として定義した。
- spec 側で `isolation` を下げても、`productionMinimum` を下回る場合は `apply` / `plan` が拒絶される。
- 下限の緩和は `environment: "development"`（Lima やローカル検証環境用）でのみ許容され、かつ development spec はリリース CI（`ValidateSpecForRelease`）によって本番リリース成果物から機械的に排除される。

**4. re-exec 穴の二重防御**
- `pins.gdgCli` による自己 re-exec の前に、現行の信頼されたバイナリ自身が spec の `environment` と `backend.isolation` を現行の `productionMinimum` で検証し、違反があればダウンロードや re-exec を行わずに落とす。
- `pins.gdgCli` の SHA-256 チェックサムをバイナリ内の承認済みリリース allowlist（`approvedGdgCliDigests`）と照合し、未知のバイナリへの re-exec を遮断する。

**5. ポリシーバンドルのバックエンド別分離**
- `agent-host/config/` 直下に混在していた cursor 固有設定を `agent-host/config/backends/cursor/` に移動し、`backends/antigravity/` を予約した。
- 収束エンジンは選択中のバックエンドのバンドルのみを配置する。
- バンドル内のファイル構造（`hooks.json` の `failClosed: true`、`cli-config.json` の `sandbox.mode: "enabled"`、`sandbox.json.in` のスロットパスと `.config` 非公開、sudoers の `spawn-slot-N`）に対する構造的不変条件検査を `backend.go` 内に集約した。

### Alternatives Considered

- **spec のバリデーションのみで制御する**: spec はリポジトリの commit/push で書き換え可能であるため、自動リリース（Stage 10）と組み合わさると人間が差分を見ないまま 3 層防御が外れる事故を防げない。バイナリコンパイル済みの `productionMinimum` が不可欠。
- **re-exec 後に新バイナリで下限を検査する**: 悪意のある、または下限の緩い旧バージョン CLI へ re-exec された時点で検査が無力化されるため、現行バイナリによる事前検証と digest allowlist の組み合わせを採用した。
- **`--force` フラグの提供**: 信頼境界の強制が目的であるため、迂回路を作ると安全装置として破綻する。下限変更は CLI バイナリの更新（コードレビューとリリース）を伴うべきである。

### Consequences

- `backend.name` を `antigravity` に設定した spec は、Stage 12(uid/slot 分離)および Stage 14(pre-tool gate / sandbox)が実装されるまで、機械的に本番適用が拒絶される。
- 本番の 3 層防御が spec の記述ミスや意図しないダウングレードによって外れるリスクが構造的に排除された。
- Stage 10 のリリース CI に必要な `backend.isolation` 検査、`productionMinimum` 検査、`environment` ゲートの基盤が確立された。

## ADR-030: Tier 2 署名リリースと pull 型適用、ロールバック

### Status

Accepted

### Date

2026-09-05

### Context

全体方針の要求 3(「リポジトリの HEAD が本番ホストの構成と一致していることが、常に機械的に検証されている」)を満たすため、Stage 09 が Tier 1(`agent-host/workspace/**`)向けに確立した署名基盤(`cli/internal/agenthost/signing.go`、detached Ed25519 マニフェスト、defensive extraction)を、spec・config・systemd unit・パッケージ全体を扱う Tier 2 に拡張する必要があった。ブラスト半径が Tier 1 より桁違いに大きいため、機構は共有しつつ適用対象と世代管理・ロールバックだけを分離する。

このステージで新たに生じた設計上の決定点が 7 つあった(括弧内は、初回実装のレビューで発見され、本 ADR の版で修正した項目):

1. Tier 2 は「最新版を検出する」ためのポインタ機構が要る(GitHub Releases に固定名アセットが無い)。
2. workspace/ を含むリリースを、Tier 1 の mutex・crash recovery・journal を再実装せずに委譲する方法が要る。
3. verify 失敗時の自動ロールバックが「ロールバック先が存在しない」場合に黙って続行しない設計が要る。
4. 収束後、次回以降の `apply`/`verify`/`sync-workspace` がどの spec を見るかを決める「ライブ spec」の置き場所が要る。
5. (レビュー起因)`config/` はリリースに含めるだけでなく実際に収束エンジンへ反映されなければならない。
6. (レビュー起因)`pins.gdgCli` を変更するリリースは、適用前に self re-exec しなければ古いバイナリがそのまま適用してしまう。
7. (レビュー起因)apply 自体の失敗(verify 失敗より前)も自動ロールバックの対象でなければならず、drift チェックと dry-run は破壊的であってはならず、未検証の spec を live spec として公開してはならない。

### Decision

**1. `latest.txt` によるバージョンポインタ + 固定 URL 構成での fetch**
- CI(`scripts/build-agent-host-release.mjs`)が `agent-host-release-<version>.{tar.gz,manifest.json,manifest.json.sig}` に加えて `latest.txt`(バージョン文字列のみ)を生成し、同一の `agent-host-release-latest` GitHub Release に `--clobber` で上書きアップロードする。
- ホスト側(`cli/internal/agenthost/release.go` の `fetchAndVerifyReleaseArtifacts`)は `latest.txt` を読んでバージョンを特定し、そのバージョン名のマニフェスト・署名・アーカイブを個別に取得する。**署名検証はアーカイブに触れる前に完了する**(マニフェスト+署名を取得・検証 → `env.Version` が `latest.txt` の値と一致することを確認 → その後にのみアーカイブを取得)。アーカイブのダウンロード自体も署名済みマニフェストの `archive.size` で上限を切り、サイズ不一致は即座に部分ファイルを削除して失敗する(改竄されたアップストリームがディスクを食い潰す前に遮断する)。
- `file://` スキームも同じ関数でサポートし、テストがネットワーク無しで fetch/verify/apply 全体を検証できるようにした(署名検証テスト、アーカイブ改竄検出テストなど)。

**2. `workspace/` は共有トランザクション関数 `ApplyWorkspaceFiles` に委譲し、`plan.go` が構造的に強制する**
- `cli/internal/agenthost/workspace.go` を、mutex 取得+crash recovery(`withWorkspaceMutexAndRecovery`)と、検証済みファイル群を実際に収束させる部分(`ApplyWorkspaceFiles`)に分割した。Tier 1(`SyncWorkspace`)と Tier 2(`release.go` の `applyReleaseGeneration`)は両方ともこの共有関数を呼ぶ。**mutex 取得とファイル取得の順序は元の Tier 1 の挙動を厳密に保持する**(`TestSyncWorkspace_WikiMutexYield`/`TestSyncWorkspace_CrashRecoveryModeB` が要求する順序: mutex 取得 → crash recovery → fetch/apply)。署名は 2 つ存在しない(Stage 09 の `signing.go` を再利用するのみ)。
- `plan.go` の `BuildPlan` は `ValidateWorkspaceDelegation` を呼び、`paths.workspace` の**内側**を対象とする file/dir リソースが 1 つでもあれば即座にエラーにする(ワークスペースのルートディレクトリ自体の mode/owner 管理は例外)。これにより Tier 2 の収束エンジンが `workspace/` を汎用リソースとして書く経路を作ろうとしても、`BuildPlan` の時点で構造的に拒否される。

**3. 自動ロールバックは「apply 失敗」と「verify 失敗」の両方から同じ経路に入り、target が無い・同一の場合は黙って続行しない**
- 初版では verify 失敗のみが自動ロールバックの引き金だったが、レビューにより「apply(収束)そのものの失敗はどうなるのか」が指摘された。修正後は `applyReleaseGeneration` の失敗と、その後の `VerifyHost` の失敗の両方が同一の `rollbackOrFail` を通る。
- `currentVersion == ""`(初回リリース)の場合は、ロールバックを試みずに直ちにエラーを返す(戻る先が無い)。
- ロールバック自体が失敗する、またはロールバック後も verify が通らない場合も、その旨を明示したエラーを返す。`gdg agent-host rollback` コマンド(`--to` 省略時は current の直前世代)も同じ `applyReleaseGeneration`+`VerifyHost`+`setCurrentRelease`(+ 下記 4 の `publishLiveSpec`)の経路を再利用する。

**4. ライブ spec と `current` ポインタは verify 成功後にのみ更新する**
- 初版では `publishLiveSpec` が `applyReleaseGeneration` の内側、つまり `VerifyHost` より前に呼ばれていた。これは検証に失敗した候補が `current` にならないまま `/etc/gdg-agent/agent-host.json` に残ってしまうバグで、レビューで発覚した。修正後は `publishLiveSpec` と `setCurrentRelease` を `applyReleaseGeneration` から呼び出し側(`ApplyRelease` の成功パス、および `rollbackOrFail`/`Rollback` のロールバック成功パス)に移し、**verify を通過した世代についてのみ**呼ぶ。
- `cli/internal/command/agent_host.go` の `resolveSpecPath` が `--spec` → `GDG_SPEC` → このライブ spec パス → (埋め込み既定 spec)の順で解決する。
- `/var/lib/agent-host/releases/<version>/` にリリース世代を保持し、`current` シンボリックリンクで現在の世代を指す。このディレクトリと `/etc/gdg-agent` はいずれも `root:root` で、slot uid(`gdgagent-run-<N>`)や `gdgagent-svc` からもアクセスできない(自己改変経路の遮断)。

**5. drift チェックと dry-run は非破壊にし、`current` と同一バージョンは常に report-only にする**
- 初版は `--dry-run` の判定より前にアーカイブを `releasesRoot/<version>` へ直接展開しており、これは (a) `current` と同じバージョンを再フェッチしただけで、稼働中の世代ディレクトリ(将来のロールバック先)を消して作り直してしまう、(b) `--dry-run` という「読み取り専用」であるべき操作がディスクの永続状態を書き換える、という 2 つの問題を持っていた。レビューでどちらも指摘された。
- 修正後は常に **使い捨てのステージング領域**(`stagingRoot/extracted`)へ展開し、実際に収束させて verify が通った後にのみ `releasesRoot/<version>` へ `os.Rename` で昇格させる。`--dry-run` はステージングに対してのみ `apply --dry-run --diff` を実行し、何も永続化しない。
- 取得したバージョンが **既に `current` と同じ**場合は、`--dry-run` の指定に関わらず常に report-only の drift チェックのみを行う(`current` が指す既存の展開先に対して dry-run するだけで、再展開すらしない)。これは全体方針の「3. 現在適用中のリリースと同じなら dry-run だけ実行し、差分があれば非ゼロ」という要求そのものであり、初版がここを「同一バージョンでも実際に再適用してドリフトを修復する」という異なる(そして黙って修復してしまう)挙動にしていたのは設計からの逸脱だった。周期的なタイマーが変更のないリリースを検知するたびに黙って収束させてしまうと、ホストへの意図しない改変が「通常の収束」として隠れてしまう。

**6. `pins.gdgCli` の変更は、適用前に検証済み spec を根拠に self re-exec する**
- 初版は `release apply` から `CheckAndReexecSelf`(Stage 04/07 で確立済み、`apply` コマンドはすでに呼んでいた)を一切呼んでいなかった。これは `pins.gdgCli` を変更するリリースが、それを解釈すべき新しい `gdg` バイナリではなく、現在動いている古いバイナリによって処理されてしまうことを意味していた。
- 修正後は、ステージングへの展開・署名検証が終わった**認証済みの** extracted spec を使って、host/workspace への変更を一切加える前に `CheckAndReexecSelf` を呼ぶ。実際に re-exec が発生する場合は `syscall.Exec` でプロセスイメージが置き換わり、同じ argv で `release apply` が最初からやり直される(再フェッチは冪等)。

**7. `config/` は Tier 2 の収束エンジンに実際に反映する(埋め込みへのフォールバック付き)**
- 初版は `config/` をリリースに含めながら、`BuildPlan` は常に `gdg` バイナリに `go:embed` された設定を読んでいた。これはレビューで発見された、Stage 10 の核心である「HEAD = ホスト構成」を破る欠陥だった(config のみの変更が publish されても決して反映されない)。
- 修正として `cli/internal/agenthost/assets.go` に `withConfigOverrideRoot` を追加した。プロセス全体スコープの(goroutine 非対応、`gdg` は 1 プロセスにつき 1 操作を直列実行する前提の)オーバーライドで、`configBytes`/`backendConfigBytes` はまずオーバーライドされたディレクトリを見て、無ければ埋め込みのデフォルトにフォールバックする。`applyReleaseGeneration` は spec のロード(`ValidateBundleInvariants` を経由するため)から `BuildPlan`/`ApplyPlan` まで全体をこのオーバーライドで包む。関数引数として全 `configBytes` 呼び出し箇所(`ValidateBundleInvariants` は spec 解析そのものの内部から呼ばれ、経路上に paths が存在しない)に配線するのはこの段階では大規模すぎるため、意図的にこの形を選んだ。

### Alternatives Considered

- **push 型(GitHub Actions から ssh、または self-hosted runner)**: `docs/agents-local-mvp/adr.md` の既存方針どおり、public リポジトリでの self-hosted runner は fork PR からのコード実行経路になり、ssh デプロイは CI に root 相当の資格情報を持たせる。pull 型を維持した。
- **`current` を経由せず、常に `latest.txt` の内容を信頼してロールバック判定する**: ネットワーク到達性がロールバックの前提になってしまい、「ロールバックはネットワークの問題そのものによってブロックされてはならない」という要件に反する。ロールバックは常にローカルにすでに展開済みの世代のみを対象にする設計にした。
- **`config/` を読むために `configBytes`/`backendConfigBytes` の全呼び出し箇所へ config root パラメータを配線する**: 最も「正しい」形だが、`ValidateBundleInvariants` が spec 解析(`parseSpecBytes`)の内部から呼ばれているため、呼び出しチェーンの非常に深いところまでパラメータを通す必要があり、Tier 2 のスコープを大きく超える。プロセススコープのオーバーライド(決定 7)を採用した。
- **同一バージョン再フェッチでも実際に再適用してドリフトを修復する**(初版の挙動): 「変更の無いリリースの再適用」と「実際の新規リリース適用」を区別できなくなり、ホストへの意図しない改変が通常の収束ログに埋もれてしまう。全体方針の要求(dry-run のみ・差分があれば非ゼロ)どおり report-only に統一した。

### Consequences

- spec の `backend.model`・`discord.*`・`pins.*` に加えて **`config/` のテンプレート内容変更(hooks.json、sandbox.json.in 等)** も、CI 経由で署名付きリリースが publish されれば `agent-host-apply.timer`(既定 1 時間毎)が取得・検証・収束・再検証し、失敗時は自動的に直前世代へロールバックする。`gdg` バイナリの再ビルドを要するのは `configBytes` が読まない新しい構造(コード変更を要する変更)に限られる。
- `pins.gdgCli` を変更するリリースは、ホストが古いバイナリで動いていても、次の `agent-host-apply.timer` 発火で self re-exec を経由して新しいバイナリに切り替わってから収束する。
- branch protection・署名コミット・リリース署名鍵(`AGENT_HOST_SIGNING_KEY`)の管理方針・GitHub Environment protection rule によるゲートの要否は、リポジトリ設定(GitHub 側)の変更を伴うため本 ADR の記録のみに留め、実際の設定変更は別途人間の承認を要する。
- Lima VM 上での `useradd`/systemd/apparmor/sudo を実際に動かす統合テストは、本ステージの時点では CI に配線されておらず、今後の課題として残る。

## ADR-031: `@gdgjp/gdg-lib` の ACL 評価器のみを GitHub Packages へ publish する（Stage 13 producer package スライス）

### Status

Accepted（Stage 13 プロデューサースライス。consumer・ホストの完全移行は後続作業）

### Date

2026-09-05

### Context

xangi（本番 Discord エージェント。当時 `Harineko0/xangi`、後に `gdg-jp/xangi` へ移管）は
`@gdgjp/gdg-lib` を `devDependencies` の `file:../gdgjp/gdg-lib` として参照している。この
sibling 参照ゆえに:

- xangi のホスト上 `npm ci` に `/opt/gdgjp`（monorepo 全体の checkout）が要る。
- `dist/` をビルドしても `@gdgjp/gdg-lib` の TypeScript ソースを解決できず、
  systemd unit は `tsx` で `src/index.ts` を直接動かす暫定運用のままになっている
  （`agent-host/ENVIRONMENT.md:184-187`、ADR-022 が求める「tsx を使わない」に反する）。
- xangi の CI は `gdg-jp/gdgjp` を sibling checkout する回避策を要る。

`gdg-lib` は React/Radix/Cloudflare Workers（D1 型）に依存する RP 認証コードと、
純粋関数のみの ACL 評価器（`src/acl/**`、ADR-007）を同居させている。外部から実際に
使われるのは後者だけである。xangi は `@gdgjp/gdg-lib/acl` から `isSourceVisibility`、
`sourceAudienceKey`、`SourceAudienceKey`、および `SourceVisibility` を import していた。
従来 `agent.ts` は `SourceVisibility`（型）を再エクスポートしていなかったが、
公開面を `./acl` 全体に広げるのではなく、**`agent.ts` に `export type { SourceVisibility }` を
追加することで、プランの「narrow な `./acl/agent` 面のみを公開する」という制約を維持する**。
xangi 側の import 指定子も `@gdgjp/gdg-lib/acl` から `@gdgjp/gdg-lib/acl/agent`（最終的には
`@gdg-jp/gdg-lib/acl/agent`）へ移行する。`agents-index/src/authz.ts:3` も `@gdgjp/gdg-lib/acl/agent`
を参照しており、両者が同一の狭い再エクスポート面に統一される。

### Decision

**1. publish するのは `src/acl/agent.ts` の narrow な面（subpath `./acl/agent`）だけ。パッケージ全体や `./acl` 全体ではない。**
- `gdg-lib/tsconfig.build.json` で `rootDir: "src/acl"` を指定し、React/Radix/Workers 型に
  一切触れない範囲だけを `tsc` でコンパイルする。
- `gdg-lib/scripts/build-publish-package.mjs`（`pnpm --filter @gdgjp/gdg-lib build`）が
  コンパイル後、`gdg-lib/dist/` に**独立した** `package.json` を書き出す。ワークスペース用の
  `private`・`devDependencies`・peerDependencies・`exports` の src 参照は一切引き継がない。
  `exports` には `./acl/agent` のみを定義し、`./acl` やルートは一切公開しない。
- 相対 import のモジュール指定子には `.js` 拡張子が無い
  （リポジトリ全体が `moduleResolution: "Bundler"` のため）。`tsc` はこれをそのまま出力するが、
  素の Node ESM は拡張子を要求するため、同スクリプトが `dist/` 生成後に機械的に付与する。
- `npm publish` は `gdg-lib/dist/` を cwd として実行する（`.github/workflows/gdg-lib-publish.yml`）。
  ワークスペース側 `gdg-lib/package.json` 自体を publish 対象にはしない。

**2. publish 先は GitHub Packages（`gdg-jp` org スコープ）。npm public registry は不採用。**
- ユーザー判断により、private のまま配れる GitHub Packages を選択した
  （npm public も「機密は無い」という理由で候補にあったが、org スコープの GitHub Packages を優先）。
- GitHub Packages は publish するパッケージ名のスコープが所有 org と一致することを要求する。
  そのため **publish 名は `@gdg-jp/gdg-lib` とし、ワークスペース内部の呼称 `@gdgjp/gdg-lib`
  とは異なる**。モノレポ内の既存インポート（`agents-index/src/authz.ts` を含む）は
  ワークスペース参照のままなので影響しない。xangi 側だけが新しい名前
  `@gdg-jp/gdg-lib` でインポートし直す必要がある。
- 認証は CI の既定 `GITHUB_TOKEN`（`packages: write`）で足り、専用トークンの発行は不要。

**3. `build:acl`（`cli/internal/wiki/hooks/acl.ts` 向け esbuild バンドル、Stage 05）とは
完全に独立させる。**
- 出力先・スクリプト名・実行タイミングのいずれも共有しない。`pnpm --filter @gdgjp/gdg-lib test`
  が両方の経路を回帰として固定する（`scripts/build-publish-package.test.ts`）。

### Alternatives Considered

- **`package.json` の `publishConfig.exports`/`main`/`types` で src → dist を上書きする**:
  実装して `npm pack --dry-run` で検証したところ、手元の npm 11.16 ではこれらのフィールドは
  publish 時に一切マージされず（`publishConfig` オブジェクトがネストされたまま残るだけ）、
  `files: ["dist"]` と組み合わせると `main` が存在しないファイルを指す壊れたパッケージが
  出来た。ドキュメントで見た挙動が実際には確認できなかったため採用しなかった。
  `dist/` に独立した `package.json` を書き出す方式は同じ目的を確実な形で達成する。
- **`gdg-lib` パッケージ全体を publish する**: React/Radix/Cloudflare Workers 依存を
  未検証のまま外部（xangi は素の Node、ブラウザでも Cloudflare Workers でもない）に
  持ち出すことになり、「publish するのは既存の narrow な面だけ」という制約に反する。
- **npm public registry**: 最も単純だが、org スコープを外部に公開する判断を伴う。
  ユーザーは GitHub Packages（private のまま配れる）を選んだ。

### Consequences

- **本コミットは Stage 13 のプロデューサーパッケージ準備スライスであり、Stage 13 の完了ではない。**
  Stage 13 の完全な完了（`docs/agents-local-refactoring/13-xangi-packaging.md` の完了条件）には
  以下の後続タスクが必要である:
  1. `Harineko0/xangi` から `gdg-jp/xangi` への GitHub リポジトリ移管。
  2. GitHub Packages への `@gdg-jp/gdg-lib` の初回 publish（CI workflow 実行）。
  3. xangi 側の `package.json` で `@gdg-jp/gdg-lib` を `devDependencies` の `file:../gdgjp/gdg-lib` から
     `dependencies` の GitHub Packages 版へ切り替え、import を `@gdg-jp/gdg-lib/acl/agent` へ移行。
  4. xangi CI の sibling symlink 回避策（`.github/workflows/ci.yml`）の削除。
  5. xangi が `dist/` をビルドし、ホストの systemd unit `ExecStart` を
     `/usr/bin/node /opt/xangi/dist/index.js`（`tsx` なし）に切り替え。
  6. `agent-host/agent-host.json` の `pins.xangi.repo` を `gdg-jp/xangi` に更新。
  7. xangi、agents-index（Stage 08）、langfuse-forwarder（Stage 07）の 3 つすべてが自己完結した成果物
     になったことを確認したうえで、ホストプロビジョニングから `/opt/gdgjp` clone を完全撤去。
- xangi 側は本スライスの時点で先行して `@gdgjp/gdg-lib/acl/agent`（narrow 面）への import 移行を
  完了しており、publish 後の変更はパッケージ名のスコープ（`@gdgjp` → `@gdg-jp`）とレジストリ設定のみで済む。

### Update: 残タスク 1〜6 完了、Stage 13 完了（2026-09-05）

上記 7 項目のうち、1〜6 を完了した。

1. **リポジトリ移管**: `Harineko0/xangi` → `gdg-jp/xangi`（ユーザーが実施）。合わせて
   `gdgjp` モノレポに `./xangi` として submodule 追加した。`~/proj/xangi` の
   スタンドアロン clone は廃止し、以後の xangi 側変更は submodule 経由で行う。
2. **`@gdg-jp/gdg-lib@0.1.0` の初回 publish**: `gdg-lib-publish.yml` を
   `workflow_dispatch` で実行し成功（`npm notice + @gdg-jp/gdg-lib@0.1.0`
   をログで確認）。パッケージは `visibility: private`、`gdgjp` リポに紐づく。
3. **xangi 側の依存切替**: `package.json` の `@gdgjp/gdg-lib` を
   `devDependencies` の `file:../gdgjp/gdg-lib` から `dependencies` の
   `@gdg-jp/gdg-lib": "^0.1.0"` へ変更し、8 ファイルの import 指定子を
   `@gdgjp/gdg-lib/acl/agent` → `@gdg-jp/gdg-lib/acl/agent` へ変更した。
   `tsc --noEmit`・`npm run build`・移行対象 8 ファイルのテスト（83 件）を
   ローカルで確認済み。
4. **xangi CI の sibling checkout 回避策の削除**: `.github/workflows/ci.yml`
   から `gdg-jp/gdgjp` の sibling checkout と symlink 手順を削除し、
   `permissions: packages: read` を付けた `GITHUB_TOKEN` で
   `npm.pkg.github.com` から直接installするよう変更した。
   **想定外だった点**: 同一 org 内であっても、`gdg-lib` パッケージが
   private かつ `gdgjp` リポに紐づく限り、`xangi` リポの `GITHUB_TOKEN` は
   自動的には読めない（`403 permission_denied: read_package`）。
   `gdg-lib` パッケージの Package settings → Manage Actions access に
   `gdg-jp/xangi` を追加してもらうことで解消した（ユーザー操作）。
   将来 gdg-lib の消費者が増える場合は、都度この一覧に追加するか、
   visibility を `internal` に変える判断が要る。
5. **本番ホストの GitHub Packages 認証**: 生産ホストの `npm.pkg.github.com`
   読み取りは、xangi CI と異なり同一 org の `GITHUB_TOKEN` に相当するものが
   無い（GitHub Actions 外の Ubuntu ホストのため）。そのため個人アカウントの
   `GITHUB_TOKEN` に頼らず、Discord/Langfuse と同じパターンで
   `gdg agent-host secrets set npm-registry` を新設し、
   `/home/gdgagent-svc/.config/xangi/secrets.json` の `NPM_READ_TOKEN` に
   `read:packages` PAT を保存する形にした。`plan.go` はこの値を
   `npm-ci:/opt/xangi` の `ExecResource.Env` に `NODE_AUTH_TOKEN=...` として
   注入し、`/opt/xangi/.npmrc`（`@gdg-jp` スコープのレジストリ指定のみ、
   トークンは `${NODE_AUTH_TOKEN}` 展開でファイルには残らない）と組み合わせて
   解決する。`ExecResource` に汎用の `Env` フィールドを追加し、
   `npm run build`（`npm-build:/opt/xangi`、watch は `.git/HEAD`）を新設、
   `xangi.service` の `ExecStart` を `tsx` 経由の `src/index.ts` から
   `node dist/index.js` に切り替えた（ADR-022 の要求どおり）。
6. **`pins.xangi.repo`/`ref` の更新**: `gdg-jp/xangi` と、依存切替後の最新
   commit（`f69572739f46931cff1d3edbe7c34409a9f329ee`）に更新した。

**残タスク 7（`/opt/gdgjp` の完全撤去）について**: コード上の前提はすべて
揃った——xangi（本更新）・agents-index（Stage 08、`agentsindex.go` が
`/opt/agents-index` から自己完結で動く設計であることを明記済み）・
langfuse-forwarder（Stage 07、go:embed 済み）のいずれも、現在の
`buildDesiredResources` は `/opt/gdgjp` を作る収束リソースを一切持たない
（新規ホストでは最初から作られない）。ただし稼働中の `mincra-srv` に
過去の `install.sh` が作った `/opt/gdgjp` の実体が残っている可能性があり、
その物理的な削除確認は本セッションの範囲外（ホストへの適用は
`--dry-run --diff` のレビューを経て operator が行う）。

---

## ADR-032: Stage 14 ブロッキング調査 — Antigravity (`agy`) の実際の能力

### Status

Accepted（調査のみ。実装は継続判断待ち — 下記 Consequences 参照）

### Date

2026-09-05

### Context

Stage 14（`docs/agents-local-refactoring/14-antigravity-backend.md`）は実装前に
「`agy` に fail-closed なプログラム的 pre-tool フックがあるか」を確認し、無ければ
実装者が独断で進めてはならないと定める。ADR-029 は当時の理解として
「Antigravity（`agy` CLI）には同等のプログラム的 pre-tool フックが存在しない」と
記録していたが、これは xangi 側のソース（`antigravity-cli.ts` が素の `spawn()` を
使っていること）からの推論であり、`agy` 自体の能力を実地検証したものではなかった。

この開発機に `agy` 1.1.3（`/Users/hari/.local/bin/agy`、Google の Antigravity CLI）が
実際にインストールされていたため、`agy --help`、バイナリに埋め込まれた
Markdown 形式のドキュメント文字列（`strings` で抽出。hooks.json の完全な仕様書が
バイナリ内に埋め込まれている）、実機での `agy -p`（print/headless モード）実行、
および `~/.gemini/config/hooks.json` ・ `~/.gemini/antigravity-cli/settings.json` という
既存の実運用設定（Orca が同じフック機構を使って自身の hook を登録済み）を根拠に、
調査 1〜4 を実地で行った。

### Findings

**調査 1（fail-closed なプログラム的 pre-tool フック）: 「有り」— ADR-029 の記録は誤りだった**

- `agy` は `<workspace>/.agents/hooks.json`（バイナリ埋め込みドキュメントに明記。
  changelog にも「Fixed workspace-local hooks defined in `<workspace>/.agents/hooks.json`
  not loading after trusting a folder」という記述があり実在が二重に裏付けられる）に
  `PreToolUse` / `PostToolUse` / `PreInvocation` / `PostInvocation` / `Stop` の
  5 イベントのフックを定義できる。構造は Cursor の `hooks.json` とほぼ同型
  （`matcher` 正規表現 + `hooks` 配列 + `type: "command"` + `timeout`）。
- `PreToolUse` の出力 JSON は `decision` フィールドを持ち、値は
  `allow` / `deny` / `ask` / `force_ask` / `deny_unless_prior_grant` の 5 種類
  （バイナリ内の protojson スキーマ記述: `enum=allow,enum=deny,enum=ask,enum=force_ask,enum=deny_unless_prior_grant`）。
  ドキュメントは `"deny"` を「Hard block the execution immediately」と明記しており、
  Cursor の `failClosed: true` と機能的に同等かそれ以上（`overwrite` によるツール引数の
  書き換えなど Cursor には無い機能もある）。
- **ヘッドレス（`-p`）モードは既定で fail-closed。** 実機テストで、`.agents/hooks.json` を
  一切置かない状態でも `run_command` ツールは自動的に拒否された
  （`jetski: no output produced — a tool required the "command" permission that headless
  mode cannot prompt for, so it was auto-denied.`）。バイナリ内の changelog にも
  「Fixed headless (`-p`) runs hanging or silently auto-approving tools that require a
  permission confirmation, so the CLI now soft-denies such tools」と明記されており、
  過去のバージョンでは fail-open（サイレント自動承認）だった欠陥が修正済みであることが
  分かる。**ピン留めするバージョンがこの修正を含むこと（後述のバージョン注意点）を
  確認する必要がある。**
- `~/.gemini/config/hooks.json` は本機で実際に使われている実データであり、
  Orca がこの機構に自身の `PreToolUse` フック（`orca-status`）を登録している。
  これは調査対象システムの外部の実運用証跡であり、フック機構が「ドキュメント上の
  仕様」ではなく実際に動作しているものであることの独立した裏付けになる。
- 結論: `acl-gate.ts` は Cursor と同じ判定ロジックのまま、起動経路（Cursor は
  `hooks.json` の `command` から Cursor 固有のペイロード形状で呼ばれる／antigravity は
  同じく `command` から `toolCall.name` / `toolCall.args.CommandLine` という
  camelCase ペイロードで呼ばれる）だけを antigravity 用に薄いアダプタで吸収すれば
  再利用できる。**代替 A・代替 B（PATH 制限や採用見送り）は不要。**

**調査 2（OS サンドボックス相当）: 「部分的に有り、境界の等価性は未検証」**

- `agy --help` に `--sandbox`（「Run in a sandbox with terminal restrictions
  enabled」）というフラグが存在し、`~/.gemini/config/config.json` の
  `userSettings.enableTerminalSandbox` という設定項目も実在する（本機では `false`）。
  つまり「サンドボックス」という概念自体は存在する。
- ただし、これが Cursor の `sandbox.mode: "enabled"` + `readBoundary: "workspace"`
  と同じ意味論（ワークスペース外の読み取りを拒否する）を持つのか、単に「ターミナルの
  一部機能制限」（例えばインタラクティブ端末機能の無効化）に過ぎないのかは、
  本調査では確認できていない。`--sandbox` を有効にした状態での実際のファイル
  アクセス境界テスト（ワークスペース外のファイルを読ませて拒否されるか）は未実施。
- **結論: `OSSandbox` を `"workspace"` として能力レジストリに true と書くのは時期尚早。**
  実装フェーズでは `OSSandbox: "none"` を維持し、境界の実地検証（Lima VM 上で
  `--sandbox` を有効にしたプロセスからワークスペース外のファイルを読ませる等）を
  別途行うまで安全側に倒す。

**調査 3（allowlist 型の権限モデル）: 「有り、ただし Cursor とは構造が異なる」**

- `agy` は独自の allowlist を持つ。`settings.json`（本機では
  `~/.gemini/antigravity-cli/settings.json`）の `permissions.allow` と、
  `~/.gemini/config/config.json` の `userSettings.globalPermissionGrants.allow` に
  `"command(<cmd>)"` / `"mcp(<url>)"` / `"unsandboxed(<cmd>)"` 形式のエントリを
  書くことで、ヘッドレスモードでも該当ツール呼び出しを事前承認できる。
- **これは Cursor の `~/.cursor/permissions.json`（gwsAllowlist 形式のフラットな
  JSON ファイルをワークスペース/スロットごとに配置する方式）とは構造が異なり、
  「パスをバックエンド非依存にする」という Stage 14 Design #3 の前提が
  そのままでは成立しない。** antigravity では allowlist はユーザー単位の
  中央集権的な `settings.json` であり、cursor のようにスロットごとの
  ワークスペース相対パスに配置する設計ではない可能性が高い（ワークスペース単位の
  trust 状態は `trustedWorkspaces` という別の中央リストで管理されている形跡がある）。
  ワークスペース局所スコープの allowlist が別途存在するかは未確認。
- **`--dangerously-skip-permissions` と `PreToolUse` の `"deny"` の優先順位は
  未検証。** ドキュメント文字列は「`--dangerously-skip-permissions` で全ツール
  自動承認」と書かれているが、これが `"ask"` の自動昇格（人間確認の省略）のみを
  指すのか、フックが明示的に返す `"deny"` すら上書きするのかは、実機テストで
  切り分けようとしたところ、**この Claude Code セッション自身の安全機構
  （auto mode classifier）が `--dangerously-skip-permissions` を渡すコマンドの
  実行を拒否したため、確認できなかった。** これは重大な未解決点であり、
  Stage 14 の実装（特に「production では `--dangerously-skip-permissions` を
  一切渡さない」という設計判断）の前提として、別途（このセッションの制約を
  受けない環境で）検証が必要。**現時点の設計方針としては、production バンドルは
  そもそも `--dangerously-skip-permissions` を渡さず、`permissions.allow` に
  `wk` / `gws` 相当の許可だけを明示するアプローチを採り、この未検証の
  優先順位に依存しない設計にする（xangi 側 `antigravity-cli.ts:137` の
  `--dangerously-skip-permissions` 経路そのものを production では使わない）。**

**調査 4（構造化出力によるツール呼び出しの観測）: 「バージョン依存、本機では未確認」**

- `docs/design.md:308` が言及する「Agy 1.1.8 以降の JSON/stream-json」に対し、
  本機にインストールされている `agy` は **1.1.3** であり、`agy --help` の出力にも
  `--output-format` フラグは現れなかった（`stream-json` を要求するとエラーになる
  文字列 `--json-schema can only be used when --output-format is 'json' or
  'stream-json'` はバイナリ内に存在するため、機能自体はコードベースにはあるが、
  このバージョンの `--help` には出ていない＝ CLI 引数パーサ側で無効化されているか
  ドキュメント漏れの可能性がある）。**pin する `agy` のバージョンは 1.1.8 以降を
  明示的に選定し、そのバージョンで `--output-format stream-json` の実地確認を
  改めて行うこと。**

### Decision

ADR-029 の「Antigravity にはプログラム的 pre-tool フックが存在しない」という記述を
本 ADR により訂正する。実地検証の結果、**調査 1 は「有り」であり、Stage 14 の
分かれ道は代替 A/B ではなく「`acl-gate.ts` を antigravity 用の薄いアダプタ経由で
再利用する」の本流に進める。**

ただし、調査 2（OS サンドボックス境界の等価性）と調査 3 後半（`--dangerously-skip-permissions`
と hook `deny` の優先順位）は本セッションの制約下では確認しきれなかった。
**Stage 14 の制約「3 層を保てないまま能力レジストリを `true` にしない」に従い、
これらが実地検証されるまで `OSSandbox` は `"none"` のまま false 側に倒す。**
`ToolGate` は調査 1 の結果に基づき実装を進めてよい。

### Consequences

- `cli/internal/agenthost/backend.go` の `antigravityPolicy.Capabilities()` は
  `ToolGate: "preToolUse-failClosed"` を実装対象にできるが、`OSSandbox` は
  `"none"` のまま維持する。**この状態では `productionMinimum`（`osSandbox: "workspace"`
  必須）を満たせないため、`environment: "production"` の antigravity spec は
  引き続き機械的に拒否される。これは ADR-029 の設計どおりの正しい挙動であり、
  OS サンドボックスの等価性が別途確認されるまで意図的に維持する。**
- xangi（`Harineko0/xangi`、`~/proj/xangi` にチェックアウト済みと判明。
  Stage 13 完了後は `gdg-jp/xangi`）を実際に読んだ結果、**toolGate 層の実装に
  xangi 側の変更は不要だった**: antigravity は `agy` 起動時の cwd
  （`AntigravityRunner` の `this.workdir` = `WORKSPACE_PATH`）から
  `.agents/hooks.json` を自力で発見する。この cwd は Stage 09 のワークスペース同期
  で配布される `agent-host/workspace/` そのものなので、hooks 定義はコード変更ではなく
  ワークスペースコンテンツ（後述）として追加すれば済んだ。`--dangerously-skip-permissions`
  は `src/antigravity-cli.ts:137` に経路として残るが、`skipPermissions` は
  `SKIP_PERMISSIONS` 環境変数（既定 false）でのみ有効化され、
  `agent-host/config/` のいずれにも設定されていないことを確認した
  （cursor の `CURSOR_FORCE`/`--force` と同型の、明示 opt-in のみのオペレータ
  用エスケープハッチであり、既定で安全）。よってこの経路は変更しなかった。
- **本セッションで実装した内容**（toolGate 層、上記の理由で xangi 側変更なし）:
  - `cli/internal/wiki/hooks/acl-gate.ts` — Antigravity の `{"toolCall":{"name","args"}}`
    ペイロードを Cursor と同じ内部形状に正規化し、`decision:"allow"/"deny"` 形式で
    出力する薄いアダプタを追加（判定ロジック本体は無変更）。
  - `cli/internal/wiki/hooks/shell-allowlist.ts` — `loadGwsAllowlist()` に
    `GDG_GWS_ALLOWLIST_PATH` 環境変数オーバーライドを追加（cursor の既定パスは無変更）。
  - `agent-host/config/backends/antigravity/permissions.json`（新規） —
    antigravity 用 gwsAllowlist。
  - `agent-host/config/backends/antigravity/hooks.json` / `settings.json`（新規） —
    `PreToolUse` を `acl-gate.ts` に接続し、converger が slot ごとの root 所有
    `~/.gemini/` 配下へ配置する。workspace 同期物は全 slot uid から可書きなので採用しない。
  - `cli/internal/agenthost/backend.go` — bundle の構造的不変条件と slot 配置を実装し、
    `/opt/gdg-agent/lib/antigravity-permissions.json` も配置する。mechanism は実装済みだが、
    pin 済み `agy` に対する E2E が完了するまで capability の `ToolGate` は `"none"`、
    `OSSandbox` も `"none"` のまま安全側に倒す。
  - テスト: `cli/internal/wiki/acl_gate_test.go`、
    `cli/internal/agenthost/backend_test.go`、golden fixture 更新。
    shipped `hooks.json` の command から実 `acl-gate.ts` まで実行する Go 回帰テストを含む。
    `go test ./internal/agenthost/... ./internal/wiki/...` と `pnpm typecheck:node-scripts` で確認済み
    （`pnpm ci:quick`/`ci:full` は未実行 — コミット前に実行すること）。
- 残タスク（本 ADR の対象外、実装継続時に別途行う）:
  1. `--sandbox` / `enableTerminalSandbox` の境界を Lima VM 実機で検証
     （ワークスペース外ファイル読み取りが実際に拒否されるか）。確認できたら
     `backend.go` の `OSSandbox` を `"workspace"` に、
     `agent-host/config/backends/antigravity/` にサンドボックス設定を追加する。
  2. `--dangerously-skip-permissions` と hook `deny` の優先順位を、この
     セッションの制約を受けない環境で確認
  3. `agy` の pin バージョンを 1.1.8 以降に確定し、`--output-format
     stream-json` を再確認したうえで `agent-host/agent-host.json` の
     `pins.antigravity` に実際の version + sha256 を追加する
     （本 ADR は検証していないバージョン/ハッシュを書かない）
  4. `normalizeAntigravityPayload()` の `run_command` 以外（`view_file` /
     `grep_search` 等）の引数フィールド名は未確認の推測。実ペイロードで
     確認し、必要なら候補リストを修正する
  5. `osSandbox` 実装（残タスク 1）が固まった段階で、xangi 側に
     sandbox フラグ配線が必要か再判断する（toolGate 層は xangi 側変更なしで
     完了したが、osSandbox 層は `agy --sandbox` の起動フラグ配線が要る可能性がある）

### Update: コードレビュー対応（3 件の P1）

上記の初版実装に対して、以下 3 件の P1（ブロッキング）指摘を受けた。いずれも実地で
検証したうえで修正した。

**P1-1: `.agents/hooks.json` を Tier 1 ワークスペース同期物として配置していた。**
指摘: ワークスペース（`paths.WikiRoot`）は `gdgagent-svc:gdgwiki` 所有・モード
`0o2770`（ディレクトリ）/ `0o660`（ファイル）で、`gdgagent-run-*` は全スロットが
`gdgwiki` グループに属する（`plan.go` で確認）。つまりゲート対象のスロットプロセス
自身がゲート定義を書き換え・削除できてしまい、境界として機能しない。

`agy` のドキュメント文字列を再確認したところ、customization root は実は 2 種類ある
ことが分かった: **Workspace Customizations Root**（`.agents/`、ワークスペース相対
— 今回使っていたもの）と **Global Customizations Root**（`$HOME` 相対、実機では
`~/.gemini/config/`）。後者はスロットユーザーのホーム配下であり、Cursor の
`~/.cursor/hooks.json` と全く同じ形（root 所有・sticky bit 付き group-writable な
ディレクトリの中に、個別に root 所有 mode 0444 のファイルを置く）で保護できる。

`agent-host/workspace/.agents/hooks.json` を削除し、`agent-host/config/backends/antigravity/hooks.json`
（新規ポリシーバンドル）を `backend.go` の `BuildSlotDirectories`/`BuildSlotResources`
から `<slotHome>/.gemini/config/hooks.json` へ root 所有 mode 0444 で配置するよう
変更した。`ValidateBundleInvariants` にも構造的検査を追加（matcher が `"*"` か、
command が `acl-gate.ts` と `ACL_GATE_BACKEND=antigravity` を含むか、timeout が
正か）。

**P1-2: `outputMode` をペイロード形状から推測していた。**
指摘: 壊れた JSON や `toolCall` が無い/壊れた形の入力に対して、`outputMode` が
`"cursor"` のままフォールスルーし、`{"permission":"deny",...}` を返してしまう。
Antigravity 側の exit-code ベースの fail-closed 挙動は未検証（調査 1 の残課題）
なので、これは「安全なフォールバック」ではなく「未検証の fail-open リスク」である。
レビューが実際に手動再現して確認した。

`acl-gate.ts` を修正し、`process.env.ACL_GATE_BACKEND === "antigravity"` を
**stdin を読む前に** チェックしてモードを確定するようにした。ペイロード形状には
一切依存しない。`ACL_GATE_BACKEND=antigravity` はデプロイされる `hooks.json` の
`command` 文字列にインラインで設定する（`GDG_GWS_ALLOWLIST_PATH` と同じ要領）。
モードが antigravity に確定した後は、`toolCall` が無い/壊れていれば直ちに
`decision:"deny"` を返す（cursor 形式へのフォールスルーは無くなった）。
`cli/internal/wiki/acl_gate_test.go` に壊れた JSON・空文字列・`toolCall` 抜けを
含む網羅的なテストを追加し、いずれも antigravity 形式で deny を返すことを確認した。

**P1-3: `ToolGate: "preToolUse-failClosed"` を宣言していたが、実バイナリでの
end-to-end 検証が無かった。**
指摘: ADR-032 自体が「旧 `agy` にはヘッドレス fail-open の欠陥があった」と書いており、
検証機のバージョンは unpinned の 1.1.3、しかも `acl-gate.ts` 単体のユニットテストは
していても、実際の `hooks.json` → `agy` → `acl-gate.ts` → deny という経路を
本物のバイナリで通したことは無かった。

`backend.go` の `Capabilities().ToolGate` を `"none"` に戻した（実装・検証済みの
機構ではあるが、pin されていない開発機での成功は「本番が実行するもの」と同じ保証
ではないため）。そのうえで、実機での end-to-end 検証を行った:

1. 本機の `agy` は検証開始時点から自動更新されており **1.1.27**（当初確認した 1.1.3
   ではない）になっていた。
2. 実際の `~/.gemini/config/hooks.json`（ユーザーの日常利用中の設定。Orca 自身の
   `orca-status` フックが既に登録されている）に、**別キー**として一時的に
   `acl-gate.ts` を指すフックを追加した（複数の named hook は event ごとにマージ
   される、というドキュメント記載どおり、既存の `orca-status` とは独立して共存できる
   ことも実地で確認した）。事前にバックアップを取り、テスト後に完全に元へ戻した
   （SHA256 で一致を確認済み）。
3. スクラッチワークスペースから `agy -p` で「`cat /etc/hostname` を実行して」と
   依頼したところ、**実際に拒否され**、理由文言（`shell-allowlist.ts` の
   `inspectWkScript()` が返す「every simple command must start with wk」）が
   ユーザーに向けてそのまま表示された。これは (a) `normalizeAntigravityPayload()`
   が仮定した `toolCall.args.CommandLine` という実ペイロード形状が正しいこと、
   (b) `decision:"deny"` が実際にツール呼び出しを止めることの両方を実地で証明する。
4. **新発見**: 同じ手順で `wk ls pages/`（フェイクの `wk` 実行可能ファイルを用意）を
   allow させようとしたところ、フックは `decision:"allow"` を返しているにも
   関わらず、`jetski: no output produced — a tool required the "command"
   permission that headless mode cannot prompt for, so it was auto-denied` で
   ブロックされた。これは PreToolUse フックとは**別の、独立した権限ゲート**が
   `"command"` 種別のツールに存在することを意味する。`~/.gemini/antigravity-cli/settings.json`
   の `permissions.allow` に `"command(wk)"` を一時的に追加したところ許可された
   （これもテスト後に完全復元・SHA256 で確認済み）。
5. この発見を受けて `agent-host/config/backends/antigravity/settings.json`
   （新規）を追加し、`{"permissions":{"allow":["command(wk)","command(gws)"]}}`
   を `<slotHome>/.gemini/antigravity-cli/settings.json` へ同じく root 所有
   mode 0444 で配置するようにした。`ValidateBundleInvariants` にもこのファイルの
   構造検査を追加した。**この発見が無ければ、toolGate 層は「安全だが使い物にならない」
   状態のまま出荷するところだった**（deny は機能するが、正規の wk/gws 呼び出しまで
   ヘッドレスモードで機械的に拒否され続ける）。
6. 生きた `agy` バイナリと OAuth 認証への依存を避けるため、恒久的な回帰テスト
   （`TestAntigravityShippedHookDeniesDisallowedCommand`、`cli/internal/agenthost/backend_test.go`）
   も追加した。これは出荷される `hooks.json` の `command` 文字列を実際にパースして
   `node` + 実 `acl-gate.ts` を実行し、`decision:"deny"` が返ることを CI で
   毎回確認する。手動の実機確認（上記 1〜4）とは独立に、この Go テストが
   `go test ./internal/agenthost/...` で継続的に守る。

**Consequences（更新）**: `ToolGate` は引き続き `"none"` のまま
（残タスク 3 の pin 完了と、pin 済みバイナリに対する同等の E2E が前提）。ただし
今回の実機検証により、機構そのものが実際に機能すること（deny 側は完全に、allow 側は
settings.json の追加込みで）は高い確度で確認された。残る不確実性は
「pin する具体的なバージョンでも同じか」という一点に絞られた。
