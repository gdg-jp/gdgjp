# Stage 01 — ACL evaluator extraction into gdg-lib

## Context — 背景とリポジトリ状況

### なぜやるか

同じ ACL 判定が、これから 3 箇所で必要になる。

1. `agents-local` のローカルフック（`preToolUse` の `acl-gate.ts`、Stage 05）
2. ローカルインデックスサーバの post-filter（`agents-index/`、Stage 09）
3. `wiki/` のサーバ側（`/sync` の検証、スナップショットの黒塗り）

現在この判定は `wiki/` の中にしか無く、CLI 側は `POST /api/cli/wiki/validate-acl` に
問い合わせることでしか同じ答えを得られない。その結果、
**`agents-local/wiki/` で `git push` した段階でサーバ側の判定に弾かれて落ちることが散発的に起きる**。
ローカルは「通る」と思って commit し、サーバだけが「通らない」と言う状態である。

さらに Stage 05 では read ゲートを **fail closed** にする。fail closed にできる前提は
「判定がローカルで完結すること」なので、判定のたびにサーバへ HTTP する構造では成立しない。

このステージで、判定の**純粋な部分**を `gdg-lib/` に 1 本だけ置き、3 者が同じ関数を呼ぶ形にする。

### 依存と対象範囲

- 先行ステージ: [Stage 00](00-typescript-runtime.md)。Node ネイティブ TypeScript の
  実行・型検査・配布規約を先に固定する。
- Stage 00 の完了後は Stage 02 / 03 と並行して着手できる。
- 後続の Stage 05（ハーネス）と Stage 09（インデックス）が本ステージの成果物に依存する。
- 対象ワークスペースは `gdg-lib/` と `wiki/`。`cli/` と `accounts/` は触らない。
- **判定の意味を一切変えない。** これは純粋なリファクタリングであり、
  1 つでも挙動が変わったらバグである。

### 読むべきもの

- `CLAUDE.md`（リポジトリ直下）— Biome 設定、`verbatimModuleSyntax`、workspace 構成
- `docs/plans/09-source-visibility-acl.md` §3-1 — `canAccessSource` の評価順（fail closed の順序）
- `docs/plans/10-page-acl-spans.md` **§0「権限の代数」** — 5 値は全順序ではない。
  この前提を壊す変更を入れない
- `docs/agents-local-mvp/index.md` — 全体像
- [ADR-002](adr.md#adr-002-権限の単位をユーザーではなく権限クラスにする) — **とくに改訂部分**。
  クラス集合ではチャンネルの天井を表現できない理由。§5-4 の根拠

### 再利用する既存実装（書き直さない）

移設対象はすべて既に存在し、テストも付いている。**ロジックを書き直さず、位置だけを変える。**

**ただしこのステージは移設だけではない。** §5 で新規の関数を足す
（`canClassesAccessSource` / `canClassesSeePage` / `canMutatePage`、
および**チャンネル audience の包含判定**（§5-4）と、
エージェント側に見せる面を絞る `agent.ts`（§5-5））。
移設分と新規分を混ぜないこと — 移設分は既存テストがそのまま通るはずで、
通らなければ写し間違いである。

- `wiki/app/lib/acl-spans.ts` — 純粋モジュール。全 export が移設対象
  （`AclSpan` / `parseAclSpans` / `aclSpanSourceIds` / `scrubResidualAclMarkup` /
  `stripAclSpans` / `removeAclSpans` / `redactAclSpans` / `validateAclSpans` /
  `metadataContainsAclTag` / `computeAclSourceIdsJson` / `ACL_REDACTION_PLACEHOLDER`）
- `wiki/app/lib/acl-spans.server.ts` — このうち **DB を触らない純粋部分だけ** が移設対象。
  `sourceAudienceKey`（`:44`）、`audienceContains`（`:64`）、`parseLevelAudienceKey`（`:103`）、
  および型 `PageAudienceSubject` / `SourceAudienceKey`。
  `buildAclSpanPolicy` / `pageAclClearance` / `redactPageMarkdown` /
  `validatePageAclForSync` / `validateReadSourcesTagged` は **D1 を引くので `wiki/` に残す**
- `wiki/app/lib/sources.server.ts:145` の `canAccessSource(source, user, chapters)` — 移設対象
- `wiki/app/lib/sources-shared.ts` — `SourceVisibility` / `SOURCE_VISIBILITIES` /
  `isSourceVisibility` / `sourceVisibilityNeedsChapter`。移設対象
- `gdg-lib/package.json` の `exports` — サブパス export の書き方の手本
  （`"./auth/claims": "./src/auth/claims.ts"`）
- `gdg-lib/src/auth/claims.ts` — 依存ゼロの純粋モジュールの手本

---

## Design — 設計

### 1. 配置

```
gdg-lib/src/acl/
  index.ts        再 export のみ（サーバ側の完全な面）
  agent.ts        エージェント側に見せる面だけを再 export      ← 新規（§5-5）
  visibility.ts   SourceVisibility 語彙、isSourceVisibility、sourceVisibilityNeedsChapter
  access.ts       canAccessSource / canClassesAccessSource / canUserSeePage（純粋版）
  audience.ts     sourceAudienceKey / audienceContains / parseLevelAudienceKey
  channel.ts      audienceKeyContains / pageAudienceIncludesChannel /
                  canClassesAccessSourceInChannel / canClassesSeePageInChannel  ← 新規（§5-4）
  mutate.ts       canMutatePage                                            ← 新規（§5）
  spans.ts        acl-spans.ts の全内容
  types.ts        AclSpan / SourceSubject / Membership / PageAudienceSubject /
                  SourceAudienceKey / PermissionClass / PageSubject
```

`gdg-lib/package.json` の `exports` に追加する。

```jsonc
"./acl": "./src/acl/index.ts",
"./acl/agent": "./src/acl/agent.ts"
```

**`gdg-lib/src/index.ts` からは re-export しない。** ルート index は `./auth` を経由して
`openid-client` を引き込むため、ここに ACL を混ぜるとフックとインデックスサーバが
不要な依存を背負う。`@gdgjp/gdg-lib/acl` を直接 import させる。

### 2. 依存ゼロの制約

`gdg-lib/src/acl/**` は **`node:` 組み込みも含めて一切 import しない**。
理由は 3 つの消費者のうち 2 つが特殊な環境で動くことにある。

- Cloudflare Worker（`wiki/`）— Node API が使えない
- Node ネイティブ TypeScript で起動されるフックスクリプト（依存解決なし）
- `agents-index/`（通常の Node）

型は `import type` のみを使う（`verbatimModuleSyntax`）。

### 3. フックと `wk` から読めるようにする（最重要）

`gdg-lib` は source-only の TypeScript パッケージ（`main: "./src/index.ts"`）である。
Stage 05 のフックと **`wk`**（読み書きの唯一の窓口）は、Stage 00 の契約に従う
**root 所有の Node ネイティブ TypeScript** である。`node_modules` は配置しないため、
source-only package のディレクトリ構造をそのまま import する設計にはしない。

`gdg-lib` に、**`acl` サブパスだけ** を対象とした最小のビルドを足す。

- `gdg-lib/package.json` の `scripts` に追加する:
  `"build:acl": "esbuild src/acl/agent.ts --bundle --format=esm --platform=neutral --outfile=../cli/internal/wiki/hooks/acl.ts"`
  **エントリは `index.ts` ではなく `agent.ts`。**
  クラス版の評価器を `wk` から見えなくするため（§5-5）。
- **outfile は `gdg-lib/dist/` ではなく `cli/internal/wiki/hooks/acl.ts` である。**
  消費者（`acl-core.ts` / `wk.ts`）と同じディレクトリに出すことで、
  相対 import が **リポジトリ上でも `/opt/gdg-agent/lib/` 配置後でも `./acl.ts` のまま解決する**
  （[Stage 00](00-typescript-runtime.md) §5-§6）。
  `gdg-lib/dist/` に出すと、リポジトリ上のパスと配置後のパスが食い違い、
  **型検査が通っても本番で import に失敗する。**
- `.d.ts` は出さない（TS 側は `src/` を直接見るため不要）。
- `cli/internal/wiki/hooks/.gitignore` に `acl.ts` を入れる。**生成物をコミットしない。**
  **`//go:embed` の対象にもしない**（生成前に `go build` が落ちる）。
- Stage 07 の `setup.sh` が `cli/internal/wiki/hooks/acl.ts` を
  `/opt/gdg-agent/lib/acl.ts` に配置する。
  **消費者は `wk.ts` と `acl-insert-core.ts`** で、`acl-core.ts` 経由で使う。
  **`acl-gate.ts` は使わない**（ゲートは ACL を判定しない。Stage 05 §2）。
- root の `typecheck:node-scripts` と `ci:quick` が `build:acl` を前置する
  （[Stage 00](00-typescript-runtime.md) §2）。

**このビルド成果物と `src/` がズレる経路を塞ぐ。** Verification に回帰テストを置く。

### 4. `wiki/` 側のラッパ化

**呼び出し側を 1 箇所も変えない。** 既存の import パスと関数シグネチャをそのまま保つ。

- `wiki/app/lib/sources-shared.ts` — 中身を `gdg-lib` からの再 export に置き換える
  （`SourceKind` / `SourceRefreshPolicy` は wiki 固有なので残す）。
- `wiki/app/lib/acl-spans.ts` — 同上。純粋関数は全部 `gdg-lib` から再 export する。
- `wiki/app/lib/sources.server.ts` — `canAccessSource` を `gdg-lib` の同名関数の
  re-export にする（`export { canAccessSource } from "@gdgjp/gdg-lib/acl";`）。
- `wiki/app/lib/acl-spans.server.ts` — `sourceAudienceKey` / `audienceContains` /
  `parseLevelAudienceKey` を `gdg-lib` から import し、そのまま re-export する
  （既存の外部利用があるため export を消さない）。DB を引く関数は手を付けない。
- `wiki/package.json` の `dependencies` に `"@gdgjp/gdg-lib": "workspace:*"` が既に
  あることを確認する（無ければ追加）。

### 5. 新規に足す評価器

ここまでは移設だった。以下は**新規実装**である。
ローカル側（フック・インデックスサーバ）には、サーバ側の評価器に渡す入力が揃わない。

- `canAccessSource` は先頭で `user.isAdmin` と `source.addedBy === user.id` を見るが、
  nonce が返すのは `{ classes, guildId, channelId }` だけである。
- `canUserSeePage`（`wiki/app/lib/page-visibility.server.ts:24`）は **fast path であって
  評価器ではない**。`restricted` の実体は DB を引く `getEffectivePagePermissions` の側にある。
- `audienceContains` はソース audience の包含を答える関数で、**行為者の書き込み権限ではない。**

根拠は [ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする) と
[ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する)。

#### 5-1. `canClassesAccessSource`

```ts
export type PermissionClass = { chapterId: string; role: "organizer" | "member" };

export function canClassesAccessSource(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
): boolean;
```

`canAccessSource` の `switch` を**そのまま写し**、`isAdmin` と `addedBy` の短絡だけを落とす。

| `visibility` | 判定 |
|---|---|
| 未知の文字列 | `false`（`isSourceVisibility` で先に弾く） |
| `private` | **`false`（無条件）** — 所有者判定ができない以上、誰にも開けない |
| `member` | `classes.length > 0` |
| `organizer` | `classes.some(c => c.role === "organizer")` |
| `chapter-member` | `classes.some(c => c.chapterId === source.chapterId)` |
| `chapter-organizer` | `classes.some(c => c.chapterId === source.chapterId && c.role === "organizer")` |
| `default` | `false` |

**評価順と `default` を動かさない。**順序を入れ替えると `default` が「該当なし = 通す」に落ちる。

#### 5-2. `canClassesSeePage`

`pages/**` の read 判定に使う。**`canUserSeePage` の移設ではない** — あちらは
`public` / `unlisted` と admin / 著者しか見ない fast path なので、`restricted` を判定できない。
ここでは `getEffectivePagePermissions` の `canView` から DB 依存を除いたものを作る。

```ts
export type PageSubject = {
  visibility: string;
  chapterId: string | null;
  access: readonly { subjectType: string; subjectKey: string }[];
};

export function canClassesSeePage(page: PageSubject, classes: readonly PermissionClass[]): boolean;
```

| `page.visibility` | 判定 |
|---|---|
| `public` / `unlisted` | `true` |
| `member` | `classes.length > 0` |
| `organizer` | `classes.some(c => c.role === "organizer")` |
| `restricted` | `access` の `subjectType === "chapter"` のうち、`subjectKey` を `classes` のいずれかが持つものがあれば `true` |
| その他 | `false` |

**`subjectType === "email"` の grant は評価できない**（クラスにメールアドレスが無い）。
**無い grant は「無い」として扱う。**「評価できないから通す」に倒さない。

#### 5-3. `canMutatePage`

`Write` / `Delete` / shell 経由の変更に使う。
[ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する) の決定をそのまま実装する。

```ts
export function canMutatePage(classes: readonly PermissionClass[], page: PageSubject): boolean;
```

```
classes が空                                    -> false   // 「空 = 制限なし」に倒さない
classes に role === "organizer" が 1 つでもある  -> true    // チャプターを問わない
page.visibility が "public" / "unlisted"        -> true
page.chapterId を classes のいずれかが持つ       -> true
それ以外                                        -> false
```

catalog ページと `log` の例外は**この関数の外**で扱う（呼び出し側の Stage 05 の責務）。
パス形状の知識を `gdg-lib` に持ち込まない。

#### 5-4. チャンネル audience の包含判定（第 2 の認可制約）

**クラス集合だけではチャンネルの天井を表現できない。**
`member` 写像のチャンネルでは、Stage 04 の `applyChannelPolicy` が
保有クラスのチャプターを絞らない（絞ると未束縛チャプターの保有が落ちるため）。
その結果 `{tokyo, member}` が残り、`canClassesAccessSource` は
`chapter-member` + `tokyo` のソースを**通す**。
その回答は全国チャンネルに投稿され、東京に属さないメンバーの目に入る。
`organizer` 写像と `chapter-organizer` でも同じことが起きる。

したがって、エージェント側の判定は **2 つの制約の AND** になる。

1. **依頼者が読めるか** — クラス集合による判定（§5-1 / §5-2）
2. **このチャンネルに出してよいか** — チャンネル audience の包含

`channel.ts` に置く。**証明済みの包含だけ `true`、既定は `false`**
（`audienceContains` と同じ作法。[ADR-002](adr.md#adr-002-権限の単位をユーザーではなく権限クラスにする) の改訂を参照）。

```ts
/** A(inner) ⊆ A(outer) が証明できるときだけ true。 */
export function audienceKeyContains(outer: SourceAudienceKey, inner: SourceAudienceKey): boolean;

/** ページ audience がチャンネル audience を含むか。A(channel) ⊆ A(page)。 */
export function pageAudienceIncludesChannel(
  page: PageSubject,
  channel: SourceAudienceKey,
): boolean;

/** エージェント側が呼ぶ入口。2 つの制約の AND。 */
export function canClassesAccessSourceInChannel(
  source: { visibility: string; chapterId: string | null },
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean;

export function canClassesSeePageInChannel(
  page: PageSubject,
  classes: readonly PermissionClass[],
  channel: SourceAudienceKey,
): boolean;
```

`audienceKeyContains` の表。**チャンネルが狭いほど読める範囲が広い。**

| チャンネル audience | 読めるソース audience |
|---|---|
| `chapter-organizer` + C | `member` / `organizer` / `chapter-member:C` / `chapter-organizer:C` |
| `chapter-member` + C | `member` / `chapter-member:C` |
| `organizer` | `member` / `organizer` |
| `member` | `member` |
| `private` | なし（そのチャンネルではエージェントを使えない） |

- **表に無い組は `false`。** とくに全国 2 行は `chapter-*` を 1 つも通さない。
- `pageAudienceIncludesChannel` はページ側の語彙（`public` / `unlisted` / `member` /
  `organizer` / `restricted` + `access`）で同じことを判定する。
  - `public` / `unlisted` → **常に `true`**（どのチャンネルより広い）
  - `member` → チャンネルが `member` / `organizer` / `chapter-*` のとき `true`
  - `organizer` → チャンネルが `organizer` / `chapter-organizer` のとき `true`
  - `restricted` → `access` の `subjectType === "chapter"` の grant が
    **チャンネルの `chapterId` ただ 1 つ**であり、かつチャンネルが
    `chapter-member` / `chapter-organizer` のときだけ `true`
  - `restricted` で email grant を持つ、またはチャプター grant が複数 → **`false`（fail closed）**。
    audience key に落とせないものを「たぶん広い」と読まない
- **`SourceVisibility` の大小比較を導入しない。** 上の 2 つは述語であって順序ではない
  （`chapter-member:tokyo` と `chapter-member:osaka` は比較不能）。

#### 5-5. `agent.ts` — エージェント側に見せる面を絞る

**片方の制約だけを呼ぶ実装を、export の形で不可能にする。**
`wk`（Stage 11）と `agents-index`（Stage 09）は `agent.ts` の面だけを使う。

`agent.ts` が re-export するもの:

- `canClassesAccessSourceInChannel` / `canClassesSeePageInChannel`
- `canMutatePage`（**書き込みはチャンネルで絞らない。**理由は Stage 11 §5）
- `parseAclSpans` / `redactAclSpans` / `validateAclSpans` / `aclSpanSourceIds` /
  `metadataContainsAclTag` / `ACL_REDACTION_PLACEHOLDER`
- `sourceAudienceKey` / `parseLevelAudienceKey` / `isSourceVisibility` /
  `sourceVisibilityNeedsChapter`（チャンネル audience の key 化に要る）
- 型（`PermissionClass` / `PageSubject` / `SourceAudienceKey` ほか）

**`agent.ts` が export しないもの:**

- `canClassesAccessSource` / `canClassesSeePage` — **クラス版の裸の判定**。
  これが見えると、チャンネル制約を落とした実装が動いてしまう
- `canAccessSource` / `canUserSeePage` — user id と admin フラグを要求する
  （[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)）
- `audienceContains` — ソース audience の包含であって行為者の権限ではない

`wiki/` と Worker は従来どおり `@gdgjp/gdg-lib/acl`（`index.ts`）から完全な面を使う。

### 6. テストの移設

- `gdg-lib/src/acl/*.test.ts` に、`wiki/app/lib/acl-spans.test.ts` と
  `wiki/app/lib/sources.server.test.ts` のうち **純粋関数に対する部分** を移す。
- `wiki/` 側には DB を引く部分のテストだけを残す。
- **どちらからも消えるテストを作らない。** 移設前後でテストケース数の合計が減らないこと。

### 制約

- **判定の意味を変えない。** 特に `canAccessSource` の評価順（admin → owner →
  未知の visibility は `false` → private → member → organizer → chapter-*）を保つ。
  未知の visibility が `false` に落ちる分岐は、将来値を足したときの安全装置である。
- **`chapterId` の `String()` 正規化を落とさない。** claims 側は `number`、
  `sources.chapter_id` は TEXT。正規化を落とすと全チャプター判定が静かに `false` になる。
- **5 値を全順序として扱わない。** 「より厳しい visibility を選ぶ」ヘルパを追加しない。
  複数ソースは常に AND（`10-page-acl-spans.md` §0）。
- **`canClassesAccessSource` を `canAccessSource` の実装に流用しない。** 逆も同じ。
  2 本を独立に保ち、**等価性はテストで縛る**（Verification）。
  一方を他方から導くと、`isAdmin` / `addedBy` の短絡がローカル側に漏れ出す。
- **`private` に例外を作らない。** 「所有者なら読める」をローカルに持ち込むには
  ユーザー同一性が要る。[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする) が
  それを退けた以上、`private` は無条件に `false` である。
- **`canMutatePage` に catalog / `log` の例外を入れない。** パス形状は呼び出し側の知識。
- **空のクラス集合を「制限なし」に反転させない。** クラスを取る全関数で空は `false` 側に落ちる。
- **`agent.ts` からクラス版の裸の評価器（`canClassesAccessSource` /
  `canClassesSeePage`）を export しない**（§5-5）。**「便利だから」も無し。**
  export した瞬間に、チャンネル制約を落とした `wk` / インデックスが書けるようになり、
  **全国チャンネルの漏れが静かに復活する。**
- **`audienceKeyContains` / `pageAudienceIncludesChannel` を「表に無い組は通す」に倒さない。**
  既定 `false`。audience key に落とせない `restricted`（email grant、複数チャプター grant）も `false`。
- **`build:acl` のエントリを `index.ts` に戻さない。** `agent.ts` である（§5-5）。
- `gdg-lib/src/acl/**` は依存ゼロ。`node:` 組み込みも使わない。
- `gdg-lib/src/index.ts` から ACL を re-export しない。
- 生成物（`cli/internal/wiki/hooks/acl.ts`）はコミットしない。
- **`build:acl` の outfile を `gdg-lib/dist/` に戻さない**（§4）。
  戻すと `wk` の import 文がリポジトリ上と配置後で別物になる。
- Biome（2 スペース・ダブルクォート・セミコロン・100 桁）。`import type` を使う。

---

## Files to touch — 変更ファイル

### `gdg-lib/`

- `src/acl/index.ts`（新規）
- `src/acl/agent.ts`（新規）— エージェント側に見せる面だけの barrel（§5-5）。
  `build:acl` のエントリ
- `src/acl/types.ts`（新規）
- `src/acl/visibility.ts`（新規）
- `src/acl/access.ts`（新規）
- `src/acl/audience.ts`（新規）
- `src/acl/channel.ts`（新規）— `audienceKeyContains` /
  `pageAudienceIncludesChannel` / `…InChannel` 版（§5-4）
- `src/acl/mutate.ts`（新規）— `canMutatePage`。移設ではなく新規実装
- `src/acl/spans.ts`（新規）
- `src/acl/access.test.ts`, `src/acl/audience.test.ts`, `src/acl/spans.test.ts`（新規、移設）
- `src/acl/classes.test.ts`（新規）— `canClassesAccessSource` と `canAccessSource` の等価性
- `src/acl/channel.test.ts`（新規）— 5 値 × チャンネル 5 値の全組み合わせ（§5-4）
- `src/acl/agent-surface.test.ts`（新規）— `agent.ts` が
  クラス版の裸の評価器を export していないこと
- `src/acl/mutate.test.ts`（新規）— `canMutatePage` の全組み合わせ
- `package.json` — `exports` に `./acl` と `./acl/agent`、`scripts` に `build:acl`、
  devDeps に `esbuild`
- `.gitignore` — `dist/`

### `cli/`

- `internal/wiki/hooks/.gitignore`（新規）— `acl.ts`（`build:acl` の生成物）

### `wiki/`

- `app/lib/sources-shared.ts` — 再 export 化
- `app/lib/acl-spans.ts` — 再 export 化
- `app/lib/sources.server.ts` — `canAccessSource` を re-export に
- `app/lib/acl-spans.server.ts` — 純粋部分を import + re-export、DB 部分は据え置き
- `app/lib/acl-spans.test.ts`, `app/lib/sources.server.test.ts` — 純粋部分を削り、DB 部分を残す
- `package.json` — `@gdgjp/gdg-lib` 依存の確認

---

## Verification — 完了条件と検証

### 完了条件

1. `wiki/` の **呼び出し側が 1 箇所も変わっていない**（import パスも関数名も同じ）。
2. `cli/internal/wiki/hooks/acl.ts` を素の Node から import でき、
   `parseAclSpans` / `redactAclSpans` / `canClassesAccessSourceInChannel` が
   export されている（**`canAccessSource` と `audienceContains` は出ない。**§5-5）。
3. `gdg-lib/src/acl/**` のどのファイルにも値の `import` 文が無い（`import type` のみ）。
4. `wiki/` と `gdg-lib/` のテストケース数の合計が、移設前より減っていない。
5. **`canClassesAccessSourceInChannel` / `canClassesSeePageInChannel` / `canMutatePage` /
   `parseAclSpans` / `redactAclSpans` / `validateAclSpans`** が
   `@gdgjp/gdg-lib/acl/agent` と生成物 `acl.ts` の**両方**から export されている。
   後段の `wk` は生成物しか読めない。
   **`redactAclSpans` を落とさない** — `wk read` の濾過がそれで動く（Stage 11 §4）。
5a. **生成物 `acl.ts` と `@gdgjp/gdg-lib/acl/agent` から
   `canClassesAccessSource` / `canClassesSeePage` / `canAccessSource` /
   `audienceContains` が export されていない**（§5-5）。
6. `canClassesAccessSource` が、admin でも所有者でもないユーザーについて
   `canAccessSource` と全組み合わせで一致する（下の回帰テスト）。
7. `audienceKeyContains` が全国 audience（`member` / `organizer`）に対して
   `chapter-member` / `chapter-organizer` のソースを **1 つも通さない**。

### コマンド

```bash
pnpm --filter @gdgjp/gdg-lib build:acl
```

```bash
pnpm --filter @gdgjp/gdg-lib test && pnpm --filter @gdgjp/wiki test
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **未知の `visibility` 文字列で `canAccessSource` が `false` を返す。**
  移設で分岐の順序が入れ替わると、`default` が「該当なし = 通す」に落ちる事故が起きる。
- **`claimsAvailable === false`（空 `chapters`）で `organizer` / `chapter-*` が読めない。**
  空配列が「全部読める」に反転しないこと。**反転しても画面上は正常に見える。**
- **`chapterId` の型混在** — claims の `number` と `sources.chapter_id` の TEXT が
  `String()` 正規化を通して一致すること。
- **`redactAclSpans` の出力に `<acl` が現れない。** 許可・拒否のどちらでもタグは必ず消える。
- **生成物 `acl.ts` と `src/acl/` がズレない。** ビルド成果物に対して
  `src/` と同じテストスイートを走らせる（`dist` を import するスモークテストを 1 本置く）。
  **ここを落とすと、フックだけが古い判定で動き続ける。画面上は正常に見える。**
- **`canClassesAccessSource` と `canAccessSource` の等価性。**
  `visibility` 5 値 × クラス集合（空 / `{C,member}` / `{C,organizer}` / 他チャプター /
  複数チャプター）の**全組み合わせ**で、`isAdmin: false` かつ `addedBy !== user.id` の
  ユーザーに対する `canAccessSource` と一致すること。
  **ここがズレると、ローカルで通った push がサーバで落ちる** —
  [ADR-007](adr.md#adr-007-acl-評価器を-gdg-lib-の純粋関数-1-本に集約する) が
  直そうとした症状そのものが、関数を 2 本にしたことで再発する。
- **`canClassesAccessSource("private", …)` がどのクラス集合でも `false`。**
  ここに所有者の例外が戻ると、睡眠が `private` ソースを読み始める。
- **`canClassesSeePage` が `restricted` + email grant だけのページを `false` にする。**
  「評価できない grant は無視して通す」に倒れないこと。
- **`canMutatePage` が空クラス集合で `false`。** ここが反転すると、
  クラス解決に失敗した invocation が全ページを書けるようになる。**画面上は正常に見える。**
- **`canMutatePage` が `organizer` を含むクラス集合で他チャプターのページに `true` を返す。**
  [ADR-018](adr.md#adr-018-ページ変更権限をクラス集合から直接判定する) の意図的な選択であり、
  「バグに見えるので直す」を防ぐためにテストで固定する。
- **`audienceKeyContains` が全国 audience でチャプター限定ソースを通さない。**
  `member` チャンネル × `chapter-member:tokyo`、`organizer` チャンネル ×
  `chapter-organizer:tokyo` を名指しで固定する。
  **ここが通ると、全国チャンネルにチャプター限定の材料が出る。**
  漏れた側の画面には何のエラーも出ない。
- **`pageAudienceIncludesChannel` が `restricted` + email grant を `false` にする。**
  複数チャプター grant も `false`。「key に落とせない = たぶん広い」に倒れないこと。
- **`…InChannel` 版が 2 つの制約を AND している。** クラス側が `true` でチャンネル側が
  `false` の組（`member` チャンネルの東京メンバー × `chapter-member:tokyo`）と、
  その逆（`chapter-organizer:tokyo` チャンネルの大阪メンバー × `chapter-member:tokyo`）を
  **両方**固定する。片側だけのテストでは、もう片方が落ちても気づけない。
- **`agent.ts` の面が広がっていない。** `canClassesAccessSource` /
  `canClassesSeePage` / `canAccessSource` / `audienceContains` が
  `agent.ts` と生成物 `acl.ts` から引けないこと（export の一覧をテストで固定する）。
  **広がった瞬間に、チャンネル制約を落とした `wk` が書ける。**
- **`gdg-lib` のルート index から ACL が export されていない。**
  `import { canAccessSource } from "@gdgjp/gdg-lib"` が型エラーになること。
  ここが通ると Worker が `openid-client` を引き込む経路が復活する。

### 手動 E2E

1. `pnpm --filter @gdgjp/wiki dev`（:5177）を起動する。
2. `tests/e2e/global-setup.ts` が用意する `admin` / `author` / `member` の 3 セッションで
   `/sources` と `<acl>` を含むページを開き、**移設前とまったく同じ見え方** であることを確認する。
3. `member` セッションで `organizer` visibility のソースが一覧に出ないことを確認する。
4. `<acl src="…">` を含むページを、権限のあるユーザーと無いユーザーの両方で開き、
   黒塗り（`⬛︎⬛︎⬛︎`）の出方が変わっていないことを確認する。
