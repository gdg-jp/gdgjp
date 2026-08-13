import type { Locator, Page } from "@cloudflare/playwright";
import { selectors } from "./selectors";

export function surveyEditUrl(eventId: string | number): string {
  return `https://connpass.com/event/${eventId}/edit/form/`;
}

export type SurveyAnswerType = "free_text" | "checkbox" | "radio" | "dropdown";

export type SurveyQuestion = {
  id?: string | null;
  title: string;
  answerType: SurveyAnswerType;
  required: boolean;
  options?: string[] | null;
};

/** Codes confirmed against selectors.survey's AnswerTypesTemplate fixture. */
export const ANSWER_TYPE_BY_CODE: Record<string, SurveyAnswerType> = {
  "1": "free_text",
  "2": "checkbox",
  "3": "radio",
  "4": "dropdown",
};
export const CODE_BY_ANSWER_TYPE: Record<SurveyAnswerType, string> = {
  free_text: "1",
  checkbox: "2",
  radio: "3",
  dropdown: "4",
};

async function readQuestionBlock(block: Locator): Promise<SurveyQuestion> {
  const title = await block.locator('input[name="title"]').inputValue();
  const code = await block.locator('select[name="answer_type"]').inputValue();
  const required = await block.locator('input[name="required"]').isChecked();
  const options = await block
    .locator('.QuestionOptionsList input[name="option_title"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  return {
    title,
    answerType: ANSWER_TYPE_BY_CODE[code] ?? "free_text",
    required,
    options: options.length > 0 ? options : null,
  };
}

export async function scrapeSurvey(
  page: Page,
  eventId: string | number,
): Promise<{ questions: SurveyQuestion[] }> {
  await page.goto(surveyEditUrl(eventId), { waitUntil: "domcontentloaded" });
  const { survey } = selectors;

  if ((await page.locator(survey.editQuestionForm).count()) === 0) {
    return { questions: [] };
  }

  const blocks = page.locator(`${survey.questionArea} > ${survey.questionBlock}`);
  const count = await blocks.count();
  const questions: SurveyQuestion[] = [];
  for (let i = 0; i < count; i++) {
    questions.push(await readQuestionBlock(blocks.nth(i)));
  }
  return { questions };
}

export async function upsertSurvey(
  page: Page,
  eventId: string | number,
  questions: SurveyQuestion[],
): Promise<void> {
  await page.goto(surveyEditUrl(eventId), { waitUntil: "domcontentloaded" });
  const { survey } = selectors;

  if ((await page.locator(survey.editQuestionForm).count()) === 0) {
    const createNew = page.locator(survey.createNewLink).first();
    await createNew.click();
    await page.locator(survey.editQuestionForm).waitFor({ state: "visible", timeout: 10_000 });
  }

  const blockSelector = `${survey.questionArea} > ${survey.questionBlock}`;
  // Full-replace semantics: clear every existing question first.
  while ((await page.locator(blockSelector).count()) > 0) {
    await page.locator(blockSelector).first().locator(survey.deleteQuestion).click();
    await page.waitForTimeout(150);
  }

  for (const question of questions) {
    await page.locator(survey.addQuestion).first().click();
    await page.waitForTimeout(150);
    const block = page.locator(blockSelector).last();
    await block.locator('input[name="title"]').fill(question.title);
    await block
      .locator('select[name="answer_type"]')
      .selectOption(CODE_BY_ANSWER_TYPE[question.answerType]);
    const requiredCheckbox = block.locator('input[name="required"]');
    const isChecked = await requiredCheckbox.isChecked();
    if (isChecked !== question.required) {
      await requiredCheckbox.click();
    }
    for (const option of question.options ?? []) {
      await block.locator(survey.addOption).click();
      await page.waitForTimeout(100);
      await block.locator('.QuestionOptionsList input[name="option_title"]').last().fill(option);
    }
  }

  await page.locator(survey.saveQuestions).first().click();
  await page.waitForTimeout(400);
}
