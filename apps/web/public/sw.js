/* ME_CBO service worker — public app shell + offline fallback.
 * apps/web/public/sw.js
 *
 * Rules:
 *  - /api/* is NEVER cached (it is same-origin through the proxy and holds private data).
 *  - Signed-in pages are NEVER cached (a shared phone must not show a previous user's data).
 *  - Only public pages and static assets are cached.
 */
const CACHE = "me-cbo-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

// Paths that belong to signed-in users; never stored in the cache.
const PRIVATE_PREFIXES = [
  "/api", "/dashboard", "/events", "/impact", "/members", "/inventory", "/incidents",
  "/swap-shop", "/learning", "/finance", "/admin", "/profile",
  "/login", "/mfa", "/register", "/forgot-password", "/reset-password",
];
const isPrivate = (p) => PRIVATE_PREFIXES.some((x) => p === x || p.startsWith(x + "/"));
const isStatic = (p) =>
  p.startsWith("/_next/static/") || p.startsWith("/icons/") || p.startsWith("/images/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not fail the whole install.
      .then((c) => Promise.allSettled(APP_SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(req, res) {
  if (res && res.ok && !res.redirected) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isPrivate(url.pathname)) return; // let the browser handle it normally

  // Public pages: network first, cached copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          store(req, res);
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // Static assets: cache first.
  if (isStatic(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            store(req, res);
            return res;
          }),
      ),
    );
  }
});
