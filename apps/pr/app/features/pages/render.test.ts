import { readFileSync } from "node:fs";
import { scanHtml } from "@skills/pr-playbook/scripts/checks/index.mjs";
import { describe, expect, it } from "vitest";
import { connpassSectionTemplates } from "~/features/playbook/guides.server";
import { type ConnpassPageContent, setSectionImages, withRenderedHtml } from "./render";

const example = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../skills/pr-connpass-page/references/example-output.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ConnpassPageContent;

describe("withRenderedHtml", () => {
  it("throws the agent's HTML away and renders the slots", () => {
    const agent = { ...example, html: '<div style="border-radius:8px">agent</div>' };
    const out = withRenderedHtml(agent, null, connpassSectionTemplates);
    expect(out.html).not.toContain("border-radius");
    expect(out.html).not.toContain("agent</div>");
    expect(scanHtml(out.html ?? "")).toEqual([]);
    expect(out.html).toContain("開催概要");
  });
  it("uses the brief's skin", () => {
    const brief = { event: { name: "DF" }, skin: { bg: "#4285F4", textColor: "#111111" } } as never;
    expect(withRenderedHtml(example, brief, connpassSectionTemplates).html).toContain(
      "background-color:#4285F4",
    );
  });
  it("fills an image slot's section", () => {
    const filled = setSectionImages(example, { "timetable-image": "https://img.gdgs.jp/tt" });
    const out = withRenderedHtml(filled, null, connpassSectionTemplates);
    expect(out.html).toContain("https://img.gdgs.jp/tt");
  });
});
