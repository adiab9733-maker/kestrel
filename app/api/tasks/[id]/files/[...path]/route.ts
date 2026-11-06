import fs from "fs/promises";
import path from "path";
import { safeResolve, workspaceDir } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".pdf": "application/pdf", ".py": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8", // served as text so agent-written pages never run on our origin
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: parts } = await params;
  try {
    const root = workspaceDir(id);
    const file = await safeResolve(root, parts.map(decodeURIComponent).join("/"));
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const download = new URL(req.url).searchParams.has("download");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(file).replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
