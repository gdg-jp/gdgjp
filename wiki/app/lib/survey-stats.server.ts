/**
 * Survey statistics pre-processor.
 *
 * Computes descriptive statistics from raw Google Forms responses before
 * feeding them to Gemini. This ensures the AI uses pre-computed numbers
 * as ground truth rather than hallucinating statistics.
 */

import type { FormData, FormQuestion, FormQuestionType, FormResponse } from "./google-forms.server";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QuestionStats {
  questionId: string;
  title: string;
  type: FormQuestionType;
  responseCount: number;
  stats: ChoiceStats | ScaleStats | FreeTextStats | GridStats | null;
}

export interface ChoiceStats {
  kind: "choice";
  counts: Record<string, number>;
  percentages: Record<string, number>;
  mode: string;
}

export interface ScaleStats {
  kind: "scale";
  mean: number;
  median: number;
  stdDev: number;
  distribution: Record<string, number>;
  low: number;
  high: number;
  lowLabel?: string;
  highLabel?: string;
  nps?: NpsStats;
}

export interface NpsStats {
  score: number;
  promoters: number;
  passives: number;
  detractors: number;
  promoterPct: number;
  passivePct: number;
  detractorPct: number;
}

export interface FreeTextStats {
  kind: "freeText";
  answers: string[];
}

export interface GridStats {
  kind: "grid";
  rows: Record<string, Record<string, number>>;
}

export interface SurveyStatsResult {
  formTitle: string;
  formDescription: string;
  totalResponses: number;
  questions: QuestionStats[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeSurveyStats(formData: FormData): SurveyStatsResult {
  const { structure, responses } = formData;

  const questions: QuestionStats[] = structure.questions.map((q) => {
    const answers = collectAnswers(q.questionId, responses);
    return {
      questionId: q.questionId,
      title: q.title,
      type: q.type,
      responseCount: answers.length,
      stats: computeQuestionStats(q, answers),
    };
  });

  return {
    formTitle: structure.title,
    formDescription: structure.description,
    totalResponses: responses.length,
    questions,
  };
}

// ---------------------------------------------------------------------------
// Per-question stats
// ---------------------------------------------------------------------------

function computeQuestionStats(
  question: FormQuestion,
  answers: string[][],
): ChoiceStats | ScaleStats | FreeTextStats | GridStats | null {
  if (answers.length === 0) return null;

  switch (question.type) {
    case "RADIO":
    case "CHECKBOX":
    case "DROP_DOWN":
      return computeChoiceStats(answers, question.options ?? []);

    case "SCALE":
      return computeScaleStats(answers, question.low ?? 1, question.high ?? 5, question);

    case "TEXT":
    case "PARAGRAPH_TEXT":
      return computeFreeTextStats(answers);

    case "GRID":
      return computeGridStats(answers, question.columns ?? []);

    default:
      return null;
  }
}

function computeChoiceStats(answers: string[][], options: string[]): ChoiceStats {
  const counts: Record<string, number> = {};
  for (const opt of options) counts[opt] = 0;

  let total = 0;
  for (const answerSet of answers) {
    for (const a of answerSet) {
      counts[a] = (counts[a] ?? 0) + 1;
      total++;
    }
  }

  const percentages: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    percentages[key] = total > 0 ? round((count / total) * 100, 1) : 0;
  }

  let mode = "";
  let maxCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      mode = key;
    }
  }

  return { kind: "choice", counts, percentages, mode };
}

function computeScaleStats(
  answers: string[][],
  low: number,
  high: number,
  question: FormQuestion,
): ScaleStats {
  const values = answers
    .flat()
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  if (values.length === 0) {
    return {
      kind: "scale",
      mean: 0,
      median: 0,
      stdDev: 0,
      distribution: {},
      low,
      high,
      lowLabel: question.lowLabel,
      highLabel: question.highLabel,
    };
  }

  const mean = round(values.reduce((s, v) => s + v, 0) / values.length, 2);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = round(Math.sqrt(variance), 2);

  const distribution: Record<string, number> = {};
  for (let i = low; i <= high; i++) {
    distribution[String(i)] = 0;
  }
  for (const v of values) {
    distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;
  }

  // NPS calculation for 1-10 scales
  let nps: NpsStats | undefined;
  if (low === 1 && high === 10 && values.length > 0) {
    const detractors = values.filter((v) => v <= 6).length;
    const passives = values.filter((v) => v === 7 || v === 8).length;
    const promoters = values.filter((v) => v >= 9).length;
    const total = values.length;
    nps = {
      score: round(((promoters - detractors) / total) * 100, 1),
      promoters,
      passives,
      detractors,
      promoterPct: round((promoters / total) * 100, 1),
      passivePct: round((passives / total) * 100, 1),
      detractorPct: round((detractors / total) * 100, 1),
    };
  }

  return {
    kind: "scale",
    mean,
    median,
    stdDev,
    distribution,
    low,
    high,
    lowLabel: question.lowLabel,
    highLabel: question.highLabel,
    nps,
  };
}

function computeFreeTextStats(answers: string[][]): FreeTextStats {
  return {
    kind: "freeText",
    answers: answers.flat().filter((a) => a.trim().length > 0),
  };
}

function computeGridStats(answers: string[][], columns: string[]): GridStats {
  // For grid questions, each answer maps to a row; value is the selected column
  const rows: Record<string, Record<string, number>> = {};

  for (const answerSet of answers) {
    for (const a of answerSet) {
      // Grid answers come as the column label
      const rowKey = "row";
      if (!rows[rowKey]) {
        rows[rowKey] = {};
        for (const col of columns) rows[rowKey][col] = 0;
      }
      rows[rowKey][a] = (rows[rowKey][a] ?? 0) + 1;
    }
  }

  return { kind: "grid", rows };
}

// ---------------------------------------------------------------------------
// Format stats as structured text for Gemini
// ---------------------------------------------------------------------------

export function formatSurveyStatsAsText(stats: SurveyStatsResult, eventTitle: string): string {
  const lines: string[] = [];

  lines.push(`# Survey Analysis: ${eventTitle}`);
  lines.push(`## Form: ${stats.formTitle}`);
  if (stats.formDescription) lines.push(`Description: ${stats.formDescription}`);
  lines.push(`Total responses: ${stats.totalResponses}`);
  lines.push("");

  for (const q of stats.questions) {
    lines.push(`### Q: ${q.title}`);
    lines.push(`Type: ${q.type} | Responses: ${q.responseCount}`);

    if (!q.stats) {
      lines.push("(No responses)");
      lines.push("");
      continue;
    }

    switch (q.stats.kind) {
      case "choice": {
        const s = q.stats;
        lines.push("| Option | Count | % |");
        lines.push("|--------|-------|---|");
        for (const [opt, count] of Object.entries(s.counts)) {
          lines.push(`| ${opt} | ${count} | ${s.percentages[opt]}% |`);
        }
        lines.push(`Mode: ${s.mode}`);
        break;
      }

      case "scale": {
        const s = q.stats;
        lines.push(`Mean: ${s.mean} | Median: ${s.median} | Std Dev: ${s.stdDev}`);
        lines.push("Distribution:");
        for (const [val, count] of Object.entries(s.distribution)) {
          lines.push(`  ${val}: ${count}`);
        }
        if (s.nps) {
          lines.push(
            `NPS Score: ${s.nps.score} (Promoters: ${s.nps.promoterPct}%, Passives: ${s.nps.passivePct}%, Detractors: ${s.nps.detractorPct}%)`,
          );
        }
        break;
      }

      case "freeText": {
        const s = q.stats;
        lines.push(`Free-text responses (${s.answers.length} total):`);
        for (const a of s.answers) {
          lines.push(`- "${a}"`);
        }
        break;
      }

      case "grid": {
        const s = q.stats;
        for (const [row, cols] of Object.entries(s.rows)) {
          lines.push(`${row}:`);
          for (const [col, count] of Object.entries(cols)) {
            lines.push(`  ${col}: ${count}`);
          }
        }
        break;
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAnswers(questionId: string, responses: FormResponse[]): string[][] {
  const result: string[][] = [];
  for (const resp of responses) {
    const answer = resp.answers.find((a) => a.questionId === questionId);
    if (answer?.textAnswers && answer.textAnswers.length > 0) {
      result.push(answer.textAnswers);
    }
  }
  return result;
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
