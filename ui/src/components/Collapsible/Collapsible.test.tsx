import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible";

describe("Collapsible", () => {
  it("keeps closed content mounted for the exit transition", () => {
    const html = renderToStaticMarkup(
      <Collapsible>
        <CollapsibleTrigger>詳細</CollapsibleTrigger>
        <CollapsibleContent>説明</CollapsibleContent>
      </Collapsible>,
    );

    expect(html).toContain('data-state="closed"');
    expect(html).toContain('class="gdg-collapsible-content"');
    expect(html).toContain("説明");
  });
});
