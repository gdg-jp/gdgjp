import type { PartyStatus } from "~/features/applications/types";

/**
 * The wire contract for `/r/:viewToken` (docs/roster/09-share-public-views.md
 * "Design" §3: "公開ローダーが返してよいもの"). This is the exhaustive list —
 * `PublicRosterData` has no field beyond what's declared here, and
 * `public-roster.server.ts#buildPublicRosterData` is the only place that
 * constructs one. **`PublicStaff` may carry `id`/`name`/`party` and NOTHING
 * else** — no `email`, `contact`, `note`, `skills`, or `availability`
 * (docs/roster/adr.md ADR-005's constraint plus the top-level PII rule for
 * this stage). `public-roster.server.test.ts` asserts on the actual returned
 * key set, not just on this type, since a structural type can't catch a
 * caller widening an object literal at the call site.
 */

export type PublicEventSummary = {
  /** Parent event identity and display name, retained for existing consumers. */
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  hasParty: boolean;
  /** Schedule identity and timing for the selected published sheet. */
  sheet: { name: string; date: string; startTime: string; endTime: string };
};

export type PublicSlot = { id: string; idx: number; startTime: string; endTime: string };
export type PublicTrack = { id: string; name: string; color: string };
export type PublicRole = { id: string; name: string };

/** Deliberately 3 fields only — see the module doc comment. */
export type PublicStaff = { id: string; name: string; party: PartyStatus };

export type PublicAssignment = {
  applicationId: string;
  timeSlotId: string;
  trackId: string;
  roleId: string;
};

export type PublicRosterData = {
  event: PublicEventSummary;
  slots: PublicSlot[];
  tracks: PublicTrack[];
  roles: PublicRole[];
  staff: PublicStaff[];
  assignments: PublicAssignment[];
};

/**
 * Roster-sheet visibility gates which variant this is. The `false` branch carries only the summary
 * (including selected-sheet metadata when available) — no `data` key at all — so a private sheet's
 * assignments/staff never enter the loader's return value, let alone the rendered HTML
 * or the hydration payload (docs/roster/09-share-public-views.md "制約":
 * "canView が false のとき 404 にしない。200 で「まだ公開されていません」").
 */
export type PublicRosterView =
  | { published: false; event: PublicEventSummary }
  | { published: true; data: PublicRosterData };

export const PUBLIC_VIEWS = ["staff", "role", "person", "party"] as const;
export type PublicView = (typeof PUBLIC_VIEWS)[number];

export const PUBLIC_VIEW_LABELS: Record<PublicView, string> = {
  staff: "スタッフ別",
  role: "役割別",
  person: "個人",
  party: "懇親会",
};
