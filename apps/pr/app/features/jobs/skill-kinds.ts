/** Draft kind → the Skill whose output schema it follows. */
export const SKILL_FOR_KIND: Record<string, string> = {
  plan: "pr-plan",
  copy: "pr-copy",
  x_post: "pr-x-post",
  ig_post: "pr-x-post",
  connpass_page: "pr-connpass-page",
  connpass_mail: "pr-connpass-mail",
  asset_spec: "pr-asset",
};
