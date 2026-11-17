# agents-local Cursor 全イベント Langfuse tracing v2

## Summary

- 対象は Cursor backend を優先し、schema は将来ほかの CLI backend に拡張できる形にする。
- Cursor の `stream-json` と公式 hooks を統合し、1 xangi conversation = 1 Langfuse session、1 user turn = 1 trace、root = `cursor-agent` の `AGENT` とする。
- Cursor 内部 API の完全な messages は取得不能なため、`model_call_id` ごとに partial `GENERATION` を作り、欠落項目を明示する。ターン合計 token usage は個別 call に推測配分しない。
- `~/proj/xangi` のイベント生成と `agents-local/lib/langfuse-forwarder` の変換を同時に更新する。Langfuse SDK は現行最新の `@langfuse/tracing` / `@langfuse/otel` 5.10.1を維持する。

## Implementation Changes

### Cursor / xangi capture

- append-only schema を v2 に上げ、全イベントに `eventId`, `turnId`, `appSessionId`, `createdAt`, `sequence`, `source`, Cursor session/generation/model-call ID を持たせる。v1ログは引き続き forwarder で読めるようにする。
- Cursor parser に内部 observation sink を追加し、UI用 `StreamCallbacks` と分離して以下を正規化する。
  - system/init、assistant message、thinking start/delta/end
  - tool call started/completed と input/result/error
  - retry、connection、interaction/approval request・response
  - result、turn outcome、input/output/cache token usage
  - 未知の正常な Cursor event は raw payload付き `EVENT` として残し、ターン全体を破棄しない
- user-level Cursor hooks に `beforeSubmitPrompt`, `afterAgentThought`, `subagentStart/Stop`, `preCompact`, `stop`, `sessionStart/End` を追加する。thinking は stream の時系列と hook の集約本文・durationを ordinalで統合し、重複 observation を作らない。
- hook collector は既存の per-slot authz Unix socketへ、nonce付き `POST /observability` で送る。spawn環境には当該ターンのIDだけを渡し、endpointは nonce、turn/session ID、hook名、payload shape、サイズ、rate limitを検証する。
- telemetry hook は常に best-effortで、失敗しても Cursor動作を止めない。既存 `preToolUse` ACL gateの `failClosed` 挙動は変えず、実際のallow/deny結果だけを同じendpointへ送る。

### Langfuse mapping

- root `cursor-agent` を `AGENT` とし、ユーザーprompt、最終回答、outcome、Cursor/xangi version、モデル設定、capture coverageを記録する。
- `model_call_id` ごとに `GENERATION cursor-model-call` を作る。観測できたassistant/thinking/tool requestをoutputにし、完全なAPI messagesがないinputは `completeness: partial` または `unavailable` と明示する。ターン合計usageはroot metadataと `turn-usage` eventにのみ置く。
- 実際のsubagent hookを `AGENT` にし、role/task由来の安定名、model、status、summary、duration、tool/message countsを記録する。同じTask dispatchの `TOOL` は抑止し、hookが得られなかった場合だけfallback `TOOL` を残す。
- tool kindを以下の規則で分類する。
  - Read/Grep/Glob/List/semantic search/LSP definitions・references → `RETRIEVER`
  - write/edit/delete/shell/git/test/build/typecheck/lint/MCP/browser/API → `TOOL`
  - ACL・permission/policy判定 → `GUARDRAIL`
  - thinking block、prompt constructionなど時間幅が観測できる内部処理 → `SPAN`
  - retry、connection、approval、checkpoint、compaction、session lifecycle → `EVENT`
  - test command完了後の明示的なpass/fail判定と、実際に起動したdiff/security review → `EVALUATOR`
  - `CHAIN` はcontext assemblyなど開始・終了が実際に観測できる場合だけ使用し、現状の断片情報からは生成しない
- tool、generation、subagentはrootの子かつ互いにsiblingとする。subagent内部への帰属がIDで証明できるイベントだけをsubagent配下へ入れる。
- start/completed eventから実時間、output、errorを保存する。shellは低cardinality名（`run-tests`, `build`, `typecheck`, `lint`, `git`, `shell`）とmetadataのcommand categoryに分離する。
- deterministic IDを `turnId + observation kind + stable subject ID` から生成する。forwarder stateは単純なforwarded booleanからターンevent digestへ変更し、遅れて届いたeventがあれば同じIDで安全に再送・upsertする。
- malformed/unsupported recordsは行単位でquarantineし、有効なターンを破棄しない。traceをWARNINGかつ `captureIncomplete` にし、digestを確定させず再試行可能にする。
- 既存のBearer/JWT/secret maskingとHMAC user/session IDを全新規payloadへ適用する。会話、tool result、thinking本文は既存方針どおり保持する。

## Interfaces and Rollout

- cross-repo契約として `ObservabilityEventV2` discriminated unionとCursor hook payload adapterを文書化する。
- ローカルUnix endpoint、spawn環境変数、root-owned hooks設定、installed hook clientをlayout/install処理へ追加し、prefix-mode layoutテストでも検証する。
- rollout順は forwarder v1+v2対応 → xangi v2 capture → hooks/layout配置 → 手動forwarder実行 → timer再開とする。これにより途中状態でもv1ログを失わない。
- `agents-local` のREADME、ENVIRONMENT、AGENTS、o11y計画とxangi側schema documentationを更新し、Cursor upgrade時にstream fixtureを再採取する手順を追加する。

## Test Plan

- xangi unit tests:
  - Cursor 2026.08.11 fixtureからthinking、partial generations、tool start/end、usage、retry、interaction、未知eventを順序どおり生成
  - retry後もturn start/endが1組だけになる
  - tool result/errorとmodel-call associationを保持
- hook/authz tests:
  - valid、unknown、expired、revoked nonce、turn ID不一致、oversize、malformed、rate-limit
  - observational hook失敗がagentを止めず、ACL gateのdeny/failClosedは維持される
  - subagent・thought・compaction payloadの正規化と重複排除
- forwarder tests:
  - 全Langfuse type、階層、Task/subagent dedupe、tool分類、partial-generation metadata
  - deterministic IDs、同一digest no-op、late-event upsert、v1互換、quarantine、masking
  - test exit codeからのderived evaluatorと、推測によるevaluator/chainを作らないこと
- verification:
  - xangiのfocused Vitest/typecheck、forwarder test/typecheck、`pnpm ci:quick`
  - `@gdgjp/gdg-lib build:acl` とlayout/native-hook tests
  - disposable Lima VMでCursor harnessを実行し、tool、thinking、可能ならsubagentを発生させる
  - test用Langfuse JPへforward後、APIでtraceを取得し、root/child types、時刻、I/O、hash済みID、masking、重複なしを確認
  - 最新の[Langfuse trace best practices](https://langfuse.com/docs/observability/best-practices)で監査し、修正・再実行・再取得を最低2巡行う

## Assumptions

- 選択済み方針は Stream + Hooks、Cursor first、partial `GENERATION`。
- Cursorは本番pin済みの `2026.08.11-e8db854` を基準とし、upgrade時は公式[output format](https://docs.cursor.com/en/cli/reference/output-format)と[hooks](https://cursor.com/docs/hooks)との差分検証を必須にする。
- Cursorが公開しない完全なAPI messages、call別token usage、証明できないsubagent内部階層は推測しない。
- Langfuseの型定義に従い、semantic lookupは `RETRIEVER`、実処理は `TOOL`、実在する評価・policy判定のみ `EVALUATOR` / `GUARDRAIL` とする。
