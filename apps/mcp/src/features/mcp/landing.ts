import type { Env } from "../../env";
import { escapeHtml, htmlPage } from "../oauth/consent-page";
import { mcpResource } from "../oauth/server";

/** `GET /` — what this is and how to connect a client. */
export function landingPage(env: Pick<Env, "APP_URL">): Response {
  const url = escapeHtml(mcpResource(env));
  return htmlPage(
    "GDG Japan MCP",
    `<h1>GDG Japan MCP</h1>
<p>GDG Japan のサービスを MCP クライアント（Claude、Cursor、ChatGPT など）から使うためのサーバーです。ツールは GDG Japan Accounts でサインインしたあなたの権限で動きます。</p>
<div class="card"><p>サーバー URL</p><p><code>${url}</code></p></div>
<p>Claude Code の場合:</p>
<div class="card"><code>claude mcp add --transport http gdg-japan ${url}</code></div>
<p class="muted">初回の接続でブラウザーが開き、許可の確認と GDG Japan Accounts へのサインインを行います。いまは Wiki（検索・閲覧・ソース登録など）のツールがあります。</p>`,
  );
}
