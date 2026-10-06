import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AvailabilityGrid,
  type AvailabilityGridSlot,
  availabilityShortcuts,
} from "./AvailabilityGrid";

const SLOTS: AvailabilityGridSlot[] = [
  { id: "s0900", start: "09:00", end: "10:00", phaseName: "開場前" },
  { id: "s1100", start: "11:00", end: "12:00", phaseName: null },
  { id: "s1300", start: "13:00", end: "14:00", phaseName: null },
];

function render(values: Record<string, "o" | "d" | "x">) {
  return renderToStaticMarkup(
    createElement(AvailabilityGrid, {
      timeSlots: SLOTS,
      values,
      onChange: () => undefined,
      onBulkChange: () => undefined,
    }),
  );
}

function checkedLabels(html: string): string[] {
  return [
    ...html.matchAll(/<label[^>]*><input type="checkbox"[^>]*checked=""[^>]*\/>([^<]*)/g),
  ].map((match) => match[1] ?? "");
}

describe("AvailabilityGrid", () => {
  it("asks only for unavailable slots and explains how unselected slots and △ are used", () => {
    const html = render({ s0900: "o", s1100: "o", s1300: "o" });

    expect(html).toContain("参加できない時間だけ選んでください。");
    expect(html).toContain("選ばなかった時間は参加できるものとして扱います。");
    expect(html).toContain("△ は、参加できる人で埋まらない場合にだけ割り当てられます。");
    expect(html.match(/△ できれば避けたい/g)).toHaveLength(3);
    expect(html.match(/× 参加できない/g)).toHaveLength(3);
    expect(html).not.toContain('type="radio"');
    expect(checkedLabels(html)).toEqual([]);
  });

  it("submits every slot through one hidden o/d/x input and marks only △/× choices", () => {
    const html = render({ s0900: "d", s1100: "x" });

    expect(html).toContain('<input type="hidden" name="avail_s0900" value="d"/>');
    expect(html).toContain('<input type="hidden" name="avail_s1100" value="x"/>');
    // A slot without an answer is treated as available.
    expect(html).toContain('<input type="hidden" name="avail_s1300" value="o"/>');
    expect(checkedLabels(html)).toEqual(["△ できれば避けたい", "× 参加できない"]);
  });

  it("clears every mark, or adds × to one half while keeping the other half's answers", () => {
    const values = { s0900: "d", s1100: "o", s1300: "d" } as const;
    const [clearAll, morning, afternoon] = availabilityShortcuts(values);
    const apply = (compute: (slot: AvailabilityGridSlot) => string) =>
      Object.fromEntries(SLOTS.map((slot) => [slot.id, compute(slot)]));

    expect([clearAll?.label, morning?.label, afternoon?.label]).toEqual([
      "すべて解除",
      "午前は不可",
      "午後は不可",
    ]);
    expect(apply(clearAll?.compute ?? (() => ""))).toEqual({ s0900: "o", s1100: "o", s1300: "o" });
    expect(apply(morning?.compute ?? (() => ""))).toEqual({ s0900: "x", s1100: "x", s1300: "d" });
    expect(apply(afternoon?.compute ?? (() => ""))).toEqual({
      s0900: "d",
      s1100: "o",
      s1300: "x",
    });
  });
});
