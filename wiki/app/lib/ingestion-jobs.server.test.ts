import { describe, expect, it } from "vitest";
import {
  buildIngestionQueueMessage,
  isIngestionQueueMessage,
  parseSessionInputsJson,
} from "./ingestion-jobs.server";

describe("ingestion-jobs helpers", () => {
  it("builds an ingestion queue message", () => {
    expect(buildIngestionQueueMessage("s1", "u1", "post_clarification")).toEqual({
      kind: "ingestion",
      sessionId: "s1",
      userId: "u1",
      resumeMode: "post_clarification",
    });
  });

  it("validates ingestion queue message shape", () => {
    expect(
      isIngestionQueueMessage({
        kind: "ingestion",
        sessionId: "s1",
        userId: "u1",
        resumeMode: "initial",
      }),
    ).toBe(true);
    expect(isIngestionQueueMessage({ pageId: "p1" })).toBe(false);
  });

  it("parses ingestion session inputs JSON", () => {
    const parsed = parseSessionInputsJson(
      JSON.stringify({
        texts: ["hello"],
        imageKeys: ["ingestion/u1/s1/a.png"],
        googleDocUrls: [],
      }),
    );

    expect(parsed).toEqual({
      texts: ["hello"],
      imageKeys: ["ingestion/u1/s1/a.png"],
      googleDocUrls: [],
      pdfKeys: [],
      googleFormUrl: undefined,
      eventTitle: undefined,
    });
  });

  it("parses session inputs JSON with Google Form fields", () => {
    const parsed = parseSessionInputsJson(
      JSON.stringify({
        texts: ["Tech Talk 2025"],
        imageKeys: [],
        googleDocUrls: [],
        googleFormUrl: "https://docs.google.com/forms/d/abc123/viewform",
        eventTitle: "Tech Talk 2025",
      }),
    );

    expect(parsed).toEqual({
      texts: ["Tech Talk 2025"],
      imageKeys: [],
      googleDocUrls: [],
      pdfKeys: [],
      googleFormUrl: "https://docs.google.com/forms/d/abc123/viewform",
      eventTitle: "Tech Talk 2025",
    });
  });

  it("throws on invalid ingestion session inputs JSON", () => {
    expect(() => parseSessionInputsJson(JSON.stringify({ texts: "bad" }))).toThrow(
      "Invalid session inputs",
    );
  });
});
