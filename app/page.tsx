import Link from "next/link";
import { NewTask } from "@/components/NewTask";
import { listTasks } from "@/lib/store";

export const dynamic = "force-dynamic";

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default async function Home() {
  const tasks = (await listTasks()).slice(0, 15);
  return (
    <main className="home">
      <h1>What should Kestrel get done?</h1>
      <p className="lede">Describe a task. Kestrel plans it, searches the web, writes and runs code, and hands back the results and files.</p>
      <NewTask />
      {tasks.length > 0 && (
        <section className="recent">
          <h2>Recent tasks</h2>
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`}>
                  <span>{t.title}</span>
                  <span className="when">
                    <span className={`pill ${t.status}`}>{t.status}</span> {ago(t.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
