import { describe, expect, it } from "vitest";
import { selectPlannedEvidenceReferences } from "./ingestion-model-gateway";

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
