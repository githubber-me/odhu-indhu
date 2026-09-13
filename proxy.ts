import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/neon-auth";

const neonAuthProxy = auth.middleware({ loginUrl: "/" });

export function proxy(request: NextRequest) {
  // Keep old bookmarks out of a second sign-in page. OAuth and Magic Link
  // callbacks still use /auth/* so Neon can complete their verifier exchange.
  if (request.nextUrl.pathname === "/auth/sign-in")
    return NextResponse.redirect(new URL("/", request.url));
  return neonAuthProxy(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
