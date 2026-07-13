import type {
  CampaignChannelOption,
  ConnpassImportDraft,
} from "~/components/campaigns/participant-import-wizard";
import {
  type ChannelCandidate,
  extractChannelMappings,
  extractChannelQuestions,
} from "~/lib/connpass-channel-extraction";
import {
  isCancelledParticipant,
  parseConnpassParticipantsCsv,
  uniqueAnswerOptions,
} from "~/lib/connpass-csv";

/** Browser-only boundary: the raw CSV never runs through the Worker action. */
export async function analyzeConnpassParticipantsFile(
  file: File,
  campaignChannels: CampaignChannelOption[],
): Promise<ConnpassImportDraft> {
  if (file.size > 10_000_000) throw new Error("CSVが大きすぎます（上限10MB）。");
  const parsed = parseConnpassParticipantsCsv(await file.text());
  const dataset = {
    ...parsed,
    participants: parsed.participants.filter((participant) => !isCancelledParticipant(participant)),
  };
  const selectedQuestionIds = extractChannelQuestions(dataset.questionHeaders);
  const channelCandidates: ChannelCandidate[] = campaignChannels.map((channel) => ({
    id: String(channel.id),
    label: channel.name,
    aliases: [channel.code],
  }));
  const mappings = dataset.questionHeaders.map((question) => ({
    question,
    mappings: extractChannelMappings(
      uniqueAnswerOptions(dataset.participants, question),
      channelCandidates,
    ),
  }));

  return {
    rowCount: dataset.participants.length,
    questions: dataset.questionHeaders.map((question) => ({
      id: question,
      label: question,
    })),
    selectedQuestionIds,
    answerMappings: mappings.flatMap(({ question, mappings: questionMappings }) =>
      questionMappings.map((mapping) => ({
        questionId: question,
        questionLabel: question,
        answer: mapping.answer,
        channelIds: mapping.channelIds,
      })),
    ),
    source: dataset,
  };
}
