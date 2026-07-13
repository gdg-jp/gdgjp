import type {
  AnswerMappingDraft,
  ConnpassImportDraft,
} from "~/components/campaigns/participant-import-wizard";

export type ParticipantImportValidation = {
  errors: string[];
  unassignedMappings: AnswerMappingDraft[];
};

export function validateParticipantImport(
  draft: ConnpassImportDraft,
  connpassEventId: string,
): ParticipantImportValidation {
  const errors: string[] = [];
  if (!/^\d+$/.test(connpassEventId)) errors.push("Enter a numeric connpass event ID.");
  if (draft.selectedQuestionIds.length === 0) {
    errors.push("Select at least one discovery question.");
  }
  const selectedQuestions = new Set(draft.selectedQuestionIds);
  return {
    errors,
    unassignedMappings: draft.answerMappings.filter(
      (mapping) => selectedQuestions.has(mapping.questionId) && mapping.channelIds.length === 0,
    ),
  };
}
