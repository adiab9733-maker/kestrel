# Kestrel

An autonomous agent web app. You give Kestrel a task; it writes a plan, then works through it on its own — searching the web, reading pages, running Python/bash in a per-task sandbox, and writing files — while you watch every step live. It finishes with a written answer and downloadable files.

Built on the Claude API (`claude-opus-5-5` by default) with Next.js + TypeScript.

## Run it

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                   # http://localhost:3000
```

Requires Node 20+ and Python 3 on the machine (for the `local` sandbox), or Docker (for `KESTREL_SANDBOX=docker`).

## Use it from a tablet or phone (host it on Railway)

1. Push this code to a GitHub repository.
2. On railway.app: **New Project → Deploy from GitHub repo**, pick the repo. Railway builds the included `Dockerfile`.
3. In the service's **Variables**, add `ANTHROPIC_API_KEY` and `KESTREL_PASSWORD` (anything you like).
4. Optional but recommended: add a **Volume** mounted at `/data` so task history survives redeploys.
5. Under **Settings → Networking**, click **Generate Domain** and open that link on your tablet.
6. In Safari: Share → **Add to Home Screen** (Chrome: menu → **Install app**). Kestrel then opens full screen like a normal app.

## How it works

| Piece | File |
|---|---|
| Agent loop: streams each turn, runs tools, loops until done | `lib/agent.ts` |
| Tools: `update_plan`, `run_code`, `write_file`, `read_file`, `list_files` (client) + `web_search`, `web_fetch` (Anthropic server tools) | `lib/tools.ts` |
| Code sandbox (local subprocess or Docker container) | `lib/sandbox.ts` |
| Task store: append-only event log in memory + `data/tasks/<id>/events.jsonl` | `lib/store.ts` |
| Live updates over Server-Sent Events, with replay on reconnect | `app/api/tasks/[id]/events/route.ts` |
| UI: home/composer, live task view with plan, activity feed, workspace panel | `app/`, `components/` |

Model features used: adaptive thinking with `display: "updates"` (short progress notes between tool calls), `effort`, automatic prompt caching, and server-side refusal fallbacks (`fallbacks: "default"`).

## Security notes

- `KESTREL_SANDBOX=local` runs model-written code directly on the host. Use it only on your own machine. Use `docker` (with `KESTREL_SANDBOX_NETWORK=none` if you don't need pip) for anything shared.
- File paths from the model are confined to the task workspace; files are served with `Content-Security-Policy: sandbox` and HTML as plain text.
- There is no auth yet. Don't expose it to the internet as-is.

## Roadmap (after MVP)

- Follow-up messages on a finished task
- User accounts + per-user task lists
- Headless browser tool (screenshots, clicking, forms)
- Hosted sandboxes (e.g. a container per task) and a job queue so tasks survive restarts
- Usage/cost display per task
