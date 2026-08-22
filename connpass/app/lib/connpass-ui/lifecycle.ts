import type { Page } from "@cloudflare/playwright";
import { eventEditUrl } from "./events";

export async function copyEvent(page: Page, eventId: string): Promise<{ eventId: string | null }> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.locator(".CopyEvent").first().click();
  await page.waitForTimeout(800);
  const match = /\/event\/(\d+)\/edit/.exec(page.url());
  return { eventId: match?.[1] ?? null };
}

export async function deleteEventDraft(page: Page, eventId: string): Promise<void> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.locator(".DeleteEvent").first().click();
  const button = page.locator("button.btn_action[type=submit], button.PopupSubmit").first();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await page.waitForTimeout(800);
}

export async function cancelEvent(page: Page, eventId: string): Promise<void> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.locator(".CancelEvent").first().click();
  const button = page.locator("button.btn_action[type=submit], button.PopupSubmit").first();
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await button.click();
  await page.waitForTimeout(800);
}

export async function uploadEventImage(
  page: Page,
  eventId: string,
  bytes: Uint8Array,
  contentType: string,
  name: string,
): Promise<void> {
  await page.goto(eventEditUrl(eventId), { waitUntil: "domcontentloaded" });
  await page.evaluate(
    async ({ eventId, data, contentType, name }) => {
      const csrf = document.querySelector<HTMLInputElement>(
        'input[name="csrfmiddlewaretoken"]',
      )?.value;
      if (!csrf) throw new Error("connpass_csrf_token_missing");
      const form = new FormData();
      form.set("csrfmiddlewaretoken", csrf);
      form.set("image", new File([new Uint8Array(data)], name, { type: contentType }));
      const response = await fetch(`/event/${eventId}/image_upload/`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`connpass_image_upload_failed:${response.status}`);
    },
    { eventId, data: Array.from(bytes), contentType, name },
  );
  await page.waitForTimeout(1_000);
  await page.reload({ waitUntil: "domcontentloaded" });
  const image = page.locator(".EventImageBlock img").first();
  const source = await image.getAttribute("src");
  if (!source || source.includes("no_event_image")) {
    throw new Error("connpass_image_upload_not_persisted");
  }
}
