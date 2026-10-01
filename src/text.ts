/** Count without creating a potentially huge array for newline-heavy documents. */
export function countLines(text: string, end = text.length): number {
  let count = 1,
    offset = -1;
  while ((offset = text.indexOf("\n", offset + 1)) !== -1 && offset < end)
    count++;
  return count;
}
export function lineStart(text: string, offset: number): number {
  return offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
}

/** Preserve the exact whitespace and continue plain-text bullet/numbered lists. */
export function continueLine(
  text: string,
  start: number,
  end = start,
  continueList = true,
) {
  const from = lineStart(text, start);
  const prefix = text.slice(from, start);
  const indent = prefix.match(/^[ \t\u3000]*/)![0];
  const edit = { from: start, to: end, replacement: "\n" + indent };
  if (!continueList) return edit;
  // Requiring a separator avoids treating negative numbers and decimals as lists.
  const list = prefix.match(
    /^([ \t\u3000]*)(?:(\d{1,12})([.)])|([-*+]))([ \t\u3000]+)(.*)$/u,
  );
  if (!list) return edit;
  const [, leading, number, punctuation, bullet, separator] = list;
  const nextNewline = text.indexOf("\n", from);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const marker = number ? number + punctuation : bullet;
  const body = text
    .slice(from + leading.length + marker.length, lineEnd)
    .trim();
  if (!body && end <= lineEnd) {
    // Enter on an empty item exits the list on the same line, keeping indentation.
    return { from: from + leading.length, to: lineEnd, replacement: "" };
  }
  const nextMarker = number
    ? String(Number(number) + 1).padStart(number.length, "0") + punctuation
    : bullet;
  const inserted = "\n" + leading + nextMarker + separator;
  if (!number || end > lineEnd || nextNewline < 0)
    return { ...edit, replacement: inserted };
  let cursor = nextNewline + 1;
  let nextNumber = Number(number) + 2;
  let to = end;
  const renumbered: string[] = [];
  while (cursor < text.length) {
    const newline = text.indexOf("\n", cursor);
    const stop = newline < 0 ? text.length : newline;
    const line = text.slice(cursor, stop);
    const item = line.match(
      /^([ \t\u3000]*)(\d{1,12})([.)])([ \t\u3000]+)(.*)$/u,
    );
    if (
      !item ||
      item[1] !== leading ||
      item[3] !== punctuation ||
      nextNumber > 999999999999
    )
      break;
    const digits = String(nextNumber++);
    renumbered.push(
      item[1] +
        (item[2].startsWith("0")
          ? digits.padStart(item[2].length, "0")
          : digits) +
        item[3] +
        item[4] +
        item[5],
    );
    to = stop;
    cursor = stop + 1;
  }
  if (!renumbered.length) return { ...edit, replacement: inserted };
  const caret = start + inserted.length;
  return {
    from: start,
    to,
    replacement:
      inserted + text.slice(end, lineEnd) + "\n" + renumbered.join("\n"),
    selection: [caret, caret] as [number, number],
  };
}
export function indentBlock(
  text: string,
  start: number,
  end: number,
  unit: string,
  outdent: boolean,
) {
  const from = lineStart(text, start);
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const next = text.indexOf("\n", last);
  const to = next < 0 ? text.length : next;
  let position = from,
    newStart = start,
    newEnd = end;
  const edits: { position: number; removed: number; added: number }[] = [];
  const replacement = text
    .slice(from, to)
    .split("\n")
    .map((line) => {
      const removed = outdent
        ? line.startsWith("\t")
          ? 1
          : Math.min(
              unit === "\t" ? 4 : unit.length,
              line.match(/^ */)![0].length,
            )
        : 0;
      const added = outdent ? 0 : unit.length;
      edits.push({ position, removed, added });
      position += line.length + 1;
      return outdent ? line.slice(removed) : unit + line;
    })
    .join("\n");
  // Map selection endpoints through prefix edits. End-at-next-line stays outside.
  for (const edit of edits) {
    if (start >= edit.position)
      newStart += edit.added - Math.min(edit.removed, start - edit.position);
    if (end >= edit.position)
      newEnd += edit.added - Math.min(edit.removed, end - edit.position);
  }
  return {
    from,
    to,
    replacement,
    selection: [newStart, newEnd] as [number, number],
  };
}
