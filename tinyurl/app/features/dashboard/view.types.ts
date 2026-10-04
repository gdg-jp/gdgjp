import type { LinkSortKey } from "~/features/dashboard/display-preferences";
export type Scope = "all" | "own" | "shared";

export type SortKey = LinkSortKey;

export type CampaignFilter = "all" | "unclassified" | `campaign:${number}` | `channel:${number}`;

export type FolderFilter = "all" | "unfiled" | `folder:${number}`;
