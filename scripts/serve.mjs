// Tiny static server for previewing dist/ locally: npm run dev
// It only listens on this computer (127.0.0.1), so other devices on your network can't reach it.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "127.0.0.1";
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon" };
const notFound = async (res) => res.writeHead(404, { "content-type": types[".html"] }).end(await readFile(path.join(dist, "404.html")).catch(() => "Not found"));

createServer(async (req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return res.writeHead(400).end("Bad request"); }
  let file = path.resolve(dist, "." + p);
  // Never serve anything outside dist/ (for example /../package.json).
  if (file !== dist && !file.startsWith(dist + path.sep)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "x-content-type-options": "nosniff" }).end(body);
  } catch {
    await notFound(res);
  }
}).listen(port, host, () => console.log(`Preview: http://localhost:${port}`));
