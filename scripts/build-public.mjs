import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, parse, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist-site");
const files = [
  "_headers",
  "_redirects",
  "404.html",
  "robots.txt",
  "sitemap.xml",
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
  "faq",
  "owner",
];
const fingerprintedAssets = [
  "styles.css",
  "sow-builder.css",
  "site-config.js",
  "observability.js",
  "script.js",
  "intake.js",
  "sow.js",
  "payment.js",
  "sow-builder.js",
  "assets/css/styles.css",
  "assets/css/example-builds-showcase.css",
  "assets/js/main.js",
  "assets/js/example-builds-showcase.js",
  "owner/leads/leads.css",
  "owner/leads/leads.js",
];
const legacyAssetsExcludedFromBuild = [
  "assets/logo.png",
  "assets/owner-photo.png",
  "assets/images/logo.png",
  "assets/images/logo-stripe.jpg",
  "assets/images/stripe-icon.jpg",
  "assets/images/stripe-logo.jpg",
  "assets/business-shot-1.png",
  "assets/business-shot-2.png",
  "assets/business-shot-3.png",
  "assets/business-shot-4.png",
  "assets/church-shot-1.png",
  "assets/church-shot-2.png",
  "assets/church-shot-3.png",
  "assets/church-shot-4.png",
  "assets/church-demo-dashboard.png",
  "assets/church-demo-glow.png",
  "assets/church-demo-live.png",
  "assets/ai-dashboard-live.png",
  "assets/reels/ai-research-matcher-reel.webm",
  "assets/screenshots/concession-full.png",
  "assets/screenshots/concession-kpi.png",
  "assets/screenshots/concession-sync.png",
  "assets/pba-business-case-study.png",
  "assets/pba-church-case-study.png",
  "assets/pba-operations-case-study.png",
  "assets/coastal-source-home.png",
  "assets/coastal-source-premium.png",
  "assets/coastal-source-glass.png",
];
const productionOrigin = "https://palmettobusinessautomation.com";
const marketingRoutes = new Map([
  ["index.html", { path: "/" }],
  ["services/index.html", { path: "/services/", current: "/services/" }],
  ["example-builds/index.html", { path: "/example-builds/", current: "/example-builds/" }],
  ["who-i-help/index.html", { path: "/who-i-help/", current: "/who-i-help/" }],
  ["about/index.html", { path: "/about/", current: "/about/" }],
  ["faq/index.html", { path: "/faq/", current: "/faq/" }],
  ["contact/index.html", { path: "/contact/", current: "/contact/" }],
  ["case-studies/business-dashboard/index.html", { path: "/case-studies/business-dashboard/", current: "/example-builds/" }],
  ["case-studies/church-directory-hub/index.html", { path: "/case-studies/church-directory-hub/", current: "/example-builds/" }],
  ["case-studies/concession-ordering/index.html", { path: "/case-studies/concession-ordering/", current: "/example-builds/" }],
]);

const findHtmlFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findHtmlFiles(path);
    return extname(entry.name) === ".html" ? [path] : [];
  }));
  return nested.flat();
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const improveMarketingMarkup = (html, route) => {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name=(["'])description\1\s+content=(["'])(.*?)\2[^>]*>/i)?.[3]?.trim();

  if (title && description) {
    const canonicalUrl = `${productionOrigin}${route.path}`;
    const socialMetadata = [
      `    <link rel="canonical" href="${canonicalUrl}" />`,
      '    <meta property="og:type" content="website" />',
      '    <meta property="og:site_name" content="Palmetto Business Automation" />',
      `    <meta property="og:title" content="${title}" />`,
      `    <meta property="og:description" content="${description}" />`,
      `    <meta property="og:url" content="${canonicalUrl}" />`,
      '    <meta name="twitter:card" content="summary" />',
      `    <meta name="twitter:title" content="${title}" />`,
      `    <meta name="twitter:description" content="${description}" />`,
    ].join("\n");
    html = html.replace(/\s*<\/head>/i, `\n${socialMetadata}\n  </head>`);
  }

  if (route.current) {
    const currentLink = new RegExp(
      `<a href="${escapeRegex(route.current)}"(?![^>]*aria-current)`,
      "g",
    );
    html = html.replace(currentLink, `<a href="${route.current}" aria-current="page"`);
  }

  const mainTag = html.match(/<main(?:\s[^>]*)?>/i)?.[0];
  if (!mainTag) return html;
  const existingMainId = mainTag.match(/\sid=["']([^"']+)["']/i)?.[1];
  const mainId = existingMainId || "main-content";
  if (!existingMainId) {
    html = html.replace(/<main(?=\s|>)/i, `<main id="${mainId}"`);
  }
  return html.replace(
    /<body([^>]*)>/i,
    `<body$1>\n    <a class="skip-link" href="#${mainId}">Skip to content</a>`,
  );
};

await rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
for (const asset of legacyAssetsExcludedFromBuild) {
  await rm(resolve(output, asset), { force: true });
}
for (const directory of publicDirectories) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}

// Cloudflare may cache static assets beyond the HTML lifetime. Content-derived
// filenames keep new markup from ever being paired with an older stylesheet or
// script, even when an edge or browser cache retains the prior deployment.
const manifest = new Map();
for (const asset of fingerprintedAssets) {
  const source = resolve(output, asset);
  const contents = await readFile(source);
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  const parsed = parse(asset);
  const fingerprinted = join(parsed.dir, `${parsed.name}.${hash}${parsed.ext}`)
    .replaceAll("\\", "/");
  const target = resolve(output, fingerprinted);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  manifest.set(asset.replaceAll("\\", "/"), fingerprinted);
}

for (const htmlFile of await findHtmlFiles(output)) {
  let html = await readFile(htmlFile, "utf8");
  const outputPath = relative(output, htmlFile).replaceAll("\\", "/");
  const marketingRoute = marketingRoutes.get(outputPath);
  if (marketingRoute) html = improveMarketingMarkup(html, marketingRoute);
  for (const [asset, fingerprinted] of manifest) {
    const reference = new RegExp(
      `(?<=["'])/?${escapeRegex(asset)}(?:\\?[^"'<>\\s]*)?(?=["'])`,
      "g",
    );
    html = html.replace(reference, `/${fingerprinted}`);
  }
  await writeFile(htmlFile, html);
}
