import type { RunWikiAgentResult } from "./agent";
export type InquiryOutcome =
  | { kind: "needs_link"; text: string; authorizationUrl: string }
  | { kind: "temporarily_unavailable"; text: string }
  | { kind: "needs_relink"; text: string; authorizationUrl: string }
  | { kind: "answer"; text: string; steps: RunWikiAgentResult["steps"] };
