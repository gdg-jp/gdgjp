import { chromium } from "@playwright/test";

const bridge = process.env.GOOGLE_PHOTOS_IMPORT_URL;
const token = process.env.GOOGLE_PHOTOS_IMPORT_TOKEN;
const retries = 3;

if (!bridge || !token)
  throw new Error("GOOGLE_PHOTOS_IMPORT_URL and GOOGLE_PHOTOS_IMPORT_TOKEN are required");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(operation) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await delay(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function bridgeJson(path, body) {
  const response = await fetch(`${bridge}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`bridge ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function collectPhotos(page) {
  let stableRounds = 0;
  let previousCount = 0;
  for (let index = 0; index < 40 && stableRounds < 3; index += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(500);
    const count = await page.locator("img").count();
    stableRounds = count === previousCount ? stableRounds + 1 : 0;
    previousCount = count;
  }
  const photos = await page.locator("img").evaluateAll((images) =>
    images
      .map((image) => {
        const ancestor = image.closest(
          "[data-photo-id], [data-media-key], [data-item-id], [role=listitem]",
        );
        const stableId =
          ancestor?.getAttribute("data-photo-id") ??
          ancestor?.getAttribute("data-media-key") ??
          ancestor?.getAttribute("data-item-id") ??
          image.getAttribute("data-photo-id");
        const url = image.currentSrc || image.getAttribute("src");
        return stableId && url && /^https:\/\/(lh3|lh5)\.googleusercontent\.com\//.test(url)
          ? { stableId, url }
          : null;
      })
      .filter(Boolean),
  );
  const unique = new Map(photos.map((photo) => [photo.stableId, photo]));
  if (!unique.size)
    throw new Error("page_structure_changed: no stable Google Photos identifiers found");
  return [...unique.values()];
}

async function uploadPhoto(albumId, photo, context) {
  const response = await retry(() => context.request.get(photo.url, { failOnStatusCode: true }));
  const contentType = response.headers()["content-type"]?.split(";", 1)[0] ?? "";
  if (!contentType.startsWith("image/")) return "skipped";
  const upload = await fetch(`${bridge}/media`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      authorization: `Bearer ${token}`,
      "x-album-id": albumId,
      "x-stable-photo-id": photo.stableId,
      "x-source-url": photo.url,
    },
    body: await response.body(),
  });
  if (upload.status === 409) return "duplicate";
  if (upload.status === 413) return "skipped";
  if (!upload.ok) throw new Error(`media upload failed: ${upload.status} ${await upload.text()}`);
  return "imported";
}

async function poll() {
  const claim = await bridgeJson("/claim");
  if (!claim.album) return { ok: true, idle: true };
  const { id: albumId, url, runId } = claim.album;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await retry(() => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }));
    await page.waitForTimeout(1_000);
    const photos = await collectPhotos(page);
    const known = new Set(
      (
        await bridgeJson("/known", {
          albumId,
          stablePhotoIds: photos.map((photo) => photo.stableId),
        })
      ).known,
    );
    let importedCount = 0;
    let duplicateCount = known.size;
    for (const photo of photos.filter((item) => !known.has(item.stableId))) {
      const result = await uploadPhoto(albumId, photo, context);
      if (result === "imported") importedCount += 1;
      if (result === "duplicate") duplicateCount += 1;
    }
    await bridgeJson("/complete", {
      albumId,
      runId,
      outcome: importedCount ? "imported" : "unchanged",
      discoveredPhotoIds: photos.map((photo) => photo.stableId),
      importedCount,
      duplicateCount,
    });
    return { ok: true, importedCount, duplicateCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await bridgeJson("/complete", {
      albumId,
      runId,
      outcome: detail.startsWith("page_structure_changed:") ? "structure_changed" : "failed",
      detail,
    });
    throw error;
  } finally {
    await browser?.close();
  }
}

console.log(JSON.stringify(await poll()));
