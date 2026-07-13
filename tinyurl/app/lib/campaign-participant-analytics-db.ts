export type CampaignParticipantQuestion = {
  id: string;
  label: string;
};

export type CampaignParticipantChannelMapping = {
  questionId: string;
  questionLabel: string;
  answer: string;
  channelIds: number[];
};

export type CampaignParticipant = {
  participantId: string;
  participationType: string;
  registeredAt: string | null;
  lastUpdatedAt: string | null;
  channelIds: number[];
};

export type CampaignParticipantAnalyticsSnapshot = {
  campaignId: number;
  connpassEventId: string;
  importedByUserId: string;
  selectedQuestions: CampaignParticipantQuestion[];
  channelMappings: CampaignParticipantChannelMapping[];
  participants: CampaignParticipant[];
  createdAt: number;
  updatedAt: number;
};

export type ReplaceCampaignParticipantAnalyticsInput = Omit<
  CampaignParticipantAnalyticsSnapshot,
  "createdAt" | "updatedAt"
>;

type AnalyticsRow = {
  campaign_id: number;
  connpass_event_id: string;
  imported_by_user_id: string;
  created_at: number;
  updated_at: number;
};

type QuestionRow = { question_id: string; question_label: string };
type MappingRow = {
  question_id: string;
  question_label: string;
  answer: string;
  channel_id: number | null;
};
type ParticipantRow = {
  participant_id: string;
  participation_type: string;
  registered_at: string | null;
  last_updated_at: string | null;
  channel_id: number | null;
};

const ANALYTICS_COLUMNS =
  "campaign_id, connpass_event_id, imported_by_user_id, created_at, updated_at";

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${field} must not be empty`);
  return normalized;
}

function positiveId(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${field} must be positive`);
  return value;
}

function uniqueChannelIds(values: number[]): number[] {
  return [...new Set(values.map((value) => positiveId(value, "channel ID")))];
}

function normalizeInput(
  input: ReplaceCampaignParticipantAnalyticsInput,
): ReplaceCampaignParticipantAnalyticsInput {
  const selectedQuestions = input.selectedQuestions.map((question) => ({
    id: requiredText(question.id, "question ID"),
    label: requiredText(question.label, "question label"),
  }));
  const selectedQuestionsById = new Map(
    selectedQuestions.map((question) => [question.id, question]),
  );
  if (selectedQuestionsById.size !== selectedQuestions.length) {
    throw new RangeError("Duplicate question ID");
  }

  const mappingKeys = new Set<string>();
  const channelMappings = input.channelMappings.map((mapping) => {
    const questionId = requiredText(mapping.questionId, "mapping question ID");
    const answer = requiredText(mapping.answer, "mapping answer");
    const question = selectedQuestionsById.get(questionId);
    if (!question) throw new RangeError(`Mapping question is not selected: ${questionId}`);
    const key = JSON.stringify([questionId, answer]);
    if (mappingKeys.has(key)) throw new RangeError(`Duplicate channel mapping: ${questionId}`);
    mappingKeys.add(key);
    return {
      questionId,
      questionLabel: question.label,
      answer,
      channelIds: uniqueChannelIds(mapping.channelIds),
    };
  });

  const participantIds = new Set<string>();
  const participants = input.participants.map((participant) => {
    const participantId = requiredText(participant.participantId, "participant ID");
    if (participantIds.has(participantId)) {
      throw new RangeError(`Duplicate participant ID: ${participantId}`);
    }
    participantIds.add(participantId);
    return {
      participantId,
      participationType: requiredText(participant.participationType, "participation type"),
      registeredAt:
        participant.registeredAt === null
          ? null
          : requiredText(participant.registeredAt, "registration time"),
      lastUpdatedAt:
        participant.lastUpdatedAt === null
          ? null
          : requiredText(participant.lastUpdatedAt, "last update time"),
      channelIds: uniqueChannelIds(participant.channelIds),
    };
  });

  return {
    campaignId: positiveId(input.campaignId, "campaign ID"),
    connpassEventId: requiredText(input.connpassEventId, "connpass event ID"),
    importedByUserId: requiredText(input.importedByUserId, "imported by user ID"),
    selectedQuestions,
    channelMappings,
    participants,
  };
}

/** Atomically replaces the connpass participant snapshot belonging to one campaign. */
export async function replaceCampaignParticipantAnalytics(
  db: D1Database,
  rawInput: ReplaceCampaignParticipantAnalyticsInput,
): Promise<void> {
  const input = normalizeInput(rawInput);
  const questions = input.selectedQuestions.map((question, sortOrder) => ({
    questionId: question.id,
    questionLabel: question.label,
    sortOrder,
  }));
  const mappings = input.channelMappings.map((mapping, sortOrder) => ({
    questionId: mapping.questionId,
    answer: mapping.answer,
    sortOrder,
  }));
  const mappingChannels = input.channelMappings.flatMap((mapping) =>
    mapping.channelIds.map((channelId) => ({
      questionId: mapping.questionId,
      answer: mapping.answer,
      channelId,
    })),
  );
  const participants = input.participants.map((participant, sortOrder) => ({
    participantId: participant.participantId,
    participationType: participant.participationType,
    registeredAt: participant.registeredAt,
    lastUpdatedAt: participant.lastUpdatedAt,
    sortOrder,
  }));
  const participantChannels = input.participants.flatMap((participant) =>
    participant.channelIds.map((channelId) => ({
      participantId: participant.participantId,
      channelId,
    })),
  );

  await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_participant_analytics
           (campaign_id, connpass_event_id, imported_by_user_id)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(campaign_id) DO UPDATE SET
           connpass_event_id = excluded.connpass_event_id,
           imported_by_user_id = excluded.imported_by_user_id,
           updated_at = unixepoch()`,
      )
      .bind(input.campaignId, input.connpassEventId, input.importedByUserId),
    db
      .prepare("DELETE FROM campaign_participant_questions WHERE campaign_id = ?1")
      .bind(input.campaignId),
    db
      .prepare(
        `INSERT INTO campaign_participant_questions
           (campaign_id, question_id, question_label, sort_order)
         SELECT ?1, value ->> '$.questionId', value ->> '$.questionLabel',
                value ->> '$.sortOrder'
         FROM json_each(?2)`,
      )
      .bind(input.campaignId, JSON.stringify(questions)),
    db
      .prepare(
        `INSERT INTO campaign_participant_channel_mappings
           (campaign_id, question_id, answer, sort_order)
         SELECT ?1, value ->> '$.questionId', value ->> '$.answer', value ->> '$.sortOrder'
         FROM json_each(?2)`,
      )
      .bind(input.campaignId, JSON.stringify(mappings)),
    db
      .prepare(
        `INSERT INTO campaign_participant_mapping_channels
           (campaign_id, question_id, answer, campaign_channel_id)
         SELECT ?1, value ->> '$.questionId', value ->> '$.answer', value ->> '$.channelId'
         FROM json_each(?2)`,
      )
      .bind(input.campaignId, JSON.stringify(mappingChannels)),
    db.prepare("DELETE FROM campaign_participants WHERE campaign_id = ?1").bind(input.campaignId),
    db
      .prepare(
        `INSERT INTO campaign_participants
           (campaign_id, participant_id, participation_type, registered_at, last_updated_at,
            sort_order)
         SELECT ?1, value ->> '$.participantId', value ->> '$.participationType',
                value ->> '$.registeredAt', value ->> '$.lastUpdatedAt', value ->> '$.sortOrder'
         FROM json_each(?2)`,
      )
      .bind(input.campaignId, JSON.stringify(participants)),
    db
      .prepare(
        `INSERT INTO campaign_participant_channels
           (campaign_id, participant_id, campaign_channel_id)
         SELECT ?1, value ->> '$.participantId', value ->> '$.channelId'
         FROM json_each(?2)`,
      )
      .bind(input.campaignId, JSON.stringify(participantChannels)),
  ]);
}

export async function getCampaignParticipantAnalytics(
  db: D1Database,
  campaignId: number,
): Promise<CampaignParticipantAnalyticsSnapshot | null> {
  const analytics = await db
    .prepare(
      `SELECT ${ANALYTICS_COLUMNS} FROM campaign_participant_analytics WHERE campaign_id = ?`,
    )
    .bind(campaignId)
    .first<AnalyticsRow>();
  if (!analytics) return null;

  const [{ results: questions }, { results: mappings }, { results: participants }] =
    await Promise.all([
      db
        .prepare(
          `SELECT question_id, question_label FROM campaign_participant_questions
           WHERE campaign_id = ? ORDER BY sort_order`,
        )
        .bind(campaignId)
        .all<QuestionRow>(),
      db
        .prepare(
          `SELECT m.question_id, q.question_label, m.answer, c.campaign_channel_id AS channel_id
           FROM campaign_participant_channel_mappings m
           JOIN campaign_participant_questions q
             ON q.campaign_id = m.campaign_id AND q.question_id = m.question_id
           LEFT JOIN campaign_participant_mapping_channels c
             ON c.campaign_id = m.campaign_id AND c.question_id = m.question_id
            AND c.answer = m.answer
           WHERE m.campaign_id = ?
           ORDER BY m.sort_order, c.campaign_channel_id`,
        )
        .bind(campaignId)
        .all<MappingRow>(),
      db
        .prepare(
          `SELECT p.participant_id, p.participation_type, p.registered_at, p.last_updated_at,
                  c.campaign_channel_id AS channel_id
           FROM campaign_participants p
           LEFT JOIN campaign_participant_channels c
             ON c.campaign_id = p.campaign_id AND c.participant_id = p.participant_id
           WHERE p.campaign_id = ?
           ORDER BY p.sort_order, c.campaign_channel_id`,
        )
        .bind(campaignId)
        .all<ParticipantRow>(),
    ]);

  const channelMappings: CampaignParticipantChannelMapping[] = [];
  for (const row of mappings) {
    const current = channelMappings.at(-1);
    if (!current || current.questionId !== row.question_id || current.answer !== row.answer) {
      channelMappings.push({
        questionId: row.question_id,
        questionLabel: row.question_label,
        answer: row.answer,
        channelIds: row.channel_id === null ? [] : [row.channel_id],
      });
    } else if (row.channel_id !== null) {
      current.channelIds.push(row.channel_id);
    }
  }

  const mappedParticipants: CampaignParticipant[] = [];
  for (const row of participants) {
    const current = mappedParticipants.at(-1);
    if (!current || current.participantId !== row.participant_id) {
      mappedParticipants.push({
        participantId: row.participant_id,
        participationType: row.participation_type,
        registeredAt: row.registered_at,
        lastUpdatedAt: row.last_updated_at,
        channelIds: row.channel_id === null ? [] : [row.channel_id],
      });
    } else if (row.channel_id !== null) {
      current.channelIds.push(row.channel_id);
    }
  }

  return {
    campaignId: analytics.campaign_id,
    connpassEventId: analytics.connpass_event_id,
    importedByUserId: analytics.imported_by_user_id,
    selectedQuestions: questions.map((row) => ({ id: row.question_id, label: row.question_label })),
    channelMappings,
    participants: mappedParticipants,
    createdAt: analytics.created_at,
    updatedAt: analytics.updated_at,
  };
}
