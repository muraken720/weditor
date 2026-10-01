// Centralized resource limits; byte budgets approximate UTF-16 string storage.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MATCHES = 10_000;
export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 300;
export const MAX_TEXT_CHARS = 10 * 1024 * 1024;
export const MAX_TABS = 32;
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_FONT_SIZE = 15;
export const MIN_FONT_SIZE = 11;
export const MAX_FONT_SIZE = 28;
export const INDENT_SIZE = 4;

interface DocumentText {
  id: number;
  text: string;
  savedText: string;
  pendingSaveText?: string | null;
}
export function documentBytes(
  text: string,
  savedText = text,
  pendingSaveText?: string | null,
): number {
  const pending =
    pendingSaveText != null &&
    pendingSaveText !== text &&
    pendingSaveText !== savedText
      ? pendingSaveText.length
      : 0;
  return (
    (text.length + (text === savedText ? 0 : savedText.length) + pending) * 2
  );
}
export function canAddDocument(
  documents: readonly DocumentText[],
  text: string,
): boolean {
  return (
    documents.length < MAX_TABS &&
    documents.reduce(
      (sum, doc) =>
        sum + documentBytes(doc.text, doc.savedText, doc.pendingSaveText),
      documentBytes(text),
    ) <= MAX_DOCUMENT_BYTES
  );
}
export function canUpdateDocument(
  documents: readonly DocumentText[],
  id: number,
  text: string,
): boolean {
  return (
    text.length <= MAX_TEXT_CHARS &&
    documents.reduce(
      (sum, doc) =>
        sum +
        documentBytes(
          doc.id === id ? text : doc.text,
          doc.savedText,
          doc.pendingSaveText,
        ),
      0,
    ) <= MAX_DOCUMENT_BYTES
  );
}
