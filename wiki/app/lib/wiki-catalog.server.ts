import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";

const NS_LOG = "ns-log";
const NS_INDEX = "ns-index";

export type AppendLogEntryInput = {
  subject: string;
  lines: string[];
  /** Fixed to `query` for the agent log route. */
  type?: "query";
  /** Override for tests; defaults to UTC today. */
  date?: string;
};

export type UpsertIndexEntryInput = {
  section: string;
  slug: string;
  title: string;
  summary: string;
};

/** Strip newlines and a leading `#` so untrusted chat text cannot forge headings. */
export function hardenCatalogField(value: string, maxLength: number): string {
  let text = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  while (text.startsWith("#")) {
    text = text.slice(1).trimStart();
  }
  return text.slice(0, maxLength);
}

export function formatLogEntry(input: {
  date: string;
  type: string;
  subject: string;
  lines: readonly string[];
}): string {
  const subject = hardenCatalogField(input.subject, 200);
  const lines = input.lines
    .slice(0, 8)
    .map((line) => hardenCatalogField(line, 200))
    .filter((line) => line.length > 0)
    .map((line) => `- ${line}`);
  const heading = `## [${input.date}] ${input.type} | ${subject}`;
  return `\n${heading}\n\n${lines.join("\n")}\n`;
}

export function formatIndexLine(input: {
  sectionSlug: string;
  slug: string;
  title: string;
  summary: string;
}): string {
  const title = hardenCatalogField(input.title, 200);
  const summary = hardenCatalogField(input.summary, 300);
  return `- [${title}](${input.sectionSlug}/${input.slug}) — ${summary}`;
}

/**
 * Atomic append to the log page. Concurrent callers cannot lose each other's
 * entries the way a read-modify-write would.
 */
export async function appendLogEntry(
  env: Env,
  input: AppendLogEntryInput,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const subject = hardenCatalogField(input.subject, 200);
  if (!subject) return { ok: false, error: "subject_required", status: 400 };
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, error: "lines_required", status: 400 };
  }
  if (input.lines.length > 8) {
    return { ok: false, error: "too_many_lines", status: 400 };
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const entry = formatLogEntry({
    date,
    type: input.type ?? "query",
    subject,
    lines: input.lines,
  });

  const result = await env.DB.prepare(
    `UPDATE pages
        SET content_ja = content_ja || ?, content_en = content_en || ?,
            updated_at = unixepoch(), sync_revision = sync_revision + 1
      WHERE id = ?`,
  )
    .bind(entry, entry, NS_LOG)
    .run();

  if (!result.success || (result.meta?.changes ?? 0) === 0) {
    return { ok: false, error: "log_unavailable", status: 503 };
  }
  return { ok: true };
}

/**
 * Insert or replace a catalog line under `## <section>` in index.
 * Read-modify-write guarded by sync_revision; retries once on mismatch.
 */
export async function upsertIndexEntry(
  db: ReturnType<typeof getDb>,
  env: Env,
  input: UpsertIndexEntryInput,
): Promise<void> {
  const section = hardenCatalogField(input.section, 80);
  const slug = hardenCatalogField(input.slug, 160);
  const title = hardenCatalogField(input.title, 200);
  const summary = hardenCatalogField(input.summary, 300);
  if (!section || !slug || !title) return;

  const sectionSlug = sectionToPathSlug(section);
  const line = formatIndexLine({ sectionSlug, slug, title, summary });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await db
      .select({
        contentJa: schema.pages.contentJa,
        contentEn: schema.pages.contentEn,
        syncRevision: schema.pages.syncRevision,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, NS_INDEX))
      .get();
    if (!row) return;

    const nextJa = upsertSectionLine(row.contentJa, section, slug, line);
    const nextEn = upsertSectionLine(row.contentEn, section, slug, line);
    if (nextJa === row.contentJa && nextEn === row.contentEn) return;

    const result = await env.DB.prepare(
      `UPDATE pages
          SET content_ja = ?, content_en = ?,
              updated_at = unixepoch(), sync_revision = sync_revision + 1
        WHERE id = ? AND sync_revision = ?`,
    )
      .bind(nextJa, nextEn, NS_INDEX, row.syncRevision)
      .run();

    if ((result.meta?.changes ?? 0) === 1) return;
  }
  // Give up quietly after one retry — filing must not throw on catalog races.
}

function sectionToPathSlug(section: string): string {
  const known: Record<string, string> = {
    Answers: "answers",
    Events: "events",
    Venues: "venues",
    Vendors: "vendors",
    People: "people",
    Organizations: "orgs",
    Playbooks: "playbooks",
  };
  return known[section] ?? section.toLowerCase().replace(/\s+/g, "-");
}

/** Pure helper: ensure `## Section` exists and the slug's line is unique. */
export function upsertSectionLine(
  content: string,
  section: string,
  slug: string,
  line: string,
): string {
  const heading = `## ${section}`;
  const slugPattern = new RegExp(
    `^- \\[[^\\]]*\\]\\([^)\\/]*\\/${escapeRegExp(slug)}\\) — .*$`,
    "m",
  );

  const headingIndex = content.indexOf(heading);
  if (headingIndex < 0) {
    const trimmed = content.replace(/\s*$/, "");
    const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
    return `${prefix}${heading}\n\n${line}\n`;
  }

  const afterHeading = headingIndex + heading.length;
  const nextHeading = content.slice(afterHeading).search(/\n## /);
  const sectionEnd = nextHeading < 0 ? content.length : afterHeading + nextHeading;
  const before = content.slice(0, afterHeading);
  let sectionBody = content.slice(afterHeading, sectionEnd);
  const after = content.slice(sectionEnd);

  if (slugPattern.test(sectionBody)) {
    sectionBody = sectionBody.replace(slugPattern, line);
  } else {
    const body = sectionBody.replace(/^\n*/, "").replace(/\s*$/, "");
    sectionBody = body.length > 0 ? `\n\n${body}\n${line}\n` : `\n\n${line}\n`;
  }

  return `${before}${sectionBody}${after}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
