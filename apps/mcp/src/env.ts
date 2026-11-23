export type Env = {
  OAUTH_KV: KVNamespace;
  WIKI?: Fetcher;
  APP_URL: string;
  ACCOUNTS_URL: string;
  WIKI_URL: string;
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
};
