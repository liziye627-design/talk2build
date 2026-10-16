import { loadMeeting, saveMeeting, wipeDb } from "@/lib/db";
import { emptyMeeting } from "@/lib/meeting-defaults";
import type {
  ChatterItem,
  Decision,
  DeployRecord,
  DiffFile,
  DocRecord,
  MeetingState,
  PendingConfirm,
  ProgressReport,
  PullRequestDraft,
  Requirement,
  ScaffoldFile,
  SpeakerId,
  TimelineEvent,
  TodoItem,
  ToolTraceEntry,
  TranscriptEntry,
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function confirmationJobId(item: PendingConfirm) {
  if (item.jobId) return item.jobId;
  return typeof item.payload?.jobId === "string" ? item.payload.jobId : undefined;
}

export { emptyMeeting };

interface StoreGlobal {
  __talk2buildStore?: MeetingStore;
}

export class MeetingStore {
  private meetings = new Map<string, MeetingState>();
  private checkpoints = new Map<string, MeetingState[]>();

  ensure(id = "demo"): MeetingState {
    const existing = this.meetings.get(id);
    if (existing) return existing;
    const loaded = loadMeeting(id);
    if (loaded) {
      this.meetings.set(id, loaded.state);
      this.checkpoints.set(id, loaded.checkpoints);
      return loaded.state;
    }
    const created = emptyMeeting(id);
    this.meetings.set(id, created);
    this.checkpoints.set(id, []);
    this.persist(id);
    return created;
  }

  get(id = "demo"): MeetingState {
    return this.ensure(id);
  }

  reset(id = "demo"): MeetingState {
    const created = emptyMeeting(id);
    this.meetings.set(id, created);
    this.checkpoints.set(id, []);
    this.persist(id);
    return created;
  }

  adopt(state: MeetingState) {
    this.meetings.set(state.id, state);
    if (!this.checkpoints.has(state.id)) this.checkpoints.set(state.id, []);
    this.persist(state.id);
    return state;
  }

  checkpoint(id = "demo") {
    const snap = structuredClone(this.ensure(id));
    const stack = this.checkpoints.get(id) ?? [];
    stack.push(snap);
    this.checkpoints.set(id, stack);
    this.persist(id);
  }

  rollback(id = "demo"): { restored: boolean } {
    const stack = this.checkpoints.get(id) ?? [];
    const snap = stack.pop();
    this.checkpoints.set(id, stack);
    if (!snap) {
      this.persist(id);
      return { restored: false };
    }
    this.meetings.set(id, snap);
    this.persist(id);
    return { restored: true };
  }

  persist(id: string) {
    const state = this.meetings.get(id);
    if (!state) return;
    saveMeeting(state, this.checkpoints.get(id) ?? []);
  }

  private touch(state: MeetingState) {
    state.updatedAt = now();
    this.persist(state.id);
  }

  private nextId(state: MeetingState, prefix: string) {
    state.seq += 1;
    return `${prefix}_${state.seq}`;
  }

  ingest(
    id: string,
    input: { speaker: SpeakerId | "Alexa"; text: string; kind?: string },
  ): TranscriptEntry {
    const state = this.ensure(id);
    const entry: TranscriptEntry = {
      id: this.nextId(state, "tr"),
      speaker: input.speaker,
      text: input.text,
      at: now(),
      kind: input.kind,
    };
    state.transcript.push(entry);
    this.touch(state);
    return entry;
  }

  stampKind(id: string, text: string, kind: string) {
    const state = this.ensure(id);
    for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
      const line = state.transcript[index];
      if (line && line.speaker !== "Alexa" && line.text === text) {
        line.kind = kind;
        this.touch(state);
        return line;
      }
    }
    return null;
  }

  addTimeline(
    id: string,
    input: Omit<TimelineEvent, "id" | "linkedIds"> & { linkedIds?: string[] },
  ): TimelineEvent {
    const state = this.ensure(id);
    const event: TimelineEvent = {
      id: this.nextId(state, "tl"),
      linkedIds: input.linkedIds ?? [],
      timeLabel: input.timeLabel,
      title: input.title,
      detail: input.detail,
      speaker: input.speaker,
      correlationNote: input.correlationNote,
      metrics: input.metrics,
    };
    state.timeline.push(event);
    state.timeline.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
    this.touch(state);
    return event;
  }

  correlate(id: string, fromTime: string, toTime: string, note: string) {
    const state = this.ensure(id);
    const from = [...state.timeline].reverse().find((event) => event.timeLabel === fromTime);
    const to = state.timeline.find((event) => event.timeLabel === toTime);
    if (!from || !to) {
      return { ok: false as const, from: from ?? null, to: to ?? null };
    }
    if (!from.linkedIds.includes(to.id)) from.linkedIds.push(to.id);
    if (!to.linkedIds.includes(from.id)) to.linkedIds.push(from.id);
    from.correlationNote = note;
    this.touch(state);
    return { ok: true as const, from, to };
  }

  parkChatter(id: string, speaker: SpeakerId, text: string): ChatterItem {
    const state = this.ensure(id);
    const item: ChatterItem = {
      id: this.nextId(state, "ch"),
      speaker,
      text,
      at: now(),
    };
    state.chatter.push(item);
    this.touch(state);
    return item;
  }

  recordDecision(id: string, speaker: SpeakerId, text: string, requirements: string[] = []) {
    const state = this.ensure(id);
    const decision: Decision = {
      id: this.nextId(state, "dec"),
      speaker,
      text,
      at: now(),
    };
    state.decisions.push(decision);
    const filed: Requirement[] = requirements.filter(Boolean).map((requirement) => ({
      id: this.nextId(state, "req"),
      text: requirement,
      speaker,
      at: now(),
    }));
    state.requirements.push(...filed);
    this.touch(state);
    return { decision, requirements: filed };
  }

  addRequirement(id: string, speaker: SpeakerId, text: string): Requirement {
    const state = this.ensure(id);
    const item: Requirement = {
      id: this.nextId(state, "req"),
      speaker,
      text,
      at: now(),
    };
    state.requirements.push(item);
    this.touch(state);
    return item;
  }

  addTodo(id: string, speaker: SpeakerId, text: string): TodoItem {
    const state = this.ensure(id);
    const item: TodoItem = {
      id: this.nextId(state, "todo"),
      speaker,
      text,
      done: false,
      at: now(),
    };
    state.todos.push(item);
    this.touch(state);
    return item;
  }

  askConfirm(id: string, pending: Omit<PendingConfirm, "id">): PendingConfirm {
    const state = this.ensure(id);
    const jobId = pending.jobId || (typeof pending.payload?.jobId === "string" ? pending.payload.jobId : undefined);
    const stored: PendingConfirm = { ...pending, jobId, id: this.nextId(state, "ask") };
    const existing = [state.pending, ...(state.confirmQueue ?? [])].filter((item): item is PendingConfirm => Boolean(item));
    const without = jobId ? existing.filter((item) => confirmationJobId(item) !== jobId) : existing;
    this.writeConfirmations(state, [...without, stored]);
    this.touch(state);
    return stored;
  }

  clearPending(id: string, jobId?: string) {
    const state = this.ensure(id);
    const existing = [state.pending, ...(state.confirmQueue ?? [])].filter((item): item is PendingConfirm => Boolean(item));
    const remaining = jobId ? existing.filter((item) => confirmationJobId(item) !== jobId) : existing.slice(1);
    this.writeConfirmations(state, remaining);
    this.touch(state);
  }

  private writeConfirmations(state: MeetingState, items: PendingConfirm[]) {
    state.pending = items[0] ?? null;
    state.confirmQueue = items.slice(1);
  }

  setDeploy(id: string, deploy: DeployRecord) {
    const state = this.ensure(id);
    state.deploy = deploy;
    this.touch(state);
  }

  setIncidentDiff(id: string, files: DiffFile[]) {
    const state = this.ensure(id);
    state.incidentDiff = files;
    this.touch(state);
  }

  setScaffold(id: string, files: ScaffoldFile[]) {
    const state = this.ensure(id);
    state.scaffold = files;
    this.touch(state);
  }

  setPullRequest(id: string, pullRequest: PullRequestDraft) {
    const state = this.ensure(id);
    state.pullRequest = pullRequest;
    this.touch(state);
  }

  writeDoc(id: string, title: string, body: string): DocRecord {
    const state = this.ensure(id);
    const doc: DocRecord = {
      id: this.nextId(state, "doc"),
      title,
      body,
      at: now(),
    };
    state.docs.push(doc);
    this.touch(state);
    return doc;
  }

  addProgress(id: string, text: string): ProgressReport {
    const state = this.ensure(id);
    const report: ProgressReport = {
      id: this.nextId(state, "prog"),
      text,
      at: now(),
    };
    state.progress.push(report);
    this.touch(state);
    return report;
  }

  addTrace(id: string, entry: Omit<ToolTraceEntry, "at">) {
    const state = this.ensure(id);
    state.toolTrace.push({ ...entry, at: now() });
    if (state.toolTrace.length > 80) {
      state.toolTrace.splice(0, state.toolTrace.length - 80);
    }
    this.touch(state);
  }

  bumpSubstantive(id: string) {
    const state = this.ensure(id);
    state.substantiveTurns += 1;
    this.touch(state);
    return state.substantiveTurns;
  }
}

export function getStore(): MeetingStore {
  const g = globalThis as typeof globalThis & StoreGlobal;
  if (!g.__talk2buildStore) g.__talk2buildStore = new MeetingStore();
  return g.__talk2buildStore;
}

export function resetStore() {
  wipeDb();
  const g = globalThis as typeof globalThis & StoreGlobal;
  g.__talk2buildStore = new MeetingStore();
  return g.__talk2buildStore;
}

export function reopenStore() {
  const g = globalThis as typeof globalThis & StoreGlobal;
  g.__talk2buildStore = new MeetingStore();
  return g.__talk2buildStore;
}
