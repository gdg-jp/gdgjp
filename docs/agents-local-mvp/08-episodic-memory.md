# Stage 08 — Episodic memory capture and upload

## Context — 背景とリポジトリ状況

### なぜやるか

現在、Discord での会話は xangi の transcript
（`<workdir>/logs/sessions/<appSessionId>.jsonl`）に残るだけで、
wiki には一切還元されない。同じ質問に何度も同じ調査をやり直し、
チャンネルで決まったことが wiki に載らない。

このステージで、**会話をエピソード記憶としてファイルに落とし、
サーバの `sources` 行として登録できる形にする**。

記憶の ACL は、それが生まれた **Discord チャンネルの権限セット** から決まる。
`#core-staff` での会話は `chapter-organizer`、`#main` での会話は
IAM のチャンネル写像が定めた値になる。写像に無ければ `chapter-organizer`（最も狭く）。

### 設計の要点 — なぜ 2 段構えなのか

生の会話ログは `agents-local/memories/` に **ローカル保存のみ** し、gitignore する。
`agents-local` は GitHub 上の実リポジトリなので、コミットすると
全チャプターの記憶が GitHub に載り、front matter の `visibility` は
そこでは何の効力も持たなくなる（GitHub のリポジトリ権限が唯一の境界になる）。

一方、記憶をページに昇格させるときは `<acl src="…">` でタグ付けしたい。
`src` の値は `sources.id` なので、**昇格の直前にサーバへアップロードして
`source.id` を得る**（Stage 02 のエンドポイント）。

`raw pull` で `raw/` に materialize されるのを待つ往復は挟まない。
**ingest はローカルの `memories/` ファイルを直接読み**、
タグにはアップロードで得た `source.id` を使う。

したがって `kind: "conversation"` は **CLI マニフェストからも除外される**（Stage 02 §4）。
マニフェストに出すと `raw pull` が同じ内容を `raw/` にも落とし、
ローカルの `memories/` と合わせて同じ会話ログが 2 回 ingest される。
サーバ上の `sources` 行は `<acl src>` が参照する id と、
ローカル削除後に残る恒久記録のために存在する。

**アップロードのタイミングは「そのファイルを ingest する直前」**（Stage 10 §3）。
セッション終了時ではない。書き出しとアップロードは別のタイミングに起こる。

### 依存と対象範囲

- **先行ステージ: Stage 02（`sources/inline` エンドポイント）、Stage 04（IAM のチャンネル写像）。**
- 後続の Stage 10（睡眠）が本ステージの記憶を消費する。
- 対象は `~/proj/xangi`（書き出しとアップロード）と `agents-local/`（`.gitignore`、`AGENTS.md`）。
- **睡眠のループそのものは Stage 10 の担当。** ここでは
  「記憶を書く」「アップロードする」の 2 つの部品まで。
- **`<acl>` の自動挿入は Stage 06 の担当。**

### 読むべきもの

- `docs/agents-local-mvp/index.md` §7「エピソード記憶」
- `docs/agents-local-mvp/02-wiki-inline-source-api.md` — アップロード先の仕様
- `docs/agents-local-mvp/04-xangi-authz-iam.md` §2 — `resolveMemoryVisibility`
- `docs/plans/09-source-visibility-acl.md` — `SourceVisibility` の 5 値
- `~/proj/xangi/src/transcript-logger.ts` — 既存の会話ログ

### 再利用する既存実装（書き直さない）

- `~/proj/xangi/src/transcript-logger.ts` の `getSessionLogPath`（`:39`）、
  `writeEntry` の追記の作法、エントリ形状（`:21`）—
  `{id, role, content, createdAt, usage?, edited?, editedAt?, platformMessageId?}`。
  **JSONL の書き方は手本にするが、記憶の本文には使えない。**
  `role: "user"` に入っているのは `fullPrompt`（systemPrompt + runtime context + 本文）であって
  人間の発言ではなく、発言者 id のフィールドも無い。詳細は §1。
  発話は Discord 境界で別に記録する（`src/speech-log.ts`、§1）
- `~/proj/xangi/src/sessions.ts` — `SessionEntry`、`contextKey`、
  セッションの終了を検出する足がかり
- `~/proj/xangi/src/iam.ts`（Stage 04）— `resolveMemoryVisibility`
- `~/proj/xangi/src/principal.ts`（Stage 03）— `Principal`
- `~/proj/xangi/src/account-link.ts`（Stage 04）— GDG のアクセストークン取得。
  **アップロードはこのトークンで行う**

---

## Design — 設計

### 1. 記憶ファイル

`agents-local/memories/<ISO8601>-<sessionId>-<segmentSeq>.md`。フラット。ディレクトリを掘らない。

**ファイル名に主題を書かない。** インデックス（Stage 09）の出力はパスを含むので、
ファイル名が主題を含むとパス名だけで内容が漏れる。

```markdown
---
gdg_memory: 1
session_id: <xangi appSessionId>
platform: discord
guild_id: "1397126037963542569"
channel_id: "1485243906655518741"
channel_name: core-staff
started_at: 2026-08-18T09:12:03Z
ended_at: 2026-08-18T09:41:55Z
visibility: chapter-organizer
chapter_id: "12"
participants:
  - discord_user_id: "…"
    display_name: "…"
    classes: ["12:organizer"]
uploaded_source_id: null
upload_actor: null
---

## 2026-08-18T09:12:03Z <発言者>

（本文）

## 2026-08-18T09:12:40Z assistant

（本文）
```

- `visibility` / `chapter_id` は `resolveMemoryVisibility`（Stage 04）が決める。
  **`null` が返る（guild 未束縛）なら記憶を書き出さない。**
- `uploaded_source_id` はアップロード後に書き戻す（§4）。
- 本文は **Discord 境界で記録した発話イベント**を整形したもの（下記）。
- ツール呼び出しの詳細（`logs/tool-trajectory/`）は **含めない**。
  記憶として価値があるのは会話であって、ツールの軌跡ではない。

#### 既存 transcript だけでは本文を作れない

`transcript-logger.ts` は再利用するが、**そのままでは上のフォーマットを満たせない。**
実装を確認した結果、2 つ足りない。

- **`role: "user"` の `content` は発話ではない。** 記録しているのは
  `logPrompt(this.workdir, options.appSessionId, fullPrompt)`
  （`~/proj/xangi/src/cursor-cli.ts:106,112,177,190`）であり、
  `fullPrompt` は `systemPrompt` + `prependRuntimeContext(...)` + プロンプトを連結したものである。
  **バックエンドに送った文字列であって、人間が書いた発言ではない。**
- **発言者が入っていない。** `TranscriptEntry` は
  `{id, role, content, createdAt, usage?, edited?, editedAt?, platformMessageId?}` で、
  Discord の user id を持つフィールドが無い。
  上の front matter の `participants[].discord_user_id` も、本文の `## <ISO8601> <発言者>` も、
  **ここからは復元できない。**

したがって **Discord 境界（`src/discord/message-handler.ts`）で正規化した発話イベントを別に記録する。**

```ts
type SpeechEvent = {
  id: string;                    // transcript と同じ採番でよい
  at: string;                    // ISO8601
  speaker:
    | { kind: "user"; discordUserId: string; displayName: string }
    | { kind: "assistant" };
  text: string;                  // 人間が書いた本文 / bot が返した本文
  platformMessageId?: string;
};
```

- 置き場所は **xangi の `dataDir` 配下**の `speech/<appSessionId>.jsonl`。JSONL 追記、
  書き方の流儀は transcript と同じにする。
  **`<workdir>/logs/` の下に置かない** — workdir は `gdgwiki` グループで
  全スロットと共有される（Stage 07 §1）ので、**ACL タグが付く前の生の会話が
  どのチャプターのエージェントからも読める。**
  発話ログは Stage 05 の判定表のどのパス種別にも当たらず、**素通りする。**
- **既存の transcript（`<workdir>/logs/sessions/`）も同じ露出を持つ。**
  `role: "user"` の `content` は `fullPrompt` なので、会話本文がそのまま入っている。
  **併せて `dataDir` 配下へ移す。**移設が重ければ、少なくとも
  workdir 配下に残さないことだけは満たす。
- **既存の transcript を置き換えない。**あちらはデバッグと再送に使われている。
  並べて書く。
- `assistant` 側は、バックエンドの JSON blob ではなく
  **実際に Discord に投稿した本文**を記録する。
- `lastEmittedEntryId` はこの `SpeechEvent.id` を指す。

### 2. 書き出しのタイミング

「セッション終了」の定義を決める。

- **アイドルタイムアウト** — `contextKey` に対する最後のターンから N 分
  （既定 30 分、`MEMORY_IDLE_TIMEOUT_MS`）経過したら書き出す。
  `RunnerManager` の `IDLE_TIMEOUT_MS`（既定 30 分）と同じ考え方で、
  同じタイマー機構に相乗りしてよい。
- **プロセス終了時** — 未書き出しのセッションを全部書き出す。
- **`/memory flush` スラッシュコマンド** — 手動で確定させる（デバッグと運用用）。

書き出し済みのセッションが再開されたら、**新しい記憶ファイルを作る**
（1 ファイル = 1 連続会話）。

#### セグメント番号と、どこまで書き出したかの記録

**「新しいファイルを作る」だけでは足りない。** 2 つの状態を永続化する。

| 状態 | 置き場所 | 用途 |
|---|---|---|
| `segmentSeq`（0 始まり） | `SessionEntry` | ファイル名と `externalId` を一意にする |
| `lastEmittedEntryId` | `SessionEntry` | transcript のどこまで書き出したか |

- **`segmentSeq` を `externalId` に含める。** 含めないと、再開後の 2 本目以降が
  1 本目と同じ冪等キーになり、Stage 02 の手順 4 が
  **既存の `ready` 行をそのまま返して終わる** — つまり
  **2 本目以降の会話が永久にサーバへ渡らない。**
  ローカルのファイルは消えるので、**気づく手がかりが残らない。**
- **`lastEmittedEntryId` が無いと、毎回ログを先頭から読み直す。**
  発話ログは `<dataDir>/speech/<appSessionId>.jsonl` の 1 セッション 1 ファイルで、
  追記しかされない。2 本目の記憶ファイルに 1 本目の内容が丸ごと再掲される。
- 書き出しは `lastEmittedEntryId` の**次**のイベントから始め、
  成功したら最後の `SpeechEvent.id` で更新する。
- 記憶ファイル名も `<ISO8601>-<sessionId>-<segmentSeq>.md` にする。
  **主題は入れない**（ファイル名からの漏洩を防ぐ規約は維持する）。

### 3. DM・未束縛 guild・スレッド

| 状況 | 動作 |
|---|---|
| DM | **記憶を書かない。** `DirectMessages` intent を要求していないので届かないが、明示的に弾く |
| guild が IAM に未束縛 | **記憶を書かない。** ログに 1 行残し、`/iam bind` を促す |
| スレッド | 親チャンネルの写像を継承する（`resolveMemoryVisibility` が処理する） |
| Web chat / スケジューラ | **記憶を書かない。** チャンネル起点の ACL が決まらない |

### 4. アップロード

`src/memory-upload.ts`（新規）。**睡眠（Stage 10）から呼ばれる。**

```ts
export async function uploadMemory(path: string): Promise<{ sourceId: string } | { error: string }>;
```

1. front matter を読む。`uploaded_source_id` が既に埋まっていれば何もせず返す。
   `upload_actor` が埋まっていれば、**そのユーザーのトークンだけ**を使う（§5）。
2. `POST {WIKI_URL}/api/agent/sources/inline` に送る。

```jsonc
{
  "title": "Discord #core-staff 2026-08-18",
  "content": "<記憶ファイルの本文（front matter を除く）>",
  "visibility": "chapter-organizer",
  "chapter": "12",
  "externalId": "xangi-session:<appSessionId>:<segmentSeq>"
}
```

**`externalId` から `segmentSeq` を落とさない。** 落とすと再開後のセグメントが
1 本目の冪等キーに衝突し、サーバは既存行をそのまま返す。
アップロードは「成功」に見え、ローカルのファイルは削除され、**内容だけが消える。**

3. 認証は **`links.json` に保存された GDG アクセストークン**（Stage 04）。
   どのユーザーのトークンを使うかは §5。
4. 返った `id` を front matter の `uploaded_source_id` に書き戻す。
   併せて `.gdgwiki/acl-sources.json`（[Stage 11](11-wk-mediator.md) §4）に
   `{ "<id>": { "visibility", "chapterId" } }` を追記する。
   **会話ソースは CLI マニフェストに出ないので、ここで積まないと
   `wk` がこの `source.id` を持つスパンを解決できず、fail closed で deny する。**
5. **`externalId` によりサーバ側で冪等** なので、再試行しても重複しない。

### 5. どのトークンでアップロードするか

記憶は複数人の会話であり、「誰の記憶か」が一意に決まらない。

**そのチャンネルの `visibility` を割り当てられる参加者のトークンを使う。**

- 参加者の `classes` を見て、`canAssignSourceVisibility(visibility, chapterId, …)` を
  満たす人を選ぶ（`chapter-organizer` ならそのチャプターの organizer）。
- 複数いれば **最初にログインした人**（`links.json` の `linkedAt` が古い順）を選ぶ。
- **選定結果を front matter の `upload_actor: <GDG sub>` に書き戻し、以降はそれに固定する。**
  2 回目以降の `uploadMemory` は**選び直さない**。
- 誰も満たさなければ **アップロードしない**。記憶ファイルはそのまま残し、
  ログに理由を残す。運用者が `/iam` を直すか、organizer がログインすれば次回通る。

#### アップローダを選び直してはいけない理由

Stage 02 §1 の冪等キーは **`(added_by, kind, external_id)`** である。
`added_by` はアップロードしたユーザーであり、**キーの一部**である。

したがって、アップローダを毎回計算し直すと、
**新しい参加者がログインした・IAM のロール写像が変わった・`linkedAt` の順序が変わった**
だけで `added_by` が変わり、**同じ会話が別の行として登録される。**
`externalId` は同じなので衝突もせず、`uploaded_source_id` も埋まり、
**アップロードは成功として観測される。**気づけるのは重複ページができてからである。

`upload_actor` に固定した人がもう `visibility` を割り当てられなくなった場合は、
**別の人に切り替えず、アップロードを見送る**。切り替えは重複を作る。

**運用者の固定トークンで代行しない。** それをやると、参加者の誰も
アクセスできない範囲の記憶が運用者の権限で登録されうる。

### 6. `.gitignore` と保持期間

- `agents-local/.gitignore` に `memories/` を追加する。
- 昇格（Stage 10）が完了した記憶ファイルは **削除する**。
- アップロードに失敗し続けるファイルのために、
  `MEMORY_MAX_AGE_DAYS`（既定 30）を超えたものを警告付きで残す運用にする。
  **自動削除しない** — 消えた記憶は取り戻せない。

### 制約

- **`memories/` をコミットしない。** front matter の `visibility` は
  GitHub 上では何の効力も持たない。
- **ファイル名に主題を書かない。** インデックスの出力から内容が漏れる。
- **未束縛 guild・DM・Web・スケジューラでは記憶を書かない。**
  ACL が決まらないものを保存しない。
- **未設定チャンネルは `chapter-organizer` にフォールバックする。**
  `member` に落とすと全国の GDG メンバーが読める。
- **運用者の固定トークンでアップロードしない。** 参加者の権限で登録する。
- **アップローダを毎回選び直さない。** `upload_actor` に固定する。
  `added_by` は冪等キーの一部なので、変わると同じ会話が別の行になる（§5）。
- **発話ログと transcript を workdir 配下に置かない。** あそこは全スロットと
  共有されるので、ACL タグが付く前の生の会話が全チャプターから読める。
- **記憶ファイルを自動削除しない**（昇格完了時を除く）。
- **`externalId` から `segmentSeq` を落とさない。** 落とすと再開後の会話が
  サーバに渡らないまま、ローカルのファイルだけが消える。
- **`lastEmittedEntryId` を記録せずに書き出さない。** 毎回先頭から読み直すと、
  同じ会話が複数の記憶ファイルに重複して入り、そのぶん重複ページになる。
- **既存の `transcript-logger.ts` の出力を記憶の本文に使わない。**
  あれはバックエンドに送った `fullPrompt` であって発話ではない。
  発話は Discord 境界で別に記録する。
- **ツール軌跡を記憶に含めない。** 記憶が肥大して query が遅くなる。
- `visibility` の語彙は `@gdgjp/gdg-lib/acl` から借りる。xangi 側で再定義しない。
- eslint + prettier。husky が commit 時に全 vitest と `tsc --noEmit` を走らせる。

---

## Files to touch — 変更ファイル

### `~/proj/xangi`

- `src/memory-writer.ts`（新規）— 記憶ファイルの生成、front matter、整形
- `src/memory-upload.ts`（新規）— `sources/inline` へのアップロードと書き戻し
- `src/memory-session.ts`（新規）— アイドル検出と書き出しトリガ
- `src/sessions.ts` — セッション終了の検出フック
- `src/speech-log.ts`（新規）— `SpeechEvent` の追記と読み出し（`dataDir` 配下の `speech/`）
- `src/transcript-logger.ts` — 出力先を `dataDir` 配下へ移す（workdir 配下に残さない）
- `src/installer/layout.ts` — `speech/` と `sessions/` のパス解決
- `src/discord/message-handler.ts` — 発話イベントの記録（受信側と投稿側の両方）
- `src/discord/slash-commands.ts` — `/memory flush`
- `src/index.ts` — アイドルタイマーの起動、プロセス終了時のフラッシュ
- `src/config.ts` — `MEMORY_IDLE_TIMEOUT_MS` / `MEMORY_MAX_AGE_DAYS` / `WIKI_URL`
- `tests/memory-writer.test.ts`, `tests/memory-upload.test.ts`（新規）

### `agents-local/`

- `.gitignore` — `memories/`
- `AGENTS.md` — `memories/` の存在と、ingest 時の扱い
- `README.md` — 記憶の仕組みと保持期間

---

## Verification — 完了条件と検証

### 完了条件

1. Discord で会話してアイドル 30 分（テストでは短縮）経つと、
   `memories/<ISO8601>-<sessionId>-<segmentSeq>.md` が生成される。
1a. 本文に **`## <ISO8601> <発言者>` の見出しが発言ごとに並び**、
   `<発言者>` が Discord の表示名になっている。
   `systemPrompt` や runtime context の文字列が本文に混ざっていない。
1b. front matter の `participants[]` に、実際に発言した Discord user id が入っている。
2. front matter の `visibility` / `chapter_id` が IAM のチャンネル写像どおりになる。
   写像に無いチャンネルでは `chapter-organizer` になる。
3. `uploadMemory` が `sources/inline` に登録し、`uploaded_source_id` が書き戻る。
4. 同じファイルで 2 回 `uploadMemory` しても新しい `sources` 行ができない。
4a. **書き出し済みのセッションを再開して再度フラッシュすると、
   `segmentSeq` が 1 つ進んだ別ファイルができ、別の `sources` 行として登録される。**
4b. **2 本目の記憶ファイルに 1 本目の会話が含まれていない**
   （`lastEmittedEntryId` が効いている）。
5. DM・未束縛 guild・Web chat では記憶ファイルが作られない。
6. `memories/` が `git status` に現れない。
7. 発話ログと transcript が xangi の `dataDir` 配下にあり、workdir の中に無い。
8. `uploadMemory` が front matter に `upload_actor` を書き戻し、
   2 回目以降はそれを使う。参加者が増えても `added_by` が変わらない。

### コマンド

```bash
cd ~/proj/xangi && npm test
```

```bash
cd ~/proj/xangi && npx tsc --noEmit && npm run lint
```

```bash
cd /Users/hari/proj/gdgjp/agents-local && git status --porcelain --untracked-files=all
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **未設定チャンネルが `chapter-organizer` にフォールバックする。**
  `member` に落ちると全国の GDG メンバーに公開される。
- **再開後のセグメントが別の `sources` 行になる。** `externalId` に `segmentSeq` が
  入っていること。**入っていないと、2 本目以降の会話がサーバに渡らないまま
  ローカルファイルだけが削除される。** アップロードは成功と報告され、
  `uploaded_source_id` も埋まるので、**失敗として観測できない。**
- **セグメント間で会話が重複しない。** `lastEmittedEntryId` の次から書き出すこと。
  先頭から読み直すと、同じ会話が 2 つのソースとして ingest され、重複ページになる。
- **記憶の本文に `systemPrompt` や runtime context が混ざらない。**
  `transcript-logger` の `role: "user"` をそのまま使うとこうなる。
  内容としては読めてしまうので、**目視でしか気づけない。**
- **記憶の本文に発言者が入っている。** `participants[]` と本文の見出しの両方。
  発話ログを経由していないと、ここが `user` / `assistant` だけになる。
  **画面上は何も変わらないので気づけない。**
- **未束縛 guild で記憶が作られない。** `chapterId` が空文字や `undefined` のまま
  書き出されると、後でアップロードが通ってしまう。
- **`memories/` が gitignore されている。** `git status --porcelain --untracked-files=all`
  が空であること。`.gitignore` を書き換えると全チャプターの記憶が GitHub に載る。
- **冪等性** — `externalId` が同じなら `sources` 行が増えないこと。
  睡眠は失敗時に再試行する。
- **トークン選択の安定性** — 同じチャンネルの記憶が毎回同じユーザーの
  トークンでアップロードされること。ばらつくと `sources.added_by` が散らばり、
  「オーナーは常に読める」規則の効き方が予測できなくなる。
- **参加者が増えても `added_by` が変わらない。** `upload_actor` を書き戻したあとに
  新しい参加者がログインした状態で再アップロードし、**同じ行が返る**こと。
  ここが変わると `(added_by, kind, external_id)` のキーが変わって行が 2 つになり、
  **アップロードは成功と報告され `uploaded_source_id` も埋まる。**
  重複ページができるまで気づけない。
- **発話ログが workdir 配下に無い。** `<workdir>/logs/speech/` が存在しないこと。
  スロット uid から発話ログと transcript が読めないこと。
  **読めると、ACL タグが付く前の全チャプターの会話が素通しになる。**
- **トークン選択の失敗がアップロードを止める。** 誰も `visibility` を
  割り当てられないとき、運用者トークンにフォールバックしないこと。
- **`role: "assistant"` の JSON blob が正しく展開される。** 生の JSON が
  記憶本文に混ざると、ingest がノイズを読む。
- **ファイル名に主題が入らない。** `<ISO8601>-<sessionId>` の形式であること。

### 手動 E2E

1. テスト用 Discord サーバーを `/iam bind` でチャプターに束縛する。
2. `/iam channel #core-staff chapter-organizer` を設定する。
3. `#core-staff` で数ターン会話し、`/memory flush` を実行する。
4. `agents-local/memories/` にファイルができ、`visibility: chapter-organizer` に
   なっていることを確認する。
5. 写像を設定していない `#random` で会話し、`/memory flush` →
   `visibility: chapter-organizer` にフォールバックすることを確認する。
6. `git status --porcelain --untracked-files=all` が空であることを確認する。
7. `uploadMemory` を手動で呼び、`/sources` に **出ない** source ができ、
   `uploaded_source_id` と `upload_actor` が書き戻ることを確認する。
   `.gdgwiki/acl-sources.json` にその `source.id` が積まれることも確認する。
8. もう一度 `uploadMemory` を呼び、D1 の `sources` 件数が増えないことを確認する。
9. 束縛していない別サーバーで会話し、記憶ファイルが作られないことを確認する。
