/**
 * Shared HTTP boundary for `/api/cli/v1/*` routes (see
 * `docs/cli-support-url-img-sns/index.md`'s "HTTP boundary" convention):
 * JSON endpoints require `application/json`, reject malformed/oversized bodies
 * with the shared `{ error }` envelope, return `405` for unsupported methods,
 * and set `Cache-Control: no-store` on every authenticated response.
 */

export const CLI_NO_STORE = { "Cache-Control": "no-store" };

/** Generous for the small, fixed-shape JSON bodies these routes accept. */
export const MAX_CLI_JSON_BODY_BYTES = 16 * 1024;

export function cliJson<T>(body: T, init: { status?: number } = {}): Response {
  return Response.json(body, { status: init.status, headers: CLI_NO_STORE });
}

export function cliError(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: CLI_NO_STORE });
}

export function cliMethodNotAllowed(): Response {
  return cliError("method_not_allowed", 405);
}

export type CliJsonBodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Streams a request body, aborting as soon as it exceeds `cap` UTF-8 bytes so a
 * chunked request with no `Content-Length` can never buffer more than the cap.
 * Returns `null` when the cap is exceeded.
 */
async function readBodyBytesWithCap(request: Request, cap: number): Promise<Uint8Array | null> {
  if (!request.body) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return bytes.byteLength > cap ? null : bytes;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Reads and parses a JSON request body, enforcing the documented HTTP boundary:
 * rejects non-`application/json` content types, rejects bodies that declare (via
 * `Content-Length`) or stream past `MAX_CLI_JSON_BODY_BYTES` UTF-8 bytes without
 * buffering the overflow, and rejects malformed JSON — all with the shared
 * `{ error }` envelope.
 */
export async function parseCliJsonBody<T>(request: Request): Promise<CliJsonBodyResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: cliError("unsupported_media_type", 415) };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CLI_JSON_BODY_BYTES) {
    return { ok: false, response: cliError("payload_too_large", 413) };
  }

  const bytes = await readBodyBytesWithCap(request, MAX_CLI_JSON_BODY_BYTES);
  if (bytes === null) {
    return { ok: false, response: cliError("payload_too_large", 413) };
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, response: cliError("invalid_json", 400) };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: cliError("invalid_json", 400) };
  }
  return { ok: true, value: value as T };
}

/** Parses a required positive-integer query parameter. */
export function parsePositiveIntParam(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Parses an optional 1..100 `limit` query parameter; `null` means "invalid". */
export function parseLimitParam(raw: string | null, fallback = 50): number | null {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
}

/** Offset pagination cursor: an opaque base64 of the next row offset. */
export function decodeOffsetCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const value = Number(atob(cursor));
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function encodeOffsetCursor(offset: number): string {
  return btoa(String(offset));
}
