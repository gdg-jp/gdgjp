import { extractFormId, fetchFormData } from "../../../../app/lib/google-forms.server";
import {
  computeSurveyStats,
  formatSurveyStatsAsText,
} from "../../../../app/lib/survey-stats.server";
import type { GoogleAccessTokenProvider } from "./google-drive";

export function createGoogleFormsTool(tokens: GoogleAccessTokenProvider) {
  return {
    async exportForm(url: string, eventTitle?: string): Promise<{ title: string; text: string }> {
      const formId = extractFormId(url);
      if (!formId) throw new Error("Invalid Google Form URL");
      const form = await fetchFormData(formId, await tokens.getAccessToken());
      return {
        title: form.structure.title,
        text: formatSurveyStatsAsText(computeSurveyStats(form), eventTitle ?? form.structure.title),
      };
    },
  };
}
