import type Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { runCode } from "./sandbox";
import { listFiles, safeResolve } from "./workspace";
import type { PlanStep } from "./types";

type Tool = Anthropic.Beta.BetaTool;

/** Client tools: Kestrel executes these itself, inside the task's workspace. */
export const CLIENT_TOOLS: Tool[] = [
  {
    name: "update_plan",
    description:
      "Create or update your step-by-step plan for the task. Call it first with the full plan, then again whenever a step starts, finishes, or the plan changes. Always send the complete list.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short imperative step, under 80 characters" },
              status: { type: "string", enum: ["pending", "in_progress", "done", "skipped"] },
            },
            required: ["title", "status"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "run_code",
    description:
      "Run Python or bash in the task's sandbox. The working directory is the task workspace and persists between calls, so files you create stay available. Use print() for output you need to see. Python has the standard library; install extra packages with bash (pip install --user ...) if the sandbox allows network.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "bash"] },
        code: { type: "string" },
        timeout_seconds: { type: "integer", description: "Default 120, max 600" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "write_file",
    description:
      "Create or overwrite a text file in the workspace (relative path). Use it for deliverables such as reports (.md), data (.csv, .json), code, or HTML pages.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace (relative path). Returns at most 50,000 characters.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List every file in the workspace with its size.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {} },
  },
];

/** Server tools: Anthropic runs these; results come back inside the response. */
export const SERVER_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 15 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15 },
] as const;

const schemas = {
  update_plan: z.object({
    steps: z.array(z.object({ title: z.string(), status: z.enum(["pending", "in_progress", "done", "skipped"]) })),
  }),
  run_code: z.object({
    language: z.enum(["python", "bash"]),
    code: z.string(),
    timeout_seconds: z.number().int().positive().max(600).optional(),
  }),
  write_file: z.object({ path: z.string().min(1), content: z.string() }),
  read_file: z.object({ path: z.string().min(1) }),
  list_files: z.object({}).passthrough(),
};

export type ClientToolName = keyof typeof schemas;

export function isClientTool(name: string): name is ClientToolName {
  return name in schemas;
}

/** A short human label for the activity feed. */
export function describeToolCall(name: string, input: unknown): { label: string; detail?: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "update_plan":
      return { label: "Updated the plan" };
    case "run_code":
      return { label: i.language === "bash" ? "Ran a shell command" : "Ran Python code", detail: String(i.code ?? "") };
    case "write_file":
      return { label: `Wrote ${i.path}`, detail: String(i.content ?? "").slice(0, 4000) };
    case "read_file":
      return { label: `Read ${i.path}` };
    case "list_files":
      return { label: "Listed workspace files" };
    case "web_search":
      return { label: `Searched the web`, detail: String(i.query ?? "") };
    case "web_fetch":
      return { label: `Opened a page`, detail: String(i.url ?? "") };
    default:
      return { label: name, detail: JSON.stringify(input) };
  }
}

export interface ToolContext {
  workspace: string;
  signal: AbortSignal;
  onPlan: (steps: PlanStep[]) => void;
}

export interface ToolOutcome {
  ok: boolean;
  content: string;
}

export async function executeClientTool(name: ClientToolName, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = schemas[name].safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, content: `Invalid input for ${name}: ${parsed.error.message}. Raw input: ${JSON.stringify(rawInput).slice(0, 2000)}` };
  }
  try {
    switch (name) {
      case "update_plan": {
        const { steps } = parsed.data as z.infer<typeof schemas.update_plan>;
        ctx.onPlan(steps);
        return { ok: true, content: "Plan updated." };
      }
      case "run_code": {
        const { language, code, timeout_seconds } = parsed.data as z.infer<typeof schemas.run_code>;
        const r = await runCode(ctx.workspace, language, code, timeout_seconds ?? 120, ctx.signal);
        const parts = [
          r.timedOut ? "[timed out]" : `exit code: ${r.exitCode}`,
          r.stdout && `stdout:\n${r.stdout}`,
          r.stderr && `stderr:\n${r.stderr}`,
        ].filter(Boolean);
        return { ok: !r.timedOut && r.exitCode === 0, content: parts.join("\n\n") };
      }
      case "write_file": {
        const { path: rel, content } = parsed.data as z.infer<typeof schemas.write_file>;
        const target = await safeResolve(ctx.workspace, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf8");
        const uid = process.env.KESTREL_SANDBOX_UID ? Number(process.env.KESTREL_SANDBOX_UID) : undefined;
        if (uid !== undefined) await fs.chown(target, uid, uid).catch(() => {}); // keep it editable by sandboxed code
        return { ok: true, content: `Wrote ${content.length} characters to ${rel}.` };
      }
      case "read_file": {
        const { path: rel } = parsed.data as z.infer<typeof schemas.read_file>;
        const target = await safeResolve(ctx.workspace, rel);
        const text = await fs.readFile(target, "utf8");
        return { ok: true, content: text.length > 50_000 ? text.slice(0, 50_000) + "\n…[truncated]" : text };
      }
      case "list_files": {
        const files = await listFiles(ctx.workspace);
        return { ok: true, content: files.length ? files.map((f) => `${f.path} (${f.size} bytes)`).join("\n") : "(workspace is empty)" };
      }
    }
  } catch (e) {
    return { ok: false, content: `Error: ${(e as Error).message}` };
  }
}
