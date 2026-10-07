import { NextResponse, type NextRequest } from "next/server";

import { PUBLIC_PATHS, SESSION_COOKIE, SIGN_IN_PATH } from "@/lib/auth-routes";

/**
 * The optimistic half of the auth check: it knows only whether a session cookie is present, never
 * whether it names a live session. That is deliberate - this runs ahead of every request including
 * prefetches, so a database lookup here would put one on the path of every hovered link.
 *
 * What it buys is that an unauthenticated visitor lands on the sign-in form instead of watching a
 * dashboard render and then disappear. The real check is `requireAccount()` in the dashboard
 * layout, which resolves the cookie against the database; a forged or revoked cookie gets past
 * this file and is stopped there, and every mutation is checked again in the action itself.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!hasCookie && !isPublic) {
    const url = new URL(SIGN_IN_PATH, request.url);
    // Where they were going, so signing in lands there rather than on the dashboard. Read back
    // through `safeNextPath`, which is what keeps it from becoming an open redirect.
    if (pathname !== "/") {
      url.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }

  if (hasCookie && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own static output, the favicon and the logo. Auth wants to run on all
  // routes; the exclusions are the assets that would otherwise be redirected into a sign-in page and
  // break the styling of the very form they were sent to. The logo needs its own entry even though
  // `_next/image` is excluded: the optimizer fetches the source file through this proxy.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png).*)"],
};
