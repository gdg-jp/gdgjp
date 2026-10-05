import { describe, expect, it } from "vitest";
import type { Demand } from "~/features/demand/types";
import {
  type SupplyApplicant,
  computeSlotSupplyDemand,
  computeSupplyDemand,
  summarizeShortages,
  toSupplyApplicant,
} from "./supply";

const SLOT_1 = "slot_1";
const SLOT_2 = "slot_2";
const STREAM = "stream";
const RECEPTION = "reception";

function demand(overrides: Partial<Demand> = {}): Demand {
  return {
    timeSlotId: SLOT_1,
    trackId: "track_a",
    roleId: STREAM,
    min: 1,
    ideal: 1,
    leadMin: 0,
    newMax: 99,
    ...overrides,
  };
}

function applicant(overrides: Partial<SupplyApplicant> = {}): SupplyApplicant {
  return {
    applicationId: "app_1",
    withdrawn: false,
    skills: new Map(),
    availability: new Map(),
    ...overrides,
  };
}

describe("computeSlotSupplyDemand — head vs lead shortage (docs/roster/05-staff-supply-demand.md 回帰)", () => {
  it("reports a lead shortage when headcount is met but nobody is lead-level — this stage's entire reason for existing", () => {
    const demands = [demand({ min: 2, leadMin: 1 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
      applicant({
        applicationId: "a2",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.tight).toEqual([{ roleId: STREAM, kind: "lead", lack: 1 }]);
  });

  it("reports only a head shortage when headcount itself is short — never lead in the same breath", () => {
    const demands = [demand({ min: 3, leadMin: 1 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.tight).toEqual([{ roleId: STREAM, kind: "head", lack: 2 }]);
  });

  it("reports neither when headcount and lead minimum are both met", () => {
    const demands = [demand({ min: 1, leadMin: 1 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "lead"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.tight).toEqual([]);
  });
});

describe("computeSlotSupplyDemand — exclusions", () => {
  it("does not count a withdrawn applicant toward available or a role's candidate count", () => {
    const demands = [demand({ min: 2, leadMin: 0 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
      applicant({
        applicationId: "a2",
        withdrawn: true,
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(1);
    expect(result.tight).toEqual([{ roleId: STREAM, kind: "head", lack: 1 }]);
  });

  it("does not count an `x` (unavailable) applicant toward available or a role's candidate count", () => {
    const demands = [demand({ min: 1, leadMin: 0 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "x"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(0);
    expect(result.tight).toEqual([{ roleId: STREAM, kind: "head", lack: 1 }]);
  });

  it("treats a missing availability entry the same as `x`, never as implicitly available", () => {
    const demands = [demand({ min: 1, leadMin: 0 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map(), // no entry at all for SLOT_1
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(0);
    expect(result.tight).toEqual([{ roleId: STREAM, kind: "head", lack: 1 }]);
  });

  it("does not count `d` (soft-available) staff as unavailable — they count toward available and role candidates", () => {
    const demands = [demand({ min: 1, leadMin: 0 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([[SLOT_1, "d"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(1);
    expect(result.tight).toEqual([]);
  });

  it("does not count an applicant who can't take the role, even if available", () => {
    const demands = [demand({ min: 1, leadMin: 0 })];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[RECEPTION, "lead"]]), // can't take STREAM
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(1); // available overall, just not for this role
    expect(result.tight).toEqual([{ roleId: STREAM, kind: "head", lack: 1 }]);
  });
});

describe("computeSlotSupplyDemand — cross-track aggregation", () => {
  it("sums the same role's demand across multiple tracks (e.g. shared 全体 + a per-track row) into one shortage", () => {
    const demands = [
      demand({ trackId: "shared", roleId: RECEPTION, min: 1, leadMin: 0 }),
      demand({ trackId: "party", roleId: RECEPTION, min: 1, leadMin: 0 }),
    ];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[RECEPTION, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    // roleMin = 1 + 1 = 2; only 1 candidate available -> lack 1, not two
    // independent shortages for the same role.
    expect(result.tight).toEqual([{ roleId: RECEPTION, kind: "head", lack: 1 }]);
  });

  it("sums leadMin across tracks the same way as min", () => {
    const demands = [
      demand({ trackId: "shared", roleId: RECEPTION, min: 1, leadMin: 1 }),
      demand({ trackId: "party", roleId: RECEPTION, min: 1, leadMin: 1 }),
    ];
    const applicants = [
      applicant({
        applicationId: "a1",
        skills: new Map([[RECEPTION, "exp"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
      applicant({
        applicationId: "a2",
        skills: new Map([[RECEPTION, "lead"]]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    // headcount met (2 candidates >= min 2), but only 1 lead against leadMin 2.
    expect(result.tight).toEqual([{ roleId: RECEPTION, kind: "lead", lack: 1 }]);
  });
});

describe("computeSlotSupplyDemand — need/available slot totals and skip rules", () => {
  it("sums `need` across every (track, role) demand row for the slot, independent of role-level tight", () => {
    const demands = [
      demand({ trackId: "shared", roleId: RECEPTION, min: 2 }),
      demand({ trackId: "track_a", roleId: STREAM, min: 3 }),
    ];
    const applicants = [
      applicant({
        skills: new Map([
          [RECEPTION, "exp"],
          [STREAM, "exp"],
        ]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.need).toBe(5);
  });

  it("skips a role with roleMin === 0 (no minimum requirement) even if it has demand rows", () => {
    const demands = [demand({ min: 0, leadMin: 0, ideal: 3 })];
    const applicants: SupplyApplicant[] = [];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.tight).toEqual([]);
  });

  it("counts `available` once per staff member regardless of how many roles they can take", () => {
    const demands = [
      demand({ trackId: "shared", roleId: RECEPTION, min: 1 }),
      demand({ trackId: "track_a", roleId: STREAM, min: 1 }),
    ];
    const applicants = [
      applicant({
        skills: new Map([
          [RECEPTION, "exp"],
          [STREAM, "exp"],
        ]),
        availability: new Map([[SLOT_1, "o"]]),
      }),
    ];

    const result = computeSlotSupplyDemand(SLOT_1, demands, applicants);

    expect(result.available).toBe(1);
  });
});

describe("computeSupplyDemand", () => {
  it("computes one snapshot per time slot, grouping demand rows by their own slot only", () => {
    const demands = [
      demand({ timeSlotId: SLOT_1, roleId: STREAM, min: 2, leadMin: 0 }),
      demand({ timeSlotId: SLOT_2, roleId: STREAM, min: 1, leadMin: 0 }),
    ];
    const applicants = [
      applicant({
        skills: new Map([[STREAM, "exp"]]),
        availability: new Map([
          [SLOT_1, "o"],
          [SLOT_2, "x"],
        ]),
      }),
    ];

    const results = computeSupplyDemand([SLOT_1, SLOT_2], demands, applicants);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      timeSlotId: SLOT_1,
      tight: [{ roleId: STREAM, kind: "head", lack: 1 }],
    });
    expect(results[1]).toMatchObject({
      timeSlotId: SLOT_2,
      tight: [{ roleId: STREAM, kind: "head", lack: 1 }],
    });
  });

  it("preserves the caller's time slot order, including a slot with no demand at all", () => {
    const results = computeSupplyDemand([SLOT_2, SLOT_1], [], []);
    expect(results.map((r) => r.timeSlotId)).toEqual([SLOT_2, SLOT_1]);
    expect(results.every((r) => r.need === 0 && r.tight.length === 0)).toBe(true);
  });
});

describe("summarizeShortages", () => {
  it("deduplicates the same (role, kind) shortage seen in multiple time slots into one entry", () => {
    const slots = computeSupplyDemand(
      [SLOT_1, SLOT_2],
      [
        demand({ timeSlotId: SLOT_1, roleId: STREAM, min: 1, leadMin: 0 }),
        demand({ timeSlotId: SLOT_2, roleId: STREAM, min: 1, leadMin: 0 }),
      ],
      [],
    );

    expect(summarizeShortages(slots)).toEqual([{ roleId: STREAM, kind: "head" }]);
  });

  it("keeps head and lead shortages for the same role as distinct summary entries", () => {
    const slots = computeSupplyDemand(
      [SLOT_1, SLOT_2],
      [
        demand({ timeSlotId: SLOT_1, roleId: STREAM, min: 3, leadMin: 0 }),
        demand({ timeSlotId: SLOT_2, roleId: STREAM, min: 1, leadMin: 1 }),
      ],
      [
        applicant({
          skills: new Map([[STREAM, "exp"]]),
          availability: new Map([
            [SLOT_1, "o"],
            [SLOT_2, "o"],
          ]),
        }),
      ],
    );

    expect(summarizeShortages(slots)).toEqual([
      { roleId: STREAM, kind: "head" },
      { roleId: STREAM, kind: "lead" },
    ]);
  });

  it("returns an empty list when nothing is short", () => {
    expect(summarizeShortages([{ timeSlotId: SLOT_1, need: 0, available: 0, tight: [] }])).toEqual(
      [],
    );
  });
});

describe("toSupplyApplicant", () => {
  it("builds skills/availability maps keyed by roleId/timeSlotId from the domain records", () => {
    const result = toSupplyApplicant(
      { id: "app_1", withdrawn: false },
      [{ roleId: STREAM, level: "lead" }],
      [{ timeSlotId: SLOT_1, value: "o" }],
    );

    expect(result.applicationId).toBe("app_1");
    expect(result.withdrawn).toBe(false);
    expect(result.skills.get(STREAM)).toBe("lead");
    expect(result.availability.get(SLOT_1)).toBe("o");
  });

  it("passes through withdrawn as-is regardless of skills/availability content", () => {
    const result = toSupplyApplicant(
      { id: "app_2", withdrawn: true },
      [{ roleId: STREAM, level: "exp" }],
      [{ timeSlotId: SLOT_1, value: "o" }],
    );
    expect(result.withdrawn).toBe(true);
  });

  it("produces an empty map for a role/slot the applicant has no row for", () => {
    const result = toSupplyApplicant({ id: "app_3", withdrawn: false }, [], []);
    expect(result.skills.size).toBe(0);
    expect(result.availability.size).toBe(0);
  });
});
