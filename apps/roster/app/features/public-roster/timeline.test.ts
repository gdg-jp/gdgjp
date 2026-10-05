import { describe, expect, it } from "vitest";
import { buildPersonTimeline } from "./timeline";
import type { PublicAssignment } from "./types";

const SLOTS = [
  { id: "s0", idx: 0, start: "09:00", end: "10:00" },
  { id: "s1", idx: 1, start: "10:00", end: "11:00" },
  { id: "s2", idx: 2, start: "11:00", end: "12:00" },
  { id: "s3", idx: 3, start: "12:00", end: "13:00" },
  { id: "s4", idx: 4, start: "13:00", end: "14:00" },
];

function assignment(
  applicationId: string,
  timeSlotId: string,
  trackId: string,
  roleId: string,
): PublicAssignment {
  return { applicationId, timeSlotId, trackId, roleId };
}

describe("buildPersonTimeline", () => {
  it("merges consecutive slots with the same track+role into one entry", () => {
    const assignments = [
      assignment("me", "s0", "trkA", "reception"),
      assignment("me", "s1", "trkA", "reception"),
      assignment("me", "s2", "trkA", "reception"),
    ];
    const items = buildPersonTimeline(SLOTS.slice(0, 3), assignments, "me");
    expect(items).toEqual([
      {
        kind: "assigned",
        start: "09:00",
        end: "12:00",
        trackId: "trkA",
        roleId: "reception",
        companionIds: [],
      },
    ]);
  });

  it("does not merge across a track change even with the same role", () => {
    const assignments = [
      assignment("me", "s0", "trkA", "reception"),
      assignment("me", "s1", "trkB", "reception"),
    ];
    const items = buildPersonTimeline(SLOTS.slice(0, 2), assignments, "me");
    expect(items).toEqual([
      {
        kind: "assigned",
        start: "09:00",
        end: "10:00",
        trackId: "trkA",
        roleId: "reception",
        companionIds: [],
      },
      {
        kind: "assigned",
        start: "10:00",
        end: "11:00",
        trackId: "trkB",
        roleId: "reception",
        companionIds: [],
      },
    ]);
  });

  it("does not merge across a role change even with the same track", () => {
    const assignments = [
      assignment("me", "s0", "trkA", "reception"),
      assignment("me", "s1", "trkA", "guide"),
    ];
    const items = buildPersonTimeline(SLOTS.slice(0, 2), assignments, "me");
    expect(items.map((i) => (i.kind === "assigned" ? i.roleId : "break"))).toEqual([
      "reception",
      "guide",
    ]);
  });

  it("emits an explicit break for a slot with no assignment, never a silent gap", () => {
    const assignments = [
      assignment("me", "s0", "trkA", "reception"),
      // s1: nothing for "me"
      assignment("me", "s2", "trkA", "reception"),
    ];
    const items = buildPersonTimeline(SLOTS.slice(0, 3), assignments, "me");
    expect(items).toEqual([
      {
        kind: "assigned",
        start: "09:00",
        end: "10:00",
        trackId: "trkA",
        roleId: "reception",
        companionIds: [],
      },
      { kind: "break", start: "10:00", end: "11:00" },
      {
        kind: "assigned",
        start: "11:00",
        end: "12:00",
        trackId: "trkA",
        roleId: "reception",
        companionIds: [],
      },
    ]);
  });

  it("merges consecutive break slots into a single break entry", () => {
    const items = buildPersonTimeline(SLOTS.slice(0, 3), [], "me");
    expect(items).toEqual([{ kind: "break", start: "09:00", end: "12:00" }]);
  });

  it("computes companions as the union across the whole merged range, including a mid-range swap", () => {
    const assignments = [
      assignment("me", "s0", "trkA", "reception"),
      assignment("alice", "s0", "trkA", "reception"),
      assignment("me", "s1", "trkA", "reception"),
      assignment("bob", "s1", "trkA", "reception"), // alice left, bob arrived
      assignment("me", "s2", "trkA", "reception"),
      // s2: nobody else — a slot within the range with zero companions
      // must not erase bob/alice from the range-wide union.
    ];
    const items = buildPersonTimeline(SLOTS.slice(0, 3), assignments, "me");
    expect(items).toEqual([
      {
        kind: "assigned",
        start: "09:00",
        end: "12:00",
        trackId: "trkA",
        roleId: "reception",
        companionIds: ["alice", "bob"],
      },
    ]);
  });

  it("a solo slot has an empty companionIds array (caller renders 'この枠はひとりです')", () => {
    const items = buildPersonTimeline(
      SLOTS.slice(0, 1),
      [assignment("me", "s0", "trkA", "reception")],
      "me",
    );
    expect(items[0]).toMatchObject({ companionIds: [] });
  });

  it("never includes the person themselves in their own companionIds", () => {
    const items = buildPersonTimeline(
      SLOTS.slice(0, 1),
      [assignment("me", "s0", "trkA", "reception")],
      "me",
    );
    expect((items[0] as { companionIds: string[] }).companionIds).not.toContain("me");
  });

  it("a full day of nothing assigned is a single break spanning the whole range", () => {
    const items = buildPersonTimeline(SLOTS, [], "ghost");
    expect(items).toEqual([{ kind: "break", start: "09:00", end: "14:00" }]);
  });

  it("ignores other people's assignments when building this person's own slot map", () => {
    const assignments = [assignment("someone-else", "s0", "trkA", "reception")];
    const items = buildPersonTimeline(SLOTS.slice(0, 1), assignments, "me");
    expect(items).toEqual([{ kind: "break", start: "09:00", end: "10:00" }]);
  });
});
