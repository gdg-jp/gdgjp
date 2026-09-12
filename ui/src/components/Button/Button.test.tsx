import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders native button, loading state and disabled links on the server", () => {
    expect(renderToStaticMarkup(<Button loading>保存</Button>)).toMatch(/disabled=""/);
    expect(renderToStaticMarkup(<Button loading>保存</Button>)).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        <Button asChild disabled>
          <a href="/test">移動</a>
        </Button>,
      ),
    ).toContain('aria-disabled="true"');
    expect(renderToStaticMarkup(<Button>保存</Button>)).toContain('type="button"');
  });
});
