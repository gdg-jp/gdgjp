import type { EventListing, ListingPlatform } from "@gdgjp/gdg-lib";

export const LISTING_PLATFORMS: readonly ListingPlatform[] = ["luma", "techplay", "findy", "bevy"];

/**
 * How each platform is written. Every one is `undecided` until its pre-check in
 * docs/plans/pr/06-luma-techplay-findy.md §1 picks one method (official API, internal API or
 * Browser Run); no method is implemented before that, so createListing answers not_supported.
 */
export const LISTING_METHODS: Record<ListingPlatform, "undecided"> = {
  luma: "undecided",
  techplay: "undecided",
  findy: "undecided",
  bevy: "undecided",
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const HTML = /<\s*[a-z][^>]*>/i;

/** Platform-neutral checks before any job: required fields, pointer URL, no HTML. */
export function validateListing(
  raw: unknown,
): { ok: true; listing: EventListing } | { ok: false; error: string } {
  const l = raw as Partial<EventListing> | null;
  if (!l || typeof l !== "object") return { ok: false, error: "invalid_listing" };
  for (const field of ["title", "summary", "description", "startAt", "endAt"] as const)
    if (typeof l[field] !== "string" || !l[field]?.trim())
      return { ok: false, error: `missing:${field}` };
  if (!l.venue?.name?.trim()) return { ok: false, error: "missing:venue.name" };
  if (!l.organizer?.name?.trim()) return { ok: false, error: "missing:organizer.name" };
  if (l.mode !== "mirror" && l.mode !== "pointer") return { ok: false, error: "missing:mode" };
  if (l.mode === "pointer" && !/^https:\/\//.test(l.registrationUrl ?? ""))
    return { ok: false, error: "missing:registrationUrl" };
  if (!ISO.test(l.startAt as string) || !ISO.test(l.endAt as string))
    return { ok: false, error: "invalid:time" };
  if (Date.parse(l.endAt as string) <= Date.parse(l.startAt as string))
    return { ok: false, error: "invalid:time" };
  if (HTML.test(l.description as string) || HTML.test(l.summary as string))
    return { ok: false, error: "invalid:html" };
  return { ok: true, listing: l as EventListing };
}
