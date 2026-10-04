import { handleGatewayRequest } from "../src/gateway.js";

export const config = { runtime: "edge", regions: ["hnd1"] };

export default function gateway(request: Request): Promise<Response> {
  return handleGatewayRequest(request);
}
