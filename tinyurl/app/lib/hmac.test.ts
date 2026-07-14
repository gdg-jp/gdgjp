import { describe, expect, it } from "vitest";
import { gatewaySignaturePayload, signGatewayRequest, verifyGatewayRequest } from "./hmac";

describe("gateway HMAC", () => {
  it("binds timestamp, method, path, and hostname", async () => {
    const payload = gatewaySignaturePayload({
      timestamp: "1700000000",
      method: "GET",
      pathname: "/api/internal/gateway/config",
      hostname: "Example.JP",
    });
    const signature = await signGatewayRequest("secret", payload);
    expect(await verifyGatewayRequest("secret", payload, signature)).toBe(true);
    expect(await verifyGatewayRequest("secret", `${payload}x`, signature)).toBe(false);
  });
});
