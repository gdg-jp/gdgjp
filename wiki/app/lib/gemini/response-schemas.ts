const SENSITIVE_ITEM_PROPERTIES = {
  id: { type: "string" },
  type: {
    type: "string",
    enum: ["email", "phone", "sns-handle", "financial", "personal-opinion", "credential", "other"],
  },
  excerpt: { type: "string" },
  location: { type: "string" },
  suggestion: { type: "string" },
};

export const OPERATION_PLAN_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    planRationale: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["create", "update"] },
          tempId: { type: "string" },
          suggestedTitle: {
            type: "object",
            properties: { ja: { type: "string" } },
            required: ["ja"],
          },
          suggestedParentId: { type: "string", nullable: true },
          pageType: {
            type: "string",
            enum: [
              "event-report",
              "speaker-profile",
              "project-log",
              "how-to-guide",
              "onboarding-guide",
              "survey-report",
            ],
          },
          rationale: { type: "string" },
          pageId: { type: "string" },
          pageTitle: { type: "string" },
        },
        required: ["type", "rationale"],
      },
    },
  },
  required: ["planRationale", "operations"],
};

export const PAGE_DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestedPageType: {
      type: "string",
      enum: [
        "event-report",
        "speaker-profile",
        "project-log",
        "how-to-guide",
        "onboarding-guide",
        "survey-report",
      ],
    },
    pageTypeConfidence: { type: "string", enum: ["high", "medium", "low"] },
    title: { type: "object", properties: { ja: { type: "string" } }, required: ["ja"] },
    summary: { type: "object", properties: { ja: { type: "string" } }, required: ["ja"] },
    metadata: { type: "object", additionalProperties: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          sectionType: {
            type: "string",
            enum: [
              "overview",
              "steps",
              "tips",
              "retrospective-good",
              "retrospective-improve",
              "checklist",
              "contact",
              "handover",
              "faq",
              "other",
            ],
          },
        },
        required: ["heading", "body", "sectionType"],
      },
    },
    suggestedParentId: { type: "string", nullable: true },
    suggestedTags: { type: "array", items: { type: "string" } },
    suggestedSlug: { type: "string" },
    actionabilityScore: { type: "integer", enum: [1, 2, 3] },
    actionabilityNotes: { type: "string" },
    sensitiveItems: {
      type: "array",
      items: {
        type: "object",
        properties: SENSITIVE_ITEM_PROPERTIES,
        required: ["id", "type", "excerpt", "location", "suggestion"],
      },
    },
  },
  required: [
    "suggestedPageType",
    "pageTypeConfidence",
    "title",
    "summary",
    "metadata",
    "sections",
    "suggestedParentId",
    "suggestedTags",
    "actionabilityScore",
    "actionabilityNotes",
    "sensitiveItems",
  ],
};

export const SECTION_PATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pageId: { type: "string" },
    sectionPatches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headingMatch: { type: "string", nullable: true },
          operation: { type: "string", enum: ["append", "prepend"] },
          newHeading: { type: "string" },
          content: { type: "string" },
        },
        required: ["headingMatch", "operation", "content"],
      },
    },
    sensitiveItems: {
      type: "array",
      items: {
        type: "object",
        properties: SENSITIVE_ITEM_PROPERTIES,
        required: ["id", "type", "excerpt", "location", "suggestion"],
      },
    },
    actionabilityScore: { type: "integer", enum: [1, 2, 3] },
    actionabilityNotes: { type: "string" },
  },
  required: [
    "pageId",
    "sectionPatches",
    "sensitiveItems",
    "actionabilityScore",
    "actionabilityNotes",
  ],
};

export const PHASE0_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    needsClarification: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          context: { type: "string" },
          suggestions: { type: "array", items: { type: "string" } },
        },
        required: ["id", "question", "context"],
      },
    },
    summary: { type: "string" },
  },
  required: ["needsClarification", "questions", "summary"],
};

export const TRANSLATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titleEn: { type: "string" },
    summaryEn: { type: "string" },
    contentEn: { type: "string" },
  },
  required: ["titleEn", "summaryEn", "contentEn"],
};
