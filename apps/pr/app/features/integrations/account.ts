export type AccountKind = "x" | "ig" | "connpass_group";

export type CampaignAccount = {
  id: number;
  campaignId: number;
  kind: AccountKind;
  chapterId: number;
  externalId: string;
  label: string;
  role: "primary" | "mirror";
};

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  x: "X",
  ig: "Instagram",
  connpass_group: "connpass グループ",
};
