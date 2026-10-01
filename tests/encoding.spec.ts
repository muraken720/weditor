import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { clickMenuAction } from "./helpers.ts";
import {
  decodeFile,
  detectFile,
  encodeFile,
  type FileEncoding,
} from "../src/encoding.ts";
const url = pathToFileURL(resolve("dist/weditor.html")).href;
test.use({ locale: "ja-JP", colorScheme: "light" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined });
  });
  await page.goto(url);
});
const fixtures: [FileEncoding, string, boolean][] = [
  ["UTF-8", "e697a5e69cace8aa9e0d0a", false],
  ["Shift_JIS (CP932)", "93fa967b8cea0d0a", false],
  ["EUC-JP", "c6fccbdcb8ec0d0a", false],
  ["ISO-2022-JP", "1b2442467c4b5c386c1b28420d0a", false],
  ["UTF-16LE", "fffee5652c679e8a0d000a00", true],
  ["UTF-16BE", "feff65e5672c8a9e000d000a", true],
];
for (const [encoding, hex, bom] of fixtures) {
  test(`${encoding} opens, edits, and saves with original encoding, BOM and CRLF`, async ({
    page,
  }) => {
    const original = Buffer.from(hex, "hex");
    expect(decodeFile(original, encoding).text).toBe("日本語\n");
    await page.locator("#fileInput").setInputFiles({
      name: "original.txt",
      mimeType: "text/plain",
      buffer: original,
    });
    await expect(page.locator("#editor")).toHaveValue("日本語\n");
    await expect(page.locator("#encoding")).toHaveText(
      encoding + (bom ? " BOM" : ""),
    );
    // Known original bytes plus an ASCII append, independently of encoder output.
    await page.locator("#editor").fill("日本語\nupdated");
    const downloading = page.waitForEvent("download");
    await clickMenuAction(page, "saveBtn");
    const saved = await readFile((await (await downloading).path())!);
    const append =
      encoding === "UTF-16LE"
        ? Buffer.from("updated", "utf16le")
        : encoding === "UTF-16BE"
          ? Buffer.from("0075007000640061007400650064", "hex")
          : Buffer.from("updated");
    expect(saved).toEqual(Buffer.concat([original, append]));
  });
}

test("legacy save rejects unrepresentable emoji before starting any write or download", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles({
    name: "sjis.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("93fa967b8cea", "hex"),
  });
  await page.locator("#editor").fill("日本語😀");
  let downloads = 0;
  page.on("download", () => downloads++);
  await clickMenuAction(page, "saveBtn");
  await expect(page.locator("#toast")).toContainText("保存は中止");
  await expect(page.locator(".tab.active .dirty")).toHaveText("●");
  expect(downloads).toBe(0);
  await expect(page.locator("#editor")).toHaveValue("日本語😀");
});

test("ambiguous, unsupported and BOM-less UTF-16 files show supported encodings without opening a tab", async ({
  page,
}) => {
  await expect(page.locator("#openEncodingBtn, #encodingDialog")).toHaveCount(
    0,
  );
  await page.locator("#editor").fill("keep");
  for (const hex of ["a4a2", "ff", "41004200"]) {
    await page.locator("#fileInput").setInputFiles({
      name: "unknown.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(hex, "hex"),
    });
    await expect(page.locator("#toast")).toContainText("開けません");
    await expect(page.locator("#toast")).toContainText(
      "UTF-8、Shift_JIS（CP932）、EUC-JP、ISO-2022-JP、UTF-16LE／BE（BOM付き）",
    );
    await expect(page.locator("#editor")).toHaveValue("keep");
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
  }
});

test("batch opening skips ambiguous files and keeps independent encodings", async ({
  page,
}) => {
  await page.locator("#fileInput").setInputFiles([
    {
      name: "sjis.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("93fa967b8cea", "hex"),
    },
    {
      name: "ambiguous.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a4a2", "hex"),
    },
    {
      name: "euc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("c6fccbdcb8ec", "hex"),
    },
  ]);
  await expect(page.locator("#encoding")).toHaveText("EUC-JP");
  await expect(page.locator('[role="tab"]')).toHaveCount(3);
  await page.locator('[role="tab"][title="sjis.txt"]').click();
  await expect(page.locator("#encoding")).toHaveText("Shift_JIS (CP932)");
  await expect(page.locator("#editor")).toHaveValue("日本語");
});

test("codec refuses ambiguous detection, broken byte sequences and lossy Unicode writes", () => {
  expect(() => detectFile(new Uint8Array([0xa4, 0xa2]))).toThrow(
    "AMBIGUOUS_ENCODING",
  );
  expect(detectFile(new Uint8Array([0x82, 0xa0])).encoding).toBe(
    "Shift_JIS (CP932)",
  );
  expect(detectFile(new Uint8Array([65, 66])).encoding).toBe("UTF-8");
  expect(
    decodeFile(new Uint8Array([0xfa, 0xb1]), "Shift_JIS (CP932)").text,
  ).toBe("﨑");
  expect(
    decodeFile(new Uint8Array([0xed, 0x95]), "Shift_JIS (CP932)").text,
  ).toBe("﨑");
  expect(() =>
    decodeFile(new Uint8Array([0x82]), "Shift_JIS (CP932)"),
  ).toThrow();
  expect(() =>
    decodeFile(new Uint8Array([0xff, 0xfe, 0x00]), "UTF-16LE"),
  ).toThrow();
  expect(() => encodeFile("😀", "EUC-JP", "LF", false)).toThrow();
  expect(() => encodeFile("\ud800", "UTF-8", "LF", false)).toThrow();
});
