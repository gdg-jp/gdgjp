import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWER_TYPE_BY_CODE, CODE_BY_ANSWER_TYPE } from "./survey";

const fixturesDir = join(process.cwd(), "fixtures/html");

describe("survey answer-type mapping", () => {
  it("maps connpass's numeric answer_type codes to the OpenAPI enum", () => {
    expect(ANSWER_TYPE_BY_CODE["1"]).toBe("free_text");
    expect(ANSWER_TYPE_BY_CODE["2"]).toBe("checkbox");
    expect(ANSWER_TYPE_BY_CODE["3"]).toBe("radio");
    expect(ANSWER_TYPE_BY_CODE["4"]).toBe("dropdown");
  });

  it("round-trips through the reverse mapping", () => {
    for (const [code, answerType] of Object.entries(ANSWER_TYPE_BY_CODE)) {
      expect(CODE_BY_ANSWER_TYPE[answerType]).toBe(code);
    }
  });

  const fixture = join(
    fixturesDir,
    "event-edit_アンケートを作成・編集する_アンケートを新規作成をクリック.html",
  );

  it.skipIf(!existsSync(fixture))(
    "matches the AnswerTypesTemplate option values/labels in the fixture",
    () => {
      const html = readFileSync(fixture, "utf8");
      expect(html).toContain('<option value="1" data-has-option="0">フリーテキスト</option>');
      expect(html).toContain('<option value="2" data-has-option="1">チェックボックス</option>');
      expect(html).toContain('<option value="3" data-has-option="1">ラジオボタン</option>');
      expect(html).toContain('<option value="4" data-has-option="1">プルダウン</option>');
    },
  );
});
