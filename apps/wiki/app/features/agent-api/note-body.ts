const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_BODY_KEYS = new Set([
  "slug",
  "title",
  "summary",
  "content",
  "citedPaths",
  "replaceId",
]);

export type NoteRequestBody = {
  slug: string;
  title: string;
  summary: string;
  content: string;
  citedPaths: string[];
  replaceId?: string;
};

/** Validate the answer-note request body. Pure — no DB, no auth. */
export function parseNoteBody(
  raw: unknown,
): { ok: true; body: NoteRequestBody } | { ok: false; error: string; status: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      return { ok: false, error: "unknown_field", status: 400 };
    }
  }

  if (typeof record.slug !== "string" || !SLUG_RE.test(record.slug) || record.slug.length > 160) {
    return { ok: false, error: "invalid_slug", status: 400 };
  }
  if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > 200) {
    return { ok: false, error: "invalid_title", status: 400 };
  }
  if (
    typeof record.summary !== "string" ||
    record.summary.length === 0 ||
    record.summary.length > 300
  ) {
    return { ok: false, error: "invalid_summary", status: 400 };
  }
  if (
    typeof record.content !== "string" ||
    record.content.length === 0 ||
    record.content.length > 8000
  ) {
    return { ok: false, error: "invalid_content", status: 400 };
  }
  if (!Array.isArray(record.citedPaths)) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (record.citedPaths.length < 2 || record.citedPaths.length > 12) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (!record.citedPaths.every((p) => typeof p === "string" && p.length > 0)) {
    return { ok: false, error: "invalid_citation", status: 400 };
  }
  if (record.replaceId !== undefined && typeof record.replaceId !== "string") {
    return { ok: false, error: "invalid_replace_id", status: 400 };
  }

  return {
    ok: true,
    body: {
      slug: record.slug,
      title: record.title,
      summary: record.summary,
      content: record.content,
      citedPaths: record.citedPaths as string[],
      ...(typeof record.replaceId === "string" ? { replaceId: record.replaceId } : {}),
    },
  };
}
