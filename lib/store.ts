import fs from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { runAgent } from "./agent";
import { DATA_DIR, taskDir, workspaceDir } from "./workspace";
import type { AgentEvent, AgentEventBody, TaskMeta, TaskStatus } from "./types";

interface LiveTask {
  meta: TaskMeta;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent) => void>;
  abort: AbortController;
}

// Survive Next.js dev hot reloads.
const g = globalThis as unknown as { __kestrelTasks?: Map<string, LiveTask> };
const live = (g.__kestrelTasks ??= new Map());

const FINAL: TaskStatus[] = ["done", "error", "cancelled"];
export const isFinal = (s: TaskStatus) => FINAL.includes(s);

async function saveMeta(meta: TaskMeta) {
  await fs.writeFile(path.join(taskDir(meta.id), "task.json"), JSON.stringify(meta, null, 2));
}

function titleFrom(prompt: string) {
  const line = prompt.trim().split("\n")[0];
  return line.length > 70 ? line.slice(0, 67) + "…" : line;
}

export async function createTask(prompt: string): Promise<TaskMeta> {
  const id = randomUUID();
  await fs.mkdir(workspaceDir(id), { recursive: true });
  const now = Date.now();
  const meta: TaskMeta = { id, title: titleFrom(prompt), prompt, status: "running", createdAt: now, updatedAt: now };
  await saveMeta(meta);

  const task: LiveTask = { meta, events: [], listeners: new Set(), abort: new AbortController() };
  live.set(id, task);

  const logPath = path.join(taskDir(id), "events.jsonl");
  let seq = 0;
  let writes = Promise.resolve();
  const emit = (body: AgentEventBody) => {
    const event = { ...body, seq: ++seq, ts: Date.now() } as AgentEvent;
    task.events.push(event);
    writes = writes.then(() => fs.appendFile(logPath, JSON.stringify(event) + "\n")).catch(() => {});
    for (const l of task.listeners) l(event);
  };
  const finish = async (status: TaskStatus) => {
    task.meta = { ...task.meta, status, updatedAt: Date.now() };
    emit({ type: "status", status });
    await writes;
    await saveMeta(task.meta);
  };

  emit({ type: "user", text: prompt });
  emit({ type: "status", status: "running" });

  runAgent({ prompt, workspace: workspaceDir(id), signal: task.abort.signal, emit })
    .then(() => finish(task.abort.signal.aborted ? "cancelled" : task.events.some((e) => e.type === "final") ? "done" : "error"))
    .catch((err) => {
      if (task.abort.signal.aborted) return finish("cancelled");
      emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      return finish("error");
    });

  return meta;
}

export function cancelTask(id: string) {
  live.get(id)?.abort.abort();
}

export async function getTask(id: string): Promise<{ meta: TaskMeta; events: AgentEvent[] } | null> {
  const t = live.get(id);
  if (t) return { meta: t.meta, events: t.events };
  try {
    const meta = JSON.parse(await fs.readFile(path.join(taskDir(id), "task.json"), "utf8")) as TaskMeta;
    const raw = await fs.readFile(path.join(taskDir(id), "events.jsonl"), "utf8").catch(() => "");
    const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent);
    // A task that was running when the server stopped can't resume.
    if (meta.status === "running") meta.status = "error";
    return { meta, events };
  } catch {
    return null;
  }
}

export function subscribe(id: string, fn: (e: AgentEvent) => void): (() => void) | null {
  const t = live.get(id);
  if (!t || isFinal(t.meta.status)) return null;
  t.listeners.add(fn);
  return () => t.listeners.delete(fn);
}

export async function listTasks(): Promise<TaskMeta[]> {
  const ids = await fs.readdir(DATA_DIR).catch(() => [] as string[]);
  const metas = await Promise.all(ids.map(async (id) => (await getTask(id))?.meta ?? null));
  return metas.filter((m): m is TaskMeta => !!m).sort((a, b) => b.createdAt - a.createdAt);
}
