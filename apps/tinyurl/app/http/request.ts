/** HTTP input used by feature handlers; React Router remains the transport adapter. */
export type PageRequestArgs = {
  request: Request;
  context: { cloudflare: { env: Env; ctx: ExecutionContext } };
  params: Record<string, string | undefined>;
};
