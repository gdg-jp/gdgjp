export type PageRequestArgs = {
  request: Request;
  context: { cloudflare: { env: Env; ctx: ExecutionContext } };
  params: Record<string, string | undefined>;
};
