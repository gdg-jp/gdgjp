import { mulberry32 } from "./random";
import type { Demand, Level, Pref, SolverApplication, SolverInput } from "./types";

export type FixtureSize = {
  staffCount: number;
  slotCount: number;
  roleCount: number;
  trackCount: number;
  seed?: number;
};

export function buildFixture(size: FixtureSize): SolverInput {
  const { staffCount, slotCount, roleCount, trackCount, seed = 1 } = size;
  const rng = mulberry32(seed);

  const roles = Array.from({ length: roleCount }, (_, i) => ({ id: `role-${i}` }));
  const tracks = Array.from({ length: trackCount }, (_, i) => ({ id: `track-${i}` }));
  const slots = Array.from({ length: slotCount }, (_, i) => ({ id: `slot-${i}`, idx: i }));

  const applications: SolverApplication[] = Array.from({ length: staffCount }, (_, i) => {
    const skills: Record<string, { level: Level; pref: Pref }> = {};
    for (const role of roles) {
      if (rng() >= 0.5) continue;
      const levelRoll = rng();
      const level: Level = levelRoll < 0.15 ? "lead" : levelRoll < 0.55 ? "exp" : "new";
      const pref: Pref = rng() < 0.3 ? 1 : 2;
      skills[role.id] = { level, pref };
    }
    if (Object.keys(skills).length === 0) {
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
        if (rng() >= 0.25) continue;
        const min = 1 + Math.floor(rng() * 2);
        const ideal = min + Math.floor(rng() * 2);
        const leadMin = rng() < 0.25 ? 1 : 0;
        const newMax = 1 + Math.floor(rng() * 2);
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

export function buildSmallFixture(seed = 7): SolverInput {
  return buildFixture({ staffCount: 16, slotCount: 10, roleCount: 6, trackCount: 4, seed });
}

export function buildBenchFixture(seed = 1): SolverInput {
  return buildFixture({ staffCount: 100, slotCount: 60, roleCount: 10, trackCount: 4, seed });
}
