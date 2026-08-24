import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-site");
const files = [
  "_headers",
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

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });

const publicRoutes = ["about", "case-studies", "contact", "example-builds", "faq", "services", "who-i-help"];
for (const route of publicRoutes) {
  await cp(resolve(root, route), resolve(output, route), { recursive: true });
}
