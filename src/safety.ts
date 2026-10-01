export function readSettings(raw: string | null): Record<string, unknown> {
  if (!raw || raw.length > 1024) return {};
  try {
    const settings: unknown = JSON.parse(raw);
    return settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
export function safeFileName(raw: string): string {
  // Portable file names, no paths or controls. File contents remain untouched.
  const name = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 180)
    .replace(/[. ]+$/g, "");
  if (!name || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))
    return "untitled.txt";
  // HTML documents are still downloadable; no preview or execution is offered.
  return name;
}
