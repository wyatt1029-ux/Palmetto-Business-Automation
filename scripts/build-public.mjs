import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-site");
const files = ["_headers", "_redirects", "index.html"];
const directories = [
  "about",
  "assets",
  "case-studies",
  "contact",
  "example-builds",
  "pay",
  "review",
  "scope",
  "services",
  "start",
  "who-i-help",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}
for (const directory of directories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
