import { describe, expect, it, vi } from "vitest";
import { handleGatewayInternalRequest } from "./gateway-internal";
import { gatewaySignaturePayload, signGatewayRequest } from "./hmac";

const domainRow = {
  id: 3,
  hostname: "example.jp",
  kind: "custom",
  mode: "origin-first",
  upstream_origin: "https://origin.example.jp",
  owner_chapter_id: 1,
  status: "active",
  provider_domain_id: "example.jp",
  verification_records: "[]",
  provider_error: null,
  created_by_user_id: "u",
  created_at: 1,
  updated_at: 1,
  checked_at: 1,
  deleted_at: null,
} as const;

function env() {
  const first = vi.fn(async () => domainRow);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { DB: { prepare }, GATEWAY_SHARED_SECRET: "secret" } as unknown as Env;
}

function ctx() {
  return { waitUntil: vi.fn() } as unknown as ExecutionContext;
}

async function signedRequest(
  hostname = "example.jp",
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const pathname = "/api/internal/gateway/config";
  const signature = await signGatewayRequest(
    "secret",
    gatewaySignaturePayload({
      timestamp,
      method: "GET",
      pathname: `${pathname}?hostname=${hostname}`,
      hostname,
    }),
  );
  return new Request(`https://url.gdgs.jp${pathname}?hostname=${hostname}`, {
    headers: {
      "x-gdg-timestamp": timestamp,
      "x-gdg-host": hostname,
      "x-gdg-signature": signature,
    },
  });
}

describe("gateway internal authentication", () => {
  it("returns active configuration for a valid signature", async () => {
    const response = await handleGatewayInternalRequest(await signedRequest(), env(), ctx());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      hostname: "example.jp",
      mode: "origin-first",
      upstreamOrigin: "https://origin.example.jp",
    });
  });

  it("rejects stale signatures", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 301);
    const response = await handleGatewayInternalRequest(
      await signedRequest("example.jp", stale),
      env(),
      ctx(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a Host identity mismatch even with a valid signature", async () => {
    const request = await signedRequest();
    const url = new URL(request.url);
    url.searchParams.set("hostname", "other.jp");
    const response = await handleGatewayInternalRequest(new Request(url, request), env(), ctx());
    expect(response.status).toBe(401);
  });
});
