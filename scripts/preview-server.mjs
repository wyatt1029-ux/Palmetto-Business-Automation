import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.argv[2] || 8788);
const root = resolve(process.argv[3] || "dist-site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const safe = normalize(requested).replace(/^([/\\])+/, "");
    let file = resolve(root, safe || "index.html");
    if (!file.startsWith(root)) throw new Error("Path denied");
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch {}
    try { await stat(file); } catch { file = join(root, "404.html"); response.statusCode = 404; }
    response.setHeader("content-type", types[extname(file).toLowerCase()] || "application/octet-stream");
    createReadStream(file).on("error", () => response.end()).pipe(response);
  } catch { response.statusCode = 400; response.end("Bad request"); }
});
server.listen(port, "127.0.0.1", () => console.log(`Preview available at http://127.0.0.1:${port}/`));
