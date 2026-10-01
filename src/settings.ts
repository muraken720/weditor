import { readSettings } from "./safety.ts";
import { SETTINGS_VERSION, type Theme } from "./environment.ts";
import type { Language } from "./i18n.ts";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "./limits.ts";
const KEY = "weditor-settings";
export function loadSettings(): Record<string, unknown> {
  try {
    return readSettings(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}
export function readFontSize(settings: Record<string, unknown>): number {
  const size = settings.fontSize;
  return typeof size === "number" &&
    Number.isInteger(size) &&
    size >= MIN_FONT_SIZE &&
    size <= MAX_FONT_SIZE
    ? size
    : DEFAULT_FONT_SIZE;
}
export function saveSettings(
  fontSize: number,
  theme: Theme | null,
  lang: Language | null,
) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        fontSize,
        ...(theme ? { theme } : {}),
        ...(lang ? { lang } : {}),
      }),
    );
  } catch {
    /* Storage may be blocked for file:// or private browsing. */
  }
}
