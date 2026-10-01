import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clickMenuAction } from "./helpers.ts";
import { resolveStartup } from "../src/environment.ts";
const url = pathToFileURL(resolve("dist/weditor.html")).href;
test.use({ locale: "ja-JP", colorScheme: "light" });

test("only explicit menu choices persist; temporary URL overrides do not replace them", async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.locator("#themeAutoBtn, #languageAutoBtn")).toHaveCount(0);
  await expect(page.locator("#themeLightBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#languageJaBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("weditor-settings")!),
    ),
  ).toEqual({ version: 2, fontSize: 15 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("#themeDarkBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickMenuAction(page, "themeDarkBtn");
  await clickMenuAction(page, "languageEnBtn");
  await clickMenuAction(page, "largerBtn");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "16px");
  await page.goto(url + "?lang=ja&theme=light");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("weditor-settings")!),
    ),
  ).toEqual({ version: 2, fontSize: 16, lang: "en", theme: "dark" });
  await page.goto(url);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("disabled storage does not prevent editing or manual display choices", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Disabled", "SecurityError");
      },
    }),
  );
  await page.goto(url);
  await page.locator("#editor").fill("編集できます");
  await clickMenuAction(page, "themeDarkBtn");
  await clickMenuAction(page, "languageEnBtn");
  await expect(page.locator("#editor")).toHaveValue("編集できます");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("startup validates saved choices and gives valid URL values priority", () => {
  const env = {
    search: "",
    languages: ["ja-JP"],
    language: "ja",
    platform: "Win32",
    darkMode: false,
  };
  expect(
    resolveStartup(env, { version: 2, lang: "en", theme: "dark" }),
  ).toMatchObject({
    lang: "en",
    theme: "dark",
    languageIsExplicit: true,
    themeIsExplicit: true,
  });
  expect(
    resolveStartup(
      { ...env, search: "?lang=ja&theme=light" },
      { version: 2, lang: "en", theme: "dark" },
    ),
  ).toMatchObject({
    lang: "ja",
    theme: "light",
    savedLang: "en",
    savedTheme: "dark",
  });
  expect(
    resolveStartup(env, { version: 2, lang: "<script>", theme: false }),
  ).toMatchObject({
    lang: "ja",
    theme: "light",
    languageIsExplicit: false,
    themeIsExplicit: false,
  });
});
