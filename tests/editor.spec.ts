import { clickMenuAction } from "./helpers.ts";
import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findMatches } from "../src/search.ts";
import { safeFileName, readSettings } from "../src/safety.ts";
import { countLines, lineStart, indentBlock } from "../src/text.ts";

test("unindent at column one and IME Enter preserve the editing intent", async ({
  page,
}) => {
  const editor = page.locator("#editor");
  await editor.fill("    日本語\n    next");
  await select(page, 0);
  await editor.press("Shift+Tab");
  await expect(editor).toHaveValue("日本語\n    next");
  await editor.fill("\nsecond");
  await select(page, 0);
  await editor.press("Tab");
  await expect(editor).toHaveValue("    \nsecond");
  await editor.fill("変換中");
  await editor.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    el.dispatchEvent(event);
    if (event.defaultPrevented) throw new Error("IME Enter was intercepted");
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await expect(editor).toHaveValue("変換中");
});

test("proportional Japanese font search reveals a far-right match", async ({
  page,
}) => {
  const prefix = "幅広い日本語".repeat(100);
  await page.locator("#editor").fill(prefix + "検索対象");
  await select(page, 0);
  await clickMenuAction(page, "findBtn");
  await page.locator("#query").fill("検索対象");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#nextBtn").click();
  const bounds = await page.locator("#mirror mark.current").boundingBox();
  const editorBounds = await page.locator("#editor").boundingBox();
  expect(bounds!.x).toBeGreaterThan(editorBounds!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    editorBounds!.x + editorBounds!.width,
  );
});

test.use({ locale: "ja-JP", colorScheme: "light" });

const url = pathToFileURL(resolve("dist/weditor.html")).href;
async function select(page: Page, start: number, end = start) {
  await page.locator("#editor").evaluate(
    (el: HTMLTextAreaElement, range) => {
      el.focus();
      el.setSelectionRange(range[0], range[1]);
    },
    [start, end],
  );
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "platform", {
      value: "Linux x86_64",
      configurable: true,
    });
    Object.defineProperty(navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
    try {
      localStorage.clear();
    } catch {}
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(url);
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
});

test("compact app header stays in one row at desktop and narrow widths in both languages", async ({
  page,
}) => {
  for (const width of [1280, 600, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const lang of ["ja", "en"]) {
      await clickMenuAction(
        page,
        lang === "ja" ? "languageJaBtn" : "languageEnBtn",
      );
      const header = await page.locator(".top").boundingBox();
      const editor = await page.locator(".workspace").boundingBox();
      const menus = await page.locator(".toolbar").boundingBox();
      expect(header!.height).toBeLessThanOrEqual(38);
      expect(editor!.y).toBeLessThanOrEqual(70);
      expect(menus!.y + menus!.height).toBeLessThanOrEqual(header!.height);
      expect(
        await page.evaluate(
          () => document.body.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.locator("#viewMenu > summary").click();
      const panel = await page.locator("#viewMenu .menu-items").boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
      await page.locator("#editor").click();
      await expect(page.locator("#viewMenu")).toHaveJSProperty("open", false);
    }
  }
});

test("menu keyboard navigation, single-open behavior and action dismissal", async ({
  page,
}) => {
  const summary = page.locator("#fileMenu > summary");
  await summary.focus();
  await summary.press("ArrowDown");
  await expect(page.locator("#newBtn")).toBeFocused();
  await page.locator("#newBtn").press("End");
  await expect(page.locator("#saveAsBtn")).toBeFocused();
  await page.locator("#saveAsBtn").press("Escape");
  await expect(page.locator("#fileMenu")).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
  await summary.click();
  await page.locator("#editMenu > summary").click();
  await expect(page.locator("#fileMenu")).toHaveJSProperty("open", false);
  await expect(page.locator("#editMenu")).toHaveJSProperty("open", true);
  await clickMenuAction(page, "findBtn");
  await expect(page.locator("#searchBar")).toBeVisible();
  await expect(page.locator("#editMenu")).toHaveJSProperty("open", false);
});

test("standalone Japanese UI, embedded Noto font, light/dark and zoom", async ({
  page,
}) => {
  await expect(page.locator("#newBtn")).toContainText("新規");
  await expect(page.locator("[role=tab]")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page
      .locator("#editor")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Noto Sans JP Variable");
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) =>
          font.family.includes("Noto Sans JP") && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  await clickMenuAction(page, "themeDarkBtn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await clickMenuAction(page, "languageEnBtn");
  await expect(page.locator("#saveAsBtn [data-i18n]")).toHaveText("Save as");
  await expect(page.locator("#editor")).toHaveAttribute(
    "aria-label",
    "Text editor",
  );
  await clickMenuAction(page, "largerBtn");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "16px");
  await clickMenuAction(page, "smallerBtn");
  await expect(page.locator("#editor")).toHaveCSS("font-size", "15px");
});

test("indentation, multiline indent/unindent, per-tab undo and redo", async ({
  page,
}) => {
  const editor = page.locator("#editor");
  await editor.fill("    日本語");
  await select(page, 7);
  await editor.press("Enter");
  await expect(editor).toHaveValue("    日本語\n    ");
  await editor.press("Tab");
  await expect(editor).toHaveValue("    日本語\n        ");
  await editor.press("Shift+Tab");
  await expect(editor).toHaveValue("    日本語\n    ");
  await select(page, 0, 12);
  await editor.press("Tab");
  await expect(editor).toHaveValue("        日本語\n        ");
  await editor.press("Shift+Tab");
  await expect(editor).toHaveValue("    日本語\n    ");
  await clickMenuAction(page, "newBtn");
  await editor.fill("second");
  await page.locator("[role=tab]").first().click();
  await clickMenuAction(page, "undoBtn");
  await expect(editor).toHaveValue("        日本語\n        ");
  await clickMenuAction(page, "redoBtn");
  await expect(editor).toHaveValue("    日本語\n    ");
  await page.locator("[role=tab]").nth(1).click();
  await expect(editor).toHaveValue("second");
});

test("literal search, highlights, case option, replacement and undo", async ({
  page,
}) => {
  const editor = page.locator("#editor");
  await editor.fill("猫 cat CAT 猫 [x] <script>");
  await select(page, 0);
  await clickMenuAction(page, "findBtn");
  await page.locator("#query").fill("cat");
  await expect(page.locator("#mirror mark")).toHaveCount(2);
  await page.locator("#caseSensitive").check();
  await expect(page.locator("#mirror mark")).toHaveCount(1);
  await page.locator("#query").fill("[x]");
  await expect(page.locator("#mirror mark")).toHaveCount(1);
  await page.locator("#query").fill("猫");
  await page.locator("#nextBtn").click();
  await expect(page.locator("#mirror mark.current")).toHaveCount(1);
  await page.locator("#replacement").fill("犬");
  await page.locator("#replaceAllBtn").click();
  await expect(editor).toHaveValue("犬 cat CAT 犬 [x] <script>");
  await clickMenuAction(page, "undoBtn");
  await expect(editor).toHaveValue("猫 cat CAT 猫 [x] <script>");
  await page.locator("#closeSearch").click();
  await expect(page.locator("#mirror mark")).toHaveCount(0);
});

test("search from a long selected line honors the query length limit", async ({
  page,
}) => {
  await page.locator("#editor").fill("a".repeat(20_000));
  await select(page, 0, 20_000);
  await clickMenuAction(page, "findBtn");
  expect((await page.locator("#query").inputValue()).length).toBe(1000);
  await expect(page.locator("#mirror mark")).toHaveCount(20);
});

test("download saves UTF-8 and opens saved files in multiple tabs", async ({
  page,
}) => {
  const text = "日本語と🙂\n    インデント";
  await page.locator("#editor").fill(text);
  await clickMenuAction(page, "saveBtn");
  await page.locator("#fileName").fill("日本語.txt");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#nameForm button[type=submit]").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("日本語.txt");
  const bytes = await readFile((await download.path())!);
  expect(bytes.equals(Buffer.from(text, "utf8"))).toBe(true);
  await expect(page.locator(".tab.active .dirty")).toHaveCount(0);
  await page.locator("#fileInput").setInputFiles([
    { name: "日本語.txt", mimeType: "text/plain", buffer: bytes },
    { name: "other.txt", mimeType: "text/plain", buffer: Buffer.from("other") },
  ]);
  await expect(page.locator("[role=tab]")).toHaveCount(3);
  await page.locator("[role=tab]").nth(1).click();
  await expect(page.locator("#editor")).toHaveValue(text);
});

test("CRLF and UTF-8 BOM survive open and save", async ({ page }) => {
  const bytes = Buffer.from("\ufeff日本語\r\n    test\r\n", "utf8");
  await page
    .locator("#fileInput")
    .setInputFiles({ name: "bom.txt", mimeType: "text/plain", buffer: bytes });
  await expect(page.locator("#eolBtn")).toHaveText("CRLF");
  await expect(page.locator("#encoding")).toHaveText("UTF-8 BOM");
  const promise = page.waitForEvent("download");
  await clickMenuAction(page, "saveBtn");
  expect((await readFile((await (await promise).path())!)).equals(bytes)).toBe(
    true,
  );
});

test("native overwrite succeeds; failures leave changes unsaved", async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      written: string;
      failWrite: boolean;
      aborts: number;
      showOpenFilePicker: () => Promise<unknown[]>;
    };
    state.failWrite = false;
    state.aborts = 0;
    state.showOpenFilePicker = async () => [
      {
        name: "direct.txt",
        getFile: async () => new File(["original"], "direct.txt"),
        createWritable: async () => ({
          write: async (bytes: Uint8Array) => {
            if (state.failWrite) throw new Error("disk failure");
            state.written = new TextDecoder("utf-8", { fatal: true }).decode(
              bytes,
            );
          },
          close: async () => {},
          abort: async () => {
            state.aborts++;
          },
        }),
      },
    ];
  });
  await clickMenuAction(page, "openBtn");
  await expect(page.locator("#editor")).toHaveValue("original");
  await page.locator("#editor").fill("保存された日本語");
  await clickMenuAction(page, "saveBtn");
  await expect(page.locator(".tab.active .dirty")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { written: string }).written,
    ),
  ).toBe("保存された日本語");
  await page.evaluate(() => {
    (window as unknown as { failWrite: boolean }).failWrite = true;
  });
  await page.locator("#editor").fill("still unsaved");
  await clickMenuAction(page, "saveBtn");
  await expect(page.locator("#toast")).toContainText("disk failure");
  await expect(page.locator(".tab.active .dirty")).toHaveText("●");
  expect(
    await page.evaluate(() => (window as unknown as { aborts: number }).aborts),
  ).toBe(1);
});

test("unsaved tab close can be cancelled; final tab closes safely", async ({
  page,
}) => {
  await page.locator("#editor").fill("unsaved");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".close").click();
  await expect(page.locator("#editor")).toHaveValue("unsaved");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".close").click();
  await expect(page.locator("[role=tab]")).toHaveCount(1);
  await expect(page.locator("#editor")).toHaveValue("");
});

test("file contents and filenames cannot inject HTML or script; CSP blocks execution and networking", async ({
  page,
}) => {
  const payload =
    '<img src="https://example.com/leak" onerror="window.pwned=true"><script>window.pwned=true</script>';
  await page.locator("#fileInput").setInputFiles({
    name: "<img onerror=alert(1)>.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(payload),
  });
  await clickMenuAction(page, "findBtn");
  await page.locator("#query").fill("<script>");
  await expect(page.locator("#mirror mark")).toHaveText("<script>");
  await expect(page.locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned),
  ).toBeUndefined();
  const blocked = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.injected=true";
    document.body.append(script);
    try {
      await fetch("https://example.com/leak");
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { injected?: boolean }).injected,
    ),
  ).toBeUndefined();
  expect(
    await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content"),
  ).not.toContain("unsafe-inline");
});

test("malformed encoding, binary and oversized files are rejected without replacing text", async ({
  page,
}) => {
  await page.locator("#editor").fill("keep me");
  for (const buffer of [
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from([65, 0, 66]),
    Buffer.alloc(10 * 1024 * 1024 + 1, 65),
  ]) {
    await page.locator("#fileInput").setInputFiles({
      name: "bad.txt",
      mimeType: "application/octet-stream",
      buffer,
    });
    await expect(page.locator("#toast")).toBeVisible();
    await expect(page.locator("[role=tab]")).toHaveCount(1);
    await expect(page.locator("#editor")).toHaveValue("keep me");
  }
});

test("large match count is capped; replace all never silently replaces a partial result", async ({
  page,
}) => {
  const text = "a".repeat(10_001);
  await page.locator("#editor").fill(text);
  await clickMenuAction(page, "findBtn");
  await page.locator("#query").fill("a");
  await expect(page.locator("#mirror mark")).toHaveCount(10_000);
  await page.locator("#replacement").fill("b");
  await page.locator("#replaceAllBtn").click();
  await expect(page.locator("#editor")).toHaveValue(text);
  await expect(page.locator("#toast")).toContainText("10,000");
});

test("scrolling alignment and standalone file moved to another directory", async ({
  page,
}, testInfo) => {
  const text = Array.from(
    { length: 1000 },
    (_, index) => `行 ${index + 1}\t日本語`,
  ).join("\n");
  // Use the real file-opening path; CDP insertText is slow for many line breaks.
  await page.locator("#fileInput").setInputFiles({
    name: "many-lines.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text, "utf8"),
  });
  await expect(page.locator("#editor")).toHaveValue(text);
  const pos = text.indexOf("行 500\t");
  await select(page, pos);
  await page.locator("#editor").evaluate((el: HTMLTextAreaElement) => {
    el.scrollTop =
      Number.parseFloat(getComputedStyle(el).paddingTop) +
      499 * 24 -
      el.clientHeight / 2;
  });
  await expect(page.locator("#position")).toContainText("行 500");
  await expect(page.locator(".gutter-line.active")).toHaveText("500");
  expect(await page.locator(".gutter-line").count()).toBeLessThan(100);
  const offsets = await page.evaluate(() => [
    document.querySelector("textarea")!.scrollTop,
    document.querySelector("#mirror")!.scrollTop,
  ]);
  expect(offsets[0]).toBe(offsets[1]);
  const moved = testInfo.outputPath("arbitrary folder", "standalone.html");
  await mkdir(resolve(moved, ".."), { recursive: true });
  await copyFile(resolve("dist/weditor.html"), moved);
  page.once("dialog", (dialog) => dialog.accept());
  await page.goto(pathToFileURL(moved).href);
  await expect(page.locator("#newBtn")).toContainText("新規");
  await page.locator("#editor").fill("Moved HTML works.");
  await expect(page.locator("#editor")).toHaveValue("Moved HTML works.");
});

test("offline operation and screenshots at desktop and narrow widths", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.reload();
  await page
    .locator("#editor")
    .fill(
      "WEditor — ローカルテキストエディタ\n\n    単一のHTMLで、どこでも書く。\n    Noto Sans JP / UTF-8\n\n検索、複数タブ、インデント、保存。\nインターネット接続は不要です。",
    );
  await page.evaluate(() => document.fonts.ready);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/light.png" });
  await clickMenuAction(page, "themeDarkBtn");
  await page.screenshot({ path: "artifacts/dark.png" });
  await page.setViewportSize({ width: 600, height: 700 });
  await page.screenshot({ path: "artifacts/narrow.png" });
  expect(
    await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("security helpers and literal Unicode search", () => {
  expect(countLines("\n\n")).toBe(3);
  expect(countLines("a\nb", 2)).toBe(2);
  expect(lineStart("\nsecond", 0)).toBe(0);
  expect(indentBlock("    a\n    b", 0, 0, "    ", true)).toEqual({
    from: 0,
    to: 5,
    replacement: "a",
    selection: [0, 0],
  });
  expect(indentBlock("a\nb", 0, 2, "  ", false)).toEqual({
    from: 0,
    to: 1,
    replacement: "  a",
    selection: [2, 4],
  });
  expect(findMatches("İ cat CAT [a]+", "cat", false).matches).toEqual([
    { start: 2, end: 5 },
    { start: 6, end: 9 },
  ]);
  expect(findMatches("a [a]+", "[a]+", false).matches).toEqual([
    { start: 2, end: 6 },
  ]);
  expect(safeFileName("../CON.txt")).not.toContain("/");
  expect(safeFileName("CON.txt")).toBe("untitled.txt");
  expect(readSettings("null")).toEqual({});
});
