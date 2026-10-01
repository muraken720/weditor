import { defineConfig } from "@playwright/test";

const browser = process.env.PW_BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browser))
  throw new Error("Unsupported PW_BROWSER");
const channel =
  process.env.PW_CHANNEL ||
  (process.platform === "win32" && browser === "chromium"
    ? "msedge"
    : undefined);
if (channel && browser !== "chromium")
  throw new Error("PW_CHANNEL requires chromium");
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: browser as "chromium" | "firefox" | "webkit",
    channel,
    viewport: { width: 1280, height: 800 },
    headless: true,
  },
  reporter: "list",
});
