import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icons } from "./Icons";
describe("Icons", () => {
  it("renders a lucide-animated icon through the public wrapper", () => {
    const markup = renderToStaticMarkup(
      <Icons name="Heart" aria-label="お気に入り" data-testid="favorite-icon" />,
    );
    expect(markup).toContain('class="gdg-icons"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="お気に入り"');
    expect(markup).toContain('data-testid="favorite-icon"');
    expect(markup).toContain('width="24"');
  });
  it("accepts the library icon suffix and preserves decorative attributes", () => {
    const markup = renderToStaticMarkup(
      <Icons name="SparklesIcon" size={18} aria-hidden="true" title="装飾" />,
    );
    expect(markup).toContain('width="18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('title="装飾"');
    expect(markup).not.toContain('role="img"');
  });
  it("fails clearly for an unknown icon name", () => {
    expect(() => renderToStaticMarkup(<Icons name="NotAnIcon" />)).toThrow(
      'Unknown icon "NotAnIcon"',
    );
  });
});
