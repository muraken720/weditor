import type { FileEncoding } from "./encoding.ts";
export type LineEnding = "LF" | "CRLF";
export interface Snapshot {
  text: string;
  start: number;
  end: number;
}
export interface EditorTab extends Snapshot {
  id: number;
  name: string | null;
  savedText: string;
  pendingSaveText: string | null;
  eol: LineEnding;
  savedEol: LineEnding;
  bom: boolean;
  encoding: FileEncoding;
  handle: LocalFileHandle | null;
  scrollTop: number;
  scrollLeft: number;
  undo: Snapshot[];
  redo: Snapshot[];
}
export interface SearchMatch {
  start: number;
  end: number;
}
export interface LocalFileHandle {
  name: string;
  getFile(): Promise<File>;
  isSameEntry?(other: LocalFileHandle): Promise<boolean>;
  createWritable(): Promise<{
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
  }>;
}
interface FileAPI {
  showOpenFilePicker?: (options: {
    multiple: boolean;
  }) => Promise<LocalFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<LocalFileHandle>;
}
export const fileAPI = window as Window & FileAPI;
interface Elements {
  editor: HTMLTextAreaElement;
  query: HTMLInputElement;
  replacement: HTMLInputElement;
  caseSensitive: HTMLInputElement;
  fileInput: HTMLInputElement;
  fileName: HTMLInputElement;
  nameDialog: HTMLDialogElement;
  helpDialog: HTMLDialogElement;
  aboutDialog: HTMLDialogElement;
  nameForm: HTMLFormElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
}
export function $<K extends string>(
  id: K,
): K extends keyof Elements ? Elements[K] : HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as K extends keyof Elements ? Elements[K] : HTMLElement;
}
