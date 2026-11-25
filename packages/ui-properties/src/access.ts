import type { BrowserContext, Route } from "@playwright/test";

export type AccessToken = { readonly id: string; readonly secret: string };

export function accessToken(env: Readonly<Record<string, string | undefined>>): AccessToken | null {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export function browserEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    if (value !== undefined && !name.startsWith("CF_ACCESS_")) kept[name] = value;
  return kept;
}

export function slotHosts(domain: string | undefined): (url: string) => boolean {
  return (url) => {
    if (!domain) return false;
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  };
}

type RoutedRequest = Pick<Route, "request" | "continue" | "fetch" | "fulfill" | "abort">;

export async function forwardThroughAccess(
  route: RoutedRequest,
  inSlot: (url: string) => boolean,
  token: AccessToken,
): Promise<void> {
  const request = route.request();
  if (!inSlot(request.url())) return route.continue();
  const response = await route
    .fetch({
      headers: {
        ...request.headers(),
        "CF-Access-Client-Id": token.id,
        "CF-Access-Client-Secret": token.secret,
      },
      maxRedirects: 0,
    })
    .catch(() => null);
  if (!response) return route.abort().catch(() => undefined);
  await route.fulfill({ response }).catch(() => undefined);
}

export async function routeThroughAccess(
  context: BrowserContext,
  inSlot: (url: string) => boolean,
  token: AccessToken | null,
): Promise<void> {
  if (!token) return;
  await context.route("**/*", (route) => forwardThroughAccess(route, inSlot, token));
}
