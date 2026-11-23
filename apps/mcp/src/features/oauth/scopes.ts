export const WIKI_READ = "wiki:read";
export const WIKI_WRITE = "wiki:write";

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

export function approvedScopes(ticked: readonly string[]): McpScope[] {
  const chosen = new Set<McpScope>([WIKI_READ]);
  for (const scope of ticked) if (isMcpScope(scope)) chosen.add(scope);
  return MCP_SCOPES.filter((scope) => chosen.has(scope));
}

export function defaultTicked(requested: readonly string[]): McpScope[] {
  const known = requested.filter(isMcpScope);
  return known.length === 0 ? [...MCP_SCOPES] : approvedScopes(known);
}
