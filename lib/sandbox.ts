import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

/**
 * Runs code for a task inside its workspace folder.
 *
 * KESTREL_SANDBOX=docker (recommended for anything public) runs each call in a
 * throwaway container with only the workspace mounted. The default "local" mode
 * runs a plain subprocess on the host: fine for trying it out on your own
 * machine, NOT an isolation boundary.
 */
export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 20_000;
const MODE = process.env.KESTREL_SANDBOX === "docker" ? "docker" : "local";
const IMAGE = process.env.KESTREL_SANDBOX_IMAGE || "python:3.12-slim";
const NETWORK = process.env.KESTREL_SANDBOX_NETWORK || "bridge";
// Optional: run local-mode code as an unprivileged user (set in the Dockerfile).
const RUN_UID = process.env.KESTREL_SANDBOX_UID ? Number(process.env.KESTREL_SANDBOX_UID) : undefined;

function clip(s: string) {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

export async function runCode(
  workspace: string,
  language: "python" | "bash",
  code: string,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<RunResult> {
  const scratch = path.join(workspace, ".kestrel");
  await fs.mkdir(scratch, { recursive: true });
  if (RUN_UID !== undefined) {
    await fs.chown(workspace, RUN_UID, RUN_UID).catch(() => {});
    await fs.chown(scratch, RUN_UID, RUN_UID).catch(() => {});
  }
  const file = language === "python" ? "run.py" : "run.sh";
  await fs.writeFile(path.join(scratch, file), code, "utf8");
  if (RUN_UID !== undefined) await fs.chown(path.join(scratch, file), RUN_UID, RUN_UID).catch(() => {});

  let cmd: string;
  let args: string[];
  if (MODE === "docker") {
    cmd = "docker";
    args = [
      "run", "--rm",
      "--network", NETWORK,
      "--memory", "1g", "--cpus", "1", "--pids-limit", "256",
      "-v", `${workspace}:/workspace`, "-w", "/workspace",
      IMAGE,
      language === "python" ? "python" : "bash",
      `.kestrel/${file}`,
    ];
  } else {
    cmd = language === "python" ? process.env.KESTREL_PYTHON || "python3" : "bash";
    args = [path.join(".kestrel", file)];
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: workspace,
      env: { PATH: process.env.PATH ?? "", HOME: workspace, LANG: "C.UTF-8", MPLBACKEND: "Agg" } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: MODE === "local",
      ...(MODE === "local" && RUN_UID !== undefined ? { uid: RUN_UID, gid: RUN_UID } : {}),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const kill = () => {
      try {
        if (MODE === "local" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutSec * 1000);
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: "", stderr: String(err), timedOut: false });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout: clip(stdout), stderr: clip(stderr), timedOut });
    });
  });
}
