import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "docs/screenshots");
await mkdir(output, { recursive: true });
const channel =
  process.env.PW_CHANNEL ||
  (process.platform === "win32" ? "msedge" : undefined);
const browser = await chromium.launch({ channel, headless: true });
try {
  for (const language of ["en", "ja"]) {
    const context = await browser.newContext({
      locale: language === "ja" ? "ja-JP" : "en-US",
      viewport: { width: 1100, height: 640 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.goto(
        pathToFileURL(resolve(root, "dist/weditor.html")).href +
          `?lang=${language}&theme=light`,
      );
      await page.locator("#fileInput").setInputFiles([
        {
          name: language === "ja" ? "読書リスト.txt" : "reading-list.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(
            language === "ja"
              ? "読書リスト\n\n- 短編集\n- 街の歴史についての本\n"
              : "Reading list\n\n- A collection of short stories\n- A book about local history\n",
          ),
        },
        {
          name: language === "ja" ? "週末のノート.txt" : "weekend-notes.txt",
          mimeType: "text/plain",
          buffer: await readFile(
            resolve(root, `docs/samples/weekend.${language}.txt`),
          ),
        },
      ]);
      await page.locator('[role="tab"]').first().locator(".close").click();
      await page.locator("#editor").evaluate((el) => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      await page.keyboard.insertText(
        language === "ja"
          ? "天気がよければ、少し遠回りして帰ります。"
          : "If the weather stays clear, take the longer way home.",
      );
      await page.locator("#editMenu > summary").click();
      await page.locator("#findBtn").click();
      await page.locator("#query").fill(language === "ja" ? "散歩" : "walk");
      await page.locator("#nextBtn").click();
      await page.evaluate(() => document.fonts.ready);
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") {
          await page.locator("#viewMenu > summary").click();
          await page.locator("#themeDarkBtn").click();
        }
        await page.locator("#editor").evaluate((el) => {
          el.scrollTop = 0;
          el.dispatchEvent(new Event("scroll"));
        });
        await page.screenshot({
          path: resolve(output, `${language}-${theme}.png`),
        });
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(
  "Saved English/Japanese light/dark screenshots in docs/screenshots.",
);
