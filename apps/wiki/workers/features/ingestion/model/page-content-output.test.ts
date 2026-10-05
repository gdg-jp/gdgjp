import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { PageDraftOutputSchema, SectionPatchResponseOutputSchema } from "./page-content-output";

function providerSchema(schema: Parameters<typeof zodSchema>[0]): string {
  return JSON.stringify(zodSchema(schema).jsonSchema);
}

describe("Gemini page content output schemas", () => {
  it("do not expose unions or record schemas to the provider", () => {
    for (const schema of [PageDraftOutputSchema, SectionPatchResponseOutputSchema]) {
      const jsonSchema = providerSchema(schema);
      expect(jsonSchema).not.toContain('"oneOf"');
      expect(jsonSchema).not.toContain('"additionalProperties":{"type":"string"}');
    }
  });

  it("converts metadata rows and an integer score into a PageDraft", () => {
    const result = PageDraftOutputSchema.parse({
      suggestedPageType: "how-to-guide",
      pageTypeConfidence: "high",
      title: { ja: "小さなドキュメント" },
      summary: { ja: "概要" },
      metadataEntries: [{ key: "event", value: "Build with AI" }],
      sections: [],
      suggestedTags: ["ai"],
      suggestedSlug: null,
      actionabilityScore: "3",
      actionabilityNotes: "公開可能です",
      sensitiveItems: [],
    });

    expect(result.metadata).toEqual({ event: "Build with AI" });
    expect(result.actionabilityScore).toBe(3);
    expect(result.suggestedSlug).toBeUndefined();
  });

  it("rejects a score outside the supported range before domain conversion", () => {
    const result = SectionPatchResponseOutputSchema.safeParse({
      sectionPatches: [],
      sensitiveItems: [],
      actionabilityScore: "4",
      actionabilityNotes: "invalid",
    });

    expect(result.success).toBe(false);
  });

  it("does not ask the model to generate page or parent IDs", () => {
    const patchSchema = providerSchema(SectionPatchResponseOutputSchema);
    const draftSchema = providerSchema(PageDraftOutputSchema);

    expect(patchSchema).not.toContain('"pageId"');
    expect(draftSchema).not.toContain('"suggestedParentId"');
  });
});
