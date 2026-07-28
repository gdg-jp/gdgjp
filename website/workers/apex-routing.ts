const WEBSITE_PATHS = new Set(["/", "/privacy", "/terms", "/favicon.svg"]);

export function isWebsiteRequest(url: URL): boolean {
  return WEBSITE_PATHS.has(url.pathname) || url.pathname.startsWith("/assets/");
}

export function routeApexRequest(
  request: Request,
  handleWebsiteRequest: (request: Request) => Promise<Response>,
  tinyurl: Pick<Fetcher, "fetch">,
): Promise<Response> {
  if (isWebsiteRequest(new URL(request.url))) return handleWebsiteRequest(request);
  return tinyurl.fetch(request);
}
