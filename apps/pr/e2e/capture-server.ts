import { type Server, createServer } from "node:http";

/**
 * A local stand-in for Discord webhooks and a dead link target (e2e only).
 * POST /hook/<name> records the body; GET /messages lists them; anything under /dead is 404.
 */
export const CAPTURE_PORT = 5299;
export const CAPTURE_URL = `http://127.0.0.1:${CAPTURE_PORT}`;

export function startCaptureServer(): Promise<Server> {
  const messages: { hook: string; content: string; allowedMentions: unknown }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", CAPTURE_URL);
    if (req.method === "POST" && url.pathname.startsWith("/hook/")) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const json = JSON.parse(body || "{}");
        messages.push({
          hook: url.pathname.slice(6),
          content: json.content,
          allowedMentions: json.allowed_mentions,
        });
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === "/messages") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(messages));
      return;
    }
    if (url.pathname.startsWith("/dead")) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end("ok");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(CAPTURE_PORT, "127.0.0.1", () => resolve(server));
  });
}
