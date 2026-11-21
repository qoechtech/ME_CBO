import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge guard for the Next.js frontend.
 *
 * Checks for the presence of the `me_access` or `me_refresh` cookie that
 * the NestJS API sets on login.
 *
 * IMPORTANT — cross-origin cookie note:
 * If the API and web are on different domains (e.g. me-cbo-api.onrender.com
 * and me-cbo-web.onrender.com), the auth cookies are scoped to the API's
 * domain. The Next.js middleware CANNOT read them because the browser
 * does not send them with requests to the web domain.
 *
 * Two ways to fix that:
 *  1. Use a shared parent domain (recommended for production):
 *     api.mecbo.org + www.mecbo.org → both under `.mecbo.org`, cookies
 *     shared, middleware works as written below.
 *  2. On separate *.onrender.com subdomains, set COOKIE_DOMAIN=.onrender.com
 *     in the API env so the cookie is issued for the parent, and ensure
 *     the API sends Set-Cookie with Domain=.onrender.com.
 *
 * If cookies are genuinely cross-domain and cannot be shared, rely on the
 * client-side AuthGuard (which calls /auth/me) instead of this middleware
 * to protect routes. This middleware is a fast-path optimization, not the
 * sole defense — the API always enforces auth.
 */

const ACCESS_COOKIE = "me_access";
const REFRESH_COOKIE = "me_refresh";

/* ─── Route classification ───────────────────────────────────── */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/events",
  "/impact",
  "/members",
  "/inventory",
  "/incidents",
  "/swap-shop",
  "/learning",
  "/finance",
  "/admin",
  "/profile",
];

const AUTH_PAGES = [
  "/login",
  "/register",
  "/mfa",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

/* ─── Helpers ────────────────────────────────────────────────── */

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/* ─── Middleware ─────────────────────────────────────────────── */

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const hasSession =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));
  const isAuthPage = AUTH_PAGES.some((p) => matchesPrefix(pathname, p));

  /* --- 1. Protected route with no session → login ------------- */
  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  /* --- 2. Auth page with active session → dashboard ---------- */
  if (isAuthPage && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  /* --- 3. Otherwise pass through ------------------------------ */
  return NextResponse.next();
}

/* ─── Matcher ────────────────────────────────────────────────── */
/**
 * Run middleware on:
 *  - Page routes (exclude _next internals, static assets, images)
 * Do NOT run on:
 *  - /api/*               (Next.js route handlers)
 *  - /_next/*             (build artifacts)
 *  - /icons/*, /images/*  (static assets)
 *  - Any file with an extension (favicon.ico, manifest.webmanifest, sw.js, *.png, *.css, *.js, etc.)
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icons|images|manifest.webmanifest|sw.js|.*\\..*).*)",
  ],
};
