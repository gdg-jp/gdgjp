import { describe, expect, it } from "vitest";
import type { WorkspaceSourceReference } from "../serialization/context-manifest-codec";
import { ManifestWorkspaceAdapter } from "./manifest-workspace-adapter";

const references: WorkspaceSourceReference[] = [
  {
    path: "/google-docs/Meeting",
    parentPath: "/google-docs",
    title: "Meeting",
    kind: "google_document",
  },
  {
    path: "/google-docs/Meeting/PR",
    parentPath: "/google-docs/Meeting",
    title: "PR",
    kind: "google_tab",
    artifactKey: "tab-pr",
  },
  {
    path: "/google-docs/Meeting/PR/広報_議事録",
    parentPath: "/google-docs/Meeting/PR",
    title: "広報 議事録",
    kind: "google_tab",
    artifactKey: "tab-minutes",
  },
];

describe("ManifestWorkspaceAdapter", () => {
  it("keeps readable nodes listable without adding virtual filenames", async () => {
    const contents = new Map([
      ["tab-pr", "PR content"],
      ["tab-minutes", "minutes content"],
    ]);
    const adapter = new ManifestWorkspaceAdapter("/google-docs", references, async (reference) =>
      contents.get(reference.artifactKey ?? ""),
    );

    const root = await adapter.ls("");
    const pr = await adapter.ls("Meeting/PR");
    const content = await adapter.cat("Meeting/PR", { maxChars: 2 });

    expect(root.data.entries).toEqual([
      expect.objectContaining({ path: "Meeting", readable: false, hasChildren: true }),
    ]);
    expect(pr.data.entries).toEqual([
      expect.objectContaining({ path: "Meeting/PR/広報_議事録", readable: true }),
    ]);
    expect(content.data).toEqual({
      path: "Meeting/PR",
      content: "PR",
      nextCursor: "eyJvZmZzZXQiOjJ9",
    });
    expect(content.truncated).toBe(true);
  });
});
