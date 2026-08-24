import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("mobile navigation remains available without JavaScript and Escape only returns focus for an open menu", async () => {
  const [styles, script] = await Promise.all([
    readFile(new URL("../assets/css/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../assets/js/main.js", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /\.topnav \{ display: flex; grid-column:/);
  assert.match(styles, /\.menu-enhanced \.topnav \{ display: none; \}/);
  assert.match(script, /topbar\.classList\.add\("menu-enhanced"\)/);
  assert.match(script, /event\.key === "Escape" && topbar\.classList\.contains\("menu-open"\)/);
});

test("deployment documentation identifies GitHub main as the Cloudflare production source", async () => {
  const [agents, readme, packageJson] = await Promise.all([
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(agents, /`main` is the production source branch/);
  assert.match(readme, /Cloudflare Pages Git integration/);
  assert.equal(Object.hasOwn(JSON.parse(packageJson).scripts, "deploy"), false);
});
