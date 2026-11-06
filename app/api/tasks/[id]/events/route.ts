import { getTask, isFinal, subscribe } from "@/lib/store";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-sent events: replays the log after Last-Event-ID, then streams live. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTask(id).catch(() => null);
  if (!task) return new Response("not found", { status: 404 });
  const after = Number(req.headers.get("last-event-id") || new URL(req.url).searchParams.get("after") || 0);

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (e: AgentEvent) => {
        if (closed) return;
        controller.enqueue(enc.encode(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`));
        if (e.type === "status" && isFinal(e.status)) close();
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.enqueue(enc.encode(`event: end\ndata: {}\n\n`));
        controller.close();
      };
      let lastSent = after;
      for (const e of task.events) if (e.seq > after) { send(e); lastSent = e.seq; }
      if (closed) return;
      if (isFinal(task.meta.status)) return close();
      const unsub = subscribe(id, (e) => { if (e.seq > lastSent) send(e); });
      if (!unsub) return close();
      const ping = setInterval(() => !closed && controller.enqueue(enc.encode(`: ping\n\n`)), 15000);
      cleanup = () => { unsub(); clearInterval(ping); };
      req.signal.addEventListener("abort", () => { closed = true; cleanup(); });
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
