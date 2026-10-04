import type { Page } from "@cloudflare/playwright";

export type VoucherRecipient = {
  id: string;
  name: string;
  quantity: number;
  participationTypeIds: string[];
  codes: Array<{ code: string; used: boolean; usedBy: string | null; usedAt: string | null }>;
};

export type VoucherRecipientWrite = Pick<
  VoucherRecipient,
  "name" | "quantity" | "participationTypeIds"
>;

function vouchersUrl(eventId: string): string {
  return `https://connpass.com/event/${eventId}/voucher_manage/`;
}

export async function scrapeVoucherRecipients(
  page: Page,
  eventId: string,
): Promise<VoucherRecipient[]> {
  await page.goto(vouchersUrl(eventId), { waitUntil: "domcontentloaded" });
  return page.evaluate(() =>
    [...document.querySelectorAll("table tbody tr")].flatMap((row) => {
      const link = row.querySelector("a[href*='voucher_manage']") as HTMLAnchorElement | null;
      if (!link?.href) return [];
      const id = /voucher_manage\/(\d+)/.exec(link.href)?.[1];
      if (!id) return [];
      const cells = [...row.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").trim());
      const match = /(\d+)\s*\/\s*(\d+)/.exec(cells[1] ?? "");
      return [
        {
          id,
          name: cells[0] ?? "",
          quantity: Number(match?.[2] ?? 0),
          participationTypeIds: [],
          codes: [],
        },
      ];
    }),
  );
}

export async function saveVoucherRecipient(
  page: Page,
  eventId: string,
  input: VoucherRecipientWrite,
  voucherId?: string,
): Promise<void> {
  const url = voucherId
    ? `https://connpass.com/event/${eventId}/voucher_manage/${voucherId}/`
    : `${vouchersUrl(eventId)}new`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("input[name=name], input[name=recipient_name]").first().fill(input.name);
  await page
    .locator("input[name=quantity], input[name=count]")
    .first()
    .fill(String(input.quantity));
  for (const id of input.participationTypeIds) {
    const checkbox = page.locator(`input[type=checkbox][value='${id}']`).first();
    if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) await checkbox.click();
  }
  await page.locator("button[type=submit], input[type=submit]").first().click();
  await page.waitForTimeout(800);
}

export async function deleteVoucherRecipient(
  page: Page,
  eventId: string,
  voucherId: string,
): Promise<void> {
  await page.goto(`https://connpass.com/event/${eventId}/voucher_manage/${voucherId}/`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".DeleteVoucher, a:has-text('削除')").first().click();
  const confirm = page.locator("button[type=submit], input[type=submit]").first();
  if ((await confirm.count()) > 0) await confirm.click();
  await page.waitForTimeout(800);
}
