import { Output } from "ai";
import { describe, expect, it } from "vitest";
import {
  ClarificationResultSchema,
  PageDraftSchema,
  SectionPatchResponseSchema,
} from "./contracts";

async function jsonSchemaFor(schema: Parameters<typeof Output.object>[0]["schema"]) {
  const responseFormat = await Output.object({ schema }).responseFormat;
  if (responseFormat?.type !== "json") throw new Error("Expected JSON response format");
  return responseFormat.schema as {
    properties: Record<string, { properties?: Record<string, unknown>; items?: unknown }>;
    required: string[];
  };
}

describe("ingestion structured-output schemas", () => {
  it("normalizes nullable provider values to the public optional shape", () => {
    const clarification = ClarificationResultSchema.parse({
      needsClarification: true,
      questions: [{ id: "q1", question: "Question", context: "Context", suggestions: null }],
      summary: "Summary",
    });
    expect(clarification.questions[0]).not.toHaveProperty("suggestions", null);
    expect(clarification.questions[0]?.suggestions).toBeUndefined();
    expect(
      ClarificationResultSchema.parse({
        needsClarification: true,
        questions: Array.from({ length: 6 }, (_, index) => ({
          id: `q${index}`,
          question: "Question",
          context: "Context",
          suggestions: null,
        })),
        summary: "Summary",
      }).questions,
    ).toHaveLength(4);

    const page = PageDraftSchema.parse({
      suggestedPageType: "how-to-guide",
      pageTypeConfidence: "high",
      title: { ja: "Title" },
      summary: { ja: "Summary" },
      metadata: {},
      sections: [],
      suggestedParentId: null,
      suggestedTags: [],
      suggestedSlug: null,
      actionabilityScore: 1,
      actionabilityNotes: "",
      sensitiveItems: [],
    });
    expect(page.suggestedSlug).toBeUndefined();
    expect(
      PageDraftSchema.parse({
        suggestedPageType: "how-to-guide",
        pageTypeConfidence: "high",
        title: { ja: "Title" },
        summary: { ja: "Summary" },
        metadata: {},
        sections: [],
        suggestedParentId: null,
        suggestedTags: ["a", "b", "c", "d", "e", "f"],
        suggestedSlug: null,
        actionabilityScore: 1,
        actionabilityNotes: "",
        sensitiveItems: [],
      }).suggestedTags,
    ).toHaveLength(5);

    const patch = SectionPatchResponseSchema.parse({
      pageId: "page-1",
      sectionPatches: [
        { headingMatch: null, operation: "append", newHeading: null, content: "Content" },
      ],
      sensitiveItems: [],
      actionabilityScore: 1,
      actionabilityNotes: "",
    });
    expect(patch.sectionPatches[0]?.newHeading).toBeUndefined();
  });

  it("marks nullable fields as required in the provider JSON schema", async () => {
    const clarification = await jsonSchemaFor(ClarificationResultSchema);
    // Zod may emit the array item directly or wrap it; inspect the serialized
    // schema to keep this assertion independent of that representation detail.
    expect(JSON.stringify(clarification)).toContain(
      '"required":["id","question","context","suggestions"]',
    );

    const page = await jsonSchemaFor(PageDraftSchema);
    expect(page.required).toContain("suggestedSlug");

    const patch = await jsonSchemaFor(SectionPatchResponseSchema);
    expect(JSON.stringify(patch)).toContain(
      '"required":["headingMatch","operation","newHeading","content"]',
    );
  });
});
