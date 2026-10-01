import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeToHandle } from "../src/file-storage.ts";
import {
  rememberEdit,
  moveHistory,
  limitHistories,
  type History,
} from "../src/history.ts";
import {
  canAddDocument,
  canUpdateDocument,
  MAX_TABS,
  MAX_DOCUMENT_BYTES,
  MAX_TOTAL_HISTORY_BYTES,
} from "../src/limits.ts";
import { readFontSize } from "../src/settings.ts";
import { safeFileName } from "../src/safety.ts";
import type { LocalFileHandle, Snapshot } from "../src/types.ts";
const url = pathToFileURL(resolve("dist/weditor.html")).href;
test.use({ locale: "ja-JP", colorScheme: "light" });

test("write and commit failures abort the stream and preserve the original error", async () => {
  for (const failure of ["write", "close"]) {
    const calls: string[] = [];
    const original = new Error(failure);
    const handle: LocalFileHandle = {
      name: "file.txt",
      getFile: async () => new File([], "file.txt"),
      createWritable: async () => ({
        write: async () => {
          calls.push("write");
          if (failure === "write") throw original;
        },
        close: async () => {
          calls.push("close");
          throw original;
        },
        abort: async () => {
          calls.push("abort");
          throw new Error("abort also failed");
        },
      }),
    };
    await expect(writeToHandle(handle, new Uint8Array([65]))).rejects.toBe(
      original,
    );
    expect(calls).toEqual(
      failure === "write" ? ["write", "abort"] : ["write", "close", "abort"],
    );
  }
});

test("undo and redo share per-tab and global budgets, with branching edits clearing redo", () => {
  const state = (text: string): Snapshot => ({ text, start: 0, end: 0 });
  const history: History = { undo: [], redo: [] };
  rememberEdit([history], history, state("a"));
  expect(moveHistory([history], history, state("b"), false)?.text).toBe("a");
  expect(moveHistory([history], history, state("a"), true)?.text).toBe("b");
  moveHistory([history], history, state("b"), false);
  rememberEdit([history], history, state("branch"));
  expect(history.redo).toHaveLength(0);
  const histories: History[] = Array.from({ length: 8 }, () => ({
    undo: [],
    redo: Array.from({ length: 20 }, () => state("x".repeat(1024 * 1024))),
  }));
  limitHistories(histories);
  const bytes = histories
    .flatMap((h) => [...h.undo, ...h.redo])
    .reduce((sum, s) => sum + s.text.length * 2, 0);
  expect(bytes).toBeLessThanOrEqual(MAX_TOTAL_HISTORY_BYTES);
  expect(histories.every((h) => h.redo.length < 20)).toBe(true);
});

test("document budget accounts for saved originals as well as current edits", () => {
  const original = "x".repeat(MAX_DOCUMENT_BYTES / 4);
  const docs = [{ id: 1, text: original, savedText: original }];
  expect(canUpdateDocument(docs, 1, "y".repeat(10 * 1024 * 1024))).toBe(true);
  expect(
    canAddDocument(
      [...docs, { id: 2, text: original, savedText: original }],
      "a",
    ),
  ).toBe(false);
  expect(
    canUpdateDocument(
      [
        { id: 1, text: "", savedText: original },
        { id: 2, text: original, savedText: original },
      ],
      1,
      "a",
    ),
  ).toBe(false);
  expect(
    canAddDocument(
      [
        { id: 1, text: "", savedText: "", pendingSaveText: original },
        { id: 2, text: original, savedText: original },
      ],
      "a",
    ),
  ).toBe(false);
});

test("tab limit rejects extra tabs without replacing the active document", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate((count) => {
    for (let i = 1; i < count; i++) document.getElementById("newBtn")!.click();
  }, MAX_TABS);
  await page.locator("#editor").fill("keep the active document");
  await page.evaluate(() => document.getElementById("newBtn")!.click());
  await expect(page.locator('[role="tab"]')).toHaveCount(MAX_TABS);
  await expect(page.locator("#editor")).toHaveValue("keep the active document");
  await expect(page.locator("#toast")).toContainText("上限");
});

test("keyboard tab navigation retains focus and dialogs have accessible names", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => document.getElementById("newBtn")!.click());
  await page.locator('.tab[aria-selected="true"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[role="tab"]').first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[role="tab"]').last()).toBeFocused();
  await expect(page.locator("#editorPanel")).toHaveAttribute(
    "aria-labelledby",
    "tab-2",
  );
  await page.evaluate(() => document.getElementById("shortcutsBtn")!.click());
  await expect(
    page.getByRole("dialog", { name: "キーボードショートカット" }),
  ).toBeVisible();
});

test("built HTML has all license notices, package version and exact CSP hashes", async () => {
  const html = await readFile(resolve("dist/weditor.html"), "utf8");
  const license = await readFile(resolve("LICENSE"), "utf8");
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  expect(html).toContain(license.replace(/--/g, "—"));
  expect(html).toContain("Copyright (c) 2012 polygonplanet");
  expect(html).toContain("SIL OPEN FONT LICENSE");
  expect(html).toContain(`WEditor <span>${pkg.version}</span>`);
  expect(html).not.toContain("__APP_VERSION__");
  for (const tag of ["script", "style"]) {
    const content = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))![1];
    const digest = createHash("sha256").update(content).digest("base64");
    expect(html).toContain(`${tag}-src 'sha256-${digest}'`);
  }
  expect(html).toContain("connect-src 'none'");
});

test("invalid font preferences and truncated trailing-dot filenames are sanitized", () => {
  for (const fontSize of [NaN, Infinity, 15.5, -1, 100, "20"])
    expect(readFontSize({ fontSize })).toBe(15);
  expect(readFontSize({ fontSize: 20 })).toBe(20);
  expect(safeFileName("a".repeat(179) + ".tail")).toBe("a".repeat(179));
});
