import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};

export interface StaticServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Serves `rootDir` on localhost. Localhost is a secure context, which WebCodecs requires. */
export async function serve(rootDir: string, port = 0): Promise<StaticServer> {
  const root = resolve(rootDir);

  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const target = normalize(join(root, rawPath));
    const inside = target === root || target.startsWith(root + sep);

    if (!inside || !existsSync(target) || statSync(target).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    createReadStream(target).pipe(res);
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
