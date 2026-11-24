import type { Locator, Page } from "@playwright/test";
import { type Action, PropertyViolation, action } from "./engine";
import { accessibleControl } from "./monitor";
import type { UiPropertyWorld } from "./run";

export type ExploreWorld = UiPropertyWorld & {
  readonly page: Page;
  readonly start: string;
  readonly origins: readonly string[];
  readonly avoid: RegExp;
};

export const DESTRUCTIVE_CONTROLS =
  /sign ?out|log ?out|ログアウト|サインアウト|delete|削除|remove|退会|trash|ゴミ箱|revoke|取り消|send|送信|publish|公開|approve|承認|pay\b|支払|購入|purchase|invite|招待|archive|アーカイブ|reset|リセット|disconnect|解除/i;

type Candidate = { readonly id: number; readonly kind: "click" | "fill" | "select" };
type Target = { role: string; name: string; nth: number };
type ControlInput = Target & { kind: Candidate["kind"]; value: string | null };

const MARK = "data-ui-explore";

async function candidates(page: Page): Promise<Candidate[]> {
  return page
    .evaluate((mark) => {
      for (const element of document.querySelectorAll(`[${mark}]`)) element.removeAttribute(mark);
      const selector = [
        "a[href]",
        "button",
        "input:not([type=hidden]):not([type=file])",
        "select",
        "textarea",
        "summary",
        "[role=button]",
        "[role=link]",
        "[role=menuitem]",
        "[role=menuitemcheckbox]",
        "[role=tab]",
        "[role=checkbox]",
        "[role=switch]",
      ].join(",");
      const found: { id: number; kind: "click" | "fill" | "select" }[] = [];
      for (const element of document.querySelectorAll(selector)) {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.width === 0 || box.height === 0) continue;
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (element.closest("[inert],[aria-hidden=true]")) continue;
        if (element.matches(":disabled,[aria-disabled=true]")) continue;
        if (element instanceof HTMLAnchorElement) {
          const url = new URL(element.href, location.href);
          if (url.origin !== location.origin) continue;
          if (element.target === "_blank" || element.hasAttribute("download")) continue;
        }
        const kind =
          element instanceof HTMLSelectElement
            ? "select"
            : element instanceof HTMLTextAreaElement ||
                (element instanceof HTMLInputElement &&
                  ![
                    "checkbox",
                    "radio",
                    "submit",
                    "button",
                    "reset",
                    "image",
                    "range",
                    "color",
                  ].includes(element.type))
              ? "fill"
              : "click";
        element.setAttribute(mark, String(found.length));
        found.push({ id: found.length, kind });
      }
      return found;
    }, MARK)
    .catch(() => []);
}

async function locate(page: Page, target: Target): Promise<Locator> {
  return page
    .getByRole(target.role as Parameters<Page["getByRole"]>[0], {
      name: target.name,
      exact: true,
    })
    .nth(target.nth);
}

async function describe(page: Page, candidate: Candidate): Promise<Target> {
  const marked = page.locator(`[${MARK}="${candidate.id}"]`);
  const control = await accessibleControl(marked);
  const matches = page.getByRole(control.role as Parameters<Page["getByRole"]>[0], {
    name: control.name,
    exact: true,
  });
  const count = await matches.count();
  for (let nth = 0; nth < count; nth++) {
    const same = await matches
      .nth(nth)
      .evaluate(
        (element, [mark, id]) => element.getAttribute(mark as string) === id,
        [MARK, String(candidate.id)],
      )
      .catch(() => false);
    if (same) return { ...control, nth };
  }
  return { ...control, nth: 0 };
}

async function onApp(world: ExploreWorld): Promise<void> {
  const url = world.page.url();
  const origin = url.startsWith("http") ? new URL(url).origin : "";
  if (!world.origins.includes(origin)) await world.page.goto(world.start);
}

const previous = new WeakMap<ExploreWorld, ControlInput>();

async function use(world: ExploreWorld, input: ControlInput): Promise<void> {
  if (input.role === "none") return;
  previous.set(world, input);
  const control = await locate(world.page, input);
  if ((await control.count()) === 0) return;
  if (!(await control.isVisible())) await control.focus();
  if (input.kind === "fill") await world.ui.fill(control, input.value ?? "");
  else if (input.kind === "select" && input.value !== null)
    await world.ui.select(control, input.value);
  else await world.ui.click(control);
  await world.page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await world.page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await onApp(world);
}

export function exploreActions<W extends ExploreWorld>(): Action<W>[] {
  return [
    action<W, ControlInput>({
      name: "use a control",
      weight: 8,
      enabled: async (world) => (await candidates(world.page)).length > 0,
      input: async (random, world) => {
        const found = await candidates(world.page);
        const candidate = random.pick(found);
        const target = await describe(world.page, candidate);
        if (world.avoid.test(target.name))
          return { kind: "click", role: "none", name: "", nth: 0, value: null };
        let value: string | null = null;
        if (candidate.kind === "fill") value = random.text();
        if (candidate.kind === "select") {
          const options = await world.page
            .locator(`[${MARK}="${candidate.id}"] option`)
            .evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
          value = options.length ? random.pick(options) : null;
        }
        return { ...target, kind: candidate.kind, value };
      },
      run: use,
    }),
    action<W, ControlInput>({
      name: "repeat the last control",
      weight: 3,
      enabled: async (world) => {
        const last = previous.get(world);
        if (!last || last.role === "none") return false;
        return (await (await locate(world.page, last)).count()) > 0;
      },
      input: (random, world) => {
        const last = previous.get(world) as ControlInput;
        return { ...last, value: last.kind === "fill" ? random.text() : last.value };
      },
      run: use,
    }),
    action<W>({
      name: "go back",
      weight: 1,
      run: async (world) => {
        await world.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
        await onApp(world);
      },
    }),
    action<W>({
      name: "reload",
      weight: 1,
      run: async (world) => {
        const response = await world.page.reload({ waitUntil: "domcontentloaded" });
        if (response && response.status() >= 500)
          throw new PropertyViolation(
            "monitor",
            "no 5xx responses",
            `reload of ${world.page.url()} returned ${response.status()}`,
          );
      },
    }),
    action<W>({
      name: "start over",
      weight: 1,
      run: async (world) => {
        await world.page.goto(world.start, { waitUntil: "domcontentloaded" });
      },
    }),
  ];
}
