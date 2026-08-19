import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-site");
const files = [
  "_headers",
  "_redirects",
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
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
for (const directory of publicDirectories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
