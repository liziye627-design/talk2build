import fs from "node:fs";
import path from "node:path";

export function talk2buildHome() {
  return process.env.TALK2BUILD_HOME || path.join(process.cwd(), "data");
}

export function safeSegment(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
  return cleaned || "desk";
}

export function workspaceDir(workspaceId: string) {
  const dir = path.join(talk2buildHome(), "workspaces", safeSegment(workspaceId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveInWorkspace(workspaceId: string, relativePath: string) {
  const root = path.resolve(workspaceDir(workspaceId));
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("That path leaves the workspace.");
  }
  return target;
}

export function writeWorkspaceFile(workspaceId: string, relativePath: string, contents: string) {
  const target = resolveInWorkspace(workspaceId, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
  return target;
}

export function readWorkspaceFile(workspaceId: string, relativePath: string) {
  const target = resolveInWorkspace(workspaceId, relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error("File not found in the workspace.");
  }
  const stat = fs.statSync(target);
  if (stat.size > 80_000) throw new Error("File is too large to preview.");
  return fs.readFileSync(target, "utf8");
}

export function listWorkspaceFiles(workspaceId: string) {
  const root = workspaceDir(workspaceId);
  const found: { path: string; bytes: number }[] = [];
  const walk = (dir: string) => {
    if (found.length >= 200) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const rel = path.relative(root, absolute).split(path.sep).join("/");
        found.push({ path: rel, bytes: fs.statSync(absolute).size });
      }
    }
  };
  walk(root);
  return found;
}
