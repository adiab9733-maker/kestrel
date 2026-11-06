import fs from "fs/promises";
import path from "path";
import type { FileInfo } from "./types";

export const DATA_DIR = path.resolve(process.env.KESTREL_DATA_DIR || "./data/tasks");

export function taskDir(id: string) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("bad task id");
  return path.join(DATA_DIR, id);
}

export function workspaceDir(id: string) {
  return path.join(taskDir(id), "workspace");
}

/**
 * Resolve a model- or user-supplied relative path inside a workspace.
 * Rejects absolute paths, `..` escapes and symlinks that point outside.
 */
export async function safeResolve(root: string, rel: string): Promise<string> {
  const target = path.resolve(root, rel.replace(/^\/+/, ""));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace: ${rel}`);
  }
  // Canonicalize the deepest existing ancestor to catch symlink escapes.
  let probe = target;
  while (true) {
    try {
      const real = await fs.realpath(probe);
      const realRoot = await fs.realpath(root);
      const r = path.relative(realRoot, real);
      if (r.startsWith("..") || path.isAbsolute(r)) throw new Error(`Path escapes the workspace: ${rel}`);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return target;
}

export async function listFiles(root: string, max = 500): Promise<FileInfo[]> {
  const out: FileInfo[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith(".kestrel") || e.name === "__pycache__" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const st = await fs.stat(full);
        out.push({ path: path.relative(root, full), size: st.size });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
