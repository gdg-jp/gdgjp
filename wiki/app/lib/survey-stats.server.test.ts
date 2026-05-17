import { describe, expect, it } from "vitest";
import type { FormData } from "./google-forms.server";
import { computeSurveyStats, formatSurveyStatsAsText } from "./survey-stats.server";

function makeFormData(overrides?: Partial<FormData>): FormData {
  return {
    structure: {
      formId: "test-form",
      title: "Event Feedback",
      description: "Post-event survey",
      questions: [
        {
          questionId: "q1",
          title: "Overall satisfaction",
          type: "RADIO",
          options: ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied"],
        },
        {
          questionId: "q2",
          title: "Rate the session (1-5)",
          type: "SCALE",
          low: 1,
          high: 5,
        },
        {
          questionId: "q3",
          title: "Comments",
          type: "PARAGRAPH_TEXT",
        },
        {
          questionId: "q4",
          title: "Recommend to others (1-10)",
          type: "SCALE",
          low: 1,
          high: 10,
        },
      ],
      ...overrides?.structure,
    },
    responses: overrides?.responses ?? [
      {
        responseId: "r1",
        createTime: "2025-01-01T00:00:00Z",
        answers: [
          { questionId: "q1", textAnswers: ["Very Satisfied"] },
          { questionId: "q2", textAnswers: ["5"] },
          { questionId: "q3", textAnswers: ["Great event!"] },
          { questionId: "q4", textAnswers: ["9"] },
        ],
      },
      {
        responseId: "r2",
        createTime: "2025-01-01T00:01:00Z",
        answers: [
          { questionId: "q1", textAnswers: ["Satisfied"] },
          { questionId: "q2", textAnswers: ["4"] },
          { questionId: "q3", textAnswers: ["Good but could improve"] },
          { questionId: "q4", textAnswers: ["7"] },
        ],
      },
      {
        responseId: "r3",
        createTime: "2025-01-01T00:02:00Z",
        answers: [
          { questionId: "q1", textAnswers: ["Very Satisfied"] },
          { questionId: "q2", textAnswers: ["5"] },
          { questionId: "q3", textAnswers: ["Loved it"] },
          { questionId: "q4", textAnswers: ["10"] },
        ],
      },
    ],
  };
}

describe("computeSurveyStats", () => {
  it("computes total responses", () => {
    const result = computeSurveyStats(makeFormData());
    expect(result.totalResponses).toBe(3);
    expect(result.formTitle).toBe("Event Feedback");
  });

  it("computes choice stats for RADIO questions", () => {
    const result = computeSurveyStats(makeFormData());
    const q1 = result.questions.find((q) => q.questionId === "q1");
    expect(q1).toBeDefined();
    expect(q1?.stats).not.toBeNull();
    expect(q1?.stats?.kind).toBe("choice");

    const choice = q1?.stats as { kind: "choice"; counts: Record<string, number>; mode: string };
    expect(choice.counts["Very Satisfied"]).toBe(2);
    expect(choice.counts.Satisfied).toBe(1);
    expect(choice.counts.Neutral).toBe(0);
    expect(choice.counts.Dissatisfied).toBe(0);
    expect(choice.mode).toBe("Very Satisfied");
  });

  it("computes scale stats (mean, median, stdDev)", () => {
    const result = computeSurveyStats(makeFormData());
    const q2 = result.questions.find((q) => q.questionId === "q2");
    expect(q2).toBeDefined();
    expect(q2?.stats).not.toBeNull();
    expect(q2?.stats?.kind).toBe("scale");

    const scale = q2?.stats as {
      kind: "scale";
      mean: number;
      median: number;
      stdDev: number;
      distribution: Record<string, number>;
    };
    // Values: 5, 4, 5 → mean = 4.67, median = 5
    expect(scale.mean).toBeCloseTo(4.67, 1);
    expect(scale.median).toBe(5);
    expect(scale.distribution["5"]).toBe(2);
    expect(scale.distribution["4"]).toBe(1);
  });

  it("computes NPS for 1-10 scales", () => {
    const result = computeSurveyStats(makeFormData());
    const q4 = result.questions.find((q) => q.questionId === "q4");
    expect(q4).toBeDefined();
    expect(q4?.stats?.kind).toBe("scale");

    const scale = q4?.stats as { kind: "scale"; nps: { score: number; promoters: number } };
    expect(scale.nps).toBeDefined();
    // Values: 9, 7, 10 → promoters=2, passives=1, detractors=0
    // NPS = (2-0)/3 * 100 = 66.7
    expect(scale.nps.promoters).toBe(2);
    expect(scale.nps.score).toBeCloseTo(66.7, 0);
  });

  it("collects free-text answers", () => {
    const result = computeSurveyStats(makeFormData());
    const q3 = result.questions.find((q) => q.questionId === "q3");
    expect(q3).toBeDefined();
    expect(q3?.stats?.kind).toBe("freeText");

    const ft = q3?.stats as { kind: "freeText"; answers: string[] };
    expect(ft.answers).toHaveLength(3);
    expect(ft.answers).toContain("Great event!");
  });

  it("handles empty responses gracefully", () => {
    const result = computeSurveyStats(makeFormData({ responses: [] }));
    expect(result.totalResponses).toBe(0);
    expect(result.questions[0].responseCount).toBe(0);
    expect(result.questions[0].stats).toBeNull();
  });
});

describe("formatSurveyStatsAsText", () => {
  it("produces structured text output", () => {
    const stats = computeSurveyStats(makeFormData());
    const text = formatSurveyStatsAsText(stats, "GDG Tech Talk 2025");

    expect(text).toContain("# Survey Analysis: GDG Tech Talk 2025");
    expect(text).toContain("Total responses: 3");
    expect(text).toContain("Q: Overall satisfaction");
    expect(text).toContain("Very Satisfied");
    expect(text).toContain("Mean:");
    expect(text).toContain("NPS Score:");
  });
});
