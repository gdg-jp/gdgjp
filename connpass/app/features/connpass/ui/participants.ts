import type { Page } from "@cloudflare/playwright";

export type Participant = {
  id: string;
  displayName: string;
  email: string | null;
  status: "registered" | "waitlisted" | "canceled";
  participationTypeId: string | null;
  participationTypeName: string | null;
  checkedIn: boolean;
  registeredAt: string | null;
  surveyAnswers: Record<string, unknown>;
};

export function participantsUrl(eventId: string): string {
  return `https://connpass.com/event/${eventId}/participants/?d=1`;
}

export async function scrapeParticipants(page: Page, eventId: string): Promise<Participant[]> {
  await page.goto(participantsUrl(eventId), { waitUntil: "domcontentloaded" });
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    return rows.flatMap((row) => {
      const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      const user = row.querySelector("a[href*='/user/']") as HTMLAnchorElement | null;
      if (!user?.href) return [];
      const id = /\/user\/([^/]+)/.exec(user.href)?.[1];
      if (!id) return [];
      const status = text.includes("キャンセル")
        ? "canceled"
        : text.includes("補欠")
          ? "waitlisted"
          : "registered";
      const cells = [...row.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").trim());
      const email = cells.find((cell) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) ?? null;
      return [
        {
          id,
          displayName: (user.textContent ?? id).trim(),
          email,
          status,
          participationTypeId: null,
          participationTypeName: cells[1] || null,
          checkedIn: /出席|チェックイン/.test(text) && !/未出席|未チェックイン/.test(text),
          registeredAt: null,
          surveyAnswers: {},
        },
      ];
    });
  });
}

export async function updateParticipant(
  page: Page,
  eventId: string,
  participantId: string,
  input: {
    status?: "registered" | "waitlisted" | "canceled";
    participationTypeId?: string;
    checkedIn?: boolean;
  },
): Promise<void> {
  await page.goto(participantsUrl(eventId), { waitUntil: "domcontentloaded" });
  const row = page.locator(`tr:has(a[href*='/user/${participantId}/'])`).first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  if (input.checkedIn !== undefined) {
    const checkbox = row.locator("input[type=checkbox]").first();
    if ((await checkbox.count()) > 0 && (await checkbox.isChecked()) !== input.checkedIn) {
      await checkbox.click();
    }
  }
  if (input.participationTypeId) {
    const select = row.locator("select").first();
    if ((await select.count()) > 0) await select.selectOption(input.participationTypeId);
  }
  if (input.status === "canceled") {
    const cancel = row.getByText("キャンセル").first();
    if ((await cancel.count()) > 0) await cancel.click();
  }
  const save = page.locator("button[type=submit], input[type=submit]").first();
  if ((await save.count()) > 0) await save.click();
  await page.waitForTimeout(500);
}

export async function scrapeEventStatistics(
  page: Page,
  eventId: string,
): Promise<Record<string, number>> {
  await page.goto(`https://connpass.com/event/${eventId}/stats/`, {
    waitUntil: "domcontentloaded",
  });
  return page.evaluate(() => {
    const text = document.body.innerText;
    const count = (label: string) =>
      Number(new RegExp(`${label}[^0-9]*(\\d+)`).exec(text)?.[1] ?? 0);
    return {
      registeredCount: count("参加者"),
      waitlistedCount: count("補欠"),
      canceledCount: count("キャンセル"),
      checkedInCount: count("出席"),
    };
  });
}

export async function sendEventMessage(
  page: Page,
  eventId: string,
  input: { subject: string; body: string },
): Promise<void> {
  await page.goto(`https://connpass.com/event/${eventId}/message/new/`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("input[name=subject], input[name=title]").first().fill(input.subject);
  await page.locator("textarea[name=message], textarea[name=body]").first().fill(input.body);
  await page.locator("button[type=submit], input[type=submit]").first().click();
  await page.waitForTimeout(800);
}
