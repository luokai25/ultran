const REPO = "luokai25/ultran";
const RELEASE_TAG = "ultron-web-latest";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8"
};

function ext(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function cleanPath(path) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes("..") || decoded.includes("\\\\") || decoded.includes("\\0")) return null;
  return decoded.replace(/^\\/+/, "");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const path = cleanPath(url.pathname === "/" ? "index.html" : url.pathname);
    if (!path) return new Response("Bad path", { status: 400 });

    const isAsset = path.startsWith("assets/");
    const assetName = path.split("/").pop();

    try {
      const name = isAsset ? assetName : "index.html";
      const cacheKey = new Request("https://ultron-edge-cache.invalid/" + name);
      const cache = caches.default;
      let response = await cache.match(cacheKey);

      if (!response) {
        const assetUrl = "https://github.com/" + REPO + "/releases/download/" + RELEASE_TAG + "/" + encodeURIComponent(name);
        const upstream = await fetch(assetUrl);
        if (!upstream.ok) {
          return new Response(upstream.status === 404 ? "Asset not found" : "Web asset fetch failed", {
            status: upstream.status === 404 ? 404 : 502
          });
        }

        const headers = new Headers(upstream.headers);
        // GitHub release downloads are marked as attachments. Forwarding this header
        // makes browsers download index.html instead of rendering the ULTRON app.
        headers.delete("Content-Disposition");
        headers.delete("Content-Encoding");
        headers.delete("Content-Length");
        headers.set("Content-Type", MIME[ext(name)] || "application/octet-stream");
        headers.set("Cache-Control", name === "index.html" ? "no-store" : "public, max-age=31536000, immutable");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

        response = new Response(upstream.body, { status: 200, headers });
        if (name !== "index.html") await cache.put(cacheKey, response.clone());
      }

      if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    } catch (error) {
      return new Response("ULTRON web deployment is preparing: " + String(error && error.message || error), {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
  }
};
