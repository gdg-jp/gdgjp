import type { SurveyQuestion } from "./ui/survey";

const ANSWER_TYPES = new Set(["free_text", "checkbox", "radio", "dropdown"]);

/** The questions a PUT /survey (or pr's upsertSurvey) may send; null when any is malformed. */
export function parseSurveyQuestions(value: unknown): SurveyQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const questions: SurveyQuestion[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.title !== "string") return null;
    if (typeof item.answerType !== "string" || !ANSWER_TYPES.has(item.answerType)) return null;
    if (typeof item.required !== "boolean") return null;
    const options = Array.isArray(item.options)
      ? item.options.filter((o): o is string => typeof o === "string")
      : null;
    questions.push({
      title: item.title,
      answerType: item.answerType as SurveyQuestion["answerType"],
      required: item.required,
      options,
    });
  }
  return questions;
}
