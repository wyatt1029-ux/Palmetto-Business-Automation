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

test("production owner functions validate current and rollover Cloudflare Access audiences", async () => {
  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(wrangler, /POLICY_AUD = "48eef1e8795d47d78ba55c2d74ef3d06428b39f281c88c17d20599d48b85cefb,d865225dd001ab8c97b867935b8ba0611b68875afc1d343a77f0a1addedd6b93"/);
  assert.match(wrangler, /TEAM_DOMAIN = "https:\/\/mute-cloud-628c\.cloudflareaccess\.com"/);
});
