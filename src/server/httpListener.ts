import { type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

/**
 * Shared HTTP plumbing for the Node servers (cloud and desktop): translate
 * Node's req/res to the Web Request/Response the app handler speaks, serve the
 * built single-page app, and apply the security headers.
 */

// Mirrors the headers netlify.toml applied to every response.
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' blob:; frame-ancestors 'none'",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

type App = (req: Request) => Promise<Response>;

async function toWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(url.toString(), { method, headers, body });
}

async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS };
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const setCookies = typeof webRes.headers.getSetCookie === "function" ? webRes.headers.getSetCookie() : [];
  if (setCookies.length > 0) headers["set-cookie"] = setCookies;
  const buffer = Buffer.from(await webRes.arrayBuffer());
  res.writeHead(webRes.status, headers);
  res.end(buffer);
}

async function serveStatic(res: ServerResponse, pathname: string, staticDir: string): Promise<void> {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(staticDir, safe);
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const info = await stat(filePath).catch(() => null);
  const immutable = pathname.startsWith("/assets/");
  if (!info || info.isDirectory()) {
    // SPA fallback: unknown routes and the root serve index.html (client-side routing).
    filePath = join(staticDir, "index.html");
    if (!(await stat(filePath).catch(() => null))) {
      res.writeHead(404).end("Not found");
      return;
    }
  }
  const data = await readFile(filePath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(data);
}

/** Builds the Node request handler that routes /api/* through the app and serves the SPA. */
export function createRequestListener(app: App, staticDir: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "localhost";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "http";
    const requestUrl = new URL(req.url ?? "/", `${proto}://${host}`);
    void (async () => {
      try {
        if (requestUrl.pathname.startsWith("/api/")) {
          await sendWebResponse(res, await app(await toWebRequest(req, requestUrl)));
        } else {
          await serveStatic(res, requestUrl.pathname, staticDir);
        }
      } catch (e) {
        console.error(JSON.stringify({ stage: "node-server", kind: (e as Error).name }));
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Κάτι πήγε στραβά." }));
      }
    })();
  };
}
