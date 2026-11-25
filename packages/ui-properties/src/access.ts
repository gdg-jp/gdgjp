import { type IncomingMessage, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
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

export type SlotRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | null;
};

export type SlotResponse = {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
};

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ACCESS_COOKIE = /^\s*CF_Authorization=/i;

function outgoingHeaders(headers: SlotRequest["headers"], token: AccessToken) {
  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || HOP_BY_HOP.has(lower) || lower.startsWith("cf-access-")) continue;
    if (lower === "cookie") {
      const kept = value
        .split(";")
        .filter((part) => part.trim() && !ACCESS_COOKIE.test(part))
        .join(";")
        .trim();
      if (kept) sent.cookie = kept;
      continue;
    }
    sent[lower] = value;
  }
  sent["accept-encoding"] = "gzip, deflate, br";
  sent["cf-access-client-id"] = token.id;
  sent["cf-access-client-secret"] = token.secret;
  return sent;
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (!body.length || !encoding || encoding === "identity") return body;
  if (encoding === "gzip" || encoding === "x-gzip") return gunzipSync(body);
  if (encoding === "deflate") return inflateSync(body);
  if (encoding === "br") return brotliDecompressSync(body);
  throw new Error(`unsupported content-encoding ${encoding}`);
}

function incomingHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string[]> = {};
  const raw = response.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = (raw[index] as string).toLowerCase();
    const value = raw[index + 1] as string;
    if (HOP_BY_HOP.has(name) || name === "content-encoding") continue;
    if (name === "set-cookie" && ACCESS_COOKIE.test(value)) continue;
    headers[name] = [...(headers[name] ?? []), value];
  }
  return Object.fromEntries(
    Object.entries(headers).map(([name, values]) => [
      name,
      values.join(name === "set-cookie" ? "\n" : ", "),
    ]),
  );
}

export function sendThroughAccess(
  request: SlotRequest,
  token: AccessToken,
  timeoutMs = 60_000,
): Promise<SlotResponse> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return Promise.reject(new Error(`cannot forward ${url.protocol} requests`));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((done, reject) => {
    const outgoing = send(
      url,
      {
        method: request.method,
        headers: outgoingHeaders(request.headers, token),
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            done({
              status: response.statusCode ?? 502,
              headers: incomingHeaders(response),
              body: decode(Buffer.concat(chunks), response.headers["content-encoding"]),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    outgoing.on("error", reject);
    outgoing.end(request.body ?? undefined);
  });
}

type RoutedRequest = Pick<Route, "request" | "continue" | "fulfill" | "abort">;

export async function forwardThroughAccess(
  route: RoutedRequest,
  inSlot: (url: string) => boolean,
  token: AccessToken,
  send: typeof sendThroughAccess = sendThroughAccess,
): Promise<void> {
  const request = route.request();
  if (!inSlot(request.url())) return route.continue();
  const response = await send(
    {
      url: request.url(),
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postDataBuffer(),
    },
    token,
  ).catch(() => null);
  if (!response) return route.abort().catch(() => undefined);
  await route.fulfill(response).catch(() => undefined);
}

export async function routeThroughAccess(
  context: BrowserContext,
  inSlot: (url: string) => boolean,
  token: AccessToken | null,
): Promise<void> {
  if (!token) return;
  await context.route("**/*", (route) => forwardThroughAccess(route, inSlot, token));
}
