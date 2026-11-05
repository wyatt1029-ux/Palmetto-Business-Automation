import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the service-business checklist is a linked, crawlable public route", async () => {
  const [guide, services, audiences, sitemap, redirects, build] = await Promise.all([
    readFile(new URL("../website-intake-checklist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../services/index.html", import.meta.url), "utf8"),
    readFile(new URL("../who-i-help/index.html", import.meta.url), "utf8"),
    readFile(new URL("../sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../_redirects", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-public.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(guide, /<h1>Website &amp; service request checklist for local businesses<\/h1>/);
  assert.match(guide, /<meta name="description" content="A practical website and service-request checklist/);
  assert.match(guide, /href="\/services\/"/);
  assert.match(guide, /href="\/contact\/"/);
  assert.match(services, /href="\/website-intake-checklist\/"/);
  assert.match(audiences, /href="\/website-intake-checklist\/"/);
  assert.match(sitemap, /https:\/\/palmettobusinessautomation\.com\/website-intake-checklist\//);
  assert.match(redirects, /^\/website-intake-checklist \/website-intake-checklist\/ 301$/m);
  assert.match(build, /"website-intake-checklist"/);
  assert.match(build, /"website-intake-checklist\/index.html", \{ path: "\/website-intake-checklist\/" \}/);
});
