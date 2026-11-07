import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  connpassMain,
  googleExportUrl,
  googleTarget,
  htmlToText,
  imagesIn,
  maskContacts,
  titleOf,
} from "./source";

const connpass = readFileSync(
  new URL("../../../fixtures/sources/connpass-event.html", import.meta.url),
  "utf8",
);

describe("connpassMain", () => {
  it("keeps the event and drops the participant lists", () => {
    const text = htmlToText(connpassMain(connpass) ?? "");
    expect(text).toContain("開発の工夫を語るLT会 in 神戸");
    expect(text).toContain("開始（UTC）: 2026-09-15T10:00:00Z");
    expect(text).toContain("OPTiM Club Kobe");
    expect(text).toContain("参加費無料");
    expect(text).not.toContain("参加者（14人）");
    expect(text).not.toContain("参加を申し込みました");
  });
});

describe("page helpers", () => {
  it("reads the title and the images worth reading", () => {
    expect(titleOf(connpass)).toContain("開発の工夫を語るLT会");
    const images = imagesIn(connpassMain(connpass) ?? "", "https://connpass.com/event/405133/");
    expect(images[0]).toBe("https://img.gdgs.jp/NWbxmMod");
    expect(images.every((u) => !u.includes("thumbs/participant"))).toBe(true);
  });
  it("turns markup into lines and masks contact details", () => {
    expect(htmlToText("<p>a&amp;b</p><script>x</script><div>c<br>d</div>")).toBe("a&b\nc\nd");
    expect(maskContacts("連絡先 hoge@example.com / 06-1234-5678")).toBe(
      "連絡先 ［メール］ / ［電話］",
    );
  });
});

describe("googleTarget", () => {
  it("knows Docs, Slides, Sheets, Drive files and folders", () => {
    expect(googleTarget("https://docs.google.com/document/d/abc_1/edit?usp=sharing")).toEqual({
      kind: "doc",
      id: "abc_1",
    });
    expect(googleTarget("https://docs.google.com/presentation/d/p1/edit")?.kind).toBe("slides");
    expect(googleTarget("https://docs.google.com/spreadsheets/d/s1/edit#gid=0")?.kind).toBe(
      "sheet",
    );
    expect(googleTarget("https://drive.google.com/file/d/f1/view")).toEqual({
      kind: "file",
      id: "f1",
    });
    expect(googleTarget("https://drive.google.com/drive/folders/d1")?.kind).toBe("folder");
    expect(googleTarget("https://example.com/")).toBeNull();
    expect(googleExportUrl({ kind: "doc", id: "x" })).toBe(
      "https://docs.google.com/document/d/x/export?format=html",
    );
    expect(googleExportUrl({ kind: "folder", id: "x" })).toBeNull();
  });
});
