import { describe, expect, it } from "vitest";
import { shortDomainLabel, shortLinkDisplay } from "./short-url";

describe("short URL display", () => {
  it("uses the go/ alias and includes a slash for normal domains", () => {
    expect(shortDomainLabel("go.gdgs.jp")).toBe("go/");
    expect(shortDomainLabel("gdgs.jp")).toBe("gdgs.jp/");
    expect(shortDomainLabel("gdg-tokyo.jp")).toBe("gdg-tokyo.jp/");
    expect(shortLinkDisplay("go.gdgs.jp", "docs")).toBe("go/docs");
  });
});
