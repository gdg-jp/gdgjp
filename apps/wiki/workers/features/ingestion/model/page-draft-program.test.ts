import { describe, expect, it, vi } from "vitest";
import type { WikiModel } from "../../../../app/features/ai/model/index.server";
import type { PageDraft, SectionPatchResponse } from "../../../../shared/ingestion/domain";
import { createPageDraftProgram } from "./page-draft-program";

const draft: PageDraft = {
  suggestedPageType: "event-report",
  pageTypeConfidence: "high",
  title: { ja: "Build with AI" },
  summary: { ja: "概要" },
  metadata: {},
  sections: [],
  suggestedParentId: null,
  suggestedTags: [],
  suggestedSlug: "build-with-ai",
  actionabilityScore: 3,
  actionabilityNotes: "ready",
  sensitiveItems: [],
};

const patch: SectionPatchResponse = {
  pageId: "ignored-by-program",
  sectionPatches: [],
  sensitiveItems: [],
  actionabilityScore: 3,
  actionabilityNotes: "ready",
};

function modelReturning(...results: unknown[]): Pick<WikiModel, "generateObject"> {
  return {
    generateObject: vi.fn(async () => results.shift()) as WikiModel["generateObject"],
  };
}

describe("PageDraftProgram", () => {
  it("generates each create operation in a fresh context containing only direct input and evidence", async () => {
    const model = modelReturning(draft, draft);
    const program = createPageDraftProgram(model);

    await program.generate({
      userInput: "ユーザーが入力したイベント情報",
      clarificationAnswers: "会場は大阪です",
      operation: {
        type: "create",
        tempId: "first",
        suggestedTitle: { ja: "最初のページ" },
        suggestedParentId: null,
        pageType: "event-report",
        rationale: "first",
        evidencePaths: ["/google-docs/meeting/PR"],
      },
      evidence: [{ path: "/google-docs/meeting/PR", content: "最初の証拠" }],
    });
    await program.generate({
      userInput: "別のユーザー入力",
      operation: {
        type: "create",
        tempId: "second",
        suggestedTitle: { ja: "二番目のページ" },
        suggestedParentId: null,
        pageType: "how-to-guide",
        rationale: "second",
        evidencePaths: ["/websites/example.com"],
      },
      evidence: [{ path: "/websites/example.com", content: "二番目の証拠" }],
    });

    const calls = vi.mocked(model.generateObject).mock.calls;
    expect(calls).toHaveLength(2);
    const firstText = String(
      (calls[0]?.[0].messages?.[0]?.content?.[0] as { text?: string })?.text,
    );
    const secondText = String(
      (calls[1]?.[0].messages?.[0]?.content?.[0] as { text?: string })?.text,
    );
    expect(firstText).toContain("ユーザーが入力したイベント情報");
    expect(firstText).toContain("会場は大阪です");
    expect(firstText).toContain("/google-docs/meeting/PR");
    expect(secondText).toContain("別のユーザー入力");
    expect(secondText).toContain("/websites/example.com");
    expect(secondText).not.toContain("最初の証拠");
    expect(secondText).not.toContain("会場は大阪です");
  });

  it("preserves the authorized update base and replaces the model page id", async () => {
    const model = modelReturning(patch);
    const program = createPageDraftProgram(model);

    const result = await program.generate({
      userInput: "更新したい",
      operation: {
        type: "update",
        pageId: "page-1",
        pageTitle: "既存ページ",
        rationale: "update",
        evidencePaths: ["/wiki/existing"],
      },
      evidence: [{ path: "/wiki/existing", content: "既存ページの本文" }],
      existingTipTapJson: '{"type":"doc"}',
    });

    expect(result).toMatchObject({
      type: "update",
      pageId: "page-1",
      existingTipTapJson: '{"type":"doc"}',
      patch: { pageId: "page-1" },
    });
  });

  it("rejects an update whose authorized base was not resolved", async () => {
    const model = modelReturning(patch);
    const program = createPageDraftProgram(model);

    await expect(
      program.generate({
        userInput: "更新したい",
        operation: {
          type: "update",
          pageId: "missing",
          pageTitle: "欠損ページ",
          rationale: "update",
          evidencePaths: [],
        },
        evidence: [],
      }),
    ).rejects.toThrow("Planned update page no longer exists: missing");
    expect(model.generateObject).not.toHaveBeenCalled();
  });
});
