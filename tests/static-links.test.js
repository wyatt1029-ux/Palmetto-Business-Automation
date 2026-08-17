import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public workflow pages are included in the site build", async () => {
  const build = await readFile(new URL("../scripts/build-public.mjs", import.meta.url), "utf8");
  for (const file of ["intake.html", "sow-builder.html", "sow.html", "payment.html", "intake.js", "sow.js", "payment.js"]) {
    assert.ok(build.includes(`\"${file}\"`), `Build allowlist must include ${file}`);
  }
});

test("legacy workflow routes redirect to the current pages", async () => {
  const redirects = await readFile(new URL("../_redirects", import.meta.url), "utf8");
  for (const expected of [
    "/start/ /intake.html 301",
    "/scope/ /sow.html 301",
    "/pay/ /payment.html 301",
    "/review/ /sow.html 301",
  ]) {
    assert.ok(redirects.includes(expected), `Missing compatibility redirect: ${expected}`);
  }
});

test("owner builder does not define a circular pretty-URL redirect", async () => {
  const redirects = await readFile(new URL("../_redirects", import.meta.url), "utf8");

  assert.doesNotMatch(redirects, /^\/sow-builder(?:\.html)?\s/m);
});
