import { describe, expect, it } from "vitest";
import { type ApplyFormContext, type ApplyFormInput, validateApplyForm } from "./validate";

const ctx: ApplyFormContext = {
  hasParty: true,
  allowedRoleIds: new Set(["reception", "guide"]),
  timeSlotIds: new Set(["slot_1", "slot_2"]),
};

function validInput(): ApplyFormInput {
  return {
    name: "山田太郎",
    contact: "",
    party: "undecided",
    note: "",
    skills: [{ roleId: "reception", level: "new", pref: 1 }],
    availability: [
      { timeSlotId: "slot_1", value: "o" },
      { timeSlotId: "slot_2", value: "x" },
    ],
  };
}

describe("validateApplyForm", () => {
  it("accepts a fully valid submission", () => {
    expect(validateApplyForm(validInput(), ctx)).toEqual([]);
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(validateApplyForm({ ...validInput(), name: "   " }, ctx)).toContain(
      "表示名を入力してください。",
    );
  });

  it("requires at least one role", () => {
    expect(validateApplyForm({ ...validInput(), skills: [] }, ctx)).toContain(
      "担当できる役割を1つ以上選んでください。",
    );
  });

  it("rejects a role id outside the event's event_roles", () => {
    const input: ApplyFormInput = {
      ...validInput(),
      skills: [{ roleId: "stream", level: "new", pref: 2 }],
    };
    expect(validateApplyForm(input, ctx)).toContain("担当できる役割に不明な値が含まれています。");
  });

  it("rejects a duplicate role", () => {
    const input: ApplyFormInput = {
      ...validInput(),
      skills: [
        { roleId: "reception", level: "new", pref: 1 },
        { roleId: "reception", level: "exp", pref: 2 },
      ],
    };
    expect(validateApplyForm(input, ctx)).toContain("同じ役割が重複して指定されています。");
  });

  it("rejects an invalid level or pref value", () => {
    const badLevel = {
      ...validInput(),
      skills: [{ roleId: "reception", level: "senior", pref: 1 }],
    } as unknown as ApplyFormInput;
    expect(validateApplyForm(badLevel, ctx)).toContain("経験レベルの値が不正です。");

    const badPref = {
      ...validInput(),
      skills: [{ roleId: "reception", level: "new", pref: 3 }],
    } as unknown as ApplyFormInput;
    expect(validateApplyForm(badPref, ctx)).toContain("希望度の値が不正です。");
  });

  it("requires every event time slot to have an availability entry", () => {
    const input = {
      ...validInput(),
      availability: [{ timeSlotId: "slot_1", value: "o" as const }],
    };
    expect(validateApplyForm(input, ctx)).toContain(
      "すべての時間枠について稼働可否を入力してください。",
    );
  });

  it("rejects a time slot id outside the event's time_slots", () => {
    const input = {
      ...validInput(),
      availability: [
        ...validInput().availability,
        { timeSlotId: "slot_ghost", value: "o" as const },
      ],
    };
    expect(validateApplyForm(input, ctx)).toContain("稼働可能時間に不明な時間枠が含まれています。");
  });

  it("rejects a duplicate time slot entry", () => {
    const input = {
      ...validInput(),
      availability: [
        { timeSlotId: "slot_1", value: "o" as const },
        { timeSlotId: "slot_1", value: "x" as const },
        { timeSlotId: "slot_2", value: "o" as const },
      ],
    };
    expect(validateApplyForm(input, ctx)).toContain("同じ時間枠が重複して指定されています。");
  });

  it("rejects an invalid availability value", () => {
    const input = {
      ...validInput(),
      availability: [
        { timeSlotId: "slot_1", value: "maybe" },
        { timeSlotId: "slot_2", value: "o" as const },
      ],
    } as unknown as ApplyFormInput;
    expect(validateApplyForm(input, ctx)).toContain("稼働可否の値が不正です。");
  });

  it("ignores the party field entirely when the event has no party", () => {
    const noPartyCtx: ApplyFormContext = { ...ctx, hasParty: false };
    const input = { ...validInput(), party: "not-a-real-status" } as unknown as ApplyFormInput;
    expect(validateApplyForm(input, noPartyCtx)).toEqual([]);
  });

  it("rejects an invalid party value when the event has a party", () => {
    const input = { ...validInput(), party: "not-a-real-status" } as unknown as ApplyFormInput;
    expect(validateApplyForm(input, ctx)).toContain("懇親会の参加可否の値が不正です。");
  });

  it("allows zero time slots to mean zero required availability entries", () => {
    const noSlotsCtx: ApplyFormContext = { ...ctx, timeSlotIds: new Set() };
    const input = { ...validInput(), availability: [] };
    expect(validateApplyForm(input, noSlotsCtx)).toEqual([]);
  });
});
