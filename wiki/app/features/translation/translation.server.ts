import { z } from "zod";
import { type WikiModel, createWikiModel } from "~/features/ai/model/index.server";
import { canonicalMarkdown } from "~/features/editor/content-format";

const TranslationSchema = z.object({
  titleEn: z.string().min(1),
  summaryEn: z.string(),
  contentEn: z.string().min(1),
});

export interface TranslatePageInput {
  contentJa: string;
  summaryJa: string;
  titleJa: string;
}

export type TranslatedPage = z.infer<typeof TranslationSchema>;

const TRANSLATION_PROMPT_VERSION = "2026-07-26.translation.v3";

function buildTranslationPrompt(input: TranslatePageInput): string {
  return `Translate the following Japanese wiki page content to English.
The content is Markdown. Return Markdown, never TipTap/ProseMirror JSON.
Preserve the complete Markdown structure: headings, lists, links and their URLs, image and attachment references, tables, blockquotes, code fences, inline code, front matter, HTML, and formatting markers. Translate only human-readable Japanese prose. Do not translate code, URLs, file paths, identifiers, or Markdown syntax. Do not add or remove content.

Title (Japanese): ${input.titleJa}
Summary (Japanese): ${input.summaryJa}

Content (Markdown):
${input.contentJa}`;
}

/** Provider-neutral translation entry point used by the translation queue. */
export async function translatePage(
  input: TranslatePageInput,
  model: WikiModel,
): Promise<TranslatedPage> {
  return model.generateObject({
    // Keep queue retries safe while a legacy row is awaiting the one-time backfill.
    prompt: buildTranslationPrompt({ ...input, contentJa: canonicalMarkdown(input.contentJa) }),
    schema: TranslationSchema,
    schemaName: "wiki_translation",
    schemaDescription: "The translated Wiki title, summary, and Markdown content.",
    temperature: 0,
  });
}

export function translatePageWithEnv(
  env: Pick<Env, "GEMINI_API_KEY">,
  input: TranslatePageInput,
): Promise<TranslatedPage> {
  return translatePage(input, createWikiModel({ apiKey: env.GEMINI_API_KEY }));
}

export { TRANSLATION_PROMPT_VERSION };
