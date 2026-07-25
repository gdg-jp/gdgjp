import { describe, expect, it, vi } from "vitest";
import { serveCliInstaller } from "./cli-installer.server";

describe("CLI installer delivery", () => {
  it("serves the shell installer before apex short-link routing", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("#!/bin/sh"));
    const response = await serveCliInstaller(new Request("https://gdgs.jp/cli/install.sh"), {
      fetch,
    });
    expect(response?.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not intercept a normal gdgs.jp short-link request", async () => {
    const response = await serveCliInstaller(new Request("https://gdgs.jp/community"), {
      fetch: vi.fn(),
    });
    expect(response).toBeNull();
  });
});
