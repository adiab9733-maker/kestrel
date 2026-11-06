import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  cancelTask(id);
  return NextResponse.json({ ok: true });
}
