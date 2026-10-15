import { PROTOCOL_VERSION } from "@/lib/types";

export interface McpSession {
  id: string;
  protocolVersion: string;
  createdAt: number;
  logLevel: string;
  events: { id: string; data: string }[];
}

interface SessionGlobal {
  __talk2buildSessions?: Map<string, McpSession>;
}

function bag() {
  const g = globalThis as typeof globalThis & SessionGlobal;
  if (!g.__talk2buildSessions) g.__talk2buildSessions = new Map();
  return g.__talk2buildSessions;
}

export function createSession(): McpSession {
  const session: McpSession = {
    id: crypto.randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    createdAt: Date.now(),
    logLevel: "info",
    events: [],
  };
  bag().set(session.id, session);
  return session;
}

export function getSession(id: string | null) {
  if (!id) return null;
  return bag().get(id) ?? null;
}

export function deleteSession(id: string) {
  return bag().delete(id);
}

export function resetSessions() {
  bag().clear();
}

export function rememberEvent(session: McpSession, data: string) {
  const id = `${session.id}:${session.events.length + 1}`;
  session.events.push({ id, data });
  if (session.events.length > 20) session.events.shift();
  return id;
}
