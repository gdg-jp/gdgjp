# Chat sender resolution — gdg CLI がローカルで表示名を解決する

> Generated from Claude Code plan: `/Users/hari/proj/gdgjp/.claude/worktrees/wiki-layer-agents-design-6075f9/docs/plans/08-chat-sender-cli-resolution.md`

## Goal

Chat sender resolution — gdg CLI がローカルで表示名を解決する

## Repo context

対象ワークスペースは **`cli/`（Go）のみ**。`wiki/` は触らない。
3 段構成の 3 段目。**先行して `docs/plans/07-chat-sender-placeholder-worker.md` が
マージされている前提**。07 と合わせて 1 コミットを成す。

### なぜやるか

07 以降、Worker は Chat の週 Markdown に表示名を焼き込まなくなり、
送信者の見出しは常に `### [time] Unknown user (users/123)` になる。
このままだとクローンした raw ファイルが読みにくいので、**解決を CLI 側に移す**。

この配置を選んだ理由:

- `source_documents.content_hash` が「素の Chat 内容」のハッシュのままになるので、
  `cli/internal/wiki/raw.go:158` の**ダウンロード後ハッシュ検証を一切弱めずに済む**。
- sender 名の変更が D1 の 1 upsert で完結し、R2 の全週ドキュメント書き換えが不要になる。
- 名前を 1 つ直すたびに全週が「changed」として `INGEST_QUEUE.md` に並ぶ現行の挙動が止まる。

### 07 が用意しているもの

- `GET /api/cli/wiki/chat-senders` — Bearer 認証。
  `{ "senders": [{ "resourceName": "users/123", "displayName": "..." }] }` を返す。
- 週 Markdown の送信者見出しが常にプレースホルダ形式であること。
- sender 名を変えても `content_hash` / `captured_at` が変わらないこと。

### 読むべきもの

- `cli/internal/wiki/client.go` — HTTP クライアント。`defaultBaseURL`(18)、
  Bearer ヘッダ(155)、`SourcesManifest`(294) / `SourceContent`(309) の実装
- `cli/internal/wiki/raw.go` — `PullRaw`(130)、`BuildIngestQueue`(181)、`syncAgentsMD`(96)
- `cli/internal/wiki/state.go` — `State` / `CloneState`、`LoadState` / `WriteState`
- `cli/internal/wiki/raw_test.go` — 既存のテストの組み立て方

### 再利用する既存実装

- `cli/internal/wiki/client.go` の既存メソッド群 — 新しい `ChatSenders` は
  `SourcesManifest`(294) と同じ形（`GET` + Bearer + JSON デコード）で書く。
  HTTP クライアントや 401 リフレッシュの仕組みを別に作らない
- `cli/internal/wiki/state.go` の `LoadState` / `WriteState` — 新フィールドはここに足す。
  別の state ファイルを作らない
- `raw.go` の `digest()` — ハッシュ計算はこれを使う
- `raw.go` の `rawLocalPath` / `ensureRawPathHasNoSymlinks` — パス検査。**緩めない**

## Acceptance criteria

### 1. `State` にレンダリング状態を持たせる

`cli/internal/wiki/state.go` の `State` に 2 つ足す。

```go
Rendered    map[string]string `json:"rendered,omitempty"`    // documentID -> 置換後バイト列の digest
SendersHash string            `json:"sendersHash,omitempty"` // sender マップ全体の digest
```

`Ingested` と同様に、`LoadState` / `WriteState` の両方で nil を空マップに正規化する
（`state.go:36` と `:45` の既存処理に倣う）。

### 2. sender マップの取得

`cli/internal/wiki/client.go` に追加する。

```go
func (c *Client) ChatSenders(ctx context.Context, token string) (ChatSenders, error)
```

戻り値は `map[string]string`（resourceName -> displayName）に正規化して扱えると後段が楽。
`SourcesManifest` と同じエラーハンドリング・401 リフレッシュ経路に乗せる。

### 3. `PullRaw` に置換を挟む

`cli/internal/wiki/raw.go` の `PullRaw`(130)。

冒頭で sender マップを 1 回取得し、正規化した JSON の `digest()` を `sendersHash` とする。

ループ内の順序を次のとおりにする。**検証と置換の順序が重要。**

1. **skip 判定**（現行 151 行目の置き換え）:
   `state.SendersHash == sendersHash` かつ、ローカルファイルの digest が
   `state.Rendered[doc.DocumentID]` と一致するときだけ skip する。
   `Rendered` にエントリがない古いクローンでは、従来どおり `doc.ContentHash` と比較して skip してよい。
   **sender マップが変わっていたら skip しない** — これが rename を反映させる経路。
2. ダウンロード。
3. **ハッシュ検証は現行のまま `doc.ContentHash` に対して行う**（158-165 行目）。
   置換前のバイト列を検証するので、整合性チェックは一切弱まらない。
4. 置換を適用する。
5. `os.WriteFile`。
6. `state.Rendered[doc.DocumentID] = digest(書き込んだバイト列)` を記録する。

ループ後に `state.SendersHash = sendersHash` をセットし、`WriteState` する。
`removeStaleRawFiles`(76) で消えたドキュメントは `state.Rendered` からも落とす。

### 4. 置換ロジック

削除された TS 側の正規表現（`chat-sender-registry.ts:120` にあったもの）のミラー。

```
(?m)^### \[[^\]]+\] Unknown user \((users/[A-Za-z0-9_-]+)\)$
```

マップに該当があれば `### [<時刻>] <displayName>` に置換し、無ければ**見出しをそのまま残す**。
Markdown 全体を対象にせず、行頭の見出しにのみマッチさせる（本文中の同じ文字列を壊さないため）。

`source-asset` など Markdown 以外のドキュメントには置換をかけない。
`BuildIngestQueue`(183) が `doc.Kind == "source-asset"` で判定しているのと同じ基準を使う。

### 5. `BuildIngestQueue` は変えない

`raw.go:181` は `doc.ContentHash` を使い続ける。結果として
**sender 名を変えても再 ingest キューには載らない**。これは意図した挙動。

現行は rename が全週ドキュメントの R2 を書き換えて `capturedAt` を進めるため、
名前を 1 つ直すたびに全週が「changed」として `INGEST_QUEUE.md` に並んでいた。それが止まる。

### 制約

- **`rawLocalPath` / `ensureRawPathHasNoSymlinks` / `removeStaleRawFiles` の検査を緩めない。**
  `raw/**` の外に書かせない安全装置である。
- **`raw.go:158` のハッシュ検証を削除・緩和しない。** 置換は検証の**後**に適用する。
  順序を逆にすると整合性チェックが無意味になる。
- **`wiki/` を触らない。** サーバ側は 07 で完結している。
  エンドポイントの形が違うと感じたら実装せず報告する。
- `.gdg` の state ファイル形式は後方互換にする。`Rendered` / `SendersHash` が無い既存クローンが
  そのまま動くこと（初回 pull で全ファイルを再取得するのは許容範囲）。
- 既存の `Ingested` の意味論を変えない。

## Files to touch

### cli/

- `cli/internal/wiki/state.go` — `Rendered` / `SendersHash` の追加と正規化
- `cli/internal/wiki/client.go` — `ChatSenders` メソッドと戻り値型
- `cli/internal/wiki/raw.go` — `PullRaw` の skip 判定・置換・state 記録、置換ヘルパ
- `cli/internal/wiki/raw_test.go` — テスト追加

## How to verify

### 完了条件

- `gdg wiki raw pull` 後、クローンの Chat Markdown で
  マップにある送信者が表示名に置き換わっている。
- マップに無い送信者は `Unknown user (users/123)` のまま残る。
- 2 回目の pull が差分なしで skip される（毎回全件ダウンロードにならない）。
- サーバ側で sender 名を変えたあとの pull で、該当ファイルだけが書き直される。
- `INGEST_QUEUE.md` が sender 名の変更だけでは増えない。

### コマンド

```bash
cd cli && go test ./...
```

```bash
cd cli && go vet ./...
```

```bash
cd cli && gofmt -l .
```

### 回帰として固定すべきテスト

`cli/internal/wiki/raw_test.go` に追加する。

- **sender マップ有りで pull → ファイルが置換済みで、`state.Rendered` に置換後の digest が入る。**
- **同じ状態で 2 回目の pull → ダウンロードが発生しない。**
  置換を挟むとローカルファイルの digest が `doc.ContentHash` と一致しなくなるため、
  ここを間違えると**毎回全ファイルを再ダウンロードする**。静かに遅くなるだけで
  エラーにならないので、テストで固定する。
- **sender マップだけ変えた 3 回目の pull → 該当ファイルが書き直される。**
  `SendersHash` の比較を忘れると rename が永久に反映されない。これも無症状で壊れる。
- **改竄されたバイト列（`doc.ContentHash` と不一致）を返すサーバに対して、
  置換を挟んでもエラーになる。** 検証と置換の順序が逆になっていないことの固定。
- **`Rendered` / `SendersHash` を持たない旧 state からでも pull が成功する。**
- 既存の `raw_test.go` のテスト（`AgentsHash`(168,194) 周辺を含む）が通り続けること。

### 手動 E2E

1. `wiki/` を dev 起動し、Chat space を import して sender 名を 1 件設定する。
2. `GDG_WIKI_URL=http://localhost:5177 gdg wiki clone <dir>` でクローンする。
3. `raw/` の Chat Markdown で該当送信者が表示名になっていることを確認する。
4. `gdg wiki raw pull` をもう一度実行し、ファイルが書き換わらないことを確認する。
5. サーバ側で別の sender 名を設定してから `gdg wiki raw pull` し、
   該当ファイルだけが更新されることを確認する。
6. `gdg wiki ingest` を実行し、sender 名の変更で `INGEST_QUEUE.md` が膨らまないことを確認する。

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
