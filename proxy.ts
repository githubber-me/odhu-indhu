import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/neon-auth";

const neonAuthProxy = auth.middleware({ loginUrl: "/" });

export function proxy(request: NextRequest) {
  // Keep old bookmarks out of a second sign-in page. OAuth and Magic Link
  // callbacks still use /auth/* so Neon can complete their verifier exchange.
  if (request.nextUrl.pathname === "/auth/sign-in") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    return NextResponse.redirect(home);
  }
  // Signing out must remain reachable when a session has already expired or
  // its provider cannot currently validate it. The action checks its result.
  if (request.nextUrl.pathname === "/auth/sign-out") return NextResponse.next();
  return neonAuthProxy(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|opening-ledger|opengraph-image|twitter-image|manifest.webmanifest|icon.svg|favicon.ico).*)",
  ],
};
