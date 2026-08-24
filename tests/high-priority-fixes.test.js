import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sendOutlookMail } from "../functions/_lib/email.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("public build fingerprints assets and includes production route metadata", async () => {
  await execFileAsync(process.execPath, ["scripts/build-public.mjs"], { cwd: root });
  const [home, services, caseStudy, notFound, robots, sitemap] = await Promise.all([
    readFile(new URL("../dist-site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist-site/services/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist-site/case-studies/business-dashboard/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist-site/404.html", import.meta.url), "utf8"),
    readFile(new URL("../dist-site/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../dist-site/sitemap.xml", import.meta.url), "utf8"),
  ]);

  for (const page of [home, services, notFound]) {
    assert.match(page, /assets\/css\/styles\.[a-f0-9]{12}\.css/);
    assert.match(page, /assets\/js\/main\.[a-f0-9]{12}\.js/);
    assert.doesNotMatch(page, /assets\/css\/styles\.css["']/);
    assert.doesNotMatch(page, /assets\/js\/main\.js["']/);
  }
  for (const page of [home, services, caseStudy]) {
    assert.match(page, /<a class="skip-link" href="#[^"]+">Skip to content<\/a>/);
    assert.match(page, /<meta property="og:title"/);
    assert.match(page, /<meta property="og:description"/);
    assert.match(page, /<meta name="twitter:card" content="summary"/);
  }
  assert.match(home, /<link rel="canonical" href="https:\/\/palmettobusinessautomation\.com\/"/);
  assert.match(services, /href="\/services\/" aria-current="page"/);
  assert.match(caseStudy, /href="\/example-builds\/" aria-current="page"/);
  assert.match(notFound, /<meta name="robots" content="noindex"/);
  assert.match(robots, /Sitemap: https:\/\/palmettobusinessautomation\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/palmettobusinessautomation\.com\/services\/<\/loc>/);
  await assert.rejects(access(new URL("../dist-site/assets/images/logo.png", import.meta.url)));
  await access(new URL("../dist-site/assets/images/owner-photo.png", import.meta.url));
});

test("intake revision links load and update through token-protected handlers", async () => {
  const [api, client, markup] = await Promise.all([
    readFile(new URL("../functions/api/intake.js", import.meta.url), "utf8"),
    readFile(new URL("../intake.js", import.meta.url), "utf8"),
    readFile(new URL("../intake.html", import.meta.url), "utf8"),
  ]);

  assert.match(api, /export async function onRequestGet/);
  assert.match(api, /export async function onRequestPut/);
  assert.match(api, /revision_token_hash = \$\{tokenHash\}/);
  assert.match(api, /revision_token_expires_at > now\(\)/);
  assert.match(client, /params\.get\("submission"\)/);
  assert.match(client, /method: revisionMode \? "PUT" : "POST"/);
  assert.match(client, /populateRevision/);
  assert.match(markup, /id="revision-link"/);
});

test("SOW publication supersedes and inserts in one atomic statement", async () => {
  const source = await readFile(new URL("../functions/api/publish-sow.js", import.meta.url), "utf8");
  assert.match(source, /with intake as \([\s\S]+superseded as \([\s\S]+inserted as \([\s\S]+select inserted\.id/);
  assert.match(source, /emailDelivered/);
  assert.match(source, /sendOutlookMail/);
});

test("Outlook delivery reports success, failure, and missing configuration", async (t) => {
  const env = { OUTLOOK_ACCESS_TOKEN: "test-token" };
  const message = { to: "client@example.test", subject: "Safe\r\nsubject", html: "<p>Hello</p>" };
  let sentBody;
  const delivered = await sendOutlookMail(env, message, async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 202 };
  });
  assert.equal(delivered, true);
  assert.equal(sentBody.message.subject, "Safe subject");

  t.mock.method(console, "error", () => {});
  assert.equal(await sendOutlookMail(env, message, async () => ({ ok: false, status: 401 })), false);
  assert.equal(await sendOutlookMail({}, message, async () => { throw new Error("must not run"); }), false);
});
