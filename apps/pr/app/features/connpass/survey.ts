import type { ConnpassSurveyQuestion } from "@gdgjp/gdg-lib";
import type { PlanBody } from "~/features/plans/plan";

const ANSWER_TYPES = new Set(["free_text", "checkbox", "radio", "dropdown"]);

/** The 4th standard question (constants.surveyQuestions): where people heard of the event. */
export const isSourceQuestion = (title: string, standard: readonly string[]) =>
  title.includes(standard[3] ?? "知った場所");

/**
 * The plan's survey as connpass questions. "Where did you hear of it" offers exactly the labels
 * of the plan's adopted channels (constants.channelLabels), so answers map back to tinyurl
 * channels; a channel without a label is refused rather than guessed.
 */
export function surveyFromPlan(
  plan: Pick<PlanBody, "surveyQuestions" | "channelMix">,
  constants: { channelLabels: Record<string, string>; surveyQuestions: readonly string[] },
): { ok: true; questions: ConnpassSurveyQuestion[] } | { ok: false; error: string } {
  const adopted = plan.channelMix.filter((c) => c.adopt).map((c) => c.channel);
  const missing = adopted.filter((c) => !constants.channelLabels[c]);
  if (missing.length)
    return { ok: false, error: `channelLabels に無いチャネルがあります: ${missing.join(", ")}` };
  const labels = [...new Set(adopted.map((c) => constants.channelLabels[c] as string))];
  const questions: ConnpassSurveyQuestion[] = [];
  for (const q of plan.surveyQuestions) {
    if (!ANSWER_TYPES.has(q.answerType))
      return { ok: false, error: `回答形式が不正です: ${q.title}` };
    const source = isSourceQuestion(q.title, constants.surveyQuestions);
    questions.push({
      title: q.title,
      answerType: source ? "checkbox" : (q.answerType as ConnpassSurveyQuestion["answerType"]),
      required: true,
      options: source ? [...labels, "その他"] : q.options,
    });
  }
  if (!questions.length) return { ok: false, error: "計画にアンケートがありません" };
  return { ok: true, questions };
}
