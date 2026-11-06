import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.KESTREL_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value === (await sessionToken(password))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico|manifest.webmanifest|icon-|apple-touch-icon).*)"] };
