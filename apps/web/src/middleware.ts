import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge guard for the Next.js frontend.
 *
 * Looks for the `me_access` / `me_refresh` cookies that the NestJS API sets
 * on login. For the middleware to see them, they must be FIRST-PARTY to this
 * site. Two supported setups:
 *
 *  1. (Current) Proxy the API through this app: next.config.mjs rewrites
 *     /api/* to the API, and the frontend calls relative "/api/..." URLs.
 *     The browser then only talks to one origin, so cookies are first-party.
 *  2. A custom domain for both services, e.g. app.mecbo.org + api.mecbo.org,
 *     with COOKIE_DOMAIN=.mecbo.org on the API.
 *
 * Do NOT rely on COOKIE_DOMAIN=.onrender.com: onrender.com is on the Public
 * Suffix List, so browsers reject cookies scoped to it.
 *
 * This middleware is a fast-path UX check, not a security boundary.
 * The API enforces authentication and permissions on every request.
 *
 * NOTE: the cookie names below must match ACCESS_COOKIE / REFRESH_COOKIE in
 * the API's auth.constants.ts.
 */

const ACCESS_COOKIE = "me_access";
const REFRESH_COOKIE = "me_refresh";

/* --- Route classification ------------------------------------ */

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

/* --- Helpers -------------------------------------------------- */

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/* --- Middleware ----------------------------------------------- */

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const hasAccess = req.cookies.has(ACCESS_COOKIE);
  const hasRefresh = req.cookies.has(REFRESH_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some((p) => matchesPrefix(pathname, p));
  const isAuthPage = AUTH_PAGES.some((p) => matchesPrefix(pathname, p));

  /* 1. Protected route with no session -> login.
   *    An expired access token (15 min) with a still-valid refresh cookie is
   *    let through so the client AuthGuard can refresh and retry. */
  if (isProtected && !hasAccess && !hasRefresh) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + (search || ""));
    return NextResponse.redirect(url);
  }

  /* 2. Auth page while logged in -> dashboard.
   *    Only the ACCESS cookie counts here. A stale refresh cookie must not
   *    bounce users away from /login, or the client guard and this redirect
   *    can ping-pong forever. */
  if (isAuthPage && hasAccess) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  /* 3. Otherwise pass through. */
  return NextResponse.next();
}

/* --- Matcher ---------------------------------------------------
 * Run on page routes only. Skip:
 *  - /api/*                (proxied to the NestJS API, must never be redirected)
 *  - /_next/*              (build artifacts)
 *  - /icons/*, /images/*   (static assets)
 *  - any path with a file extension (favicon.ico, sw.js, *.png, *.css, ...)
 */
export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icons/|images/|manifest.webmanifest|sw.js|.*\\..*).*)",
  ],
};
