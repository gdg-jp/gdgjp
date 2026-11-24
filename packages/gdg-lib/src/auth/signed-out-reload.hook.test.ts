import { describe, expect, it, vi } from "vitest";

const useMountEffect = vi.fn();
vi.mock("../react/mount-effect", () => ({ useMountEffect }));

const { installSignedOutReload, useSignedOutReload } = await import("./signed-out-reload");

describe("useSignedOutReload", () => {
  it("installs the signed-out reload once on mount", () => {
    useSignedOutReload();
    expect(useMountEffect).toHaveBeenCalledTimes(1);
    expect(useMountEffect).toHaveBeenCalledWith(installSignedOutReload);
  });
});
