import type { LocalFileHandle } from "./types.ts";
import { safeFileName } from "./safety.ts";

/** Never commit the temporary stream after a write failure. Preserve its error. */
export async function writeToHandle(
  handle: LocalFileHandle,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.(error);
    } catch {
      /* Original write/commit error is more useful. */
    }
    throw error;
  }
}
export function downloadFile(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): void {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(name);
  try {
    document.body.append(link);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
}
