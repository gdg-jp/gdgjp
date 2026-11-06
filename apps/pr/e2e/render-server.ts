import { type Server, createServer } from "node:http";
import { chromium } from "@playwright/test";

/**
 * Local stand-in for Browser Rendering's `snapshot` (it does not run locally): POST the same
 * options ({ html, viewport, waitForSelector, screenshotOptions }) and get the same JSON
 * ({ success, result: { content, screenshot } }). The pr Worker uses it when PR_RENDER_URL is set.
 */
export const RENDER_PORT = 5298;

export async function startRenderServer(): Promise<Server> {
  const browser = await chromium.launch();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}");
        const viewport = input.viewport ?? { width: 1200, height: 630, deviceScaleFactor: 2 };
        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        });
        await page.setContent(input.html, { waitUntil: "load" });
        if (input.waitForSelector?.selector)
          await page.waitForSelector(input.waitForSelector.selector, {
            timeout: input.waitForSelector.timeout ?? 15_000,
          });
        const options = input.screenshotOptions ?? {};
        const screenshot = await page.screenshot({
          type: options.type ?? "png",
          quality: options.type === "jpeg" ? options.quality : undefined,
          clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        });
        const content = await page.content();
        await page.close();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            result: { content, screenshot: screenshot.toString("base64") },
          }),
        );
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: [String(error)] }));
      }
    });
  });
  server.on("close", () => void browser.close());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(RENDER_PORT, "127.0.0.1", () => resolve(server));
  });
}
