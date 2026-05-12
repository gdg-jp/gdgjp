import { RouterContextProvider } from "react-router";

declare module "react-router" {
  interface RouterContextProvider {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

export class CloudflareContext extends RouterContextProvider {
  readonly cloudflare: { env: Env; ctx: ExecutionContext };
  constructor(cloudflare: { env: Env; ctx: ExecutionContext }) {
    super();
    this.cloudflare = cloudflare;
  }
}
