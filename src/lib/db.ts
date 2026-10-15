import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hydrateMeeting } from "@/lib/meeting-defaults";
import { yesterdayIso } from "@/lib/time";
import type { MeetingState } from "@/lib/types";
import { talk2buildHome } from "@/lib/workspace";

export interface WorkspaceRow {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
}

export interface PlanStep {
  id: string;
  text: string;
  status: "done" | "next" | "pending";
}

export interface ThreadPending {
  action: string;
  prompt: string;
  payload?: Record<string, unknown>;
}

export interface ThreadPlan {
  steps: PlanStep[];
  pending: ThreadPending | null;
}

export interface ThreadRow {
  id: string;
  title: string;
  workspaceId: string;
  meetingId: string | null;
  provider: string;
  status: "idle" | "running" | "done";
  plan: ThreadPlan;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  tools: unknown;
  createdAt: string;
}

export interface ArtifactRow {
  id: string;
  threadId: string | null;
  meetingId: string | null;
  workspaceId: string;
  path: string;
  title: string;
  kind: string;
  createdAt: string;
}

interface DbGlobal {
  __talk2buildDb?: DatabaseSync;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  checkpoints_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  meeting_id TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_meeting_id TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  meeting_id TEXT,
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

function stamp() {
  return new Date().toISOString();
}

export function nid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function databasePath() {
  const home = talk2buildHome();
  fs.mkdirSync(home, { recursive: true });
  return path.join(home, "talk2build.sqlite");
}

export function getDb() {
  const g = globalThis as typeof globalThis & DbGlobal;
  if (!g.__talk2buildDb) {
    const db = new DatabaseSync(databasePath());
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    g.__talk2buildDb = db;
    seedIfEmpty(db);
    ensureSamplePreference(db);
  }
  return g.__talk2buildDb;
}

export function wipeDb() {
  const db = getDb();
  db.exec(`
    DELETE FROM messages;
    DELETE FROM artifacts;
    DELETE FROM threads;
    DELETE FROM meetings;
    DELETE FROM workspaces;
    DELETE FROM preferences;
  `);
}

function parsePlan(raw: string): ThreadPlan {
  try {
    const value = JSON.parse(raw) as ThreadPlan;
    return {
      steps: Array.isArray(value.steps) ? value.steps : [],
      pending: value.pending ?? null,
    };
  } catch {
    return { steps: [], pending: null };
  }
}

export function saveMeeting(state: MeetingState, checkpoints: MeetingState[]) {
  getDb()
    .prepare(
      `INSERT INTO meetings (id, state_json, checkpoints_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state_json = excluded.state_json,
         checkpoints_json = excluded.checkpoints_json,
         updated_at = excluded.updated_at`,
    )
    .run(state.id, JSON.stringify(state), JSON.stringify(checkpoints), state.updatedAt);
}

export function loadMeeting(id: string): { state: MeetingState; checkpoints: MeetingState[] } | null {
  const row = getDb().prepare("SELECT state_json, checkpoints_json FROM meetings WHERE id = ?").get(id) as
    | { state_json: string; checkpoints_json: string }
    | undefined;
  if (!row) return null;
  const state = hydrateMeeting({ ...(JSON.parse(row.state_json) as MeetingState), id });
  const checkpoints = (JSON.parse(row.checkpoints_json) as MeetingState[]).map((item) => hydrateMeeting(item));
  return { state, checkpoints };
}

export function listMeetings(): MeetingState[] {
  const rows = getDb().prepare("SELECT id, state_json FROM meetings ORDER BY updated_at DESC").all() as {
    id: string;
    state_json: string;
  }[];
  return rows.map((row) => hydrateMeeting({ ...(JSON.parse(row.state_json) as MeetingState), id: row.id }));
}

export function ensureWorkspace(id: string, name: string): WorkspaceRow {
  const existing = getDb().prepare("SELECT id, name, root_path, created_at FROM workspaces WHERE id = ?").get(id) as
    | { id: string; name: string; root_path: string; created_at: string }
    | undefined;
  if (existing) {
    return { id: existing.id, name: existing.name, rootPath: existing.root_path, createdAt: existing.created_at };
  }
  const createdAt = stamp();
  const rootPath = path.join(talk2buildHome(), "workspaces", id.replace(/[^a-zA-Z0-9._-]/g, "") || "desk");
  fs.mkdirSync(rootPath, { recursive: true });
  getDb().prepare("INSERT INTO workspaces (id, name, root_path, created_at) VALUES (?, ?, ?, ?)").run(id, name, rootPath, createdAt);
  return { id, name, rootPath, createdAt };
}

export function listWorkspaces(): WorkspaceRow[] {
  const rows = getDb().prepare("SELECT id, name, root_path, created_at FROM workspaces ORDER BY created_at ASC").all() as {
    id: string;
    name: string;
    root_path: string;
    created_at: string;
  }[];
  return rows.map((row) => ({ id: row.id, name: row.name, rootPath: row.root_path, createdAt: row.created_at }));
}

function mapThread(row: {
  id: string;
  title: string;
  workspace_id: string;
  meeting_id: string | null;
  provider: string;
  status: string;
  plan_json: string;
  created_at: string;
  updated_at: string;
}): ThreadRow {
  const status = row.status === "running" || row.status === "done" ? row.status : "idle";
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    meetingId: row.meeting_id,
    provider: row.provider,
    status,
    plan: parsePlan(row.plan_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createThread(input: {
  title?: string;
  workspaceId: string;
  meetingId?: string | null;
  provider?: string;
}): ThreadRow {
  const id = nid("task");
  const now = stamp();
  const title = input.title?.trim() || "New task";
  const provider = input.provider || "mock";
  const plan = JSON.stringify({ steps: [], pending: null });
  getDb()
    .prepare(
      `INSERT INTO threads (id, title, workspace_id, meeting_id, provider, status, plan_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
    )
    .run(id, title, input.workspaceId, input.meetingId ?? null, provider, plan, now, now);
  return getThread(id)!;
}

export function getThread(id: string): ThreadRow | null {
  const row = getDb().prepare("SELECT * FROM threads WHERE id = ?").get(id) as Parameters<typeof mapThread>[0] | undefined;
  return row ? mapThread(row) : null;
}

export function listThreads(): ThreadRow[] {
  const rows = getDb().prepare("SELECT * FROM threads ORDER BY updated_at DESC").all() as Parameters<typeof mapThread>[0][];
  return rows.map(mapThread);
}

export function updateThread(
  id: string,
  patch: Partial<Pick<ThreadRow, "title" | "workspaceId" | "meetingId" | "provider" | "status" | "plan">>,
) {
  const current = getThread(id);
  if (!current) return null;
  const next: ThreadRow = {
    ...current,
    ...patch,
    meetingId: patch.meetingId === undefined ? current.meetingId : patch.meetingId,
    updatedAt: stamp(),
  };
  getDb()
    .prepare(
      `UPDATE threads
       SET title = ?, workspace_id = ?, meeting_id = ?, provider = ?, status = ?, plan_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.title,
      next.workspaceId,
      next.meetingId,
      next.provider,
      next.status,
      JSON.stringify(next.plan),
      next.updatedAt,
      id,
    );
  return next;
}

export function addMessage(input: {
  threadId: string;
  role: "user" | "assistant";
  content: string;
  tools?: unknown;
}): MessageRow {
  const id = nid("msg");
  const createdAt = stamp();
  getDb()
    .prepare("INSERT INTO messages (id, thread_id, role, content, tools_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, input.threadId, input.role, input.content, JSON.stringify(input.tools ?? null), createdAt);
  return { id, threadId: input.threadId, role: input.role, content: input.content, tools: input.tools ?? null, createdAt };
}

export function listMessages(threadId: string): MessageRow[] {
  const rows = getDb()
    .prepare("SELECT id, thread_id, role, content, tools_json, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC")
    .all(threadId) as {
    id: string;
    thread_id: string;
    role: "user" | "assistant";
    content: string;
    tools_json: string;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    tools: JSON.parse(row.tools_json) as unknown,
    createdAt: row.created_at,
  }));
}

export function addArtifact(input: {
  threadId?: string | null;
  meetingId?: string | null;
  workspaceId: string;
  path: string;
  title: string;
  kind: string;
}): ArtifactRow {
  const id = nid("art");
  const createdAt = stamp();
  getDb()
    .prepare(
      `INSERT INTO artifacts (id, thread_id, meeting_id, workspace_id, path, title, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.threadId ?? null, input.meetingId ?? null, input.workspaceId, input.path, input.title, input.kind, createdAt);
  return {
    id,
    threadId: input.threadId ?? null,
    meetingId: input.meetingId ?? null,
    workspaceId: input.workspaceId,
    path: input.path,
    title: input.title,
    kind: input.kind,
    createdAt,
  };
}

export function listArtifacts(filter: { threadId?: string; workspaceId?: string; meetingId?: string } = {}): ArtifactRow[] {
  const rows = getDb()
    .prepare("SELECT id, thread_id, meeting_id, workspace_id, path, title, kind, created_at FROM artifacts ORDER BY created_at DESC")
    .all() as {
    id: string;
    thread_id: string | null;
    meeting_id: string | null;
    workspace_id: string;
    path: string;
    title: string;
    kind: string;
    created_at: string;
  }[];
  return rows
    .map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      meetingId: row.meeting_id,
      workspaceId: row.workspace_id,
      path: row.path,
      title: row.title,
      kind: row.kind,
      createdAt: row.created_at,
    }))
    .filter((row) => {
      if (filter.threadId && row.threadId !== filter.threadId) return false;
      if (filter.workspaceId && row.workspaceId !== filter.workspaceId) return false;
      if (filter.meetingId && row.meetingId !== filter.meetingId) return false;
      return true;
    });
}

function seedIfEmpty(db: DatabaseSync) {
  if (process.env.NODE_ENV === "test") return;
  const row = db.prepare("SELECT COUNT(*) AS c FROM meetings").get() as { c: number };
  if (row.c > 0) return;
  const when = yesterdayIso();
  const meetingId = "review-yesterday";
  const workspace = ensureWorkspace("desk", "Desk");
  const thread = createThread({
    title: "API review",
    workspaceId: workspace.id,
    meetingId,
    provider: "mock",
  });
  const state = hydrateMeeting({
    id: meetingId,
    title: "API review",
    scenario: "general",
    status: "ended",
    workspaceId: workspace.id,
    threadId: thread.id,
    participants: [
      { id: "p-maya", name: "Maya", label: "Maya", micOn: false, present: true },
      { id: "p-chris", name: "Chris", label: "Chris", micOn: false, present: true },
    ],
    decisions: [
      {
        id: "dec_seed",
        text: "Ship the billing export as a nightly job, not a request-path call.",
        speaker: "Maya",
        at: when,
      },
    ],
    todos: [
      { id: "todo_seed_1", text: "Add a billing export flag", speaker: "Maya", done: false, at: when },
      { id: "todo_seed_2", text: "Write the export runbook", speaker: "Chris", done: false, at: when },
    ],
    updatedAt: when,
    summary: {
      title: "API review",
      minutes: "Decided to ship the billing export as a nightly job.",
      at: when,
    },
  });
  saveMeeting(state, []);
  addMessage({
    threadId: thread.id,
    role: "assistant",
    content:
      "API review ended yesterday. Decision: ship the billing export as a nightly job, not a request-path call. Two action items are still open.",
    tools: { calls: [], plan: [] },
  });
}

export interface PreferenceRow {
  id: string;
  key: string;
  value: string;
  sourceMeetingId: string | null;
  updatedAt: string;
}

export function listPreferences(): PreferenceRow[] {
  const rows = getDb().prepare("SELECT id, key, value, source_meeting_id, updated_at FROM preferences ORDER BY updated_at DESC").all() as {
    id: string;
    key: string;
    value: string;
    source_meeting_id: string | null;
    updated_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    value: row.value,
    sourceMeetingId: row.source_meeting_id,
    updatedAt: row.updated_at,
  }));
}

export function savePreference(input: { key: string; value: string; sourceMeetingId?: string | null }) {
  const existing = getDb().prepare("SELECT id FROM preferences WHERE key = ?").get(input.key) as { id: string } | undefined;
  const updatedAt = stamp();
  if (existing) {
    getDb()
      .prepare("UPDATE preferences SET value = ?, source_meeting_id = ?, updated_at = ? WHERE id = ?")
      .run(input.value, input.sourceMeetingId ?? null, updatedAt, existing.id);
    return listPreferences().find((item) => item.id === existing.id)!;
  }
  const id = nid("pref");
  getDb()
    .prepare("INSERT INTO preferences (id, key, value, source_meeting_id, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.key, input.value, input.sourceMeetingId ?? null, updatedAt);
  return listPreferences().find((item) => item.id === id)!;
}

function ensureSamplePreference(db: DatabaseSync) {
  if (process.env.NODE_ENV === "test") return;
  const row = db.prepare("SELECT id FROM preferences WHERE key = ?").get("exports") as { id: string } | undefined;
  if (row) return;
  db.prepare("INSERT INTO preferences (id, key, value, source_meeting_id, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "pref_exports",
    "exports",
    "The team ships exports as a nightly job, not on the request path.",
    "review-yesterday",
    stamp(),
  );
}
