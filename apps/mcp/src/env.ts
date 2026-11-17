/** Bindings, vars and secrets of gdgjp-mcp. Deliberately no AI binding and no LLM keys. */
export type Env = {
  /** workers-oauth-provider storage: clients, grants, tokens, consent and upstream transactions. */
  OAUTH_KV: KVNamespace;
  /** Service binding to gdgjp-wiki. Absent in local dev, where WIKI_URL is fetched directly. */
  WIKI?: Fetcher;
  /** This Worker's origin; the MCP resource is `${APP_URL}/mcp`. */
  APP_URL: string;
  ACCOUNTS_URL: string;
  WIKI_URL: string;
  /** The trusted GDG Japan Accounts client this Worker signs people in with (`mcp`). */
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
};
