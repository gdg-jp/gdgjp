import { describe, expect, it } from "vitest";
import type { ConnpassImportDraft } from "~/components/campaigns/participant-import-wizard";
import { validateParticipantImport } from "./campaign-participant-import-validation";

const draft: ConnpassImportDraft = {
  rowCount: 1,
  questions: [{ id: "discovery", label: "どこで知りましたか？" }],
  selectedQuestionIds: ["discovery"],
  answerMappings: [
    {
      questionId: "discovery",
      questionLabel: "どこで知りましたか？",
      answer: "口コミ",
      channelIds: [],
    },
  ],
  source: {},
};

describe("validateParticipantImport", () => {
  it("reports every unmapped answer when save is attempted", () => {
    expect(validateParticipantImport(draft, "391029").unassignedMappings).toEqual(
      draft.answerMappings,
    );
  });

  it("accepts the draft after the answer is manually assigned", () => {
    const assigned = {
      ...draft,
      answerMappings: [{ ...draft.answerMappings[0], channelIds: ["7"] }],
    };
    expect(validateParticipantImport(assigned, "391029")).toEqual({
      errors: [],
      unassignedMappings: [],
    });
  });

  it("reports an invalid event ID and missing question selection", () => {
    expect(
      validateParticipantImport({ ...draft, selectedQuestionIds: [] }, "event-391029").errors,
    ).toEqual(["Enter a numeric connpass event ID.", "Select at least one discovery question."]);
  });
});
