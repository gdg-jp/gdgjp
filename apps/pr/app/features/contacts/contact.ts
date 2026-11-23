export const CONTACT_KINDS = [
  "person",
  "org",
  "community",
  "circle",
  "lab",
  "school",
  "company",
  "media",
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  person: "人",
  org: "団体",
  community: "コミュニティ",
  circle: "サークル",
  lab: "研究室・研究機関",
  school: "学校",
  company: "企業",
  media: "SNS・媒体・イベント",
};

export type Contact = {
  id: number;
  chapterId: number;
  organization: string;
  kind: ContactKind;
  name: string;
  relation: string | null;
  channel: string | null;
  ownerUserId: string | null;
  wikiPerson: string | null;
  wikiPath: string | null;
  syncedAt: number | null;
  manual: boolean;
  lastUsedCampaignId: number | null;
  notes: string | null;
  outcomes: { campaignId: number; outcome: string; note?: string; at: number }[];
};

export function organizationKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
