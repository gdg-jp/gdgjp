import { describe, expect, it } from "vitest";
import { parseEventWriteFields } from "./events";

describe("parseEventWriteFields", () => {
  it("preserves every supported update field, including false", () => {
    expect(
      parseEventWriteFields({
        title: "Updated",
        capacity: 42,
        registrationEnabled: false,
        participationTypes: [{ name: "General", maxParticipants: 42 }],
      }),
    ).toEqual({
      fields: {
        title: "Updated",
        subtitle: undefined,
        description: undefined,
        startAt: undefined,
        endAt: undefined,
        place: undefined,
        address: undefined,
        capacity: 42,
        reservedAt: undefined,
        registrationEnabled: false,
        participationTypes: [{ name: "General", maxParticipants: 42 }],
        ownerText: undefined,
        participantOnlyInfo: undefined,
        cancelPolicy: undefined,
      },
    });
  });

  it("rejects fields that the worker cannot write", () => {
    expect(parseEventWriteFields({ image: "https://example.com/image.png" })).toEqual({
      error: "unsupported_event_fields:image",
    });
  });

  it("rejects malformed supported fields instead of silently dropping them", () => {
    expect(parseEventWriteFields({ registrationEnabled: "false" })).toEqual({
      error: "invalid_event_fields:registrationEnabled",
    });
  });
});
