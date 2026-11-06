"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentEvent, FileInfo, PlanStep, TaskStatus } from "@/lib/types";

type Item =
  | { kind: "user"; key: string; text: string }
  | { kind: "progress"; key: string; text: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; id: string; name: string; label: string; detail?: string; done: boolean; ok?: boolean; output?: string }
  | { kind: "error"; key: string; text: string }
  | { kind: "final"; key: string; text: string };

interface View {
  status: TaskStatus | "connecting";
  plan: PlanStep[];
  items: Item[];
  files: FileInfo[];
}

function reduce(events: AgentEvent[]): View {
  const v: View = { status: "connecting", plan: [], items: [], files: [] };
  const tools = new Map<string, Extract<Item, { kind: "tool" }>>();
  for (const e of events) {
    const key = String(e.seq);
    switch (e.type) {
      case "status": v.status = e.status; break;
      case "plan": v.plan = e.steps; break;
      case "files": v.files = e.files; break;
      case "user": v.items.push({ kind: "user", key, text: e.text }); break;
      case "progress": v.items.push({ kind: "progress", key, text: e.text }); break;
      case "text": v.items.push({ kind: "text", key, text: e.text }); break;
      case "error": v.items.push({ kind: "error", key, text: e.message }); break;
      case "final": v.items.push({ kind: "final", key, text: e.text }); break;
      case "tool_start": {
        const t = { kind: "tool" as const, key, id: e.id, name: e.name, label: e.label, detail: e.detail, done: false };
        tools.set(e.id, t);
        v.items.push(t);
        break;
      }
      case "tool_end": {
        const t = tools.get(e.id);
        if (t) Object.assign(t, { done: true, ok: e.ok, output: e.output });
        break;
      }
    }
  }
  // The final answer repeats the last text block; drop that duplicate.
  const fi = v.items.findIndex((i) => i.kind === "final");
  if (fi > 0) {
    const prev = v.items[fi - 1];
    if (prev.kind === "text" && prev.text.trim() === (v.items[fi] as { text: string }).text.trim()) v.items.splice(fi - 1, 1);
  }
  return v;
}

const ICONS: Record<string, string> = { web_search: "⌕", web_fetch: "↗", run_code: ">_", write_file: "✎", read_file: "▤", list_files: "▦" };

function fmtSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileUrl(id: string, p: string, download = false) {
  return `/api/tasks/${id}/files/${p.split("/").map(encodeURIComponent).join("/")}${download ? "?download" : ""}`;
}

export function TaskView({ id }: { id: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FileInfo | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const es = new EventSource(`/api/tasks/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as AgentEvent;
      setEvents((prev) => (prev.length && prev[prev.length - 1].seq >= e.seq ? prev : [...prev, e]));
    };
    es.addEventListener("end", () => es.close());
    es.onerror = () => {
      fetch(`/api/tasks/${id}/events`, { method: "HEAD" }).then((r) => r.status === 404 && (setMissing(true), es.close())).catch(() => {});
    };
    return () => es.close();
  }, [id]);

  const view = useMemo(() => reduce(events), [events]);
  const running = view.status === "running" || view.status === "connecting";

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [view.items.length]);

  const toolItems = view.items.filter((i): i is Extract<Item, { kind: "tool" }> => i.kind === "tool");
  const focused = toolItems.find((t) => t.id === selected) ?? toolItems[toolItems.length - 1];
  const title = (view.items.find((i) => i.kind === "user") as { text: string } | undefined)?.text.split("\n")[0];

  if (missing) return <main className="home"><p className="empty">This task doesn’t exist.</p></main>;

  return (
    <div className="task">
      <section className="task-main">
        <div className="task-head">
          <h1>{title ?? "Loading…"}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`pill ${view.status}`}><span className="dot" />{view.status === "connecting" ? "loading" : view.status}</span>
            {view.status === "running" && (
              <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 13 }} onClick={() => fetch(`/api/tasks/${id}/cancel`, { method: "POST" })}>
                Stop
              </button>
            )}
          </div>
        </div>

        {view.plan.length > 0 && (
          <div className="card">
            <h3>Plan · {view.plan.filter((s) => s.status === "done").length}/{view.plan.length}</h3>
            <ol className="plan">
              {view.plan.map((s, i) => (
                <li key={i} className={s.status}>
                  <span className="mark">{s.status === "done" ? "✓" : ""}</span>
                  <span className="t">{s.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="timeline">
          {view.items.map((it) => {
            switch (it.kind) {
              case "user": return <div key={it.key} className="ev-user">{it.text}</div>;
              case "progress": return <div key={it.key} className="ev-progress">{it.text}</div>;
              case "text": return <div key={it.key} className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown></div>;
              case "error": return <div key={it.key} className="ev-error">{it.text}</div>;
              case "final":
                return (
                  <div key={it.key} className="card ev-final md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown>
                  </div>
                );
              case "tool":
                return (
                  <button key={it.key} className={`ev-tool ${focused?.id === it.id ? "selected" : ""}`} onClick={() => { setSelected(it.id); setPreview(null); }}>
                    <span className="icon">{ICONS[it.name] ?? "•"}</span>
                    <span className="lbl">
                      {it.label}
                      {it.detail && <small>{it.detail.split("\n")[0]}</small>}
                    </span>
                    {!it.done ? (running ? <span className="spinner" /> : null) : <span className={`st ${it.ok ? "" : "err"}`}>{it.ok ? "done" : "failed"}</span>}
                  </button>
                );
            }
          })}
          {running && view.items.length > 0 && !toolItems.some((t) => !t.done) && (
            <div className="ev-progress" style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="spinner" /> Working…</div>
          )}
          <div ref={bottom} />
        </div>
      </section>

      <aside className="task-side">
        <div className="card">
          <h3>Workspace files</h3>
          {view.files.length === 0 ? (
            <p className="empty">Files Kestrel creates will appear here.</p>
          ) : (
            <ul className="files">
              {view.files.map((f) => (
                <li key={f.path}>
                  <a href="#" onClick={(e) => { e.preventDefault(); setPreview(f); }}>{f.path}</a>
                  <span className="size">{fmtSize(f.size)} · <a href={fileUrl(id, f.path, true)}>download</a></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          {preview ? (
            <FilePreview id={id} file={preview} />
          ) : focused ? (
            <>
              <h3>{focused.label}</h3>
              {focused.detail && (
                <>
                  <p className="side-label">{focused.name === "run_code" ? "Code" : focused.name === "write_file" ? "Content" : "Input"}</p>
                  <pre className="term">{focused.detail}</pre>
                </>
              )}
              <p className="side-label" style={{ marginTop: 12 }}>Output</p>
              {focused.done ? <pre className="term">{focused.output || "(no output)"}</pre> : <p className="empty">Running…</p>}
            </>
          ) : (
            <>
              <h3>Live view</h3>
              <p className="empty">Searches, pages, code runs and files show up here as Kestrel works.</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function FilePreview({ id, file }: { id: string; file: FileInfo }) {
  const [text, setText] = useState<string | null>(null);
  const url = fileUrl(id, file.path);
  const isImg = /\.(png|jpe?g|gif|svg|webp)$/i.test(file.path);
  const isText = /\.(md|txt|csv|json|py|js|ts|html|css|sh|yaml|yml|xml|sql)$/i.test(file.path);
  useEffect(() => {
    setText(null);
    if (isText && file.size < 500_000) fetch(url).then((r) => r.text()).then(setText).catch(() => setText("(could not load)"));
  }, [url, isText, file.size]);
  return (
    <>
      <h3>{file.path}</h3>
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="preview-img" src={url} alt={file.path} />
      ) : isText ? (
        text === null ? <p className="empty">Loading…</p> : /\.md$/i.test(file.path) ? (
          <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
        ) : (
          <pre className="term">{text}</pre>
        )
      ) : (
        <p className="empty">No preview for this file type. <a href={fileUrl(id, file.path, true)}>Download it</a>.</p>
      )}
    </>
  );
}
