import { buildDesignHtml, svgDataUri } from "@skills/pr-playbook/scripts/render/design-html.mjs";
import { buildImageHtml, readChecks } from "@skills/pr-playbook/scripts/render/image-html.mjs";
import type { Brief } from "~/features/briefs/brief";
import { skinFromBrief } from "~/features/pages/render";
import { designAssets, imageTemplates } from "~/features/playbook/guides.server";
import { constants, runChecks } from "~/features/playbook/playbook";
import type { Asset } from "./asset";
import { finishRender, kitAssets } from "./asset.repository.server";
import { photoKey } from "./photos.server";

type Snapshot = { content: string; screenshot: Uint8Array };

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToBase64 = (bytes: ArrayBuffer) => {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Browser Rendering's snapshot (or, locally, the Playwright server at PR_RENDER_URL). */
async function snapshot(
  env: Env,
  html: string,
  width: number,
  height: number,
  screenshotOptions: { type: "png" | "jpeg"; quality?: number },
): Promise<Snapshot> {
  const options = {
    html,
    viewport: { width, height, deviceScaleFactor: 2 },
    waitForSelector: { selector: "body[data-checks=done]", timeout: 20_000 },
    screenshotOptions,
  };
  const response =
    env.ENVIRONMENT !== "production" && env.PR_RENDER_URL
      ? await fetch(env.PR_RENDER_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options),
        })
      : await env.BROWSER.quickAction("snapshot", options as never);
  if (!response.ok) throw new Error(`render failed (${response.status})`);
  const data = (await response.json()) as {
    success?: boolean;
    result?: { content?: string; screenshot?: string };
  };
  if (!data.success || !data.result?.screenshot) throw new Error("render returned no image");
  return { content: data.result.content ?? "", screenshot: base64ToBytes(data.result.screenshot) };
}

export function templateSize(templateId: string) {
  return imageTemplates.schemas[templateId]?.size ?? null;
}

export const renderLimits = () => ({
  thumbnailScale: constants.render.thumbnailScale,
  minFontPxAtThumbnail: constants.render.minFontPxAtThumbnail,
  minContrast: constants.render.minContrast,
  minContrastLarge: constants.render.minContrastLarge,
});

/** Template mode: the template's HTML for these slots (the same builder the Skill's local renderer uses). */
export function buildHtml(asset: Pick<Asset, "templateId" | "slots" | "layoutVars" | "skin">) {
  const template = imageTemplates.html[asset.templateId];
  const schema = imageTemplates.schemas[asset.templateId];
  if (!template || !schema) throw new Error(`no image template ${asset.templateId}`);
  return buildImageHtml({
    template,
    schema,
    baseCss: imageTemplates.baseCss,
    checksScript: imageTemplates.checksScript,
    logoSvg: imageTemplates.logoSvg,
    slots: asset.slots,
    layoutVars: asset.layoutVars,
    skin: asset.skin,
    render: renderLimits(),
  });
}

/**
 * The `assets/…` paths the agent's HTML may reference, as data URIs: the GDG logo and stickers
 * (from the skills), the campaign's speaker photos and event logo (from R2).
 */
export async function assetsMap(env: Env, campaignId: number, html: string) {
  const map: Record<string, string> = { "assets/gdg.svg": svgDataUri(imageTemplates.logoSvg) };
  for (const [file, svg] of Object.entries(designAssets.stickers))
    map[`assets/stickers/${file}`] = svgDataUri(svg);
  const refs = new Set(
    [...html.matchAll(/assets\/(photos\/[\w.-]+|logo\.[a-z0-9]+)/g)].map((m) => m[1] as string),
  );
  for (const ref of refs) {
    const object = await env.IMAGES.get(photoKey(campaignId, ref));
    if (!object) continue;
    const type = object.httpMetadata?.contentType ?? "image/jpeg";
    map[`assets/${ref}`] = `data:${type};base64,${bytesToBase64(await object.arrayBuffer())}`;
  }
  return map;
}

/** Design mode: the agent's HTML wrapped into the page (fonts, checks, CSP), resources inlined. */
export async function buildDesign(
  env: Env,
  asset: Pick<Asset, "campaignId" | "templateId" | "html" | "width" | "height">,
) {
  const schema = imageTemplates.schemas[asset.templateId];
  const html = asset.html ?? "";
  const built = buildDesignHtml({
    html,
    width: asset.width,
    height: asset.height,
    fontsBase: `${env.APP_URL.replace(/\/$/, "")}/fonts`,
    assets: await assetsMap(env, asset.campaignId, html),
    checksScript: imageTemplates.checksScript,
    render: renderLimits(),
    safeInset: constants.design.safeInset,
  });
  const requiredSlots = Object.entries(schema?.slots ?? {})
    .filter(([, s]) => (s as { required?: boolean }).required)
    .map(([k]) => k);
  return { ...built, requiredSlots };
}

export const assetSkin = (brief: Brief | null) => skinFromBrief(brief);

/**
 * Render, store the PNG (and for connpass a JPEG of 1 MB or less, lowering the quality step by
 * step and failing instead of silently resizing), then check: the slot contract, the Playbook's
 * mechanical rules, and the render rules measured in the page.
 */
export async function renderAsset(
  env: Env,
  asset: Asset,
  brief: Brief | null,
): Promise<{ mustFails: number; status: Asset["status"] }> {
  try {
    const design = asset.html !== null && asset.html !== undefined;
    const built = design
      ? await buildDesign(env, asset)
      : { ...buildHtml(asset), requiredSlots: [] as string[] };
    const shot = await snapshot(env, built.html, built.width, built.height, { type: "png" });
    const r2Key = `campaigns/${asset.campaignId}/assets/${asset.id}.png`;
    await env.IMAGES.put(r2Key, shot.screenshot, { httpMetadata: { contentType: "image/png" } });
    let r2KeyJpeg: string | null = null;
    if (asset.templateId === "connpass-thumbnail" && asset.purpose === "image") {
      const { maxBytes } = constants.images.connpassThumbnail;
      for (
        let q = constants.images.jpegQualityStart;
        q >= constants.images.jpegQualityMin;
        q -= constants.images.jpegQualityStep
      ) {
        const jpeg = await snapshot(env, built.html, built.width, built.height, {
          type: "jpeg",
          quality: q,
        });
        if (jpeg.screenshot.byteLength <= maxBytes) {
          r2KeyJpeg = `campaigns/${asset.campaignId}/assets/${asset.id}.jpg`;
          await env.IMAGES.put(r2KeyJpeg, jpeg.screenshot, {
            httpMetadata: { contentType: "image/jpeg" },
          });
          break;
        }
      }
      if (!r2KeyJpeg) {
        await finishRender(env.DB, asset.id, {
          r2Key,
          r2KeyJpeg: null,
          checks: [],
          status: "failed",
          error: "connpass 用の JPEG が 1 MB に収まらない",
        });
        return { mustFails: 1, status: "failed" };
      }
    }
    const rendered = readChecks(shot.content) ?? [];
    const kit = design
      ? ((await kitAssets(env.DB, asset.campaignId)).adopted?.notes.kit ?? null)
      : null;
    const report = runChecks({
      kind: "asset_spec",
      draft: {
        templateId: asset.templateId,
        slots: asset.slots,
        skinSource: asset.skin.source ?? "gdg-design",
        html: design ? asset.html : undefined,
        selfReviewMd: asset.notes.selfReviewMd ?? "",
      },
      brief,
      related: {
        render: rendered,
        requiredSlots: built.requiredSlots,
        sanitizer: { problems: built.problems },
        kit: asset.purpose === "kit" ? null : kit,
      },
    });
    const slotResults =
      !design && built.problems.length
        ? [
            {
              ruleId: "SLOTS-CONTRACT",
              strength: "MUST" as const,
              status: "fail" as const,
              detail: built.problems.join(" / "),
            },
          ]
        : [];
    const checks = [...slotResults, ...report.results];
    const mustFails = checks.filter((c) => c.strength === "MUST" && c.status === "fail").length;
    await finishRender(env.DB, asset.id, {
      r2Key,
      r2KeyJpeg,
      checks,
      status: "needs_approval",
      error: null,
      notes: design ? { ...asset.notes, sanitizer: built.problems } : undefined,
    });
    return { mustFails, status: "needs_approval" };
  } catch (error) {
    await finishRender(env.DB, asset.id, {
      r2Key: null,
      r2KeyJpeg: null,
      checks: [],
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return { mustFails: 0, status: "failed" };
  }
}
