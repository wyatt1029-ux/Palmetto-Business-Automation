import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const output = resolve(import.meta.dirname, "..", "dist-site");

const htmlFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  }));
  return nested.flat();
};

test("public HTML references existing local pages and assets", async () => {
  const failures = [];
  for (const htmlFile of await htmlFiles(output)) {
    const source = await readFile(htmlFile, "utf8");
    for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = match[1];
      if (/^(?:https?:|mailto:|sms:|tel:|data:|#)/.test(reference)) continue;
      const clean = reference.split(/[?#]/)[0];
      if (!clean || clean.startsWith("/api/")) continue;
      let target = clean.startsWith("/")
        ? join(output, clean)
        : resolve(dirname(htmlFile), clean);
      if (clean.endsWith("/")) target = join(target, "index.html");
      try {
        await access(target);
      } catch {
        failures.push(`${htmlFile}: ${reference}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
