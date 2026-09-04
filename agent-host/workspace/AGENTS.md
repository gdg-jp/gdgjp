# GDG Agent

This host runs Cursor CLI under dedicated `gdgagent-run-<N>` uids. Workdir
paths outside `/srv/gdg-agent/wiki` are not readable. Wiki ingest commands
that need `gdg` tokens (`gdg wiki clone|raw pull|ingest|verify-acl`, `git
push`) are executed by `gdgagent-svc`, not by the agent.

## Instructions

- Read and write Wiki pages only through `wk` (`wk read`, `wk write`, `wk grep`,
  `wk ls`, `wk git …`). Direct Read/Write/Edit of `pages/`, `raw/`, and
  `memories/` is denied. The ACL gate **allows** `wk`; a Shell deny means the
  argv string was not in the allowlist. Retry as a bare command (`wk ls pages/`),
  without double-quote expansion, pipes, or comments. That is not a channel ACL
  failure, and this bot only answers in channels that already have wiki access.
- `search` (MCP) is a navigation aid: it returns paths, line ranges, and scores,
  never body text. Open the returned paths with `wk read` before answering.
  An empty `search` or `wk ls` result does not mean the material is absent; it
  may be filtered by this channel's authorization. Do not claim `wk` is blocked.
- Black squares (`⬛︎⬛︎⬛︎`) in `wk read` output are ACL spans you cannot see.
  Do not guess their contents.
- Conversation logs (`kind: "conversation"`) live in `memories/` during sleep ingest.
  File decisions, numbers, and agreements onto topic pages. Do not transcribe the
  conversation, do not create a date-based page, and do not combine logs with
  different `visibility` into one page.
- Use `gws` (Shell) for Google Docs and Spreadsheet tasks, under **your own** linked Google
  account — not a shared bot account. If a call fails with "connect Google Workspace first",
  the invoking Discord user hasn't run `/login` and used "Connect Google Workspace" on
  `accounts.gdgs.jp/settings/google-workspace` yet; tell them to do that and retry. Only
  `gws drive files list` and `gws drive files get` are currently allowlisted
  (`config/permissions.json`'s `gwsAllowlist`) — a call outside that exact set is denied before
  any network call, with no override available from inside the sandbox.
- **Capture durable learnings proactively.** After completing a non-trivial task, record reusable knowledge before closing the turn: event- or community-specific facts go to `wiki/` (playbooks, event child pages, `wiki/pages/log/page.md`); agent tooling, MCP auth, and edit mechanics go to this file (`AGENTS.md`). Do not leave operational discoveries only in chat.

## Knowledge routing

| Kind of learning | Where to write |
| --- | --- |
| Event schedule, sponsors, venue ops, speaker status | `wiki/pages/events/…` and related playbooks |
| Reusable procedures (timetable rules, breaks, TBD conventions) | `wiki/pages/playbooks/…` |
| MCP auth, API edit constraints, fallback scripts, tool quirks | `AGENTS.md` (this file) |

Event-specific spreadsheet IDs and current draft contents belong in wiki, not here. Example: [DevFest Kansai 2026 timetable](wiki/pages/events/2026-10-18-devfest-kansai/devfest-kansai-timetable/page.md).

## gws（運用メモ）

`gws`（公式 `googleworkspace/cli`）は MCP ではなく Shell 経由のコマンドで、`wk` と同じ形の
ゲート付きメディエータ（`/opt/gdg-agent/bin/gws` → `cli/internal/wiki/hooks/gws.ts` →
`/opt/gdg-agent/bin/gws-bin`）を通してのみ叩ける。詳しい経路は `ENVIRONMENT.md`「Production
runtime layout」を参照。

- **認証アカウント**: 呼び出し元 Discord ユーザー本人が `/login` と「Connect Google
  Workspace」（`accounts.gdgs.jp/settings/google-workspace`）を済ませた、その人自身の Google
  アカウント。共有ボットアカウントは存在しない。未連携のユーザーの呼び出しは `gws.ts` が
  `resolveAuthz()` の時点で "connect Google Workspace first" として fail closed する ──
  OAuth URL は返らない。ユーザーに `/login` とアカウント連携を案内し、完了後に同じ呼び出しを
  リトライしてもらう。
- **トークン**: 呼び出しごとに短命の Google アクセストークンのみが渡される（リフレッシュトーク
  ンは `accounts.gdgs.jp` の外に出ない）。ディスクへの永続化はなく、`GOOGLE_WORKSPACE_CLI_TOKEN`
  としてそのプロセスの環境にだけ入る。
- **許可されているコマンド**: 現時点では `gws drive files list` / `gws drive files get` の 2 つ
  のみ（`config/permissions.json`・`agent-host/config/cli-config.json` の `gwsAllowlist`）。
  Sheets の書き込み系（`modify_sheet_values` 相当や行挿入）はまだ allowlist に入っていない ──
  下の運用ノートは Google API 側の事実として有効だが、対応する `gws sheets` サブコマンドが
  allowlist に追加されるまでは実行できない。追加が必要になったら
  `docs/agents-local-gws/plan.md`「Unverified-app scope cap」を踏まえてレビュー付きで追加する。
- **`modify_sheet_values` 相当**: 値は文字列のみ（数値も `"10"` のように文字列で渡す）。保護列を含む範囲（例: `B5:G5` で F 列が保護）の一括更新は失敗する。**保護されていない列だけ**を個別に更新する（例: `B5` と `G5` を別リクエスト）。
- **スプレッドシートの保護**: `insertDimension`（行挿入）は保護範囲があると API ごと拒否される。セル編集が通る場合でも行追加は別問題。行挿入が不可のときは、内容列（B–E）と持ち時間（G）を既存行へシフトして対応する（A 列・F 列の時刻は G の連鎖で自動再計算される）。**F 列（開始時間の数式）は書き換えない。**
- **行挿入できないときのフォールバック**: `gws` にない操作は、allowlist されていない限り実行できない。個人の Google 認証情報を直接叩くフォールバックスクリプト運用は廃止した(共有アカウント前提だったため)。行挿入が必要な場合はユーザー自身にブラウザで対応してもらうか、`sheets` 系の新しい allowlist エントリをレビュー付きで追加することを検討する。
- **複数行の一括更新**: タイムテーブル再構成などは行ごとに `B{n}:E{n}` と `G{n}` をループ更新する方が安全。変更後に読み取りで時刻連鎖（A 列）を必ず確認する。
- **正本の所在**: ユーザーが「スプシの ○○ シートだけ更新」と指定した場合、ローカル `docs/` 草案や他タブへの書き込みは正本にならない。wiki にも同じ正本 URL を記録する。

## xangi（Discord / Cursor backend）

- **設定の置き場**: `~/.config/xangi/xangi.json` は backend / workspace / Web Chat のみ。`DISCORD_SHOW_THINKING` 等の詳細は環境変数。インストール済みサービスは `~/.config/systemd/user/xangi.service.d/model.conf`（`Environment=`）。ソース checkout（`~/xangi`）は cwd の `.env`（`dotenvConfig({ override: true })` が systemd の値を上書きする）。
- **Thinking 表示（2026-08-24 修正）**: `~/xangi` の `message-handler.ts` / `scheduler-bridge.ts` / `slash-commands.ts`（`/skill`）を修正し、`DISCORD_SHOW_THINKING=false` で「考え中…」プレースホルダ（通常メッセージ・スケジューラ投稿とも）とスラッシュコマンドの Discord ネイティブ「GDG Agent is thinking...」（`/skill` は `deferReply()` の代わりに即時 `reply()` するよう変更）の両方が実際に抑止されるようになった。旧 `showThinking` は `useStreaming` と混同されており、tick も常時走っていたのが原因（`session.start()` を `showThinking` でのみ起動するよう分離）。本番 (`mincra-srv`, `/opt/xangi`) は既に `DISCORD_SHOW_THINKING=false` を設定済みなので、この修正を `/opt/xangi` に反映して `xangi.service` を再起動すれば有効になる。
- **Discord 応答の二重化（2026-08 確認）**: backend=`cursor` + 既定の `DISCORD_STREAMING` / `DISCORD_SHOW_THINKING` で、Discord 投稿は1回だが `cursor-cli.js` の stream-json 組み立て後の `result` 文字列に重複が入る。transcript `logs/sessions/*.jsonl` の assistant `content.result` を確認すると投稿前から重複。暫定: `DISCORD_SHOW_THINKING=false` または `DISCORD_STREAMING=false`。根本: `dist/cursor-cli.js` の `result` イベント追記ロジック（`fullText.endsWith(event.result)` が false のとき全文追記）。
- **2つの xangi ログを混同しない**: `logs/sessions/*.jsonl`（transcript、上の重複バグの調査対象）は Discord 編集・削除に追従して書き換わる可変ログで、ツール呼び出しや reasoning は入っていない。`logs/observability/*.jsonl`（`~/proj/xangi/src/observability-logger.ts`）は別ファイル・schema v2 の追記専用ログで、各行の event/turn/session ID・source・sequence と `turn_start`/tool start/end/`cursor_event`/`turn_end` を持つ。後者だけが `agent-host/langfuse-forwarder/` の入力になる — 前者は Langfuse に転送されない。v1 は forwarder が読み続けるが、新しいフィールドは v2 で追加する。

## Response format for Discord

- Do not using markdown header (`#`) and table.
- Write the answers to wiki aggressively.
