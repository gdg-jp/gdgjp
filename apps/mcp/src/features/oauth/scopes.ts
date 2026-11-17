/** Read the wiki as the signed-in person: search, pages, workspace, raw sources. */
export const WIKI_READ = "wiki:read";
/** Act in the wiki as the signed-in person: register sources, file answers, edit AGENTS.md. */
export const WIKI_WRITE = "wiki:write";

/** Every scope this server grants, in consent-page order. */
export const MCP_SCOPES = [WIKI_READ, WIKI_WRITE] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const SCOPE_LABELS: Record<McpScope, { title: string; detail: string }> = {
  [WIKI_READ]: {
    title: "Wiki を読む",
    detail: "あなたが見られるスペース・ページ・ソースの検索と閲覧（必須）",
  },
  [WIKI_WRITE]: {
    title: "Wiki に書き込む",
    detail: "あなたとしてソースの登録、回答ノートとログの記録、AGENTS.md の更新（管理者のみ）",
  },
};

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** What the person approved on the consent page: always wiki:read, plus write if ticked. */
export function approvedScopes(ticked: readonly string[]): McpScope[] {
  const chosen = new Set<McpScope>([WIKI_READ]);
  for (const scope of ticked) if (isMcpScope(scope)) chosen.add(scope);
  return MCP_SCOPES.filter((scope) => chosen.has(scope));
}

/**
 * Which boxes start ticked. A client that asked for nothing in particular (or only for
 * scopes this server does not know) gets the full set, matching the CLI.
 */
export function defaultTicked(requested: readonly string[]): McpScope[] {
  const known = requested.filter(isMcpScope);
  return known.length === 0 ? [...MCP_SCOPES] : approvedScopes(known);
}
