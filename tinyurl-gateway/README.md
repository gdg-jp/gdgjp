# TinyURL custom-domain gateway

Deploy this workspace package as one Vercel Hobby project with **Root Directory** set to
`tinyurl-gateway`. Configure `TINYURL_INTERNAL_BASE=https://url.gdgs.jp` and set the same long,
random `GATEWAY_SHARED_SECRET` in Vercel and in the Cloudflare Worker.

The gateway owns TLS for every custom apex domain. It proxies an optional HTTPS upstream first and
uses the signed tinyurl resolver only when a GET/HEAD upstream response is exactly 404.

The Vercel token, project ID, and optional team ID belong only to the tinyurl Worker:

```sh
pnpm --dir tinyurl exec wrangler secret put VERCEL_TOKEN
pnpm --dir tinyurl exec wrangler secret put VERCEL_PROJECT_ID
pnpm --dir tinyurl exec wrangler secret put VERCEL_TEAM_ID
pnpm --dir tinyurl exec wrangler secret put GATEWAY_SHARED_SECRET
```

After a canary domain passes DNS, TLS, origin precedence, and removal checks, set
`DOMAINS_ENABLED = "true"` in `tinyurl/wrangler.toml` and deploy the Worker.

The repository deploy workflow also deploys this package. Configure these GitHub Actions secrets
once: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Runtime values
`TINYURL_INTERNAL_BASE` and `GATEWAY_SHARED_SECRET` remain Vercel project environment variables;
they are never passed through workflow logs.
