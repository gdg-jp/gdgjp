import { expect, test } from "@playwright/test";

const story = (id: string, theme: "light" | "dark") =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`;

test("selected calendar days use the primary button hover color", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto(story("components-button--primary", theme));
    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; }",
    });
    const primaryButton = page.getByRole("button", { name: "保存", exact: true });
    await primaryButton.hover();
    const buttonHoverBackground = await primaryButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );

    await page.goto(story("components-calendar--range", theme));
    await page.addStyleTag({
      content: "*, *::before, *::after { transition: none !important; }",
    });
    const selectedDay = page.locator('.gdg-calendar-day[aria-pressed="true"]').first();
    await expect(selectedDay).toBeVisible();
    await selectedDay.hover();

    await expect(selectedDay).toHaveCSS("background-color", buttonHoverBackground);
    await expect(selectedDay).toHaveCSS("color", "rgb(255, 255, 255)");
    const contrastRatio = await selectedDay.evaluate((element) => {
      const channel = (value: string) => {
        const [red, green, blue] = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        return [red, green, blue].map((component) => {
          const normalized = component / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = (value: string) => {
        const [red, green, blue] = channel(value);
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
      };
      const styles = getComputedStyle(element);
      const foreground = luminance(styles.color);
      const background = luminance(styles.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrastRatio).toBeGreaterThanOrEqual(3);
  }
});
