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
    "/index.html / 301",
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

test("owner builder uses Cloudflare's clean static route without a circular Function redirect", async () => {
  const [payments, clients, ownerHome] = await Promise.all([
    readFile(new URL("../owner/payments/index.html", import.meta.url), "utf8"),
    readFile(new URL("../owner/clients-projects/index.html", import.meta.url), "utf8"),
    readFile(new URL("../owner/index.html", import.meta.url), "utf8"),
  ]);

  for (const page of [payments, clients, ownerHome]) {
    assert.match(page, /href="\/sow-builder"/);
    assert.doesNotMatch(page, /href="\/sow-builder\.html/);
  }

  const previewServer = await readFile(new URL("../scripts/preview-server.mjs", import.meta.url), "utf8");
  assert.match(previewServer, /const htmlFile = `\$\{file\}\.html`/);
});

test("public marketing navigation and starting prices stay available", async () => {
  const [home, services, faq, intake] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../services/index.html", import.meta.url), "utf8"),
    readFile(new URL("../faq/index.html", import.meta.url), "utf8"),
    readFile(new URL("../intake.html", import.meta.url), "utf8"),
  ]);

  for (const page of [home, services, faq]) {
    assert.match(page, /Websites • Workflows • Reporting/);
    assert.match(page, /href="\/faq\/"/);
  }
  for (const price of ["From $500", "From $800", "From $1,000", "From $1,500"]) {
    assert.ok(services.includes(price), `Missing public price: ${price}`);
  }
  assert.match(faq, /30 days’ written notice/);
  assert.match(intake, /Most people complete this in about 5–10 minutes\./);
  assert.match(intake, /Back to Services &amp; Pricing/);
});
