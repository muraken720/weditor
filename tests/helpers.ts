import type { Page } from "@playwright/test";

/** Click through the visible menu, just as a user would. */
export async function clickMenuAction(page: Page, id: string) {
  const button = page.locator(`#${id}`);
  const menu = await button.evaluate((element) => {
    const details = element.closest<HTMLDetailsElement>("details");
    return details ? { id: details.id, open: details.open } : null;
  });
  if (menu && !menu.open) await page.locator(`#${menu.id} > summary`).click();
  await button.click();
}
