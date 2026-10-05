# agents/ に LLMOps / AgentOps observability + online evaluation を追加する

> Generated from Claude Code plan: `/Users/hari/.claude/plans/agents-app-llmops-effervescent-floyd.md`

## Goal

agents/ に LLMOps / AgentOps observability + online evaluation を追加する

## Repo context

`agents/` は Discord / Google Chat の webhook を受けて AI SDK v6 の `ToolLoopAgent`
(Vertex Gemini) で Wiki を探索し、回答後に `generateObject` で書き戻し判断 (filing) を行う
Next.js on Vercel アプリ。現状**テレメトリが一切ない**:

- `experimental_telemetry` も OTel も未使用 (リポジトリ全体で 0 ヒット)。
- 失敗時の `console.error` のみ。ステップ数・ツール呼び出し・レイテンシ・トークン・
  引用の有無は本番で一切見えない。
- `SYSTEM_INSTRUCTIONS` は 10 個の運用ルール (index 先読み・引用必須・
  自前知識で答えない等) を課しているが、それが守られているかを測る手段がない。

つまり「エージェントが劣化しても気づけない」状態。ここに (1) トレース基盤と
(2) 本番トレースに対する自動採点を入れて、回答品質を継続的に観測できるようにする。

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

1. **オフライン (CI で回るもの)**
   ```bash
   pnpm --filter @gdgjp/agents test
   ```
   ```bash
   pnpm ci:quick
   ```
   — 新規ユニットテスト + Biome + 既存 vitest。Langfuse キー無しで全部通ること
   (= テレメトリ無効経路が本当に no-op である証明)。

2. **ビルド**
   ```bash
   pnpm --filter @gdgjp/agents build
   ```
   — `instrumentation.ts` と OTel パッケージが Next のバンドルを壊さないことを確認。
   壊れる場合のみ `next.config.ts` の `serverExternalPackages` に追加。

3. **ローカル実機 (Langfuse dev プロジェクト)**
   - `.env.local` に Langfuse dev キーと `LANGFUSE_TRACING_ENVIRONMENT=development` を設定。
   - `pnpm --filter @gdgjp/agents dev` を起動し、Discord `/ask` (またはトンネル経由の
     Google Chat) を 1 回実行。
   - Langfuse UI で確認する:
     - `chat-inquiry` トレースが 1 本、配下に `wiki-agent` の generation と
       `wiki_ls` / `wiki_cat` / `wiki_search` の tool span がネストしている
     - `userId` / `sessionId` が生の Discord ID ではなくハッシュ文字列
     - Phase 2 のスコアがトレースに付いている
     - filing が走ったリクエストでは `filing-decision` generation と
       `filing_outcome` スコアが同じトレースに載っている
   - `after()` の flush が効いているか = レスポンス返却後にトレースが揃うか、を必ず確認する
     (serverless で最も壊れやすい箇所)。

4. **judge**
   - `docs/agents-observability.md` の手順で evaluator 3 本を作成し、
     sampling を一時的に 100% にして上記トレースが採点されることを確認 → 20% に戻す。

5. **データポリシー確認**
   - Langfuse のトレースを目視し、アクセストークン / リフレッシュトークン /
     生の `chatUserId` がどこにも出ていないことを確認する。

---

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
