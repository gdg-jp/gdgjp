import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/utils.server", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "~/features/auth/utils.server";
import { loader } from "./layout";

const mockContext = { cloudflare: { env: {} as Env } } as Parameters<typeof loader>[0]["context"];

describe("admin layout loader", () => {
  it("enforces admin authorization", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin1" } as Awaited<
      ReturnType<typeof requireAdmin>
    >);

    const request = new Request("http://localhost/admin/pages");
    const result = await loader({
      request,
      context: mockContext,
      params: {},
      unstable_pattern: "/admin",
      unstable_url: new URL(request.url),
    });

    expect(requireAdmin).toHaveBeenCalledWith(request, mockContext.cloudflare.env);
    expect(result).toBeNull();
  });

  it("propagates the 403 thrown for non-admins", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response(null, { status: 403 }));

    const request = new Request("http://localhost/admin/pages");
    await expect(
      loader({
        request,
        context: mockContext,
        params: {},
        unstable_pattern: "/admin",
        unstable_url: new URL(request.url),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
