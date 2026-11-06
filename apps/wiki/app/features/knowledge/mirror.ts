import {
  audienceKeyContains,
  parseAclSpans,
  removeAclSpans,
  sourceAudienceKey,
} from "@gdgjp/gdg-lib/acl";
import { sourceAudience } from "~/features/sources/audience";
import { PAGE_AUDIENCE, aclItemKey, pageItemKey } from "./shared";

export type MirrorItem = {
  key: string;
  body: string;
  metadata: Record<string, string>;
};

export type MirrorPage = {
  id: string;
  titleJa: string;
  titleEn: string;
  contentJa: string;
  contentEn: string;
  pageType: string | null;
  origin: string;
  updatedAt: Date | number | null;
};

export type MirrorSource = {
  id: string;
  visibility: string;
  chapterId: string | null;
  addedBy: string;
};

/**
 * Audience of one span: readers must be able to read EVERY cited source, so the answer is
 * the narrowest cited audience when it contains all the others. Anything else (incomparable
 * chapters, a private source mixed with others, an unknown source) is ambiguous: it is left
 * out of the index and flagged for review rather than guessed — a guess either hides text
 * from readers who may see it or, worse, shows it to readers who may not.
 */
export function spanAudience(
  srcIds: readonly string[],
  sources: ReadonlyMap<string, MirrorSource>,
): string | null {
  const cited = srcIds.map((id) => sources.get(id));
  if (cited.length === 0 || cited.some((source) => !source)) return null;
  const audiences = [...new Set(cited.map((source) => sourceAudience(source as MirrorSource)))];
  if (audiences.length === 1) return audiences[0] === "none" ? null : (audiences[0] ?? null);
  const keys = (cited as MirrorSource[]).map((source) => ({
    audience: sourceAudience(source),
    key: sourceAudienceKey(source.visibility, source.chapterId),
  }));
  if (keys.some((entry) => !entry.key || entry.key.kind === "private")) return null;
  const narrowest = keys.find((candidate) =>
    keys.every((other) =>
      audienceKeyContains(
        candidate.key as NonNullable<typeof candidate.key>,
        other.key as NonNullable<typeof other.key>,
      ),
    ),
  );
  return narrowest?.audience ?? null;
}

function frontMatter(page: MirrorPage, title: string): string {
  const updated =
    page.updatedAt instanceof Date
      ? page.updatedAt.toISOString()
      : page.updatedAt
        ? new Date(page.updatedAt * 1000).toISOString()
        : "";
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `page_type: ${page.pageType ?? ""}`,
    `origin: ${page.origin}`,
    `updated_at: ${updated}`,
    "---",
    "",
  ].join("\n");
}

/**
 * Items mirroring one page into the index, per language:
 * - `pages/<id>.<lang>.md` — body with every `<acl>` span REMOVED (no placeholder either),
 *   audience "page";
 * - `acl/<audience>/<id>.<lang>.md` — the bodies of the spans of that audience.
 * Span text therefore never shares an item with text of a wider audience, and the search
 * filter on `audience` is enough to keep it from readers who may not see it.
 */
export function buildPageMirror(
  page: MirrorPage,
  sources: ReadonlyMap<string, MirrorSource>,
): { items: MirrorItem[]; ambiguousSpans: string[][] } {
  const items: MirrorItem[] = [];
  const ambiguousSpans: string[][] = [];
  for (const lang of ["ja", "en"] as const) {
    const title = (lang === "ja" ? page.titleJa : page.titleEn) || page.titleJa || page.titleEn;
    const content = lang === "ja" ? page.contentJa : page.contentEn;
    if (!content.trim() && !(lang === "ja" && title.trim())) continue;
    const meta = { page_type: page.pageType ?? "", lang, source_id: "" };
    items.push({
      key: pageItemKey(page.id, lang),
      body: `${frontMatter(page, title)}# ${title}\n\n${removeAclSpans(content)}`,
      metadata: { layer: "page", audience: PAGE_AUDIENCE, ...meta },
    });
    const byAudience = new Map<string, string[]>();
    for (const span of parseAclSpans(content)) {
      const audience = spanAudience(span.srcIds, sources);
      if (!audience) {
        ambiguousSpans.push(span.srcIds);
        continue;
      }
      byAudience.set(audience, [...(byAudience.get(audience) ?? []), span.body.trim()]);
    }
    for (const [audience, bodies] of byAudience) {
      items.push({
        key: aclItemKey(audience, page.id, lang),
        body: `${frontMatter(page, title)}# ${title}\n\n${bodies.join("\n\n")}`,
        metadata: { layer: "acl", audience, ...meta },
      });
    }
  }
  return { items, ambiguousSpans };
}
