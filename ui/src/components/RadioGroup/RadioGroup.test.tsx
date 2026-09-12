import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";

describe("RadioGroup", () => {
  it("keeps checked and unchecked indicators mounted for both transitions", () => {
    const html = renderToStaticMarkup(
      <RadioGroup aria-label="参加方法" defaultValue="venue">
        <RadioGroupItem value="venue" />
        <RadioGroupItem value="online" />
      </RadioGroup>,
    );

    expect(html.match(/class="gdg-radio-indicator"/g)).toHaveLength(2);
    expect(html).toMatch(/data-state="checked"[^>]*class="gdg-radio-indicator"/);
    expect(html).toMatch(/data-state="unchecked"[^>]*class="gdg-radio-indicator"/);
  });
});
