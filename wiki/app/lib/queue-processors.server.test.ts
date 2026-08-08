import { describe, expect, it } from "vitest";
import {
  isGoogleDocumentImportQueueBody,
  isSourceFetchQueueBody,
  isTranslationQueueBody,
} from "~/lib/queue-processors.server";

describe("queue body guards", () => {
  it("recognizes source_fetch messages", () => {
    expect(isSourceFetchQueueBody({ type: "source_fetch", sourceId: "src-1" })).toBe(true);
  });

  it("rejects other shapes so the queue handler can ack() and drop them", () => {
    expect(isSourceFetchQueueBody({ pageId: "p1" })).toBe(false);
    expect(isSourceFetchQueueBody({ type: "google_document_import", jobId: "j1" })).toBe(false);
    expect(isSourceFetchQueueBody({ type: "source_fetch" })).toBe(false);
    expect(isSourceFetchQueueBody(null)).toBe(false);
    expect(isSourceFetchQueueBody("source_fetch")).toBe(false);

    // Cross-check: unknown bodies match none of the known guards.
    const unknown = { type: "totally_unknown", payload: 1 };
    expect(isTranslationQueueBody(unknown)).toBe(false);
    expect(isGoogleDocumentImportQueueBody(unknown)).toBe(false);
    expect(isSourceFetchQueueBody(unknown)).toBe(false);
  });
});
