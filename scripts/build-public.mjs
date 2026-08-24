import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, parse, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-site");
const files = [
  "_headers",
  "_redirects",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "index.html",
  "intake.html",
  "sow.html",
  "payment.html",
  "sow-builder.html",
  "styles.css",
  "sow-builder.css",
  "script.js",
  "site-config.js",
  "observability.js",
  "intake.js",
  "sow.js",
  "payment.js",
  "sow-builder.js",
];
const publicDirectories = [
  "about",
  "contact",
  "services",
  "example-builds",
  "who-i-help",
  "case-studies",
  "faq",
];
const fingerprintedAssets = [
  "styles.css",
  "sow-builder.css",
  "site-config.js",
  "observability.js",
  "script.js",
  "intake.js",
  "sow.js",
  "payment.js",
  "sow-builder.js",
  "assets/css/styles.css",
  "assets/css/example-builds-showcase.css",
  "assets/js/main.js",
  "assets/js/example-builds-showcase.js",
];

const findHtmlFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findHtmlFiles(path);
    return extname(entry.name) === ".html" ? [path] : [];
  }));
  return nested.flat();
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
for (const directory of publicDirectories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}

// Cloudflare may cache static assets beyond the HTML lifetime. Content-derived
// filenames keep new markup from ever being paired with an older stylesheet or
// script, even when an edge or browser cache retains the prior deployment.
const manifest = new Map();
for (const asset of fingerprintedAssets) {
  const source = resolve(output, asset);
  const contents = await readFile(source);
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  const parsed = parse(asset);
  const fingerprinted = join(parsed.dir, `${parsed.name}.${hash}${parsed.ext}`)
    .replaceAll("\\", "/");
  const target = resolve(output, fingerprinted);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  manifest.set(asset.replaceAll("\\", "/"), fingerprinted);
}

for (const htmlFile of await findHtmlFiles(output)) {
  let html = await readFile(htmlFile, "utf8");
  for (const [asset, fingerprinted] of manifest) {
    const reference = new RegExp(
      `(?<=["'])/?${escapeRegex(asset)}(?:\\?[^"'<>\\s]*)?(?=["'])`,
      "g",
    );
    html = html.replace(reference, `/${fingerprinted}`);
  }
  await writeFile(htmlFile, html);
}
