import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { build, transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
if (
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)
)
  throw new Error("Invalid app version");
const appLicense = await readFile(resolve(root, "LICENSE"), "utf8");
const fontRoot = resolve(
  root,
  "node_modules/@fontsource-variable/noto-sans-jp",
);
// Keep every Unicode range, so arbitrary Japanese text works offline as well.
let fontCSS = await readFile(resolve(fontRoot, "index.css"), "utf8");
const sources = [
  ...new Set([...fontCSS.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1])),
];
for (const source of sources) {
  const relative = source.replace(/^['"]|['"]$/g, "");
  const path = resolve(fontRoot, relative);
  if (!path.startsWith(fontRoot + "/") && !path.startsWith(fontRoot + "\\"))
    throw new Error("Unsafe font path");
  const bytes = await readFile(path);
  fontCSS = fontCSS
    .split(`url(${source})`)
    .join(`url("data:font/woff2;base64,${bytes.toString("base64")}")`);
}
const fontLicense = await readFile(resolve(fontRoot, "LICENSE"), "utf8");
const css = (
  await transform(
    fontCSS + "\n" + (await readFile(resolve(root, "src/styles.css"), "utf8")),
    { loader: "css", minify: true },
  )
).code.trim();
const bundled = await build({
  entryPoints: [resolve(root, "src/app.ts")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: ["chrome110", "firefox115", "safari16.4"],
  legalComments: "inline",
});
const js = bundled.outputFiles[0].text
  .trim()
  .replace(/<\/script/gi, "<\\/script");
const hash = (text) =>
  `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
// No networking, no external assets, no HTML event attributes, and no eval.
const csp = `default-src 'none'; script-src ${hash(js)}; script-src-attr 'none'; style-src ${hash(css)}; style-src-attr 'none'; font-src data:; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const template = await readFile(resolve(root, "src/template.html"), "utf8");
const encodingLicense = await readFile(
  resolve(root, "node_modules/encoding-japanese/LICENSE"),
  "utf8",
);
const html = template
  .replace("__APP_VERSION__", () => version)
  .replace(
    "<!-- CSP -->",
    () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
  )
  .replace("<!-- STYLES -->", () => `<style>${css}</style>`)
  .replace("<!-- APP -->", () => `<script>${js}</script>`)
  .replace(
    "<!-- LICENSES -->",
    () =>
      `<!-- WEditor / MIT\n${appLicense.replace(/--/g, "—")}\n\nNoto Sans JP / SIL Open Font License 1.1\n${fontLicense.replace(/--/g, "—")}\n\nencoding.js / MIT\n${encodingLicense.replace(/--/g, "—")}\n-->`,
  );
for (const [tag, content] of [
  ["script", js],
  ["style", css],
]) {
  const emitted = html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  if (emitted !== content || !csp.includes(hash(emitted)))
    throw new Error(`CSP hash mismatch: ${tag}`);
}
if (
  /\b(?:src|href)="(?:https?:|\.\/)/i.test(html) ||
  /url\(["']?(?!data:)/i.test(css)
)
  throw new Error("External dependency in output");
await mkdir(resolve(root, "dist"), { recursive: true });
const output = resolve(root, "dist/weditor.html");
const temporary = resolve(root, "dist", `.weditor-${randomUUID()}.tmp`);
// Preserve the previous release if writing fails; readers see a complete file.
try {
  await writeFile(temporary, html, { encoding: "utf8", flag: "wx" });
  await rename(temporary, output);
} finally {
  await unlink(temporary).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
console.log(
  `Built dist/weditor.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB); ${sources.length} embedded font subsets.`,
);
