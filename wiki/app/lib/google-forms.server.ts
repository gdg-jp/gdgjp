/**
 * Google Forms API client for fetching form structure and responses.
 *
 * Uses the logged-in user's OAuth access token (stored in better-auth's
 * `account` table) to access forms they own or have been shared.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormQuestion {
  questionId: string;
  title: string;
  type: FormQuestionType;
  options?: string[]; // for RADIO, CHECKBOX, DROP_DOWN
  low?: number; // for SCALE
  high?: number; // for SCALE
  lowLabel?: string;
  highLabel?: string;
  rows?: string[]; // for GRID
  columns?: string[]; // for GRID
}

export type FormQuestionType =
  | "RADIO"
  | "CHECKBOX"
  | "DROP_DOWN"
  | "TEXT"
  | "PARAGRAPH_TEXT"
  | "SCALE"
  | "GRID"
  | "DATE"
  | "TIME"
  | "FILE_UPLOAD"
  | "UNKNOWN";

export interface FormStructure {
  formId: string;
  title: string;
  description: string;
  questions: FormQuestion[];
}

export interface FormAnswer {
  questionId: string;
  textAnswers?: string[];
}

export interface FormResponse {
  responseId: string;
  createTime: string;
  answers: FormAnswer[];
}

export interface FormData {
  structure: FormStructure;
  responses: FormResponse[];
}

// ---------------------------------------------------------------------------
// URL parsing (re-exported from shared utils for convenience)
// ---------------------------------------------------------------------------

export { extractFormId, isGoogleFormUrl } from "./google-forms-utils";

// ---------------------------------------------------------------------------
// API fetching
// ---------------------------------------------------------------------------

export async function fetchFormStructure(
  formId: string,
  accessToken: string,
): Promise<FormStructure> {
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${formId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throwFormsApiError("structure", res.status, body);
  }

  const data = (await res.json()) as GoogleFormsApiForm;
  return parseFormStructure(formId, data);
}

export async function fetchFormResponses(
  formId: string,
  accessToken: string,
): Promise<FormResponse[]> {
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throwFormsApiError("responses", res.status, body);
  }

  const data = (await res.json()) as { responses?: GoogleFormsApiResponse[] };
  return (data.responses ?? []).map(parseFormResponse);
}

function throwFormsApiError(phase: string, status: number, body: string): never {
  if (
    status === 403 &&
    (body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || body.includes("insufficient"))
  ) {
    throw new Error(
      'Google Forms permission missing. Please click the "Connect Google" button again ' +
        "to re-authorize with the required permissions.",
    );
  }
  throw new Error(`Google Forms API error (${phase}): ${status} ${body}`);
}

export async function fetchFormData(formId: string, accessToken: string): Promise<FormData> {
  const [structure, responses] = await Promise.all([
    fetchFormStructure(formId, accessToken),
    fetchFormResponses(formId, accessToken),
  ]);
  return { structure, responses };
}

// ---------------------------------------------------------------------------
// Google Forms API raw types (subset we care about)
// ---------------------------------------------------------------------------

interface GoogleFormsApiForm {
  formId: string;
  info: { title: string; description?: string };
  items?: GoogleFormsApiItem[];
}

interface GoogleFormsApiItem {
  itemId: string;
  title?: string;
  questionItem?: {
    question: {
      questionId: string;
      choiceQuestion?: {
        type: "RADIO" | "CHECKBOX" | "DROP_DOWN";
        options: { value: string }[];
      };
      scaleQuestion?: {
        low: number;
        high: number;
        lowLabel?: string;
        highLabel?: string;
      };
      textQuestion?: { paragraph?: boolean };
      dateQuestion?: Record<string, unknown>;
      timeQuestion?: Record<string, unknown>;
      fileUploadQuestion?: Record<string, unknown>;
    };
  };
  questionGroupItem?: {
    grid?: {
      columns?: { type: string; options: { value: string }[] };
    };
    questions: {
      questionId: string;
      rowQuestion?: { title: string };
    }[];
  };
}

interface GoogleFormsApiResponse {
  responseId: string;
  createTime: string;
  answers?: Record<
    string,
    {
      questionId: string;
      textAnswers?: { answers: { value: string }[] };
    }
  >;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseFormStructure(formId: string, raw: GoogleFormsApiForm): FormStructure {
  const questions: FormQuestion[] = [];

  for (const item of raw.items ?? []) {
    if (item.questionItem) {
      const q = item.questionItem.question;
      let type: FormQuestionType = "UNKNOWN";
      let options: string[] | undefined;
      let low: number | undefined;
      let high: number | undefined;
      let lowLabel: string | undefined;
      let highLabel: string | undefined;

      if (q.choiceQuestion) {
        type = q.choiceQuestion.type;
        options = q.choiceQuestion.options.map((o) => o.value);
      } else if (q.scaleQuestion) {
        type = "SCALE";
        low = q.scaleQuestion.low;
        high = q.scaleQuestion.high;
        lowLabel = q.scaleQuestion.lowLabel;
        highLabel = q.scaleQuestion.highLabel;
      } else if (q.textQuestion) {
        type = q.textQuestion.paragraph ? "PARAGRAPH_TEXT" : "TEXT";
      } else if (q.dateQuestion) {
        type = "DATE";
      } else if (q.timeQuestion) {
        type = "TIME";
      } else if (q.fileUploadQuestion) {
        type = "FILE_UPLOAD";
      }

      questions.push({
        questionId: q.questionId,
        title: item.title ?? "",
        type,
        options,
        low,
        high,
        lowLabel,
        highLabel,
      });
    }

    if (item.questionGroupItem) {
      const grid = item.questionGroupItem.grid;
      const columns = grid?.columns?.options?.map((o) => o.value) ?? [];
      const rows: string[] = [];

      for (const q of item.questionGroupItem.questions) {
        rows.push(q.rowQuestion?.title ?? "");
        questions.push({
          questionId: q.questionId,
          title: `${item.title ?? ""} — ${q.rowQuestion?.title ?? ""}`,
          type: "GRID",
          rows,
          columns,
        });
      }
    }
  }

  return {
    formId,
    title: raw.info.title,
    description: raw.info.description ?? "",
    questions,
  };
}

function parseFormResponse(raw: GoogleFormsApiResponse): FormResponse {
  const answers: FormAnswer[] = [];

  for (const [, ans] of Object.entries(raw.answers ?? {})) {
    answers.push({
      questionId: ans.questionId,
      textAnswers: ans.textAnswers?.answers.map((a) => a.value),
    });
  }

  return {
    responseId: raw.responseId,
    createTime: raw.createTime,
    answers,
  };
}
