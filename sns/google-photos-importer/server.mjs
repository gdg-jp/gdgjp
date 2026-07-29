import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { encode } from "blurhash";
import sharp from "sharp";

const bridge = process.env.GOOGLE_PHOTOS_IMPORT_URL;
const token = process.env.GOOGLE_PHOTOS_IMPORT_TOKEN;
const dryRunUrl = process.env.GOOGLE_PHOTOS_DRY_RUN_URL;
const claimedAlbumId = process.env.GOOGLE_PHOTOS_ALBUM_ID;
const claimedAlbumUrl = process.env.GOOGLE_PHOTOS_ALBUM_URL;
const claimedRunId = process.env.GOOGLE_PHOTOS_RUN_ID;
const retries = 3;
const debugDir = process.env.GOOGLE_PHOTOS_DEBUG_DIR;

if (
  import.meta.main &&
  !dryRunUrl &&
  (!bridge || !token || !claimedAlbumId || !claimedAlbumUrl || !claimedRunId)
)
  throw new Error(
    "GOOGLE_PHOTOS_IMPORT_URL, GOOGLE_PHOTOS_IMPORT_TOKEN, GOOGLE_PHOTOS_ALBUM_ID, GOOGLE_PHOTOS_ALBUM_URL, and GOOGLE_PHOTOS_RUN_ID are required",
  );

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

export async function createBlurhash(bytes) {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize(32, 32, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

async function bridgeJson(path, body) {
  const response = await fetch(`${bridge}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `bridge ${path} (${response.url}) failed: ${response.status} ${await response.text()}`,
    );
  return response.json();
}

async function captureStructureDiagnostics(page) {
  const diagnostics = await page.evaluate(() => {
    const images = [...document.images];
    const resourceHosts = Object.entries(
      performance.getEntriesByType("resource").reduce((counts, entry) => {
        const host = new URL(entry.name).hostname;
        counts[host] = (counts[host] ?? 0) + 1;
        return counts;
      }, {}),
    ).map(([host, count]) => ({ host, count }));
    const attributeNames = [
      ...new Set(
        images.flatMap((image) => {
          const parent = image.closest("[role=listitem], [data-id], [data-photo-id]");
          return [...image.getAttributeNames(), ...(parent?.getAttributeNames() ?? [])];
        }),
      ),
    ].sort();
    return {
      title: document.title,
      url: location.href,
      bodyTextPreview: document.body?.innerText.replace(/\s+/g, " ").trim().slice(0, 1000) ?? "",
      imageCount: images.length,
      listItemCount: document.querySelectorAll("[role=listitem]").length,
      resourceHosts,
      candidateIdAttributeCounts: Object.fromEntries(
        ["data-id", "data-photo-id", "data-media-key", "data-media-item-id", "data-item-id"].map(
          (attribute) => [attribute, document.querySelectorAll(`[${attribute}]`).length],
        ),
      ),
      imageAndAncestorAttributeNames: attributeNames,
    };
  });
  console.error(
    JSON.stringify({ message: "google_photos_page_structure_changed", ...diagnostics }),
  );
  if (!debugDir) return;
  await mkdir(debugDir, { recursive: true });
  await Promise.all([
    page.screenshot({ path: join(debugDir, "page-structure.png"), fullPage: true }),
    page.content().then((html) => writeFile(join(debugDir, "page-structure.html"), html)),
    writeFile(join(debugDir, "page-structure.json"), JSON.stringify(diagnostics, null, 2)),
  ]);
}

export function googlePhotosDownloadUrl(url) {
  const parsed = new URL(url);
  if (!/^(lh3|lh5)\.googleusercontent\.com$/.test(parsed.hostname))
    throw new Error("unsupported Google Photos image URL");
  // Image rendition parameters are part of the path (for example, `=w400-h300`).
  // Always request a fresh full-size rendition instead of persisting the grid's
  // progressive thumbnail, whose URL and dimensions can change while it loads.
  parsed.pathname = `${parsed.pathname.replace(/=[^/]*$/, "")}=w1600`;
  return parsed.toString();
}

async function extractVisiblePhotos(page) {
  return page.evaluate(() => {
    const parseTakenAt = (element) => {
      const timestamp = element?.getAttribute("data-timestamp");
      if (timestamp && /^\d+$/.test(timestamp)) {
        const value = Number(timestamp);
        const date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
        if (!Number.isNaN(date.valueOf())) return date.toISOString();
      }
      const candidates = [
        element?.querySelector("time")?.getAttribute("datetime"),
        element?.getAttribute("data-date"),
        element?.getAttribute("aria-label"),
        element?.getAttribute("title"),
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const match = candidate.match(
          /(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/,
        );
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          const date = new Date(
            `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}`,
          );
          if (!Number.isNaN(date.valueOf())) return date.toISOString();
        }
        const value = Date.parse(candidate);
        if (!Number.isNaN(value)) return new Date(value).toISOString();
      }
      return null;
    };
    const linkPhotos = [...document.querySelectorAll('a[href*="/photo/"]')]
      .map((link) => {
        const stableId = link.getAttribute("href")?.match(/\/photo\/([^/?]+)/)?.[1];
        const descendants = [link, ...link.querySelectorAll("*")];
        const backgroundImage = descendants
          .map((element) => getComputedStyle(element).backgroundImage)
          .find((value) => /^url\(/.test(value));
        const backgroundUrl = backgroundImage?.match(/^url\(["']?(.+?)["']?\)$/)?.[1];
        const image = link.querySelector("img");
        const url = image?.currentSrc || image?.getAttribute("src") || backgroundUrl;
        if (!stableId || !url || !/^https:\/\/(lh3|lh5)\.googleusercontent\.com\//.test(url))
          return null;
        return { stableId, url, takenAt: parseTakenAt(link), idSource: "link" };
      })
      .filter(Boolean);
    const domPhotos = [...document.images]
      .map((image) => {
        const ancestor = image.closest(
          "[data-photo-id], [data-media-key], [data-media-item-id], [data-item-id], [data-id], [role=listitem]",
        );
        const stableId =
          ancestor?.getAttribute("data-photo-id") ??
          ancestor?.getAttribute("data-media-key") ??
          ancestor?.getAttribute("data-media-item-id") ??
          ancestor?.getAttribute("data-item-id") ??
          ancestor?.getAttribute("data-id") ??
          image.getAttribute("data-photo-id");
        const url = image.currentSrc || image.getAttribute("src");
        if (!stableId || !url || !/^https:\/\/(lh3|lh5)\.googleusercontent\.com\//.test(url))
          return null;
        return { stableId, url, takenAt: parseTakenAt(ancestor), idSource: "dom" };
      })
      .filter((photo) => photo?.stableId);
    // A Googleusercontent delivery URL identifies a particular rendition, not a
    // photo. Its path may change as Google replaces an in-progress thumbnail, so
    // using it as a stable ID causes duplicate imports. If neither the photo link
    // nor an explicit DOM media ID is available, fail safely with diagnostics.
    return linkPhotos.length ? linkPhotos : domPhotos;
  });
}

async function scrollAlbum(page) {
  return page.evaluate(() => {
    const canScroll = (element) => {
      const style = getComputedStyle(element);
      return (
        element.scrollHeight > element.clientHeight + 1 &&
        /auto|scroll/.test(style.overflowY) &&
        element.clientHeight > 0
      );
    };
    const ancestors = [];
    for (
      let element = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      element;
      element = element.parentElement
    )
      ancestors.push(element);
    const container =
      ancestors.find(canScroll) ??
      [...document.querySelectorAll("*")]
        .filter(canScroll)
        .sort((left, right) => right.clientHeight - left.clientHeight)[0] ??
      document.scrollingElement;
    if (!container) return { advanced: false, atEnd: true };
    const before = container.scrollTop;
    container.scrollBy({ top: Math.max(600, Math.floor(container.clientHeight * 0.85)) });
    return {
      advanced: container.scrollTop > before,
      atEnd: container.scrollTop + container.clientHeight >= container.scrollHeight - 1,
    };
  });
}

export async function waitForVisibleGooglePhotos(page) {
  await page.waitForFunction(
    () => {
      const images = [...document.images].filter((image) =>
        /^https:\/\/(lh3|lh5)\.googleusercontent\.com\//.test(
          image.currentSrc || image.getAttribute("src") || "",
        ),
      );
      return (
        images.length === 0 || images.every((image) => image.complete && image.naturalWidth > 0)
      );
    },
    undefined,
    { timeout: 10_000 },
  );
}

export async function collectPhotos(page) {
  // Google Photos virtualizes the album grid: only roughly one viewport of images
  // remains in the DOM. Accumulate every viewport instead of inspecting only the
  // final DOM state after scrolling.
  const unique = new Map();
  let settledAtEndRounds = 0;
  for (let index = 0; index < 300 && settledAtEndRounds < 3; index += 1) {
    await waitForVisibleGooglePhotos(page);
    const visiblePhotos = await extractVisiblePhotos(page);
    for (const photo of visiblePhotos) {
      unique.set(photo.stableId, photo);
    }

    const { advanced, atEnd } = await scrollAlbum(page);
    await page.waitForTimeout(500);
    settledAtEndRounds = atEnd && !advanced ? settledAtEndRounds + 1 : 0;
  }
  const domIdCount = [...unique.values()].filter((photo) => photo.idSource === "dom").length;
  console.log(
    JSON.stringify({
      message: "google_photos_extraction",
      extractedCount: unique.size,
      domIdCount,
    }),
  );
  if (!unique.size) {
    await captureStructureDiagnostics(page);
    throw new Error("page_structure_changed: no stable Google Photos identifiers found");
  }
  return [...unique.values()];
}

async function uploadPhoto(albumId, runId, photo, context) {
  const downloadUrl = googlePhotosDownloadUrl(photo.url);
  const response = await retry(() => context.request.get(downloadUrl, { failOnStatusCode: true }));
  const contentType = response.headers()["content-type"]?.split(";", 1)[0] ?? "";
  if (!contentType.startsWith("image/")) return "skipped";
  const bytes = await response.body();
  const blurhash = await createBlurhash(bytes);
  const upload = await fetch(`${bridge}/media`, {
    method: "POST",
    headers: {
      "content-type": contentType,
      authorization: `Bearer ${token}`,
      "x-album-id": albumId,
      "x-import-run-id": runId,
      "x-stable-photo-id": photo.stableId,
      "x-source-url": downloadUrl,
      "x-blurhash": blurhash,
      ...(photo.takenAt ? { "x-photo-taken-at": photo.takenAt } : {}),
    },
    body: bytes,
  });
  if (upload.status === 409) return "duplicate";
  if (upload.status === 413) return "skipped";
  if (!upload.ok) throw new Error(`media upload failed: ${upload.status} ${await upload.text()}`);
  return "imported";
}

async function poll() {
  const albumId = claimedAlbumId;
  const url = claimedAlbumUrl;
  const runId = claimedRunId;
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
          runId,
          media: photos.map((photo) => ({
            stablePhotoId: photo.stableId,
            takenAt: photo.takenAt,
          })),
        })
      ).known,
    );
    let importedCount = 0;
    let duplicateCount = known.size;
    for (const photo of photos.filter((item) => !known.has(item.stableId))) {
      const result = await uploadPhoto(albumId, runId, photo, context);
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

async function dryRun() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await retry(() => page.goto(dryRunUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }));
    await page.waitForTimeout(1_000);
    const photos = await collectPhotos(page);
    const sampleResponse = await context.request.get(photos[0].url, { failOnStatusCode: true });
    const sampleBytes = await sampleResponse.body();
    const idSourceCounts = {};
    for (const photo of photos)
      idSourceCounts[photo.idSource] = (idSourceCounts[photo.idSource] ?? 0) + 1;
    return {
      ok: true,
      dryRun: true,
      extractedCount: photos.length,
      idSourceCounts,
      sampleDownload: {
        status: sampleResponse.status(),
        contentType: sampleResponse.headers()["content-type"] ?? null,
        byteSize: sampleBytes.byteLength,
      },
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.main) console.log(JSON.stringify(dryRunUrl ? await dryRun() : await poll()));
