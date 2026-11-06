import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Brief, parseBrief } from "./brief";
import {
  SCALAR_SECTIONS,
  TABLES,
  briefFromForm,
  cellName,
  fieldName,
  scalarValue,
  tableRows,
} from "./brief-form";

const example = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Brief;

/** What a browser would submit for the form rendered from `brief`. */
function formFor(brief: Brief): FormData {
  const form = new FormData();
  for (const section of SCALAR_SECTIONS)
    for (const field of section.fields) form.set(fieldName(field.path), scalarValue(field, brief));
  for (const table of TABLES) {
    tableRows(table, brief).forEach((row, i) => {
      for (const [column, value] of Object.entries(row))
        form.set(cellName(table.id, i, column), value);
    });
  }
  return form;
}

describe("brief form", () => {
  it("round-trips the example brief through the form", () => {
    const parsed = parseBrief(briefFromForm(formFor(example), example));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.brief.event.startAt).toBe(example.event.startAt);
    expect(parsed.brief.sessions).toHaveLength(example.sessions.length);
    expect(parsed.brief.sessions[0]?.flags).toEqual(example.sessions[0]?.flags);
    expect(parsed.brief.event.streamUrls).toEqual(example.event.streamUrls);
    expect(parsed.brief.speakers.find((s) => s.id === "llion")?.tier).toBe("high");
    // Not on the form: kept from the previous version.
    expect(parsed.brief.speakers[0]?.sessionIds).toEqual(example.speakers[0]?.sessionIds);
    expect(parsed.brief.goals.curve).toEqual(example.goals.curve);
  });

  it("drops a removed table row", () => {
    const form = formFor(example);
    for (const key of [...form.keys()]) if (key.startsWith("t.preEvents.0.")) form.delete(key);
    const out = briefFromForm(form, example) as Brief;
    expect(out.preEvents).toHaveLength((example.preEvents?.length ?? 0) - 1);
  });
});
