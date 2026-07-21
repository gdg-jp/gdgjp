import { describe, expect, it } from "vitest";
import { createCollectingEventSink } from "../../workers/features/ingestion/orchestration/ports/tool-event-sink";
import { prepareSources } from "../../workers/features/ingestion/tools/source-preprocessor";

describe("prepareSources", () => {
  it("keeps source content out of realtime events", async () => {
    const events: Array<{ type: string; summary?: string }> = [];
    const prepared = await prepareSources(
      {
        texts: ["Input with https://example.test/private"],
        imageKeys: [],
        googleDocUrls: ["https://docs.google.test/document/d/a"],
      },
      {
        attachmentExists: async () => null,
        exportGoogleDocument: async () => ({ title: "Private doc", text: "secret body" }),
        exportGoogleForm: async () => ({ title: "unused", text: "unused" }),
        extractUrls: () => [],
        fetchWebPage: async () => ({ markdown: "unused" }),
        artifacts: { saveNormalizedSource: async () => ({ key: "source/key" }) },
        eventSink: createCollectingEventSink(events as never),
      },
    );

    expect(prepared.sourceArtifactKey).toBe("source/key");
    expect(prepared.userText).toContain("secret body");
    expect(events).toEqual([
      expect.objectContaining({ type: "tool_started", summary: "Reading a Google document" }),
      expect.objectContaining({ type: "tool_completed" }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret body");
    expect(JSON.stringify(events)).not.toContain("google.test");
  });
});
