"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const EXAMPLES = [
  "Compare the three most popular open-source vector databases and write a one-page recommendation.",
  "Find the population of the 10 largest EU cities, chart it, and save the data as CSV.",
  "Research this week's top AI news and write a short briefing with sources.",
  "Write and test a Python function that parses ISO 8601 durations.",
];

export function NewTask() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the task");
      router.push(`/tasks/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="composer">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="e.g. Plan a 4-day trip to Lisbon in March with a budget under €1,200 and save it as a doc"
          aria-label="Task"
        />
        <div className="composer-row">
          <span className="hint">{error ? <span style={{ color: "var(--err)" }}>{error}</span> : <span className="kbd-hint">⌘/Ctrl + Enter to start</span>}</span>
          <button className="btn" onClick={submit} disabled={busy || !prompt.trim()}>
            {busy ? "Starting…" : "Start task"}
          </button>
        </div>
      </div>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" onClick={() => setPrompt(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </>
  );
}
