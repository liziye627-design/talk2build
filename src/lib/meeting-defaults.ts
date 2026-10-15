import type { MeetingState } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

export function joinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TB-";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function emptyMeeting(id = "demo"): MeetingState {
  const incident = id === "demo";
  return {
    id,
    title: incident ? "Orders service postmortem" : "Meeting",
    incidentDate: incident ? "2026-10-15" : new Date().toISOString().slice(0, 10),
    scenario: incident ? "incident" : "general",
    status: incident ? "live" : "scheduled",
    joinCode: joinCode(),
    workspaceId: incident ? "desk" : `ws-${id}`,
    threadId: null,
    participants: [],
    summary: null,
    seq: 0,
    transcript: [],
    timeline: [],
    decisions: [],
    requirements: [],
    todos: [],
    chatter: [],
    deploy: null,
    incidentDiff: null,
    scaffold: null,
    pullRequest: null,
    docs: [],
    pending: null,
    progress: [],
    toolTrace: [],
    substantiveTurns: 0,
    updatedAt: now(),
  };
}

export function hydrateMeeting(raw: Partial<MeetingState> & { id: string }): MeetingState {
  const base = emptyMeeting(raw.id);
  return {
    ...base,
    ...raw,
    scenario: raw.scenario === "incident" || raw.scenario === "general" ? raw.scenario : base.scenario,
    status: raw.status === "scheduled" || raw.status === "live" || raw.status === "ended" ? raw.status : base.status,
    joinCode: raw.joinCode || base.joinCode,
    workspaceId: raw.workspaceId || base.workspaceId,
    threadId: raw.threadId ?? null,
    participants: Array.isArray(raw.participants) ? raw.participants : base.participants,
    summary: raw.summary ?? null,
    transcript: raw.transcript ?? [],
    timeline: raw.timeline ?? [],
    decisions: raw.decisions ?? [],
    requirements: raw.requirements ?? [],
    todos: raw.todos ?? [],
    chatter: raw.chatter ?? [],
    docs: raw.docs ?? [],
    progress: raw.progress ?? [],
    toolTrace: raw.toolTrace ?? [],
  };
}
