import { describe, expect, it } from "vitest";
import {
  isGoogleChatImportQueueBody,
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

describe("Google Chat import queue body", () => {
  it("recognizes bounded import work items", () => {
    expect(
      isGoogleChatImportQueueBody({ type: "google_chat_import", runId: "run-1", work: "list" }),
    ).toBe(true);
    expect(
      isGoogleChatImportQueueBody({
        type: "google_chat_import",
        runId: "run-1",
        work: "message",
        messageId: "m-1",
      }),
    ).toBe(true);
    expect(
      isGoogleChatImportQueueBody({
        type: "google_chat_import",
        runId: "run-1",
        work: "finalize",
        monthIndex: 0,
      }),
    ).toBe(true);
  });

  it("rejects incomplete import work", () => {
    expect(isGoogleChatImportQueueBody({ type: "google_chat_import", work: "list" })).toBe(false);
    expect(
      isGoogleChatImportQueueBody({ type: "google_chat_import", runId: "run-1", work: "message" }),
    ).toBe(false);
  });
});
