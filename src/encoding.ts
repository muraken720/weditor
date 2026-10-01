import Encoding from "encoding-japanese";
import { MAX_FILE_BYTES } from "./limits.ts";
import type { LineEnding } from "./types.ts";

export const encodings = [
  "UTF-8",
  "Shift_JIS (CP932)",
  "EUC-JP",
  "ISO-2022-JP",
  "UTF-16LE",
  "UTF-16BE",
] as const;
export type FileEncoding = (typeof encodings)[number];
const legacy = {
  "Shift_JIS (CP932)": "SJIS",
  "EUC-JP": "EUCJP",
  "ISO-2022-JP": "JIS",
} as const;
export interface DecodedFile {
  text: string;
  encoding: FileEncoding;
  eol: LineEnding;
  bom: boolean;
}
function rawDecode(bytes: Uint8Array, encoding: FileEncoding): string {
  if (encoding in legacy) {
    return Encoding.codeToString(
      Encoding.convert(bytes, {
        to: "UNICODE",
        from: legacy[encoding as keyof typeof legacy],
      }),
    );
  }
  return new TextDecoder(encoding.toLowerCase(), {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
}
function rawEncode(
  text: string,
  encoding: FileEncoding,
): Uint8Array<ArrayBuffer> {
  if (encoding in legacy)
    return new Uint8Array(
      Encoding.convert(Encoding.stringToCode(text), {
        to: legacy[encoding as keyof typeof legacy],
        from: "UNICODE",
      }),
    );
  if (encoding === "UTF-8") return new TextEncoder().encode(text);
  const bytes = new Uint8Array(text.length * 2);
  const little = encoding === "UTF-16LE";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = little ? code & 255 : code >>> 8;
    bytes[i * 2 + 1] = little ? code >>> 8 : code & 255;
  }
  return bytes;
}
export function decodeFile(
  bytes: Uint8Array,
  encoding: FileEncoding,
): DecodedFile {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  const bom =
    encoding === "UTF-8"
      ? bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
      : encoding === "UTF-16LE"
        ? bytes[0] === 255 && bytes[1] === 254
        : encoding === "UTF-16BE"
          ? bytes[0] === 254 && bytes[1] === 255
          : false;
  const payload = bom ? bytes.subarray(encoding === "UTF-8" ? 3 : 2) : bytes;
  const text = rawDecode(payload, encoding);
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text))
    throw new Error("BINARY_FILE");
  const roundTrip = rawEncode(text, encoding);
  if (
    roundTrip.length !== payload.length ||
    roundTrip.some((byte, i) => byte !== payload[i])
  ) {
    // CP932 has duplicate NEC/IBM byte mappings. Accept valid aliases while
    // still rejecting truncated bytes and any character lost by conversion.
    if (encoding !== "Shift_JIS (CP932)") throw new Error("INVALID_ENCODING");
    new TextDecoder("shift_jis", { fatal: true }).decode(payload);
    if (rawDecode(roundTrip, encoding) !== text)
      throw new Error("INVALID_ENCODING");
  }
  return {
    text: text.replace(/\r\n?/g, "\n"),
    encoding,
    bom,
    eol: text.includes("\r\n") ? "CRLF" : "LF",
  };
}
export function detectFile(bytes: Uint8Array): DecodedFile {
  if (bytes[0] === 255 && bytes[1] === 254)
    return decodeFile(bytes, "UTF-16LE");
  if (bytes[0] === 254 && bytes[1] === 255)
    return decodeFile(bytes, "UTF-16BE");
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    return decodeFile(bytes, "UTF-8");
  if (!bytes.includes(27)) {
    try {
      return decodeFile(bytes, "UTF-8");
    } catch {}
  }
  const candidates: DecodedFile[] = [];
  // Without a BOM, do not guess UTF-16 endianness from arbitrary binary bytes.
  for (const encoding of encodings.slice(1, 4)) {
    try {
      candidates.push(decodeFile(bytes, encoding));
    } catch {}
  }
  if (!candidates.length) throw new Error("INVALID_ENCODING");
  if (candidates.length !== 1) throw new Error("AMBIGUOUS_ENCODING");
  return candidates[0];
}
export function encodeFile(
  text: string,
  encoding: FileEncoding,
  eol: LineEnding,
  bom: boolean,
): Uint8Array<ArrayBuffer> {
  const content = eol === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
  const payload = rawEncode(content, encoding);
  if (rawDecode(payload, encoding) !== content)
    throw new Error("UNREPRESENTABLE_TEXT");
  const prefix = !bom
    ? []
    : encoding === "UTF-8"
      ? [239, 187, 191]
      : encoding === "UTF-16LE"
        ? [255, 254]
        : encoding === "UTF-16BE"
          ? [254, 255]
          : [];
  const output = new Uint8Array(prefix.length + payload.length);
  output.set(prefix);
  output.set(payload, prefix.length);
  return output;
}
