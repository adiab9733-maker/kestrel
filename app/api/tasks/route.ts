import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listTasks());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  if (prompt.length > 20_000) return NextResponse.json({ error: "prompt is too long" }, { status: 400 });
  const meta = await createTask(prompt);
  return NextResponse.json(meta, { status: 201 });
}
