export type GatewayRequest = {
  url: string;
  method?: string;
  headers: Headers | Record<string, unknown>;
  body?: unknown;
};

export function requestMethod(request: GatewayRequest): string {
  return (request.method ?? "GET").toUpperCase();
}

function headerValue(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export function requestHeader(request: GatewayRequest, name: string): string | null {
  if (typeof (request.headers as Headers).get === "function") {
    return (request.headers as Headers).get(name);
  }
  const entry = Object.entries(request.headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return headerValue(entry?.[1]);
}

export function requestHeaderEntries(request: GatewayRequest): Array<[string, string]> {
  if (typeof (request.headers as Headers).entries === "function") {
    return [...(request.headers as Headers).entries()];
  }
  return Object.entries(request.headers).flatMap(([name, value]) => {
    const normalized = headerValue(value);
    return normalized === null ? [] : [[name, normalized]];
  });
}

export function requestBody(request: GatewayRequest): BodyInit | undefined {
  const body = request.body;
  if (body === null || body === undefined) return undefined;
  if (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  ) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    return copy.buffer;
  }
  return JSON.stringify(body);
}

export function publicRequestUrl(request: GatewayRequest): URL | null {
  try {
    const absolute = new URL(request.url);
    if (absolute.protocol === "http:" || absolute.protocol === "https:") return absolute;
  } catch {
    // Some local and compatibility adapters pass only the request target (for example `/`).
  }

  const forwardedHost = requestHeader(request, "x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeader(request, "host")?.trim();
  if (!host || !request.url.startsWith("/") || request.url.startsWith("//")) return null;
  try {
    return new URL(request.url, `https://${host}`);
  } catch {
    return null;
  }
}
