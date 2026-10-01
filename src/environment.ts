import type { Language } from "./i18n.ts";
import type { LineEnding } from "./types.ts";

export type Theme = "light" | "dark";
export interface StartupEnvironment {
  search: string;
  languages: readonly string[];
  language: string;
  darkMode: boolean;
  platform: string;
}

export const SETTINGS_VERSION = 2;
/** URL overrides are temporary; only explicit menu choices are remembered. */
export function resolveStartup(
  environment: StartupEnvironment,
  stored: Record<string, unknown> = {},
) {
  const query = new URLSearchParams(environment.search);
  const locale = environment.languages[0] || environment.language;
  const systemLanguage: Language = /^ja(?:[-_]|$)/i.test(locale) ? "ja" : "en";
  const requestedLanguage = query.get("lang");
  const requestedTheme = query.get("theme");
  const savedLang: Language | null =
    stored.version === SETTINGS_VERSION &&
    (stored.lang === "ja" || stored.lang === "en")
      ? stored.lang
      : null;
  const savedTheme: Theme | null =
    stored.version === SETTINGS_VERSION &&
    (stored.theme === "light" || stored.theme === "dark")
      ? stored.theme
      : null;
  const lang: Language =
    requestedLanguage === "ja" || requestedLanguage === "en"
      ? requestedLanguage
      : (savedLang ?? systemLanguage);
  const theme: Theme =
    requestedTheme === "light" || requestedTheme === "dark"
      ? requestedTheme
      : (savedTheme ?? (environment.darkMode ? "dark" : "light"));
  return {
    lang,
    theme,
    savedLang,
    savedTheme,
    languageIsExplicit:
      requestedLanguage === "ja" ||
      requestedLanguage === "en" ||
      savedLang !== null,
    themeIsExplicit:
      requestedTheme === "light" ||
      requestedTheme === "dark" ||
      savedTheme !== null,
    newFileEol: (/^(?:win|windows)/i.test(environment.platform)
      ? "CRLF"
      : "LF") as LineEnding,
  };
}
