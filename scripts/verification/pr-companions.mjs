import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function captureHandler(timetable) {
  const messages = [];
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname.startsWith("/hook/")) {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        let json = {};
        try {
          json = JSON.parse(body || "{}");
        } catch {}
        messages.push({
          hook: url.pathname.slice(6),
          content: json.content,
          allowedMentions: json.allowed_mentions,
          receivedAt: new Date().toISOString(),
        });
        response.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === "/messages") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(messages));
      return;
    }
    if (url.pathname === "/event") {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          '<html><head><title>Verify Meetup</title></head><body><h1>Verify Meetup</h1><p>2026/12/12 13:00〜 大阪</p><p>連絡先 staff@example.com</p><img src="/event/timetable.png" width="640"></body></html>',
        );
      return;
    }
    if (url.pathname === "/event/timetable.png" && timetable) {
      response.writeHead(200, { "content-type": "image/png" }).end(timetable);
      return;
    }
    if (url.pathname.startsWith("/dead")) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200).end("ok");
  };
}

export function renderHandler(browser) {
  return (request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
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
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            result: { content, screenshot: screenshot.toString("base64") },
          }),
        );
      } catch (error) {
        console.error(error);
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ success: false, errors: ["Rendering failed; see the companion's log"] }),
        );
      }
    });
  };
}

function listen(server, port) {
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => done(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const directory = resolve(process.argv[2] ?? ".");
  const capturePort = Number(process.env.PR_VERIFY_CAPTURE_PORT);
  const renderPort = Number(process.env.PR_VERIFY_RENDER_PORT);
  if (!capturePort || !renderPort) throw new Error("Capture and render ports are required");
  const timetable = readFileSync(resolve(directory, "fixtures/sources/timetable.png"));
  const require = createRequire(resolve(directory, "package.json"));
  const playwright = await import(pathToFileURL(require.resolve("@playwright/test")).href);
  const browser = await (playwright.chromium ?? playwright.default.chromium).launch();
  const servers = [
    await listen(createServer(captureHandler(timetable)), capturePort),
    await listen(createServer(renderHandler(browser)), renderPort),
  ];
  console.log(`PR companions: capture 127.0.0.1:${capturePort}, render 127.0.0.1:${renderPort}`);
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
      await browser.close();
      process.exit(0);
    });
  }
}
