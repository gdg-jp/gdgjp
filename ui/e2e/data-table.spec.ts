import { expect, test } from "@playwright/test";

test("DataTable distributes columns by their maximum content width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto("/iframe.html?id=components-datatable--content-weighted&viewMode=story");

  const table = page.locator(".gdg-data-table");
  await expect(table).toBeVisible();
  await expect(table).toHaveCSS("table-layout", "fixed");

  const widths = await table
    .locator("col")
    .evaluateAll((columns) => columns.map((column) => column.getBoundingClientRect().width));
  expect(widths[0]).toBeGreaterThan(widths[1]);
  expect(widths[1]).toBeGreaterThan(widths[2]);
});
