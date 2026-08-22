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
  await page.locator(".ImageUpload, #FieldImage input[type=file]").first().click();
  await page.evaluate(
    ({ data, contentType, name }) => {
      const input = document.querySelector(
        "#FieldImage input[type=file], input[type=file]",
      ) as HTMLInputElement | null;
      if (!input) throw new Error("connpass_image_input_missing");
      const file = new File([new Uint8Array(data)], name, { type: contentType });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { data: Array.from(bytes), contentType, name },
  );
  await page.waitForTimeout(1_000);
}
