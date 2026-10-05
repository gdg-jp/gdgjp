import { mulberry32 } from "./random";
import type { Demand, Level, Pref, SolverApplication, SolverInput } from "./types";

export type FixtureSize = {
  staffCount: number;
  slotCount: number;
  roleCount: number;
  trackCount: number;
  seed?: number;
};

/**
 * Deterministic synthetic `SolverInput` generator for tests and the scale
 * bench — no D1, no fixture files on disk. Driven by `mulberry32` (the
 * solver's own PRNG, never `Math.random()`), so a given `seed` builds a
 * byte-identical input every time, on every machine.
 *
 * The generated demand density (~25% of slot×track×role combinations) and
 * skill coverage (~50% of staff can do a given role) are chosen to produce a
 * realistically mixed outcome when solved — some cells fully satisfied, some
 * short, some newcomer-only — so tests exercise every phase of the 7-step
 * flow (docs/roster/06-solver.md Design §4) rather than a trivially-solved
 * or trivially-impossible input.
 */
export function buildFixture(size: FixtureSize): SolverInput {
  const { staffCount, slotCount, roleCount, trackCount, seed = 1 } = size;
  const rng = mulberry32(seed);

  const roles = Array.from({ length: roleCount }, (_, i) => ({ id: `role-${i}` }));
  const tracks = Array.from({ length: trackCount }, (_, i) => ({ id: `track-${i}` }));
  const slots = Array.from({ length: slotCount }, (_, i) => ({ id: `slot-${i}`, idx: i }));

  const applications: SolverApplication[] = Array.from({ length: staffCount }, (_, i) => {
    const skills: Record<string, { level: Level; pref: Pref }> = {};
    for (const role of roles) {
      if (rng() >= 0.5) continue; // ~50% skill coverage per role
      const levelRoll = rng();
      const level: Level = levelRoll < 0.15 ? "lead" : levelRoll < 0.55 ? "exp" : "new";
      const pref: Pref = rng() < 0.3 ? 1 : 2;
      skills[role.id] = { level, pref };
    }
    if (Object.keys(skills).length === 0) {
      // Guarantee every staff member can do at least one role, so nobody in
      // the fixture is structurally dead weight.
      skills[roles[0].id] = { level: "new", pref: 2 };
    }

    const availability: Record<string, "o" | "d" | "x"> = {};
    for (const slot of slots) {
      const roll = rng();
      availability[slot.id] = roll < 0.7 ? "o" : roll < 0.85 ? "d" : "x";
    }

    return { id: `app-${i}`, withdrawn: rng() < 0.05, skills, availability };
  });

  const demands = new Map<string, Demand>();
  for (const slot of slots) {
    for (const track of tracks) {
      for (const role of roles) {
        if (rng() >= 0.25) continue; // only a subset of cells carry demand
        const min = 1 + Math.floor(rng() * 2); // 1-2
        const ideal = min + Math.floor(rng() * 2); // min..min+1
        const leadMin = rng() < 0.25 ? 1 : 0;
        const newMax = 1 + Math.floor(rng() * 2); // 1-2
        demands.set(`${slot.id}|${track.id}|${role.id}`, { min, ideal, leadMin, newMax });
      }
    }
  }

  return {
    slots,
    tracks,
    roles,
    demands,
    applications,
    options: { noSoloNewcomer: true, maxConsecutive: 4, seed },
  };
}

/** index.md's illustrative scale for manual review: 10 slots / 4 tracks /
 * 6 roles / 16 staff (a few newcomers, 1-2 leads per role). */
export function buildSmallFixture(seed = 7): SolverInput {
  return buildFixture({ staffCount: 16, slotCount: 10, roleCount: 6, trackCount: 4, seed });
}

/** The Stage 06 required scale bench (docs/roster/06-solver.md Design §8 /
 * docs/roster/adr.md ADR-004): 100 staff x 60 slots x 10 roles x 4 tracks. */
export function buildBenchFixture(seed = 1): SolverInput {
  return buildFixture({ staffCount: 100, slotCount: 60, roleCount: 10, trackCount: 4, seed });
}
