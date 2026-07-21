import { describe, expect, it } from "vitest";
import { parseIngestionContextManifest } from "../../workers/features/ingestion/persistence/serialization/context-manifest-codec";
import { parseIngestionDraft } from "../../workers/features/ingestion/persistence/serialization/ingestion-draft-codec";
import {
  parsePersistedIngestionInputs,
  stringifyPersistedIngestionInputs,
} from "../../workers/features/ingestion/persistence/serialization/session-inputs-codec";

describe("ingestion persistence codecs", () => {
  it("round-trips the existing inputs_json shape without file buffers", () => {
    const encoded = stringifyPersistedIngestionInputs({
      texts: ["Notes"],
      imageKeys: ["ingestion/a/image.png"],
      googleDocUrls: ["https://docs.google.com/document/d/example"],
      pdfKeys: ["ingestion/a/source.pdf"],
      eventTitle: "DevFest",
    });
    expect(parsePersistedIngestionInputs(encoded)).toEqual({
      texts: ["Notes"],
      imageKeys: ["ingestion/a/image.png"],
      googleDocUrls: ["https://docs.google.com/document/d/example"],
      pdfKeys: ["ingestion/a/source.pdf"],
      eventTitle: "DevFest",
      googleFormUrl: undefined,
    });
  });

  it("accepts legacy result drafts without a phase", () => {
    expect(parseIngestionDraft('{"planRationale":"x","operations":[]}')).toEqual({
      planRationale: "x",
      operations: [],
    });
  });

  it("recovers an empty manifest from corrupt historical JSON", () => {
    expect(parseIngestionContextManifest("not json")).toEqual({});
  });

  it("keeps valid mounted source nodes and drops malformed nodes", () => {
    expect(
      parseIngestionContextManifest(
        JSON.stringify({
          sourceNodes: [
            {
              path: "/google-docs/Meeting/PR",
              parentPath: "/google-docs/Meeting",
              title: "PR",
              kind: "google_tab",
              artifactKey: "ingestion/session/workspace/google-docs/Meeting/PR",
              bytes: 42,
            },
            { path: "relative", title: "invalid", kind: "website" },
          ],
        }),
      ).sourceNodes,
    ).toEqual([
      {
        path: "/google-docs/Meeting/PR",
        parentPath: "/google-docs/Meeting",
        title: "PR",
        kind: "google_tab",
        artifactKey: "ingestion/session/workspace/google-docs/Meeting/PR",
        bytes: 42,
      },
    ]);
  });
});
