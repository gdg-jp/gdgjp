import { z } from "zod";
import { type WikiModel, createWikiModel } from "~/features/ai/model/index.server";

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

const TRANSLATION_PROMPT_VERSION = "2026-07-21.translation.v2";

function buildTranslationPrompt(input: TranslatePageInput): string {
  return `Translate the following Japanese wiki page content to English.
The content is in TipTap/ProseMirror JSON format. Translate ONLY the values of "text" properties within the JSON nodes, preserving the complete JSON structure — all "type", "attrs", "marks", and "content" fields must remain exactly as-is.
Return the complete TipTap JSON with Japanese text replaced by English translations. Do not add or remove nodes.

Title (Japanese): ${input.titleJa}
Summary (Japanese): ${input.summaryJa}

Content (TipTap JSON):
${input.contentJa}`;
}

/** Provider-neutral translation entry point used by the translation queue. */
export async function translatePage(
  input: TranslatePageInput,
  model: WikiModel,
): Promise<TranslatedPage> {
  return model.generateObject({
    prompt: buildTranslationPrompt(input),
    schema: TranslationSchema,
    schemaName: "wiki_translation",
    schemaDescription: "The translated Wiki title, summary, and TipTap JSON content.",
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
