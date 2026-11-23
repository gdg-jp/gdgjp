import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { MCP_SCOPES, SCOPE_LABELS, WIKI_READ, defaultTicked } from "./scopes";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f1f1f;--muted:#5f6368;--line:#dadce0;--accent:#1a73e8;--warn-bg:#fef7e0;--warn-fg:#7a4f01}
@media (prefers-color-scheme:dark){:root{--bg:#202124;--fg:#e8eaed;--muted:#9aa0a6;--line:#3c4043;--accent:#8ab4f8;--warn-bg:#3c2f00;--warn-fg:#fdd663}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:34rem;margin:0 auto;padding:2.5rem 1rem}
h1{font-size:1.375rem;line-height:1.4;margin:0 0 1rem}
p{margin:.5rem 0}.muted{color:var(--muted);font-size:.875rem}
.card{border:1px solid var(--line);border-radius:12px;padding:1rem;margin:1.25rem 0}
.warn{background:var(--warn-bg);color:var(--warn-fg);border-radius:8px;padding:.75rem 1rem;margin:1rem 0}
label{display:flex;gap:.75rem;align-items:flex-start;padding:.5rem 0}
label input{margin-top:.35rem;width:1.1rem;height:1.1rem}
.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}
button{font:inherit;border-radius:999px;padding:.6rem 1.25rem;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}
code{font-size:.875em}`;

export function htmlPage(title: string, body: string, status = 200, headers?: Headers): Response {
  const out = new Headers(headers);
  out.set("content-type", "text/html; charset=utf-8");
  out.set("cache-control", "no-store");
  if (!out.has("content-security-policy")) {
    // No form-action: Chrome applies it to the redirect after the consent POST (to Accounts).
    out.set(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
  }
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`,
    { status, headers: out },
  );
}

export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `<p>発行元: <strong>${escapeHtml(details.clientDomain)}</strong></p>`
    : `<p class="muted">このアプリは自分で登録したため、名前は確認されていません。</p>`;
  const loopback = details.redirectIsLoopback
    ? `<div class="warn"><strong>このアクセス権はあなたのコンピューター上のアプリに渡されます。</strong>いま自分でそのアプリから接続を始めた場合だけ続けてください。</div>`
    : "";
  const ticked = new Set(defaultTicked(details.scope));
  const scopes = MCP_SCOPES.map((scope) => {
    const label = SCOPE_LABELS[scope];
    const required = scope === WIKI_READ;
    const input = required
      ? `<input type="checkbox" checked disabled><input type="hidden" name="scope" value="${scope}">`
      : `<input type="checkbox" name="scope" value="${scope}"${ticked.has(scope) ? " checked" : ""}>`;
    return `<label>${input}<span><strong>${escapeHtml(label.title)}</strong> <code>${scope}</code><br><span class="muted">${escapeHtml(label.detail)}</span></span></label>`;
  }).join("");
  return `<h1>${name} に GDG Japan MCP へのアクセスを許可しますか？</h1>
${origin}
<p>アクセス権の送り先: <strong>${escapeHtml(details.redirectHost)}</strong></p>
${loopback}
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <div class="card">${scopes}</div>
  <p class="muted">許可すると GDG Japan Accounts でサインインします。ツールはあなたの権限で動き、あなたが見られないページやソースには届きません。</p>
  <div class="actions">
    <button class="primary" name="decision" value="approve">許可して続ける</button>
    <button name="decision" value="deny">拒否</button>
  </div>
</form>`;
}

export function errorPage(message: string, status = 400): Response {
  return htmlPage(
    "接続できませんでした",
    `<h1>接続できませんでした</h1><p>${escapeHtml(message)}</p><p class="muted">MCP クライアントからもう一度接続を始めてください。</p>`,
    status,
  );
}
