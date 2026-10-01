import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clickMenuAction } from "./helpers.ts";
import { continueLine } from "../src/text.ts";

const url = pathToFileURL(resolve("dist/weditor.html")).href;
test.use({ locale: "ja-JP", colorScheme: "light" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(url);
});
test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test("tabs show the pen only on the active tab, unsaved dots on modified tabs, and no indentation control", async ({
  page,
}) => {
  await expect(
    page.locator(
      ".tab-icon, #indentSize, .status select, #saveStatus, .status .saved",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".tab-pen")).toHaveCount(1);
  await expect(page.locator(".dirty")).toHaveCount(0);
  await page.locator("#editor").fill("first");
  await expect(page.locator(".dirty")).toHaveText("●");
  await clickMenuAction(page, "newBtn");
  await expect(page.locator(".tab-pen")).toHaveCount(1);
  await expect(page.locator(".tab.active .tab-pen")).toHaveCount(1);
  await expect(page.locator(".tab:not(.active) .tab-pen")).toHaveCount(0);
  await expect(page.locator(".tab:not(.active) .dirty")).toHaveText("●");
  await page.locator("[role=tab]").first().click();
  await expect(page.locator(".tab.active .tab-pen")).toHaveCount(1);
  await expect(page.locator("#editor")).toHaveValue("first");
});

test("Enter preserves full-width and mixed indentation and continues bullet/numbered lists", async ({
  page,
}) => {
  const editor = page.locator("#editor");
  for (const [line, next] of [
    ["　　日本語", "　　"],
    [" \t　 日本語", " \t　 "],
    ["　　- 項目", "　　- "],
    ["  * 内容", "  * "],
    ["+　内容", "+　"],
    ["　1. 項目", "　2. "],
    ["009. 項目", "010. "],
    ["4) 内容", "5) "],
    ["-5", ""],
    ["1.25", ""],
  ]) {
    await editor.fill(line);
    await editor.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await editor.press("Enter");
    await expect(editor).toHaveValue(line + "\n" + next);
    await editor.press("Control+z");
    await expect(editor).toHaveValue(line);
  }
  await editor.fill("　- 項目");
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.press("Enter");
  await expect(editor).toHaveValue("　- 項目\n　");
  await editor.fill("　1. 項目");
  await editor.press("Control+End");
  await editor.press("Shift+Enter");
  await expect(editor).toHaveValue("　1. 項目\n　");
});

test("inserting a numbered item renumbers contiguous siblings and undo restores all numbers", async ({
  page,
}) => {
  const editor = page.locator("#editor");
  const original = "1. first\n2. second\n3. third\n4. fourth\n\n1. separate";
  await editor.fill(original);
  const caret = original.indexOf("\n3.");
  await editor.evaluate((el: HTMLTextAreaElement, caret) => {
    el.focus();
    el.setSelectionRange(caret, caret);
  }, caret);
  await editor.press("Enter");
  await expect(editor).toHaveValue(
    "1. first\n2. second\n3. \n4. third\n5. fourth\n\n1. separate",
  );
  expect(
    await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
  ).toBe(caret + 4);
  await editor.press("Control+z");
  await expect(editor).toHaveValue(original);
  await editor.press("Control+Shift+z");
  await expect(editor).toHaveValue(
    "1. first\n2. second\n3. \n4. third\n5. fourth\n\n1. separate",
  );
});

test("numbering respects full-width indentation, zero padding, punctuation, and list boundaries", () => {
  function apply(text: string, caret: number, plain = false) {
    const edit = continueLine(text, caret, caret, !plain);
    return text.slice(0, edit.from) + edit.replacement + text.slice(edit.to);
  }
  expect(apply("　009) abc\n　010) def\n　011) ghi\n  012) other", 8)).toBe(
    "　009) ab\n　010) c\n　011) def\n　012) ghi\n  012) other",
  );
  expect(apply("1. a\n2) b\n3. c", 4)).toBe("1. a\n2. \n2) b\n3. c");
  expect(apply("1. a\n2. b", 4, true)).toBe("1. a\n\n2. b");
});

test("text and mirror have a small gap beside the single gutter border", async ({
  page,
}) => {
  await page.locator("#editor").fill("unindented\n    indented\n　full-width");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.evaluate(() => {
      const editor = document.getElementById("editor")!;
      const mirror = document.getElementById("mirror")!;
      const gutter = document.querySelector(".gutter-inner")!;
      const guide = getComputedStyle(
        document.querySelector(".code-area")!,
        "::after",
      );
      return {
        padding: getComputedStyle(editor).paddingLeft,
        mirrorPadding: getComputedStyle(mirror).paddingLeft,
        gutterPadding: getComputedStyle(gutter).paddingRight,
        guide: guide.borderLeftWidth,
      };
    });
    expect(layout).toEqual({
      padding: "4px",
      mirrorPadding: "4px",
      gutterPadding: "6px",
      guide: "0px",
    });
  }
});

test("list continuation splits at the caret, exits only empty items, and supports selection replacement", () => {
  expect(continueLine("- 内容", 2)).toMatchObject({ replacement: "\n- " });
  expect(continueLine("　-　", 3)).toEqual({ from: 1, to: 3, replacement: "" });
  expect(continueLine("1. abc", 4, 6)).toEqual({
    from: 4,
    to: 6,
    replacement: "\n2. ",
  });
  expect(continueLine("　　", 2)).toMatchObject({ replacement: "\n　　" });
});

test("View contains checked theme/language choices and font size reset; Help is adjacent with two working dialogs", async ({
  page,
}) => {
  await expect(page.locator(".toolbar > details")).toHaveCount(4);
  const ids = await page
    .locator(".toolbar > details")
    .evaluateAll((elements) => elements.map((el) => el.id));
  expect(ids).toEqual(["fileMenu", "editMenu", "viewMenu", "helpMenu"]);
  await expect(page.locator("#themeBtn, #language, .settings")).toHaveCount(0);
  await expect(page.locator("#themeLightBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#languageJaBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickMenuAction(page, "themeDarkBtn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#themeDarkBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#themeLightBtn")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await clickMenuAction(page, "themeLightBtn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await clickMenuAction(page, "languageEnBtn");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await clickMenuAction(page, "languageJaBtn");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await clickMenuAction(page, "largerBtn");
  await clickMenuAction(page, "largerBtn");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "17px");
  await clickMenuAction(page, "resetZoomBtn");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "15px");
  await clickMenuAction(page, "smallerBtn");
  await page.locator("#editor").press("Control+0");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "15px");
  await clickMenuAction(page, "shortcutsBtn");
  await expect(page.locator("#helpDialog")).toBeVisible();
  await expect(page.locator("#helpKeys")).toContainText("Ctrl+0");
  await page.locator("#closeHelp").click();
  await clickMenuAction(page, "aboutBtn");
  await expect(page.locator("#aboutDialog")).toBeVisible();
  await expect(page.locator("#aboutDialog")).toContainText("1.0.0");
  await page.locator("#closeAbout").click();
  await expect(page.locator("#aboutDialog")).not.toBeVisible();
});

test("URL preferences are checked and remain fixed when system theme changes", async ({
  page,
}) => {
  await page.goto(url + "?lang=en&theme=dark");
  await expect(page.locator("#languageEnBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#themeDarkBtn")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
