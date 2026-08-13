import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapEventStatus, parseEventModel } from "./event-model";

const fixturesDir = join(process.cwd(), "fixtures/html");

function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

describe("parseEventModel", () => {
  it("returns null when no model is embedded", () => {
    expect(parseEventModel("<html><body>no model here</body></html>")).toBeNull();
  });

  it("parses a minimal embedded model, tolerating braces inside string values", () => {
    const html = `<script>
      model: new Models.Event({"id": 1, "title": "a { weird } title", "series": null}, {parse: true}),
    </script>`;
    const model = parseEventModel(html);
    expect(model).not.toBeNull();
    expect(model?.id).toBe(1);
    expect(model?.title).toBe("a { weird } title");
    expect(model?.series).toBeNull();
  });

  it.skipIf(!existsSync(fixturePath("event-edit.html")))(
    "parses the model embedded in event-edit.html",
    () => {
      const html = readFileSync(fixturePath("event-edit.html"), "utf8");
      const model = parseEventModel(html);
      expect(model).not.toBeNull();
      expect(typeof model?.id).toBe("number");
      expect(model?.status).toBe("draft");
      expect(model?.event_type).toBe("participation");
      expect(Array.isArray(model?.participation_types)).toBe(true);
    },
  );

  const otherFixtures = [
    "event-edit_主催者をクリック.html",
    "event-edit_サブイベントの編集画面.html",
    "event-edit_サブイベントを作成するをクリック.html",
    "subevent-published.html",
    "subevent-published_イベントを中止するをクリック.html",
    "イベント編集_会場設定済み.html",
  ] as const;

  for (const fixture of otherFixtures) {
    it.skipIf(!existsSync(fixturePath(fixture)))(`parses the model embedded in ${fixture}`, () => {
      const html = readFileSync(fixturePath(fixture), "utf8");
      const model = parseEventModel(html);
      expect(model).not.toBeNull();
      expect(typeof model?.id).toBe("number");
      expect(typeof model?.title).toBe("string");
    });
  }

  it.skipIf(!existsSync(fixturePath("subevent-published.html")))(
    "confirms a published, past event reports status 'ended' in the raw model",
    () => {
      const html = readFileSync(fixturePath("subevent-published.html"), "utf8");
      const model = parseEventModel(html);
      expect(model?.status).toBe("ended");
    },
  );

  it.skipIf(!existsSync(fixturePath("イベント編集_会場設定済み.html")))(
    "confirms the model's place field stays null even once a venue is saved " +
      "(connpass renders the venue via a separate DOM table, not the model)",
    () => {
      const html = readFileSync(fixturePath("イベント編集_会場設定済み.html"), "utf8");
      const model = parseEventModel(html);
      expect(model?.place).toBeNull();
      expect(html).toContain("LINEヤフー株式会社 大阪オフィス");
    },
  );
});

describe("mapEventStatus", () => {
  it("maps connpass status literals to the OpenAPI EventStatus enum", () => {
    expect(mapEventStatus("draft")).toBe("draft");
    expect(mapEventStatus("public")).toBe("published");
    expect(mapEventStatus("ended")).toBe("published");
    expect(mapEventStatus("cancel")).toBe("canceled");
    expect(mapEventStatus("anything-else")).toBe("canceled");
  });
});
