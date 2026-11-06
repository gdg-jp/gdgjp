import { renderConnpassPage } from "@skills/pr-playbook/scripts/render/connpass-page.mjs";
import type { Brief } from "~/features/briefs/brief";

/** pr-connpass-page's output (slots) plus what the Worker adds: the skin and the rendered HTML. */
export type ConnpassPageContent = {
  title: string;
  summary: string;
  sections: { id: string; heading: string | null; slots: Record<string, unknown> }[];
  imageSlots: { id: string; purpose: string; text: string }[];
  surveyQuestions: {
    title: string;
    answerType: string;
    required: boolean;
    options: string[] | null;
  }[];
  participantOnlyInfo: string;
  skinSource: string;
  notes: string | null;
  skin?: Record<string, unknown>;
  html?: string;
  renderWarnings?: string[];
};

/** The brief's skin in the renderer's terms (textColor → text); the renderer validates colours. */
export function skinFromBrief(brief: Brief | null): Record<string, unknown> {
  const skin = (brief?.skin ?? {}) as Record<string, unknown>;
  return {
    name: brief?.event.name ?? "gdg-design",
    bg: skin.bg,
    panelBg: skin.panelBg,
    accent: skin.accent,
    text: skin.textColor,
    keyline: skin.keyline,
    sticker: skin.sticker,
  };
}

/**
 * HTML is never taken from the agent: it is rebuilt from the slots by the Playbook's renderer,
 * so only connpass-allowed tags and CSS can reach connpass.
 */
export function withRenderedHtml(
  content: ConnpassPageContent,
  brief: Brief | null,
  templates: Record<string, string>,
): ConnpassPageContent {
  const { html: _agentHtml, ...rest } = content as ConnpassPageContent & { html?: string };
  const skin = skinFromBrief(brief);
  const { html, warnings } = renderConnpassPage({ ...rest, skin }, templates);
  return { ...rest, skin, html, renderWarnings: warnings };
}

/** Fill `imageUrl` of the sections an image slot names (`imageSlots[].id` = section id). */
export function setSectionImages(
  content: ConnpassPageContent,
  urls: Record<string, string>,
): ConnpassPageContent {
  return {
    ...content,
    sections: content.sections.map((s) =>
      urls[s.id] !== undefined ? { ...s, slots: { ...s.slots, imageUrl: urls[s.id] || null } } : s,
    ),
  };
}
