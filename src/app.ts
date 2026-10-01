import { strings, type Language, type MessageKey } from "./i18n.ts";
import {
  $,
  type EditorTab,
  type SearchMatch,
  type LocalFileHandle,
  type LineEnding,
  fileAPI,
} from "./types.ts";
import { errorMessage, isAbort, safeFileName } from "./safety.ts";
import { findMatches } from "./search.ts";
import { countLines, lineStart, indentBlock, continueLine } from "./text.ts";
import { detectFile, encodeFile, type FileEncoding } from "./encoding.ts";
import { writeToHandle, downloadFile } from "./file-storage.ts";
import { rememberEdit, moveHistory } from "./history.ts";
import { loadSettings, readFontSize, saveSettings } from "./settings.ts";
import {
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  INDENT_SIZE,
  canAddDocument,
  canUpdateDocument,
} from "./limits.ts";
import { installMenus } from "./menus.ts";
import { resolveStartup } from "./environment.ts";

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const platformNavigator = navigator as Navigator & {
  userAgentData?: { platform?: string };
};
const storedSettings = loadSettings();
const startup = resolveStartup(
  {
    search: window.location.search,
    languages: navigator.languages,
    language: navigator.language,
    darkMode: systemTheme.matches,
    platform:
      platformNavigator.userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent,
  },
  storedSettings,
);
let followSystemTheme = !startup.themeIsExplicit;
let followSystemLanguage = !startup.languageIsExplicit;
let rememberedTheme = startup.savedTheme;
let rememberedLanguage = startup.savedLang;
function systemLanguage(): Language {
  return resolveStartup({
    search: "",
    languages: navigator.languages,
    language: navigator.language,
    darkMode: systemTheme.matches,
    platform: "",
  }).lang;
}

let lang: Language = startup.lang,
  theme: "light" | "dark" = startup.theme,
  fontSize = readFontSize(storedSettings),
  tabs: EditorTab[] = [],
  activeId = 0,
  serial = 0,
  matches: SearchMatch[] = [],
  matchIndex = -1,
  composing = false,
  toastTimer: ReturnType<typeof setTimeout>,
  nameResolve: ((name: string | null) => void) | null = null,
  confirmedName: string | null = null;
const editor = $("editor");
editor.maxLength = MAX_TEXT_CHARS;
const t = (key: MessageKey) => strings[lang][key] || key;
const current = (): EditorTab => {
  const tab = tabs.find((tab) => tab.id === activeId);
  if (!tab) throw new Error("Missing active tab");
  return tab;
};
const dirty = (tab: EditorTab) =>
  tab.text !== tab.savedText || tab.eol !== tab.savedEol;
function notify(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function applySettings() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--font", fontSize + "px");
  document.documentElement.style.setProperty(
    "--leading",
    Math.round(fontSize * 1.6) + "px",
  );

  document
    .querySelectorAll<HTMLElement>("[data-i18n]")
    .forEach((el) => (el.textContent = t(el.dataset.i18n as MessageKey)));
  document
    .querySelectorAll<HTMLInputElement>("[data-placeholder]")
    .forEach((el) => {
      el.placeholder = t(el.dataset.placeholder as MessageKey);
      el.setAttribute("aria-label", el.placeholder);
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-theme-choice]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeChoice === theme),
      ),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-language-choice]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.languageChoice === lang),
      ),
    );
  editor.placeholder = t("placeholder");
  editor.setAttribute("aria-label", t("editorLabel"));
  $("tabs").setAttribute("aria-label", t("filesLabel"));
  document
    .querySelector(".toolbar")!
    .setAttribute("aria-label", t("toolbarLabel"));
  $("searchBar").setAttribute("aria-label", t("find"));
  $("closeSearch").setAttribute("aria-label", t("searchClose"));
  $("smallerBtn").setAttribute("aria-label", t("smaller"));
  $("largerBtn").setAttribute("aria-label", t("larger"));
  $("fileName").setAttribute("aria-label", t("filename"));
  $("eolBtn").title = t("newline");
  const keys: [MessageKey, string][] = [
    ["new", "Ctrl+Alt+N"],
    ["open", "Ctrl+O"],
    ["save", "Ctrl+S"],
    ["saveAs", "Ctrl+Shift+S"],
    ["find", "Ctrl+F / Ctrl+H"],
    ["undo", "Ctrl+Z"],
    ["redo", "Ctrl+Shift+Z / Ctrl+Y"],
    ["indentHelp", "Tab / Shift+Tab"],
    ["nextHelp", "F3 / Shift+F3"],
    ["fontHelp", "Ctrl+＋ / Ctrl+−"],
    ["resetZoom", "Ctrl+0"],
    ["tabsHelp", "Alt+→ / Alt+←"],
  ];
  $("helpKeys").replaceChildren(
    ...keys.flatMap(([key, value]) => {
      const label = document.createElement("span");
      label.textContent = t(key);
      const shortcut = document.createElement("kbd");
      shortcut.textContent = value;
      return [label, shortcut];
    }),
  );
  updateTabSize();
  renderTabs();
  render();
  saveSettings(fontSize, rememberedTheme, rememberedLanguage);
}
function updateTabSize() {
  const size = INDENT_SIZE;
  editor.style.tabSize = String(size);
  $("mirror").style.tabSize = String(size);
}
function capture() {
  if (!tabs.length) return;
  const tab = current();
  tab.text = editor.value;
  tab.start = editor.selectionStart;
  tab.end = editor.selectionEnd;
  tab.scrollTop = editor.scrollTop;
  tab.scrollLeft = editor.scrollLeft;
}
function addTab(
  name: string | null = null,
  text = "",
  handle: LocalFileHandle | null = null,
  eol: LineEnding = startup.newFileEol,
  bom = false,
  encoding: FileEncoding = "UTF-8",
) {
  capture();
  if (!canAddDocument(tabs, text)) {
    notify(t("workspaceLimit"));
    return null;
  }
  const tab: EditorTab = {
    id: ++serial,
    name: name || null,
    text,
    savedText: text,
    pendingSaveText: null,
    eol,
    savedEol: eol,
    bom,
    encoding,
    handle,
    start: 0,
    end: 0,
    scrollTop: 0,
    scrollLeft: 0,
    undo: [],
    redo: [],
  };
  tabs.push(tab);
  activeId = tab.id;
  loadTab();
  return tab;
}
function loadTab() {
  const tab = current();
  editor.value = tab.text;
  editor.setSelectionRange(tab.start, tab.end);
  editor.scrollTop = tab.scrollTop;
  editor.scrollLeft = tab.scrollLeft;
  matchIndex = -1;
  renderTabs();
  render();
  editor.focus();
}
function switchTab(id: number) {
  if (id === activeId) return;
  capture();
  activeId = id;
  loadTab();
}
function displayName(tab: EditorTab) {
  return tab.name || t("untitled") + " " + tab.id;
}
function renderTabs() {
  const container = $("tabs");
  container.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = "tab" + (tab.id === activeId ? " active" : "");
    item.setAttribute("role", "tab");
    item.id = `tab-${tab.id}`;
    item.setAttribute("aria-controls", "editorPanel");
    item.setAttribute(
      "aria-label",
      displayName(tab) + (dirty(tab) ? " — " + t("modified") : ""),
    );
    item.setAttribute("aria-selected", tab.id === activeId ? "true" : "false");
    item.tabIndex = tab.id === activeId ? 0 : -1;
    item.title = displayName(tab);
    if (tab.id === activeId) {
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("class", "tab-pen");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const title = document.createElementNS(icon.namespaceURI, "title");
      title.textContent = t("activeTab");
      const path = document.createElementNS(icon.namespaceURI, "path");
      path.setAttribute(
        "d",
        "M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L17 3Z M15 5l3 3",
      );
      icon.append(title, path);
      item.append(icon);
    }
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = displayName(tab);
    item.append(name);
    if (dirty(tab)) {
      const dot = document.createElement("span");
      dot.className = "dirty";
      dot.textContent = "●";
      dot.setAttribute("aria-label", t("modified"));
      item.append(dot);
    }
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.setAttribute("aria-label", t("closeTab") + ": " + displayName(tab));
    close.onclick = (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    };
    item.append(close);
    item.onclick = () => switchTab(tab.id);
    item.onkeydown = (event) => {
      if (event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        switchTab(tab.id);
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        cycleTab(event.key === "ArrowRight" ? 1 : -1);
        document
          .querySelector<HTMLElement>('.tab[aria-selected="true"]')
          ?.focus();
      }
    };
    container.append(item);
  }
  const add = document.createElement("button");
  add.className = "add-tab";
  add.textContent = "+";
  add.setAttribute("aria-label", t("new"));
  add.onclick = () => addTab();
  container.append(add);
  $("editorPanel").setAttribute("aria-labelledby", `tab-${activeId}`);
  document.title =
    displayName(current()) + (dirty(current()) ? " •" : "") + " — WEditor";
}
function closeTab(id: number) {
  capture();
  const tab = tabs.find((tab) => tab.id === id);
  if (!tab) return;
  if (dirty(tab) && !confirm(t("closeConfirm"))) return;
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  if (!tabs.length) {
    addTab();
    return;
  }
  if (activeId === id) {
    activeId = tabs[Math.min(index, tabs.length - 1)].id;
    loadTab();
  } else renderTabs();
}
function cycleTab(direction: number) {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  switchTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}
let matchesTruncated = false;
function computeMatches() {
  matches = [];
  matchesTruncated = false;
  const query = $("query").value;
  if ($("searchBar").hidden || !query) {
    matchIndex = -1;
    return;
  }
  const found = findMatches(editor.value, query, $("caseSensitive").checked);
  matches = found.matches;
  matchesTruncated = found.truncated;
  if (matchIndex >= matches.length) matchIndex = matches.length - 1;
}
function renderMirror() {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    fragment.append(
      document.createTextNode(editor.value.slice(offset, match.start)),
    );
    const mark = document.createElement("mark");
    if (i === matchIndex) mark.className = "current";
    mark.textContent = editor.value.slice(match.start, match.end);
    fragment.append(mark);
    offset = match.end;
  }
  fragment.append(document.createTextNode(editor.value.slice(offset) + "\n "));
  $("mirror").replaceChildren(fragment);
  syncScroll();
  $("matchCount").textContent = !$("query").value
    ? t("searchHint")
    : matches.length
      ? (matchIndex >= 0 ? matchIndex + 1 + " / " : "") +
        matches.length +
        (matchesTruncated ? "+" : "") +
        " " +
        t("matches")
      : t("noMatches");
}
let renderedNumbers = "";
function renderNumbers() {
  const total = countLines(editor.value);
  const line = countLines(editor.value, editor.selectionStart);
  // Only mount the visible line numbers, even for large newline-heavy files.
  const height = Math.round(fontSize * 1.6);
  const paddingTop = Number.parseFloat(getComputedStyle(editor).paddingTop);
  const first = Math.max(
    0,
    Math.floor((editor.scrollTop - paddingTop) / height) - 5,
  );
  const last = Math.min(
    total,
    first + Math.ceil(editor.clientHeight / height) + 12,
  );
  const key = `${first}:${last}:${line}`;
  if (renderedNumbers !== key) {
    const fragment = document.createDocumentFragment();
    for (let index = first; index < last; index++) {
      const item = document.createElement("div");
      item.className = "gutter-line" + (index + 1 === line ? " active" : "");
      item.textContent = String(index + 1);
      fragment.append(item);
    }
    $("lineNumbers").replaceChildren(fragment);
    renderedNumbers = key;
  }
  $("lineNumbers").style.transform =
    `translateY(${first * height - editor.scrollTop}px)`;
}
function setStatusText(id: string, text: string) {
  const element = $(id);
  // Avoid replacing identical text nodes during native selection events.
  if (element.textContent !== text) element.textContent = text;
}
function renderStatus() {
  const tab = current();
  const prefix = editor.value.slice(0, editor.selectionStart);
  const line = countLines(prefix);
  const col = prefix.length - prefix.lastIndexOf("\n");
  setStatusText(
    "position",
    t("line") + " " + line + ", " + t("col") + " " + col,
  );
  setStatusText(
    "length",
    editor.value.length.toLocaleString() +
      " " +
      t("chars") +
      " · " +
      countLines(editor.value).toLocaleString() +
      " " +
      t("lines"),
  );
  setStatusText("eolBtn", tab.eol);
  setStatusText("encoding", tab.encoding + (tab.bom ? " BOM" : ""));
  $("undoBtn").disabled = !tab.undo.length;
  $("redoBtn").disabled = !tab.redo.length;
}
function render() {
  computeMatches();
  renderMirror();
  renderNumbers();
  renderStatus();
}
function syncScroll() {
  $("mirror").scrollTop = editor.scrollTop;
  $("mirror").scrollLeft = editor.scrollLeft;
}
// Each tab owns its undo history, including keyboard edits and replacements.
function snapshot() {
  return {
    text: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
  };
}
function remember() {
  rememberEdit(tabs, current(), snapshot());
}
function changed() {
  const tab = current();
  if (!canUpdateDocument(tabs, tab.id, editor.value)) {
    editor.value = tab.text;
    editor.setSelectionRange(tab.start, tab.end);
    notify(t("workspaceLimit"));
    render();
    return;
  }
  capture();
  renderTabs();
  render();
}
function insert(
  text: string,
  start = editor.selectionStart,
  end = editor.selectionEnd,
  selection?: [number, number],
) {
  if (editor.value.length - (end - start) + text.length > MAX_TEXT_CHARS) {
    notify(t("textTooLarge"));
    return;
  }
  remember();
  editor.setRangeText(text, start, end, "end");
  if (selection) editor.setSelectionRange(selection[0], selection[1]);
  changed();
  editor.focus();
}
function undo(redo = false) {
  const tab = current();
  const candidate = (redo ? tab.redo : tab.undo).at(-1);
  if (!candidate) return;
  if (!canUpdateDocument(tabs, tab.id, candidate.text)) {
    notify(t("workspaceLimit"));
    return;
  }
  const state = moveHistory(tabs, tab, snapshot(), redo)!;
  editor.value = state.text;
  editor.setSelectionRange(state.start, state.end);
  changed();
  editor.focus();
  revealCaret();
}
editor.addEventListener("beforeinput", (event) => {
  if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
    event.preventDefault();
    undo(event.inputType === "historyRedo");
  } else if (!composing) remember();
});
editor.addEventListener("input", () => {
  changed();
});
editor.addEventListener("compositionstart", () => {
  remember();
  composing = true;
});
editor.addEventListener("compositionend", () => {
  composing = false;
  changed();
});
editor.addEventListener("scroll", () => {
  syncScroll();
  renderNumbers();
});
document.addEventListener("selectionchange", () => {
  if (document.activeElement === editor) {
    renderNumbers();
    renderStatus();
  }
});
function indentSelection(outdent: boolean) {
  const value = editor.value,
    start = editor.selectionStart,
    end = editor.selectionEnd;
  const unit = " ".repeat(INDENT_SIZE);
  if (!outdent && start === end) {
    const column = start - lineStart(value, start);
    insert(" ".repeat(unit.length - (column % unit.length)));
    return;
  }
  const edit = indentBlock(value, start, end, unit, outdent);
  insert(edit.replacement, edit.from, edit.to, edit.selection);
}
editor.addEventListener("keydown", (event) => {
  if (composing || event.isComposing) return;
  if (event.key === "Tab") {
    event.preventDefault();
    indentSelection(event.shiftKey);
  } else if (
    event.key === "Enter" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    const edit = continueLine(
      editor.value,
      editor.selectionStart,
      editor.selectionEnd,
      !event.shiftKey,
    );
    insert(
      edit.replacement,
      edit.from,
      edit.to,
      "selection" in edit ? edit.selection : undefined,
    );
  }
});
function revealCaret() {
  const pos = editor.selectionStart;
  const line = countLines(editor.value, pos) - 1;
  const style = getComputedStyle(editor);
  const height = Math.round(fontSize * 1.6),
    y = Number.parseFloat(style.paddingTop) + line * height;
  if (
    y < editor.scrollTop ||
    y + height > editor.scrollTop + editor.clientHeight
  )
    editor.scrollTop = Math.max(0, y - editor.clientHeight / 2);
  const column = pos - lineStart(editor.value, pos);
  const prefix = editor.value.slice(pos - column, pos);
  const size = INDENT_SIZE;
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.fontKerning = "none";
  const tabWidth = context.measureText(" ").width * size;
  let width = 0;
  const parts = prefix.split("\t");
  for (let index = 0; index < parts.length; index++) {
    width += context.measureText(parts[index]).width;
    if (index < parts.length - 1)
      width = (Math.floor(width / tabWidth) + 1) * tabWidth;
  }
  const x = Number.parseFloat(style.paddingLeft) + width;
  if (x < editor.scrollLeft || x > editor.scrollLeft + editor.clientWidth - 35)
    editor.scrollLeft = Math.max(0, x - editor.clientWidth / 2);
  syncScroll();
}
function openSearch() {
  capture();
  $("searchBar").hidden = false;
  if (editor.selectionEnd > editor.selectionStart) {
    const selected = editor.value.slice(
      editor.selectionStart,
      editor.selectionEnd,
    );
    if (!selected.includes("\n"))
      $("query").value = selected.slice(0, $("query").maxLength);
  }
  matchIndex = -1;
  render();
  $("query").focus();
  $("query").select();
}
function closeSearch() {
  $("searchBar").hidden = true;
  render();
  editor.focus();
}
function navigateMatch(direction: number) {
  computeMatches();
  if (!matches.length) {
    renderMirror();
    return;
  }
  if (matchIndex < 0) {
    const pos = editor.selectionStart;
    matchIndex =
      direction > 0
        ? matches.findIndex((m) => m.start >= pos)
        : matches.findLastIndex((m) => m.start < pos);
    if (matchIndex < 0) matchIndex = direction > 0 ? 0 : matches.length - 1;
  } else
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
  const match = matches[matchIndex];
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  capture();
  revealCaret();
  renderMirror();
  renderNumbers();
  renderStatus();
}
function replaceOne() {
  computeMatches();
  if (!matches.length) return;
  let index = matches.findIndex(
    (m) => m.start === editor.selectionStart && m.end === editor.selectionEnd,
  );
  if (index < 0) {
    matchIndex = -1;
    navigateMatch(1);
    return;
  }
  const match = matches[index];
  insert($("replacement").value, match.start, match.end);
  matchIndex = -1;
  navigateMatch(1);
}
function replaceAll() {
  computeMatches();
  if (matchesTruncated) {
    notify(t("matchLimit"));
    return;
  }
  if (!matches.length) return;
  const count = matches.length;
  const nextLength =
    editor.value.length +
    matches.reduce(
      (delta, match) =>
        delta + $("replacement").value.length - (match.end - match.start),
      0,
    );
  if (nextLength > MAX_TEXT_CHARS) {
    notify(t("textTooLarge"));
    return;
  }
  let value = "",
    offset = 0;
  for (const match of matches) {
    value += editor.value.slice(offset, match.start) + $("replacement").value;
    offset = match.end;
  }
  value += editor.value.slice(offset);
  insert(value, 0, editor.value.length, [0, 0]);
  matchIndex = -1;
  render();
  notify(count + " " + t("allReplaced"));
}
async function readFile(file: File, handle: LocalFileHandle | null = null) {
  if (file.size > MAX_FILE_BYTES) {
    notify(t("fileTooLarge"));
    return;
  }
  try {
    const decoded = detectFile(new Uint8Array(await file.arrayBuffer()));
    addTab(
      file.name,
      decoded.text,
      handle,
      decoded.eol,
      decoded.bom,
      decoded.encoding,
    );
  } catch {
    notify(t("invalidFile") + " " + t("supportedEncodings"));
  }
}
async function openFiles() {
  try {
    if (typeof fileAPI.showOpenFilePicker === "function") {
      const handles = await fileAPI.showOpenFilePicker({ multiple: true });
      for (const handle of handles) {
        let existing: EditorTab | undefined;
        for (const tab of tabs) {
          if (
            tab.handle &&
            (tab.handle === handle ||
              (handle.isSameEntry && (await handle.isSameEntry(tab.handle))))
          ) {
            existing = tab;
            break;
          }
        }
        if (existing) switchTab(existing.id);
        else await readFile(await handle.getFile(), handle);
      }
    } else {
      $("fileInput").value = "";
      $("fileInput").click();
    }
  } catch (error) {
    if (!isAbort(error)) notify(t("error") + ": " + errorMessage(error));
  }
}
$("fileInput").onchange = async () => {
  try {
    for (const file of $("fileInput").files || []) await readFile(file);
  } catch (error) {
    notify(t("error") + ": " + errorMessage(error));
  }
};
function requestName(tab: EditorTab): Promise<string | null> {
  confirmedName = null;
  $("fileName").value = tab.name || displayName(tab) + ".txt";
  $("nameDialog").showModal();
  $("fileName").focus();
  $("fileName").select();
  return new Promise((resolve) => (nameResolve = resolve));
}
$("nameForm").onsubmit = (event) => {
  event.preventDefault();
  const name = $("fileName").value.trim();
  if (!name) {
    notify(t("emptyName"));
    return;
  }
  confirmedName = safeFileName(name);
  $("nameDialog").close();
};
$("cancelName").onclick = () => $("nameDialog").close();
$("nameDialog").addEventListener("close", () => {
  const resolve = nameResolve;
  const name = confirmedName;
  nameResolve = null;
  confirmedName = null;
  resolve?.(name);
});
let saving = false;
async function saveFile(saveAs = false) {
  if (saving) return;
  capture();
  const tab = current();
  const savedText = tab.text,
    savedEol = tab.eol;
  saving = true;
  tab.pendingSaveText = savedText;
  try {
    // Encode and verify before opening a writable stream or creating a download.
    const content = encodeFile(savedText, tab.encoding, savedEol, tab.bom);
    let handle = saveAs ? null : tab.handle;
    if (!handle && typeof fileAPI.showSaveFilePicker === "function")
      handle = await fileAPI.showSaveFilePicker({
        suggestedName: safeFileName(tab.name || displayName(tab) + ".txt"),
      });
    if (handle) {
      await writeToHandle(handle, content);
      tab.handle = handle;
      tab.name = handle.name;
      notify(t("saved"));
    } else {
      const name = saveAs || !tab.name ? await requestName(tab) : tab.name;
      if (!name) return;
      downloadFile(content, name);
      tab.name = name;
      notify(t("downloaded"));
    }
    tab.savedText = savedText;
    tab.savedEol = savedEol;
    renderTabs();
    renderStatus();
  } catch (error) {
    if (error instanceof Error && error.message === "UNREPRESENTABLE_TEXT")
      notify(t("unrepresentable"));
    else if (!isAbort(error)) notify(t("error") + ": " + errorMessage(error));
  } finally {
    tab.pendingSaveText = null;
    saving = false;
  }
}
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("drop", async (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  try {
    for (const file of event.dataTransfer.files) await readFile(file);
  } catch (error) {
    notify(t("error") + ": " + errorMessage(error));
  }
});
window.addEventListener("beforeunload", (event) => {
  capture();
  if (tabs.some(dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function zoom(delta: number) {
  fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize + delta));
  applySettings();
}
installMenus();
$("newBtn").onclick = () => addTab();
$("openBtn").onclick = () => openFiles();
$("saveBtn").onclick = () => saveFile();
$("saveAsBtn").onclick = () => saveFile(true);
$("undoBtn").onclick = () => undo();
$("redoBtn").onclick = () => undo(true);
$("findBtn").onclick = openSearch;
for (const preference of ["light", "dark"] as const) {
  const id = { light: "themeLightBtn", dark: "themeDarkBtn" }[preference];
  $(id).onclick = () => {
    followSystemTheme = false;
    rememberedTheme = theme = preference;
    applySettings();
  };
}
for (const preference of ["ja", "en"] as const) {
  const id = { ja: "languageJaBtn", en: "languageEnBtn" }[preference];
  $(id).onclick = () => {
    followSystemLanguage = false;
    rememberedLanguage = lang = preference;
    applySettings();
  };
}
$("shortcutsBtn").onclick = () => $("helpDialog").showModal();
$("aboutBtn").onclick = () => $("aboutDialog").showModal();
$("closeAbout").onclick = () => $("aboutDialog").close();
$("resetZoomBtn").onclick = () => {
  fontSize = DEFAULT_FONT_SIZE;
  applySettings();
};
$("closeHelp").onclick = () => $("helpDialog").close();
$("smallerBtn").onclick = () => zoom(-1);
$("largerBtn").onclick = () => zoom(1);
$("eolBtn").onclick = () => {
  current().eol = current().eol === "LF" ? "CRLF" : "LF";
  renderTabs();
  renderStatus();
};
$("closeSearch").onclick = closeSearch;
$("prevBtn").onclick = () => navigateMatch(-1);
$("nextBtn").onclick = () => navigateMatch(1);
$("replaceBtn").onclick = replaceOne;
$("replaceAllBtn").onclick = replaceAll;
for (const id of ["query", "caseSensitive"] as const)
  $(id).addEventListener("input", () => {
    matchIndex = -1;
    render();
  });
$("query").onkeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    navigateMatch(event.shiftKey ? -1 : 1);
  }
};
document.addEventListener("keydown", (event) => {
  if (composing || event.isComposing || document.querySelector("dialog[open]"))
    return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && ["s", "o", "f", "h"].includes(key)) {
    event.preventDefault();
    if (key === "s") saveFile(event.shiftKey);
    if (key === "o") openFiles();
    if (key === "f" || key === "h") openSearch();
  } else if (mod && event.altKey && key === "n") {
    event.preventDefault();
    addTab();
  } else if (
    mod &&
    ["z", "y"].includes(key) &&
    document.activeElement === editor
  ) {
    event.preventDefault();
    undo(key === "y" || event.shiftKey);
  } else if (event.key === "F3") {
    event.preventDefault();
    if ($("searchBar").hidden) openSearch();
    else navigateMatch(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape" && !$("searchBar").hidden) {
    event.preventDefault();
    closeSearch();
  } else if (mod && key === "0") {
    event.preventDefault();
    fontSize = DEFAULT_FONT_SIZE;
    applySettings();
  } else if (mod && ["+", "=", "-"].includes(key)) {
    event.preventDefault();
    zoom(key === "-" ? -1 : 1);
  } else if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    cycleTab(event.key === "ArrowRight" ? 1 : -1);
  }
});
systemTheme.addEventListener("change", (event) => {
  if (!followSystemTheme) return;
  theme = event.matches ? "dark" : "light";
  applySettings();
});
window.addEventListener("languagechange", () => {
  if (followSystemLanguage) {
    lang = systemLanguage();
    applySettings();
  }
});
addTab();
applySettings();
