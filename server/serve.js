/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

/** Host/protocol used in the Expo deep link. Never trust X-Forwarded-Host. */
function publicOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : (req.socket?.encrypted ? "https" : "http");
  const rawHost = String(req.headers.host || "").trim();
  if (!rawHost || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]{1,5})?$/i.test(rawHost)) return null;

  try {
    const parsed = new URL(`${protocol}://${rawHost}`);
    if (!parsed.hostname || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    const port = parsed.port ? Number(parsed.port) : 0;
    if (port > 65535) return null;
    return { protocol, host: parsed.host };
  } catch {
    return null;
  }
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function serveLandingPage(req, res, landingPageTemplate, appName, method = "GET") {
  const origin = publicOrigin(req);
  if (!origin) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Invalid Host header");
    return;
  }

  // `host` is URL-canonicalized and cannot contain HTML/JS delimiters.
  const expsUrl = origin.host;
  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, `${origin.protocol}://${origin.host}`)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName));

  applySecurityHeaders(res);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
  res.end(method === "HEAD" ? undefined : html);
}

/** Return a path only when the decoded URL stays strictly inside root. */
function resolveStaticPath(urlPath, root = STATIC_ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const relative = path.relative(absoluteRoot, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function isInsideRoot(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function serveStaticFile(urlPath, res, method = "GET") {
  const filePath = resolveStaticPath(urlPath);
  if (!filePath) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(method === "HEAD" ? undefined : "Forbidden");
    return;
  }

  try {
    const realRoot = fs.realpathSync(STATIC_ROOT);
    const realFile = fs.realpathSync(filePath);
    // Also blocks symlinks inside static-build that point outside the build.
    if (!isInsideRoot(realFile, realRoot)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end(method === "HEAD" ? undefined : "Forbidden");
      return;
    }
    const stat = fs.statSync(realFile);
    if (!stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(method === "HEAD" ? undefined : "Not Found");
      return;
    }

    const ext = path.extname(realFile).toLowerCase();
    applySecurityHeaders(res);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (method === "HEAD") return res.end();
    fs.createReadStream(realFile).pipe(res);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(method === "HEAD" ? undefined : "Not Found");
      return;
    }
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(method === "HEAD" ? undefined : "Internal Server Error");
  }
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  applySecurityHeaders(res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  let pathname = url.pathname;

  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      if (req.method === "HEAD") {
        const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json", "expo-protocol-version": "1", "expo-sfv-version": "0" });
        return res.end();
      }
      return serveManifest(platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(req, res, landingPageTemplate, appName, req.method);
    }
  }

  serveStaticFile(pathname, res, req.method);
});

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { escapeHtml, publicOrigin, resolveStaticPath, isInsideRoot, server };
