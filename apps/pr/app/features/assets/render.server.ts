import { buildImageHtml, readChecks } from "@skills/pr-playbook/scripts/render/image-html.mjs";
import type { Brief } from "~/features/briefs/brief";
import { skinFromBrief } from "~/features/pages/render";
import { imageTemplates } from "~/features/playbook/guides.server";
import { constants, runChecks } from "~/features/playbook/playbook";
import type { Asset } from "./asset";
import { finishRender } from "./asset.repository.server";

type Snapshot = { content: string; screenshot: Uint8Array };

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

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

/** The template's HTML for these slots (the same builder the Skill's local renderer uses). */
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
    render: {
      thumbnailScale: constants.render.thumbnailScale,
      minFontPxAtThumbnail: constants.render.minFontPxAtThumbnail,
      minContrast: constants.render.minContrast,
    },
  });
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
    const built = buildHtml(asset);
    const shot = await snapshot(env, built.html, built.width, built.height, { type: "png" });
    const r2Key = `campaigns/${asset.campaignId}/assets/${asset.id}.png`;
    await env.IMAGES.put(r2Key, shot.screenshot, { httpMetadata: { contentType: "image/png" } });
    let r2KeyJpeg: string | null = null;
    if (asset.templateId === "connpass-thumbnail") {
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
    const report = runChecks({
      kind: "asset_spec",
      draft: {
        templateId: asset.templateId,
        slots: asset.slots,
        skinSource: asset.skin.source ?? "gdg-design",
      },
      brief,
      related: { render: rendered },
    });
    const slotResults = built.problems.length
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
