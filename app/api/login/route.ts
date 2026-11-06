import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { COOKIE, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.KESTREL_PASSWORD || "";
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const a = Buffer.from(String(password ?? ""));
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await sessionToken(expected), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
