import { handleGatewayRequest } from "../../../../apps/tinyurl-gateway/src/gateway.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const [hostname, path = "/", method = "GET"] = process.argv.slice(2);
if (!hostname || !path.startsWith("/")) {
  console.error("usage: tsx gateway-probe.mts <hostname> </path> [GET|HEAD|POST]");
  process.exit(2);
}
if (!process.env.TINYURL_INTERNAL_BASE || !process.env.GATEWAY_SHARED_SECRET) {
  console.error("TINYURL_INTERNAL_BASE and GATEWAY_SHARED_SECRET must be set");
  process.exit(2);
}

const response = await handleGatewayRequest(
  new Request(`https://${hostname}${path}`, {
    method,
    headers: { "user-agent": BROWSER_UA },
  }),
);
const body = method === "HEAD" ? "" : await response.text();
console.log(
  JSON.stringify({
    status: response.status,
    location: response.headers.get("location"),
    body: body.slice(0, 200),
  }),
);
