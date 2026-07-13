import type { ReplaceCampaignParticipantAnalyticsInput } from "~/lib/campaign-participant-analytics-db";
import { splitAnswerOptions } from "~/lib/connpass-csv";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing.`);
  return value.trim();
}

function nullableUnixSeconds(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return new Date(value * 1000).toISOString();
}

function channelId(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("A channel ID is invalid.");
  return parsed;
}

/** Validate the browser draft and convert it to the narrow DB replacement contract. */
export function buildCampaignParticipantAnalyticsInput(args: {
  rawDraft: string;
  campaignId: number;
  connpassEventId: string;
  importedByUserId: string;
  allowedChannelIds: number[];
}): ReplaceCampaignParticipantAnalyticsInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.rawDraft);
  } catch {
    throw new Error("The import draft is not valid JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.source))
    throw new Error("The import draft is invalid.");
  if (!Array.isArray(parsed.questions) || !Array.isArray(parsed.selectedQuestionIds)) {
    throw new Error("The discovery question selection is invalid.");
  }
  if (!Array.isArray(parsed.answerMappings) || !Array.isArray(parsed.source.participants)) {
    throw new Error("The channel mapping data is invalid.");
  }
  if (!Array.isArray(parsed.source.questionHeaders)) {
    throw new Error("The source question list is invalid.");
  }

  const sourceQuestionIds = new Set(
    parsed.source.questionHeaders.map((value) => requiredString(value, "Source question")),
  );

  const selectedIds = new Set(
    parsed.selectedQuestionIds.map((value) => requiredString(value, "Question ID")),
  );
  if (selectedIds.size === 0) throw new Error("Select at least one discovery question.");

  const selectedQuestions = parsed.questions
    .map((value) => {
      if (!isRecord(value)) throw new Error("A discovery question is invalid.");
      return {
        id: requiredString(value.id, "Question ID"),
        label: requiredString(value.label, "Question label"),
      };
    })
    .filter((question) => selectedIds.has(question.id));
  if (selectedQuestions.length !== selectedIds.size) {
    throw new Error("A selected discovery question is missing.");
  }
  if (selectedQuestions.some((question) => !sourceQuestionIds.has(question.id))) {
    throw new Error("A selected discovery question does not exist in the source CSV.");
  }
  if (selectedQuestions.some((question) => question.label !== question.id)) {
    throw new Error("A discovery question label does not match the source CSV.");
  }

  const participantRows = parsed.source.participants
    .map((value) => {
      if (!isRecord(value) || !isRecord(value.responses)) {
        throw new Error("A participant row is invalid.");
      }
      return value as JsonRecord & { responses: JsonRecord };
    })
    .filter(
      (value) =>
        typeof value.participationStatus !== "string" ||
        !/キャンセル|取消|辞退/.test(value.participationStatus),
    );
  const sourceAnswers = new Map<string, Set<string>>(
    [...selectedIds].map((questionId) => [questionId, new Set<string>()]),
  );
  for (const participant of participantRows) {
    for (const questionId of selectedIds) {
      const answer = participant.responses[questionId];
      if (typeof answer === "string" && answer.trim()) {
        for (const option of splitAnswerOptions(answer)) {
          sourceAnswers.get(questionId)?.add(option);
        }
      }
    }
  }

  const channelMappings = parsed.answerMappings
    .map((value) => {
      if (!isRecord(value) || !Array.isArray(value.channelIds)) {
        throw new Error("A channel mapping is invalid.");
      }
      return {
        questionId: requiredString(value.questionId, "Mapping question ID"),
        questionLabel: requiredString(value.questionLabel, "Mapping question label"),
        answer: requiredString(value.answer, "CSV option"),
        channelIds: [...new Set(value.channelIds.map(channelId))],
      };
    })
    .filter((mapping) => selectedIds.has(mapping.questionId));
  if (channelMappings.some((mapping) => mapping.channelIds.length !== 1)) {
    throw new Error("Every CSV option must have exactly one channel.");
  }
  const allowedChannelIds = new Set(args.allowedChannelIds);
  if (
    channelMappings.some((mapping) => mapping.channelIds.some((id) => !allowedChannelIds.has(id)))
  ) {
    throw new Error("A selected channel does not belong to this Campaign.");
  }
  const mappingKeys = new Set<string>();
  for (const mapping of channelMappings) {
    const key = JSON.stringify([mapping.questionId, mapping.answer]);
    if (mappingKeys.has(key)) throw new Error("A CSV option has more than one channel mapping.");
    mappingKeys.add(key);
    if (!sourceAnswers.get(mapping.questionId)?.has(mapping.answer)) {
      throw new Error("A channel mapping answer does not exist in the source CSV.");
    }
  }
  for (const [questionId, answers] of sourceAnswers) {
    for (const answer of answers) {
      if (!mappingKeys.has(JSON.stringify([questionId, answer]))) {
        throw new Error("Every nonblank CSV option must have exactly one channel mapping.");
      }
    }
  }

  const channelsByAnswer = new Map(
    channelMappings.map((mapping) => [
      JSON.stringify([mapping.questionId, mapping.answer]),
      mapping.channelIds,
    ]),
  );
  const participants = participantRows.map((value) => {
    const channelIds = new Set<number>();
    for (const questionId of selectedIds) {
      const answer = value.responses[questionId];
      if (typeof answer !== "string" || !answer.trim()) continue;
      for (const option of splitAnswerOptions(answer)) {
        for (const id of channelsByAnswer.get(JSON.stringify([questionId, option])) ?? []) {
          channelIds.add(id);
        }
      }
    }
    return {
      participantId: requiredString(value.participantId, "Participant ID"),
      participationType: requiredString(value.participationType, "Participation type"),
      registeredAt: nullableUnixSeconds(
        value.registeredAt ?? value.lastUpdatedAt,
        "Registration time",
      ),
      lastUpdatedAt: nullableUnixSeconds(value.lastUpdatedAt, "Last update time"),
      channelIds: [...channelIds],
    };
  });

  return {
    campaignId: args.campaignId,
    connpassEventId: requiredString(args.connpassEventId, "connpass event ID"),
    importedByUserId: args.importedByUserId,
    selectedQuestions,
    channelMappings,
    participants,
  };
}
