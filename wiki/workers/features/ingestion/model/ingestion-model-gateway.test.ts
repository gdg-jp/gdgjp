import { describe, expect, it } from "vitest";
import {
  resolvePlannedWikiReferences,
  selectPlannedEvidenceReferences,
} from "./ingestion-model-gateway";

describe("selectPlannedEvidenceReferences", () => {
  it("only resolves paths actually read by the planner and preserves cursors", () => {
    const selected = selectPlannedEvidenceReferences(
      [
        { path: "/google-docs/meeting/PR" },
        { path: "/google-docs/meeting/PR", cursor: "next" },
        { path: "/wiki/about-gdg" },
      ],
      ["/google-docs/meeting/PR", "/websites/unread.example"],
    );

    expect(selected).toEqual([
      { path: "/google-docs/meeting/PR" },
      { path: "/google-docs/meeting/PR", cursor: "next" },
    ]);
  });
});

describe("resolvePlannedWikiReferences", () => {
  it("converts an evidence-backed slug path to the system-owned page ID", async () => {
    const plan = await resolvePlannedWikiReferences(
      {
        planRationale: "既存ページを更新します",
        operations: [
          {
            type: "update",
            pagePath: "/wiki/tips-for-hands-on-preparation",
            rationale: "同じ主題です",
            evidencePaths: ["/wiki/tips-for-hands-on-preparation"],
          },
        ],
      },
      async (path) =>
        path === "/wiki/tips-for-hands-on-preparation"
          ? { pageId: "page_01JABC", pageTitle: "ハンズオン準備のTips" }
          : null,
      [{ path: "/wiki/tips-for-hands-on-preparation" }],
    );

    expect(plan.operations[0]).toEqual({
      type: "update",
      pageId: "page_01JABC",
      pageTitle: "ハンズオン準備のTips",
      rationale: "同じ主題です",
      evidencePaths: ["/wiki/tips-for-hands-on-preparation"],
    });
  });

  it("rejects an update path that the planner did not read", async () => {
    await expect(
      resolvePlannedWikiReferences(
        {
          planRationale: "更新します",
          operations: [
            {
              type: "update",
              pagePath: "/wiki/unread",
              rationale: "更新",
              evidencePaths: [],
            },
          ],
        },
        async () => ({ pageId: "must-not-be-used", pageTitle: "Unread" }),
        [],
      ),
    ).rejects.toThrow("Planned update path was not read: /wiki/unread");
  });

  it("converts a parent slug path to the system-owned parent ID", async () => {
    const plan = await resolvePlannedWikiReferences(
      {
        planRationale: "子ページを作ります",
        operations: [
          {
            type: "create",
            suggestedTitle: { ja: "準備チェックリスト" },
            suggestedParentPath: "/wiki/tips-for-hands-on-preparation",
            pageType: "how-to-guide",
            rationale: "親ページ配下に整理します",
            evidencePaths: ["/wiki/tips-for-hands-on-preparation"],
          },
        ],
      },
      async () => ({ pageId: "page_01JABC", pageTitle: "ハンズオン準備のTips" }),
      [{ path: "/wiki/tips-for-hands-on-preparation" }],
    );

    expect(plan.operations[0]).toMatchObject({
      type: "create",
      suggestedParentId: "page_01JABC",
      tempId: expect.any(String),
    });
  });
});
