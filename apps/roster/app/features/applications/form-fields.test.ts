import { describe, expect, it } from "vitest";
import { parseAvailabilityFromForm, parseSkillsFromForm } from "./form-fields";

describe("parseSkillsFromForm", () => {
  it("includes only checked roles, with their level/pref", () => {
    const form = new FormData();
    form.set("role_reception", "on");
    form.set("level_reception", "lead");
    form.set("pref_reception", "1");
    // guide not checked — its level/pref inputs wouldn't even exist in the DOM.
    const skills = parseSkillsFromForm(form, ["reception", "guide"]);
    expect(skills).toEqual([{ roleId: "reception", level: "lead", pref: 1 }]);
  });

  it("defaults level/pref when a checked role's selects are missing", () => {
    const form = new FormData();
    form.set("role_reception", "on");
    const skills = parseSkillsFromForm(form, ["reception"]);
    expect(skills).toEqual([{ roleId: "reception", level: "new", pref: 2 }]);
  });

  it("ignores role ids outside allowedRoleIds even if present in the form", () => {
    const form = new FormData();
    form.set("role_stream", "on");
    expect(parseSkillsFromForm(form, ["reception"])).toEqual([]);
  });

  it("returns an empty array when nothing is checked", () => {
    expect(parseSkillsFromForm(new FormData(), ["reception", "guide"])).toEqual([]);
  });
});

describe("parseAvailabilityFromForm", () => {
  it("reads one entry per time slot present in the form", () => {
    const form = new FormData();
    form.set("avail_slot_1", "o");
    form.set("avail_slot_2", "x");
    expect(parseAvailabilityFromForm(form, ["slot_1", "slot_2"])).toEqual([
      { timeSlotId: "slot_1", value: "o" },
      { timeSlotId: "slot_2", value: "x" },
    ]);
  });

  it("omits a time slot with no entry rather than inventing a default", () => {
    const form = new FormData();
    form.set("avail_slot_1", "o");
    expect(parseAvailabilityFromForm(form, ["slot_1", "slot_2"])).toEqual([
      { timeSlotId: "slot_1", value: "o" },
    ]);
  });

  it("ignores a time slot id outside timeSlotIds even if present in the form", () => {
    const form = new FormData();
    form.set("avail_slot_ghost", "o");
    expect(parseAvailabilityFromForm(form, ["slot_1"])).toEqual([]);
  });
});
