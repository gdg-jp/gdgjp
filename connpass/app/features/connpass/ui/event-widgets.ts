import type { Page } from "@cloudflare/playwright";
import { selectors } from "./selectors";
type ConnpassJQuery = {
  (
    selector: string,
  ): {
    first: () => {
      trigger: (event: string) => unknown;
      val: (value?: string) => unknown;
    };
    val: (value?: string) => unknown;
    trigger: (event: string) => unknown;
    [0]?: Element;
  };
  _data: (el: Element, key: string) => Record<string, unknown> | undefined;
};

type ConnpassRequire = (deps: string[], cb: ($: ConnpassJQuery) => void) => void;

/**
 * Event-edit widgets (jeditable, FormEditable, PlaceEditView) bind through AMD
 * jQuery after require(), often after an extra XHR (my_places). Server HTML
 * already contains the placeholders, so Playwright clicks succeed too early.
 */
export async function waitForBoundEvent(
  page: Page,
  selector: string,
  eventName: string,
): Promise<void> {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(
    async ({ selector, eventName }) => {
      const req = (window as unknown as { require?: ConnpassRequire }).require;
      if (typeof req !== "function") throw new Error("connpass_requirejs_missing");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`connpass_event_not_bound:${selector}:${eventName}`)),
          30_000,
        );
        req(["jquery"], ($) => {
          const poll = () => {
            const el = $(selector)[0];
            const events = el ? $._data(el, "events") : undefined;
            if (events?.[eventName]) {
              clearTimeout(timeout);
              resolve();
              return;
            }
            setTimeout(poll, 50);
          };
          poll();
        });
      });
    },
    { selector, eventName },
  );
}

export async function waitForEventEditReady(page: Page): Promise<void> {
  if (page.url().includes("/login")) {
    throw new Error("connpass_login_required");
  }
  await waitForBoundEvent(page, selectors.eventEdit.title, "click");
}

export async function jqueryClick(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (sel) => {
    const req = (window as unknown as { require: ConnpassRequire }).require;
    await new Promise<void>((resolve) => {
      req(["jquery"], ($) => {
        $(sel).first().trigger("click");
        resolve();
      });
    });
  }, selector);
}

async function jqueryValChange(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    async ({ sel, value }) => {
      const req = (window as unknown as { require: ConnpassRequire }).require;
      await new Promise<void>((resolve) => {
        req(["jquery"], ($) => {
          const node = $(sel).first();
          node.val(value);
          node.trigger("change");
          resolve();
        });
      });
    },
    { sel: selector, value },
  );
}

export async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false);
}

export async function openUntilVisible(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
): Promise<void> {
  await page.locator(triggerSelector).first().waitFor({ state: "visible", timeout: 30_000 });
  const deadline = Date.now() + 20_000;
  while (!(await isVisible(page, inputSelector))) {
    if (Date.now() > deadline) break;
    await jqueryClick(page, triggerSelector);
    await page
      .locator(inputSelector)
      .first()
      .waitFor({ state: "visible", timeout: 2_000 })
      .catch(() => undefined);
  }
  await page.locator(inputSelector).first().waitFor({ state: "visible", timeout: 10_000 });
}

export async function clickScopedSave(page: Page, scopeSelector: string): Promise<void> {
  const scoped = `${scopeSelector} button.save`;
  if (await isVisible(page, scoped)) {
    await page.locator(scoped).first().click();
    await page.waitForTimeout(400);
    return;
  }
  const save = page.locator(selectors.eventEdit.saveButton).first();
  if ((await save.count()) > 0 && (await save.isVisible().catch(() => false))) {
    await save.click();
    await page.waitForTimeout(400);
  }
}

/** jQuery UI date/time pickers stay above the edit form until explicitly dismissed. */
export async function closeDateTimePickers(page: Page, inputSelector: string): Promise<void> {
  await page
    .locator(inputSelector)
    .first()
    .press("Escape")
    .catch(() => undefined);
  await page
    .locator("#ui-datepicker-div, .ui-timepicker-wrapper, .ui-timepicker")
    .first()
    .waitFor({ state: "hidden", timeout: 2_000 })
    .catch(() => undefined);
}

export async function clickEditAndFill(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
  value: string,
  saveScope = triggerSelector,
): Promise<void> {
  await openUntilVisible(page, triggerSelector, inputSelector);
  await page.locator(inputSelector).first().fill(value);
  if (await isVisible(page, `${saveScope} button.save`)) {
    await clickScopedSave(page, saveScope);
  } else {
    await page
      .locator(inputSelector)
      .first()
      .press("Enter")
      .catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

export async function openPlaceEditor(page: Page): Promise<void> {
  const { place, placeSelect, placeEditLink, placeAddress } = selectors.eventEdit;
  await waitForBoundEvent(page, place, "change");
  if (await isVisible(page, placeAddress)) return;

  if (await isVisible(page, placeEditLink)) {
    await openUntilVisible(page, placeEditLink, placeAddress);
    return;
  }

  const deadline = Date.now() + 20_000;
  while (!(await isVisible(page, placeAddress))) {
    if (Date.now() > deadline) break;
    await jqueryValChange(page, placeSelect, "new");
    await page
      .locator(placeAddress)
      .first()
      .waitFor({ state: "visible", timeout: 2_000 })
      .catch(() => undefined);
  }
  await page.locator(placeAddress).first().waitFor({ state: "visible", timeout: 10_000 });
}
