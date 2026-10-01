import { clickMenuAction } from "./helpers.ts";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStartup } from "../src/environment.ts";

const url = pathToFileURL(resolve("dist/weditor.html")).href;

async function configure(page: Page, platform: string, hintPlatform?: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ platform, hintPlatform }) => {
      Object.defineProperty(navigator, "platform", {
        value: platform,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgentData", {
        value: hintPlatform ? { platform: hintPlatform } : undefined,
        configurable: true,
      });
      Object.defineProperty(window, "showOpenFilePicker", {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(window, "showSaveFilePicker", {
        value: undefined,
        configurable: true,
      });
      try {
        // Old saved display settings must not override system defaults or URL values.
        localStorage.setItem(
          "weditor-settings",
          JSON.stringify({
            lang: "ja",
            theme: "light",
            fontSize: 17,
            indent: "2",
          }),
        );
      } catch {}
    },
    { platform, hintPlatform },
  );
  return errors;
}

async function downloadNew(page: Page, text: string): Promise<Buffer> {
  await page.locator("#editor").fill(text);
  await clickMenuAction(page, "saveBtn");
  await page.locator("#fileName").fill("test.txt");
  const downloading = page.waitForEvent("download");
  await page.locator("#nameForm button[type=submit]").click();
  return readFile((await (await downloading).path())!);
}

for (const locale of ["ja-JP", "en-US", "fr-FR"]) {
  test(`locale ${locale} and dark OS theme determine initial display`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale, colorScheme: "dark" });
    try {
      const page = await context.newPage();
      const errors = await configure(page, "Linux x86_64");
      await page.goto(url);
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        locale.startsWith("ja") ? "ja" : "en",
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("#editor")).toHaveCSS("font-size", "17px");
      await expect(page.locator("#indentSize")).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("URL values override OS preferences and existing settings; invalid values fall back safely", async ({
  page,
}) => {
  const errors = await configure(page, "Win32");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(url + "?lang=en&theme=light");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto(url + "?lang=ja&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto(url + "?lang=%3Cscript%3E&theme=javascript:alert(1)");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("system theme changes apply until manually overridden", async ({
  page,
}) => {
  const errors = await configure(page, "MacIntel");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await clickMenuAction(page, "themeLightBtn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

for (const platform of ["Win32", "MacIntel", "Linux x86_64"]) {
  test(`new files use ${platform === "Win32" ? "CRLF" : "LF"} on ${platform}; existing files keep their endings`, async ({
    page,
  }) => {
    const errors = await configure(page, platform);
    await page.goto(url + "?lang=en&theme=light");
    const eol = platform === "Win32" ? "CRLF" : "LF";
    await expect(page.locator("#eolBtn")).toHaveText(eol);
    const text = "日本語\n    second\n";
    const downloaded = await downloadNew(page, text);
    expect(
      downloaded.equals(
        Buffer.from(
          eol === "CRLF" ? text.replace(/\n/g, "\r\n") : text,
          "utf8",
        ),
      ),
    ).toBe(true);
    for (const newline of ["\n", "\r\n"]) {
      const original = Buffer.from(
        "existing" + newline + "file" + newline,
        "utf8",
      );
      await page.locator("#fileInput").setInputFiles({
        name: "existing.txt",
        mimeType: "text/plain",
        buffer: original,
      });
      await expect(page.locator("#eolBtn")).toHaveText(
        newline === "\n" ? "LF" : "CRLF",
      );
      await page.locator("#editor").press("End");
      await page.locator("#editor").press("!");
      const saving = page.waitForEvent("download");
      await clickMenuAction(page, "saveBtn");
      const saved = await readFile((await (await saving).path())!);
      expect(
        saved.equals(
          Buffer.from("existing!" + newline + "file" + newline, "utf8"),
        ),
      ).toBe(true);
    }
    await clickMenuAction(page, "newBtn");
    await expect(page.locator("#eolBtn")).toHaveText(eol);
    expect(errors).toEqual([]);
  });
}

test("modern platform hint determines Windows line endings", async ({
  page,
}) => {
  const errors = await configure(page, "Linux x86_64", "Windows");
  await page.goto(url);
  await expect(page.locator("#eolBtn")).toHaveText("CRLF");
  expect(errors).toEqual([]);
});

test("go-to-line UI, help entry and shortcut interception are removed", async ({
  page,
}) => {
  const errors = await configure(page, "Win32");
  await page.goto(url + "?lang=ja");
  await expect(page.locator("#gotoBtn, #gotoDialog, #lineInput")).toHaveCount(
    0,
  );
  await clickMenuAction(page, "shortcutsBtn");
  await expect(page.locator("#helpKeys")).not.toContainText("Ctrl+G");
  await page.locator("#closeHelp").click();
  expect(
    await page.locator("#editor").evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("locale preference order, locale fallback and query allowlist", () => {
  const environment = {
    search: "",
    languages: ["en-US", "ja-JP"],
    language: "ja-JP",
    darkMode: false,
    platform: "Win32",
  };
  expect(resolveStartup(environment)).toMatchObject({
    lang: "en",
    theme: "light",
    newFileEol: "CRLF",
  });
  expect(resolveStartup({ ...environment, languages: [] })).toMatchObject({
    lang: "ja",
  });
  expect(
    resolveStartup({ ...environment, search: "?lang=ja&theme=dark" }),
  ).toMatchObject({ lang: "ja", theme: "dark", themeIsExplicit: true });
  expect(
    resolveStartup({ ...environment, search: "?lang=invalid&theme=invalid" }),
  ).toMatchObject({ lang: "en", theme: "light", themeIsExplicit: false });
});
