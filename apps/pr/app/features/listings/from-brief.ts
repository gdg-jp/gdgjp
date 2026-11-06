import type { EventListing, ListingPlatform } from "@gdgjp/gdg-lib";
import type { Brief } from "~/features/briefs/brief";

export const LISTING_KIND_PLATFORM: Record<string, ListingPlatform> = {
  luma_publish: "luma",
  techplay_publish: "techplay",
  findy_submit: "findy",
  bevy_publish: "bevy",
};

export const PLATFORM_LABELS: Record<ListingPlatform, string> = {
  luma: "Luma",
  techplay: "TECH PLAY",
  findy: "Findy Conference",
  bevy: "Bevy",
};

export type ListingContent = { platform: ListingPlatform; listing: EventListing };

/**
 * The same facts as connpass, mapped mechanically (no LLM): title from the adopted copy,
 * summary from the connpass page, everything else from the brief. Luma and Bevy point people to
 * connpass unless a person changes it; HTML is never put into a listing.
 */
export function listingFromBrief(input: {
  platform: ListingPlatform;
  brief: Brief;
  organizer: string;
  copyTitle?: string | null;
  pageSummary?: string | null;
  registrationUrl?: string | null;
  imageUrl?: string | null;
}): ListingContent {
  const { brief } = input;
  const summary = (input.pageSummary ?? brief.metaThemes.join("\n")).trim();
  const listing: EventListing = {
    mode: "pointer",
    title: input.copyTitle?.trim() || brief.event.name,
    summary,
    description: [
      summary,
      "",
      `参加登録: ${input.registrationUrl ?? brief.event.connpassUrl ?? ""}`,
    ]
      .join("\n")
      .trim(),
    startAt: brief.event.startAt,
    endAt: brief.event.endAt,
    venue: {
      name: brief.event.venue,
      address: brief.event.address,
      online: brief.event.format !== "onsite",
    },
    capacity: brief.event.capacity,
    feeYen: /無料|free/i.test(brief.event.fee) ? 0 : undefined,
    registrationUrl: input.registrationUrl ?? brief.event.connpassUrl,
    imageUrl: input.imageUrl ?? undefined,
    organizer: { name: input.organizer },
    tags: brief.event.hashtag ? [brief.event.hashtag.replace(/^#/, "")] : undefined,
  };
  return { platform: input.platform, listing: JSON.parse(JSON.stringify(listing)) };
}

/** Plain text a person pastes into the platform's form, field by field. */
export function listingAsText(content: ListingContent): { label: string; value: string }[] {
  const l = content.listing;
  return [
    { label: "イベント名", value: l.title },
    { label: "開始", value: l.startAt },
    { label: "終了", value: l.endAt },
    { label: "会場", value: [l.venue.name, l.venue.address].filter(Boolean).join(" ") },
    { label: "定員", value: l.capacity ? String(l.capacity) : "" },
    { label: "参加費", value: l.feeYen === 0 ? "無料" : "" },
    { label: "申込 URL", value: l.registrationUrl ?? "" },
    { label: "主催", value: l.organizer.name },
    { label: "概要", value: l.summary },
    { label: "説明", value: l.description },
  ].filter((f) => f.value);
}
