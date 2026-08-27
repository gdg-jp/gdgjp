/**
 * Shared HTTP boundary for `/api/cli/v1/*` routes (see
 * `docs/cli-support-url-img-sns/index.md`'s "HTTP boundary" convention):
 * JSON endpoints require `application/json`, reject malformed/oversized
 * bodies with the shared `{ error }` envelope, return `405` for unsupported
 * methods, and use `Cache-Control: no-store` on every authenticated
 * response.
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
 * Reads and parses a JSON request body, enforcing the documented HTTP
 * boundary: rejects non-`application/json` content types, rejects bodies
 * that declare (via `Content-Length`) or turn out to exceed
 * `MAX_CLI_JSON_BODY_BYTES`, and rejects malformed JSON — all with the
 * shared `{ error }` envelope.
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

  const text = await request.text();
  if (text.length > MAX_CLI_JSON_BODY_BYTES) {
    return { ok: false, response: cliError("payload_too_large", 413) };
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: cliError("invalid_json", 400) };
  }
}
