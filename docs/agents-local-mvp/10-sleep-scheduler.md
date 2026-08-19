# Stage 10 — Sleep scheduler

## Context — 背景とリポジトリ状況

### なぜやるか

現在、wiki への反映はすべて人手の起動に依存している。誰かが
`gdg wiki raw pull` して `gdg wiki ingest` を回さない限り、
新しいソースも会話の記憶もページにならない。

サーバ側の source 再取得は **既に自動化されている**
（`wiki/wrangler.toml` の cron `0 16 * * *` → `enqueueDueSourceRefreshes` →
`SOURCE_FETCH_QUEUE` → `SourceImportDurableObject`）。
**欠けているのはローカル側の ingest を無人で回すループだけ**である。

このステージで「睡眠」を実装する。日次で、

1. 取り込み待ちのソースを消化する
2. 会話の記憶をアップロードしてページに昇格させ、記憶ファイルを削除する

### リポジトリミューテックスを設ける理由 — 頻度論では受容できない

**エピソードの独立性は、この問題を解かない。**
独立性が成り立つのは `state.Ingested` と `uploaded_source_id` が表す
「どこまで終わったか」についてだけである。
睡眠と対話は、それとは別に **同じワークツリー・git index・HEAD・
トレース・`INGEST_QUEUE.md`** を変更する。この部分は独立ではない。

**当初は「呼び出し頻度が低いから受容する」としていた。この根拠は成立しない。**

- [Stage 07](07-agent-uid-isolation.md) §1 はスロットを `N = 4` 用意し、
  **全スロットが同じワークツリー `/srv/gdg-agent/wiki` で走る**（ADR-006）。
  同時実行は設計に組み込まれていて、その手動 E2E 3a が明示的に検証する。
  つまり **対話同士の競合は稀ではない。** 睡眠との競合確率だけを見るのは誤りだった。
- 競合したときに失われるものが、編集ではなく **ACL タグ**である。

| 競合する状態 | 症状 |
|---|---|
| git index / HEAD | 一方の `git commit` が失敗する（**気づける**） |
| トレースの `reads` | **`<acl>` の自動挿入が不足する（気づけない。下記）** |
| `INGEST_QUEUE.md` | キューが再構築され、処理中のソースが先頭から消える |
| ワークツリーの同一ページ | 後勝ちで一方の編集が失われる |

**2 行目が最も重い。** `reads` が足りないと Stage 06 の自動挿入がタグを打たない。
しかも `verify-acl` に渡る `readSourceIds` は**ローカルのトレースから作って
クライアントが送る値**である（`cli/internal/wiki/verify.go:36` →
`wiki/app/routes/api.cli.wiki.validate-acl.ts:151`）。
**サーバ側のバックストップにも検出できない形で、機密派生行が未タグで push される。**
これは機密の問題であって、頻度で受容できる種類のものではない。

**設計は Design §1a にある。** ここは「なぜ受容をやめたか」の記録である。

ただし **実行経路は対話と同じにする**。systemd timer の独立プロセスにすると、
Stage 05 のハーネスを通らない実行経路が 1 つできる。
睡眠こそ全チャプターの記憶を横断する工程なので、そこを特権化するのは逆である。

### 依存と対象範囲

- **先行ステージ: Stage 06（`<acl>` 自動挿入）、Stage 08（エピソード記憶）。**
  実質的に Stage 01〜09 のすべてが揃ってから着手する最終ステージである。
- 対象は `~/proj/xangi`（スケジューラ）と `agents-local/AGENTS.md`（睡眠時の指示）。
- **source 再取得の cron は既にサーバ側にある。作らない。**
- **`wiki lint` は睡眠に含めない**（現状 `LintPrompt` を出すだけの実装であり、
  自動化の価値が確定していない）。

### 読むべきもの

- `docs/agents-local-mvp/index.md` §9「睡眠」
- `docs/agents-local-mvp/08-episodic-memory.md` — 記憶ファイルとアップロード
- `docs/plans/11-ingest-acl-hooks.md` — `ingest --commit` のバックストップ
- `~/proj/xangi/src/scheduler/` — 既存のスケジューラ実装
- `~/proj/xangi/src/sessions.ts:43` — `scope: 'interactive' | 'scheduler'`

### 再利用する既存実装（書き直さない）

- `~/proj/xangi/src/sessions.ts` の `scope: 'scheduler'` — **既に存在する概念**
- `~/proj/xangi/src/scheduler/*` — 既存のスケジューラ（cron 相当）と
  `registerDiscordSchedulerBridge`
- `~/proj/xangi/src/dynamic-runner.ts` の `run` / `runStream` — 全経路の choke point。
  睡眠もここを通す
- `~/proj/xangi/src/authz-server.ts`（Stage 04）— nonce 発行
- `~/proj/xangi/src/memory-upload.ts`（Stage 08）— `uploadMemory`
- `cli/internal/command/wiki.go` — `gdg wiki raw pull` / `ingest lock` /
  `ingest --commit`。**xangi が代行実行する**（Stage 07 で `gdg` は `gdgagent-svc` 専用）
- `wiki/workers/features/sources/fetch-source.ts` — サーバ側の日次 cron。**触らない**

---

## Design — 設計

### 1. 権限クラス `system`

睡眠は無人で走るので呼び出しユーザーが居ない。

`PermissionClass` の集合として、**IAM に束縛されている全ギルドの
全チャプターについて `organizer` を持つ集合** を組み立てる。
これを `system` と呼ぶ。

```ts
function systemClasses(iam: IamConfig): PermissionClass[] {
  // iam.guilds の全 chapterId について { chapterId, role: "organizer" }
}
```

- **`admin` 相当の特権クラスを作らない。** 束縛されたチャプターの範囲を超えない。
- **フックを通らない経路を作らない。** 睡眠のエージェント実行も
  `DynamicRunnerManager.run` を通り、`preToolUse` ハーネスが同じように効く。

#### `system` はエージェントに渡さない

**`system` は「キューとギルドを列挙するためのクラス」であって、エージェントの権限ではない。**

| 主体 | 使うクラス |
|---|---|
| スケジューラ本体（キュー読み・アップロード・`git` の代行実行） | `systemClasses(iam)` |
| **個々の ingest エージェント invocation** | **そのソース 1 件に必要なクラスだけ** |

```ts
// null = このソースは扱えない（private）。呼び出し側はスキップする。
function classesForSource(
  src: { visibility: SourceVisibility; chapterId: string | null },
): PermissionClass[] | null;
```

**`channelAudience` も invocation ごとに決める。**
睡眠には投稿先チャンネルが無いので、**そのソース自身の audience key を使う**
（`sourceAudienceKey(src.visibility, src.chapterId)`、Stage 04 §2-2）。
包含は反射的なのでそのソースは読め、より広い材料（`public` / `member`）も読める。
**一方で、そのソースより狭い他チャプターの材料には到達しない。**

```ts
function audienceForSource(
  src: { visibility: SourceVisibility; chapterId: string | null },
): SourceAudienceKey | null;   // null = 扱わない（private）
```

- **`channelAudience` を省略したり、最も広い値で埋めたりしない。**
  埋めると、プロンプト注入されたソース 1 件が他チャプターの材料に到達できる —
  クラス集合を 1 件ぶんに絞った意図がそこで消える。

`classesForSource` の対応:

- `chapter-organizer` + `C` → `[{C, organizer}]`
- `chapter-member` + `C` → `[{C, organizer}, {C, member}]`
- `organizer` / `member` → 束縛済み全チャプターの対応するクラス（元々そういう意味の値である）
- `private` → **扱わない。そのソースを飛ばす。**

**`private` を「登録者本人のクラス」に写像しない。**
所有者による判定にはユーザー同一性が要るが、クラス集合にはそれが無い
（[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)）。
`canClassesAccessSource` は `private` に対して無条件に `false` を返すので、
仮にクラスを載せても**エージェントはそのソースを読めない** — フックが deny する。
キューに `private` が現れたらスキップし、サマリに「スキップ: private」として出す。

入力は追加の問い合わせ無しに手元にある — `INGEST_QUEUE.md` と `state.Manifest` の各エントリが
`visibility` を持ち（`cli/internal/wiki/raw.go` の `BuildIngestQueue` が既に出力している）、
記憶由来の run はアップロード時の `visibility` / `chapterId` から導ける。

**理由。** 全チャプターの organizer を 1 つの nonce に載せると、
プロンプト注入されたソース 1 件が、他チャプターの `raw/` と `memories/` に到達できる。
睡眠は全チャプターの材料を横断する唯一の工程なので、**ここで ambient authority を作らない。**

nonce は invocation ごとに発行し、終了時に失効させる（Stage 04 §3 と同じ扱い）。

### 1a. リポジトリトランザクションミューテックス

**このステージで新設する。睡眠のためだけの機構ではない** — 対話経路も同じロックを取る
（根拠は Context「リポジトリミューテックスを設ける理由」）。

- **xangi 側に 1 本置く**（`proper-lockfile`、`~/proj/xangi/src/data-dir-lock.ts` と同じ作法）。
- **保持者は xangi。エージェントには渡さない。**
  エージェントに握らせると、落ちたプロセスのロックを誰が解放するか決まらない。
  ステイル検出（`proper-lockfile` の `stale`）とプロセス死亡時の解放を必ず設定する。
- 保持区間は**変更ライフサイクルの全体**である:
  `raw pull` / `ingest lock` / トレース初期化 → invocation →
  `wk git commit` → `ingest --commit` → `git push` → 状態更新。
  **invocation の途中でロックを手放さない。**
- **取得点は 2 つある。**

| 主体 | 取得のしかた |
|---|---|
| 睡眠・ingest（変更すると分かっている） | 工程の開始時に**先に取る** |
| 対話（変更するかは事前に分からない） | **`wk` の最初の変更操作**（`write` / `rm` / `git add` / `git commit`）で、`wk` が認可サーバ経由で xangi に取得を依頼する。xangi が握り、invocation 終了時に解放する |

  **読み取りだけの invocation はロックを取らない。**
  質問に答えるだけの並行実行は保たれる
  （[ADR-017](adr.md#adr-017-nonce-を-invocation-ごとの-uid-に束ねる) が
  「invocation をグローバルに直列化する」案を却下した理由を壊さない）。
  **ロックの保持者は依頼を受けた xangi のままである** — `wk` は取得を依頼するだけで、
  ロックファイルを自分で握らない。
- 取れなかったときの `wk` の変更操作は**非ゼロ終了**する（理由を stderr に出す）。
  **待たせるのではなく、失敗させて再試行させる**（フックのタイムアウトは 10 秒しかない）。
- **対話も睡眠も同じミューテックスを取る。** 睡眠を特権化しない。
  スロットプール（[Stage 07](07-agent-uid-isolation.md) §3）は
  uid と `/proc` の分離のための別機構であり、
  **スロットが 4 つ空いていてもリポジトリを変更できるのは 1 つだけ**である。
- 待ちや失敗が発生したことを Discord に伝える（「他の処理の完了を待っています」）。
  **黙って待つ・黙って落とすと、応答が遅いか壊れたようにしか見えない。**
- タイムアウトを置く（睡眠側は工程のタイムアウト + 余裕）。
  取れなかった睡眠の工程は**実行せず**、次回に回す。
  **ロックを諦めて実行に進む経路を作らない。**
- 併せて**トレースを invocation ごとのファイルに分ける**（[Stage 11](11-wk-mediator.md) §8）。
  これは多重防御である — ミューテックスにバグがあっても、
  ACL タグの欠落だけは静かに起きない形にしておく。

**却下した案**（将来のスケーリング経路として残す）:

- **スロットごとに `git worktree` を分ける。** 物理的に競合しないので直列化が要らない。
  ただし [ADR-006](adr.md#adr-006-workdir-とインデックスを-1-つに保ち射影ビューを作らない) の
  「workdir は 1 つ」の改訂が必要で、
  `agents-index` の監視対象と `index.db` の同一性も分裂する。
  **同時実行を上げる必要が出たらこちらに移る**（ADR-006 の Consequences に記録済み）。
- **`.gdgwiki/ingest-locks.json` で足りるとする。** あれは document 単位のロックであって、
  リポジトリ状態のロックではない。§2 の多重起動フラグも睡眠同士の重複しか防がない。

### 2. スケジュール

xangi の内部スケジューラで日次実行する。既定は **04:00 JST**
（サーバ側の source 再取得 cron が 16:00 UTC = 01:00 JST なので、その後）。
`SLEEP_CRON` で変更可能にする。

多重起動防止は、スケジューラ内の単純なフラグでよい
（前回の睡眠が終わっていなければスキップし、ログに残す）。

### 3. 睡眠のループ

各ステップは **独立して再試行可能** であること。途中で落ちても次回に続きから進む。

```
1. gdg wiki raw pull                        ← xangi が代行実行。通常ソースの取り込み

2. memories/ の各ファイルについて（記憶フェーズ）:
     2-1. uploadMemory(path) → source.id    ← Stage 08。既に uploaded なら記録済み id を使う
          → 進捗を uploaded に記録
     2-2. AppendTraceSource(source.id)      ← Stage 06 §5。この run が読むソースとして登録
     2-3. classesForSource(...) で nonce を発行し、エージェントを起動して
          **ローカルの memories/<file> を読ませて** ingest させる
          → commit まで進んだら committed に記録
     2-4. push → 成功を確認して pushed に記録
     2-5. memories/<file> を削除して completed に記録
     2-6. どこかで失敗したら次のファイルへ（記憶は消さない。次回の睡眠で再試行される）

3. gdg wiki ingest（キュー再構築）           ← xangi が代行実行
4. INGEST_QUEUE.md が空になるまで繰り返す（通常ソースのフェーズ）:
     4-1. gdg wiki ingest lock              ← xangi が代行実行
     4-2. classesForSource(...) で nonce を発行し、エージェントを起動して 1 ソース分を ingest
          → wk git commit まで進んだら **committed(documentId, commitSha) を記録**
     4-3. push                              ← xangi が代行実行。**--commit より前**
     4-4. push の成功を確認してから
          gdg wiki ingest --commit --document-id <id>  ← xangi が代行実行
          → **completed を記録**
     4-5. どこかで失敗したら次のソースへ（次回の睡眠で再試行される）

5. サマリを Discord の運用チャンネルに投稿する
```

#### push を `ingest --commit` より前に置く理由

`gdg wiki ingest --commit` は `state.Ingested[documentID] = contentHash` を書いて
**`.gdgwiki/state.json` に永続化する**（`cli/internal/command/wiki.go:522`）。
これはローカルの「取り込み済み」印であって、サーバへの反映ではない。

push せずに `--commit` すると、**そのソースは「取り込み済み」になったまま、
内容はこのマシンから出ていない。**次回以降の `BuildIngestQueue` は
`state.Ingested` と `contentHash` を突き合わせるので pending にも戻らない
（`cli/internal/wiki/raw.go:420`）。**そのソースは永久に wiki に載らない。**
エラーも出ない。

**push の成功を確認してから `--commit` する。**順序を逆にしない。

#### 進捗を永続化する

各アイテムの進捗を **ワークツリーの外**（xangi の `dataDir` 配下）に持つ。

```
記憶フェーズ:     uploaded → committed → pushed → completed
通常ソースフェーズ:            committed → completed
```

**通常ソースにも同じ状態機械を使う。** §3 冒頭の「各ステップは独立して再試行可能である」は、
現在の手順 4 では満たされていない — **push が成功した直後・`ingest --commit` の前に落ちると、
`state.Ingested` が書かれていないので次回の `BuildIngestQueue` はそのソースを pending として
返し、エージェントが同じソースをもう一度 ingest してページがもう 1 枚できる。**
記憶フェーズについて「同じ `source.id` を再利用してもページはもう 1 枚できる」と
書いたのとまったく同じ問題である。

- 再開時に **`committed` があり `completed` が無い** documentId は、
  **エージェントを再実行せず push からやり直す。**
- **`git push` は冪等**なので、push の途中で落ちた場合（既にリモートに届いていた場合）も
  同じ経路で吸収される。**リモートとの突き合わせ（`git ls-remote` での照合）は入れない** —
  push の冪等性で同じ穴が閉じるので、費用に見合わない。
- キーは記憶フェーズが `memories/<file>` のパス、通常ソースフェーズが `documentId`。

- **記憶フェーズの再試行で二重 ingest しない。** 元の記述は
  「アップロード済みなら記録済み `source.id` を再利用」で冪等だとしているが、
  **同じ `source.id` を再利用しても、ingest をもう一度回せばページはもう 1 枚できる。**
  push 後・削除前に落ちた場合がこれに当たる。
  `pushed` が記録されていれば、再開時は**削除だけ**を行う。
- `committed` が記録されていれば、再開時は**合成をやり直さず**、
  既にあるコミットから push に進む。エージェントの再実行はトークンを食う。
- 進捗ファイルは `memories/<file>` のパスと `documentId` をキーにする。
- **ワークツリーに置かない。** `.gdgwiki/` はエージェントが書ける場所であり、
  `git clean` や再クローンでも消える。

**アップロードは、そのファイルを ingest する直前に行う（2-1 → 2-3）。**
「全部アップロードしてからキューを回す」順序にすると、
キュー再構築より後に生まれたソースは**その run では処理されない**。
記憶は 1 ファイルずつ、アップロード → ingest → 削除 で閉じる。

**上限を設ける。** 1 回の睡眠で処理するソース数（既定 20、`SLEEP_MAX_SOURCES`）と
総実行時間（既定 3 時間、`SLEEP_MAX_DURATION_MS`）。
超えたら中断してサマリに残し、翌日の睡眠が続きから進む。
Cursor のサブスクリプション消費が青天井にならないようにする。

### 4. 記憶由来 run の扱い

**エージェントが読むのはローカルの `memories/<file>` である。**`raw/` には現れない。
アップロードは `<acl src>` に使う `source.id` と、サーバ側の恒久記録を得るためだけに行う
（[ADR-010](adr.md#adr-010-エピソード記憶をローカル-memories-に置き昇格時にサーバへアップロードする)）。
`raw pull` を待たないので、アップロードした同じ run で ingest できる。

**`INGEST_QUEUE.md` は `raw/` 由来のソース専用のままにする。** 記憶はキューに載せない。

「記憶専用の経路を作らない」の意味は、**キューまで共有することではなく**、
以下を共有することである:

- `.gdgwiki/ingest-trace/<runId>.json` — `AppendTraceSource(source.id)` で読取ソースとして
  登録する（トレースは invocation ごとに 1 ファイル。[Stage 11](11-wk-mediator.md) §8）
- `.gdgwiki/acl-sources.json` — アップロードで得た `source.id` の
  `visibility` / `chapterId` を積む（Stage 08 §4）。
  **積まないと、その id で張った `<acl src>` を `wk read` が解決できず、
  翌日以降そのページ全体が拒否側に倒れる**（[Stage 11](11-wk-mediator.md) §4）
- `<acl>` 自動挿入（Stage 06）— 登録した `source.id` でスパンが張られる
- `gdg wiki verify-acl` — トレースに載っているので run 単位の検査が効く
- `preToolUse` ゲートと `wk`、nonce（Stage 05 / 04）。
  **睡眠のエージェントも読み書きは `wk` 経由である。** 特権的な経路を作らない

エージェントには `AGENTS.md` で会話ログの扱いを指示する（§6）。
push が成功したら、その `memories/` ファイルを削除する。
**削除は push 成功後。** それより早いと、失敗時に記憶が失われる。

### 5. 統合の不変条件

**`visibility` が異なる記憶を 1 つのページに統合してはならない。**

5 値（`private` / `member` / `organizer` / `chapter-member` / `chapter-organizer`）は
**全順序ではない**。`chapter-member:tokyo` と `chapter-member:osaka` は比較不能で、
「最も狭い値に丸める」は定義できない（`docs/plans/10-page-acl-spans.md` §0）。

- ingest は 1 回に 1 ソースを扱うので、この不変条件は自然に満たされる。
- **`AGENTS.md` に明記する** — 「複数の会話ログをまとめて 1 ページにしない。
  既存ページに追記するときは、そのページの `<acl>` 構造を壊さない」。
- `verify-acl` が違反を検出する（異なるソース由来の記述が
  タグ無しで同じページに載れば `acl_untagged_read_source`）。

### 6. `AGENTS.md` への追記

- `kind: "conversation"` のソースは Discord の会話ログである。
- **決定・数値・合意事項を topic ページに載せる。**
  会話の流れそのものをページにしない（`docs/plans/03a-agents-md.md` の
  「Meeting minutes（mandatory）」と同じ規則が当てはまる）。
- **日付ごとのページを作らない。**
- 複数の会話ログをまとめて 1 ページにしない（§5）。

### 7. サマリ

睡眠の終了時に、運用チャンネルへ 1 通投稿する。

- 消化したソース数と内訳（通常 / 会話ログ）
- 昇格して削除した記憶の数
- 失敗したもの（ソース ID と理由）
- 上限で打ち切ったかどうか
- 所要時間

**失敗を黙って飲み込まない。** 睡眠は無人なので、
サマリが唯一の観測点である。

### 制約

- **フックを通らない実行経路を作らない。** 睡眠も `DynamicRunnerManager.run` を通す。
- **リポジトリミューテックスを「頻度が低いから」で外さない**（§1a）。
  外した状態で競合すると、失われるのは編集ではなく **`reads`（＝ACL タグ）**であり、
  `verify-acl` はクライアント申告なので**サーバ側でも検出できない。**
- **睡眠だけがミューテックスを取らない形にしない。** 対話も取る。
  睡眠こそ全チャプターの材料を横断する工程なので、特権化する向きが逆である。
- **ロックを取れなかったときに実行に進まない。** 案内して終わる（§1a）。
- **ミューテックスをエージェントに握らせない。** 保持者は xangi である。
- **`admin` 相当の特権クラスを作らない。** `system` は束縛済みチャプターの
  organizer 集合までとする。
- **記憶専用の ingest 経路を作らない。** 既存のキュー・ロック・トレースに乗せる。
- **異なる `visibility` の記憶を 1 ページに統合しない。**
- **上限を必ず設ける。** ソース数と総実行時間の両方。
- **失敗した記憶ファイルを削除しない。** 消えた記憶は取り戻せない。
- **通常ソースフェーズの進捗記録を省かない**（§3「進捗を永続化する」）。
  省くと、push 成功後・`--commit` 前のクラッシュで**同じソースが再 ingest され、
  ページが 2 枚になる。**エラーは出ない。
- **push より先に `gdg wiki ingest --commit` を実行しない。**
  `--commit` は `state.Ingested` を書いて永続化する。push 前にこれを進めると、
  内容がローカルに留まったまま「取り込み済み」になり、キューにも戻らない。
- **進捗をワークツリーに置かない。** `.gdgwiki/` はエージェントが書ける場所であり、
  再クローンで消える。xangi の `dataDir` 配下に持つ。
- **`private` のソースにクラスを割り当てない。** スキップする
  （[ADR-019](adr.md#adr-019-エージェントの-acl-判定はクラス集合のみを入力にする)）。
- **サーバ側の source 再取得 cron を触らない。** 既に動いている。
- **`wiki lint` を睡眠に含めない。**
- eslint + prettier。husky が commit 時に全 vitest と `tsc --noEmit` を走らせる。

---

## Files to touch — 変更ファイル

### `~/proj/xangi`

- `src/scheduler/sleep.ts`（新規）— 睡眠のループ、上限、多重起動防止、
  push → `--commit` の順序
- `src/scheduler/sleep-state.ts`（新規）— アイテムごとの進捗
  （`uploaded` / `committed` / `pushed` / `completed`）。`dataDir` 配下に永続化する。
  **記憶フェーズと通常ソースフェーズの両方が使う**（§3）
- `src/scheduler/sleep-summary.ts`（新規）— サマリの組み立てと投稿
- `src/repo-lock.ts`（新規）— リポジトリトランザクションミューテックス（§1a）。
  `src/data-dir-lock.ts` と同じ作法。**対話経路と睡眠経路の両方が使う**
- `src/authz-server.ts` — `wk` からの取得依頼を受ける口
  （`POST /repo-lock?nonce=…`。**nonce に紐づく invocation にだけ与える**）と、
  invocation 終了時の解放（§1a）
- `src/dynamic-runner.ts` / `src/discord/message-handler.ts` —
  リポジトリを変更する invocation で `repo-lock` を取る（§1a）。
  待ちの案内を返す。**睡眠だけの機構にしない**
- `src/iam.ts` — `systemClasses(iam)`
- `src/authz-server.ts` — `scope: 'scheduler'` 用の nonce 発行
- `src/gdg-cli.ts`（新規）— `gdg wiki raw pull` / `ingest lock` /
  `ingest --commit` の代行実行（Stage 07 の uid 分離に対応）
- `src/index.ts` — 睡眠スケジューラの登録
- `src/config.ts` — `SLEEP_CRON` / `SLEEP_MAX_SOURCES` / `SLEEP_MAX_DURATION_MS` /
  `SLEEP_SUMMARY_CHANNEL_ID`
- `src/discord/slash-commands.ts` — `/sleep now`（手動起動、organizer 限定）と
  `/sleep status`
- `tests/scheduler/sleep.test.ts`（新規）

### `docs/`

- `docs/plans/03a-agents-md.md` — `kind: "conversation"` の扱いを `AGENTS.md` 本文に追記

### `agents-local/`

- `AGENTS.md` — 会話ログの ingest 規則
- `README.md` — 睡眠の説明と運用（サマリの読み方、失敗時の対処）

---

## Verification — 完了条件と検証

### 完了条件

1. `/sleep now` で睡眠が起動し、`raw pull` → 記憶アップロード → ingest →
   記憶削除 → サマリ投稿まで完走する。
2. 睡眠中のエージェント実行が `preToolUse` ゲートを通り、読み書きが `wk` 経由になる
   （ゲートのログにエントリが残る）。
3. 記憶は `INGEST_QUEUE.md` に **現れない**。エージェントはローカルの
   `memories/<file>` を読んで ingest し、`<acl src>` にはアップロードで得た
   `source.id` が入る。`raw pull` しても `raw/` に会話ログが落ちてこない。
4. push 成功後に、対応する `memories/` ファイルが削除される。
5. アップロード・ingest・push のいずれで失敗しても記憶ファイルは **削除されない**。
5a. 睡眠の各 ingest エージェントに渡る nonce のクラス集合が、
   **そのソース 1 件に必要なものだけ**である（`system` 全体ではない）。
   **`channelAudience` もそのソース自身の audience key である**（§1）。
5b. **通常ソースのフェーズで、push が `ingest --commit` より先に走る。**
   push を失敗させると `state.Ingested` が更新されず、そのソースが
   次回の `INGEST_QUEUE.md` に **pending として残る**。
5c. 記憶の push 後・削除前にプロセスを落として再実行すると、
   **ingest がやり直されず、削除だけが行われる**（ページが 2 枚にならない）。
5c2. **通常ソースの `wk git commit` 後・`ingest --commit` 前**にプロセスを落として
   再実行すると、**エージェントが再実行されず** push からやり直され、
   ページが 2 枚にならない。
5d. `private` のソースがキューにあると、クラスを割り当てずスキップし、
   サマリに「スキップ: private」として出る。
5e. **睡眠中に Discord から質問を投げると、リポジトリを変更する処理が直列になる**
   （§1a）。対話側は待たされるが、待っていることが Discord に伝わる。
   **どちらのトレースも失われない。**
5f. **リポジトリミューテックスを取れないまま実行に進む経路が無い。**
   ロックを人為的に保持したまま invocation を投げると、実行されず案内が返る。
6. `SLEEP_MAX_SOURCES` に達したら中断し、翌日の睡眠が続きから進む。
7. サマリに成功数・失敗数・失敗理由・打ち切りの有無が出る。

### コマンド

```bash
cd ~/proj/xangi && npm test
```

```bash
cd ~/proj/xangi && npx tsc --noEmit && npm run lint
```

```bash
pnpm ci:quick
```

### 回帰として固定すべきテスト（静かに壊れる経路）

- **睡眠がハーネスを通る。** `DynamicRunnerManager.run` をバイパスする
  ショートカットが入っていないこと。**バイパスすると、
  睡眠だけが全権限で全チャプターの記憶を横断する。画面上は正常に見える。**
- **`systemClasses` が束縛済みチャプターを超えない。** `admin` 相当に
  膨らんでいないこと。IAM に無いチャプターの記憶を読めないこと。
- **`system` がエージェントの nonce に載っていない。** ingest エージェントに渡る
  クラス集合が `classesForSource(...)` の結果と一致すること。
  `systemClasses` をそのまま渡すと、プロンプト注入されたソース 1 件が
  他チャプターの `raw/` と `memories/` に到達できる。**成功時の挙動は何も変わらないので気づけない。**
- **`systemClasses` を消していない。** スケジューラ本体の列挙には必要である。
  「列挙には使うが、エージェントには渡さない」の区別がテストで固定されていること。
- **`channelAudience` が最も広い値で埋められていない。** ingest エージェントの nonce の
  audience が `audienceForSource(...)` と一致すること。
  広い値にすると、クラスを 1 件ぶんに絞った意図が消える。**成功時の挙動は変わらない。**
- **アップロードが ingest の直前に起きている。** 「全記憶をアップロード → キュー再構築」の
  順序に戻っていないこと。戻すと、その run でアップロードした記憶が処理されない。
- **記憶が `INGEST_QUEUE.md` に載らない。** 載ると、ローカルの `memories/` からの
  ingest と合わせて **同じ会話ログが 2 回処理される**。
- **失敗した記憶ファイルが削除されない。** アップロード失敗・ingest 失敗・
  push 失敗のいずれでも、`memories/` のファイルが残ること。
  **削除してしまうと記憶が永久に失われる。**
- **成功した記憶ファイルが削除される。** 残ると毎晩同じ記憶を再 ingest し続ける。
- **冪等性** — 睡眠を 2 回続けて走らせても、同じ記憶が 2 回 ingest されないこと。
  **`source.id` の再利用だけでは守れない。** 同じ id を使い回しても、
  ingest をもう一度回せばページはもう 1 枚できる。
  **push 後・削除前に落ちた場合**を再現し、再開時に
  「削除だけ」に進むことを固定する（進捗の `pushed` を見る）。
  `state.Ingested` は `raw/` 由来のキューの話であって、記憶には効かない。
- **通常ソースが push 後・`--commit` 前のクラッシュで再 ingest されない。**
  `wk git commit` 成功直後にプロセスを落として再実行し、
  **エージェントが再実行されず** push から進み、**ページが 2 枚にならない**こと。
  記憶フェーズと同じ状態機械を使っていること。
  **`state.Ingested` は `--commit` で初めて書かれるので、ここを守るのは進捗記録だけである。**
- **push してから `--commit` している。** 順序が逆になっていないこと。
  逆にすると `state.Ingested` が「取り込み済み」になった一方で内容はローカルに留まり、
  `BuildIngestQueue` は pending に戻さないので **そのソースは永久に wiki に載らない。**
  **エラーが出ないので、ページが無いことに誰かが気づくまで分からない。**
- **`committed` から再開したときに合成をやり直さない。** 既存コミットから
  push に進むこと。やり直すとトークンを二重に食い、内容も変わりうる。
- **進捗ファイルがワークツリーの外にある。** `.gdgwiki/` 配下に戻っていないこと。
  あそこはエージェントが書ける場所であり、再クローンで消える。
- **リポジトリを変更する処理が直列になっている。** 睡眠と対話、および
  2 つの対話を同時に走らせ、**双方のトレース（`.gdgwiki/ingest-trace/<runId>.json`）の
  `reads` が生き残ること**を固定する。
  **ミューテックスを外しても平常時は動く** — 壊れるのは競合したときだけで、
  そのとき失われるのは ACL タグである。`verify-acl` はクライアント申告なので
  **サーバ側でも検出できない。**
- **ミューテックスの保持者が xangi である。** エージェント側に解放手段が無いこと。
- **ロック取得失敗が実行に進まない。** 「取れなかったので取らずに続行」の分岐が無いこと。
- **`private` のソースがスキップされる。** `classesForSource` が
  `private` にクラスを割り当てず、サマリにスキップとして出ること。
  クラスを割り当てても `canClassesAccessSource` が deny するので、
  **エージェントが「読めない」と言い続ける無限の再試行にならないこと。**
- **上限の効き。** `SLEEP_MAX_SOURCES` / `SLEEP_MAX_DURATION_MS` を
  小さくしたときに、実際に中断して次回に続くこと。
  **効かないと Cursor の消費が青天井になる。**
- **多重起動防止。** 前回の睡眠が走っている間に起動要求が来たらスキップすること。
- **サマリが失敗を報告する。** 例外を握りつぶして「成功」と報告しないこと。
  **睡眠は無人なので、ここが唯一の観測点である。**

### 手動 E2E

1. `/iam bind` 済みのテストサーバーで数チャンネル分の会話を作り、
   `/memory flush` で記憶ファイルを 3 件用意する（うち 1 件は
   意図的に `visibility` を割り当てられない状態にしてアップロードを失敗させる）。
2. `/sleep now` を実行する。
3. 成功した 2 件が `sources` に登録され、ページに昇格し、
   `memories/` から消えることを確認する。
   **`INGEST_QUEUE.md` には現れない**ことを確認する（§4。記憶はキューに載せない）。
4. 失敗した 1 件が `memories/` に **残っている** ことを確認する。
5. 昇格したページに `<acl src="…">` が入っており、
   `member` クラスのユーザーからは黒塗りになることを確認する。
6. サマリの投稿に、成功 2 / 失敗 1 と失敗理由が出ていることを確認する。
7. `SLEEP_MAX_SOURCES=1` にして `/sleep now` を再実行し、
   1 件で打ち切られてサマリにその旨が出ることを確認する。
8. もう一度 `/sleep now` を実行し、続きから進むことを確認する。
9. 睡眠中に `preToolUse` のログを確認し、ゲートが発火していることを確認する。
10. 通常ソースを 1 件用意し、**push を意図的に失敗させて** `/sleep now` を実行する。
   `.gdgwiki/state.json` の `Ingested` にそのソースが**入っていない**こと、
   再実行で `INGEST_QUEUE.md` に pending として残っていることを確認する。
11. 記憶を 1 件用意し、**push 直後・削除直前**でプロセスを落とす。
   再実行して、ページが 2 枚にならず、`memories/` のファイルだけが消えることを確認する。
12. 通常ソースを 1 件用意し、**`wk git commit` 成功直後・push 前**でプロセスを落とす。
   再実行して、**エージェントが再実行されず** push → `--commit` だけが走り、
   ページが 2 枚にならないことを確認する。
