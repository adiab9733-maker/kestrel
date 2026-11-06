export type PlanStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
  title: string;
  status: PlanStatus;
}

export interface FileInfo {
  path: string;
  size: number;
}

export type TaskStatus = "running" | "done" | "error" | "cancelled";

/** Everything the UI shows is derived from this append-only event log. */
export type AgentEventBody =
  | { type: "status"; status: TaskStatus }
  | { type: "user"; text: string }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "progress"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; label: string; detail?: string }
  | { type: "tool_end"; id: string; ok: boolean; output: string }
  | { type: "files"; files: FileInfo[] }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export type AgentEvent = AgentEventBody & { seq: number; ts: number };

export interface TaskMeta {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}
