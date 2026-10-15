import { planChat, finishSteps } from "@/lib/chat-planner";
import {
  addMessage,
  createThread,
  ensureWorkspace,
  getThread,
  listArtifacts,
  listMeetings,
  listMessages,
  listThreads,
  listWorkspaces,
  nid,
  updateThread,
  type ThreadRow,
} from "@/lib/db";
import { enqueue } from "@/lib/mutex";
import { getStore } from "@/lib/meeting-store";
import { executeTool } from "@/lib/tools";
import { providerPublicConfig } from "@/lib/llm";
import { readWorkspaceFile } from "@/lib/workspace";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  });
}

const NEEDS_MEETING = new Set([
  "write_doc",
  "scaffold_code",
  "run_tests",
  "pr_draft",
  "meeting_summary",
  "list_workspace",
  "read_file",
  "write_file",
]);

function chunkText(value: string) {
  if (!value) return [];
  const size = 48;
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) chunks.push(value.slice(index, index + size));
  return chunks;
}

function sse(events: { event: string; data: unknown }[]) {
  const body = events.map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join("");
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function ensureTaskMeeting(thread: ThreadRow) {
  if (thread.meetingId) return thread.meetingId;
  const id = `task-${thread.id}`;
  const store = getStore();
  const state = store.ensure(id);
  state.title = thread.title === "New task" ? "Task notes" : thread.title;
  state.scenario = "general";
  state.status = "scheduled";
  state.workspaceId = thread.workspaceId;
  state.threadId = thread.id;
  store.persist(id);
  ensureWorkspace(thread.workspaceId, "Desk");
  updateThread(thread.id, { meetingId: id });
  return id;
}

export function handleBootstrap() {
  const desk = ensureWorkspace("desk", "Desk");
  const config = providerPublicConfig();
  return json({
    threads: listThreads(),
    meetings: listMeetings().filter((meeting) => meeting.status !== "scheduled"),
    workspaces: listWorkspaces().length > 0 ? listWorkspaces() : [desk],
    providers: [
      { id: "mock", label: "Mock", model: "Deterministic" },
      { id: "bedrock", label: "Bedrock", model: "amazon.nova-lite-v1:0" },
      { id: "nebius", label: "Nebius", model: "nvidia/Nemotron-3_5-Lightning" },
    ],
    active: config,
  });
}

export async function handleThreads(request: Request) {
  if (request.method === "GET") return json({ threads: listThreads() });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.trim() ? body.workspaceId.trim() : "desk";
  ensureWorkspace(workspaceId, workspaceId === "desk" ? "Desk" : workspaceId);
  const thread = createThread({
    title: typeof body.title === "string" ? body.title : "New task",
    workspaceId,
    provider: typeof body.provider === "string" ? body.provider : "mock",
  });
  return json({ thread }, 201);
}

export function handleThreadGet(id: string) {
  const thread = getThread(id);
  if (!thread) return json({ error: "Task not found." }, 404);
  return json({
    thread,
    messages: listMessages(id),
    artifacts: listArtifacts({ threadId: id }),
  });
}

export function handleThreadMessage(request: Request, threadId: string) {
  return enqueue(async () => {
    const existing = getThread(threadId);
    if (!existing) return json({ error: "Task not found." }, 404);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Expected a JSON body." }, 400);
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "Say what you want done." }, 400);
    if (typeof body.provider === "string" && body.provider.trim()) {
      updateThread(threadId, { provider: body.provider.trim() });
    }
    if (typeof body.workspaceId === "string" && body.workspaceId.trim()) {
      ensureWorkspace(body.workspaceId.trim(), body.workspaceId.trim() === "desk" ? "Desk" : body.workspaceId.trim());
      updateThread(threadId, { workspaceId: body.workspaceId.trim() });
    }
    const thread = getThread(threadId)!;
    addMessage({ threadId, role: "user", content: text });
    updateThread(threadId, { status: "running", title: thread.title === "New task" ? text.slice(0, 64) : thread.title });
    const plan = planChat({
      text,
      pending: thread.plan.pending,
      threadId,
      meetingId: thread.meetingId,
    });
    let boundMeeting = thread.meetingId;
    if (plan.tools.some((tool) => NEEDS_MEETING.has(tool.name) && !tool.arguments.meetingId)) {
      boundMeeting = ensureTaskMeeting(getThread(threadId)!);
    }
    const calls: { name: string; ok: boolean; summary: string; data?: unknown }[] = [];
    let openMeetingId: string | null = null;
    let failed = false;
    for (const tool of plan.tools) {
      const args: Record<string, unknown> = { ...tool.arguments, threadId };
      if (tool.name !== "meeting_open" && tool.name !== "search_memory" && args.scope !== "all" && !args.meetingId && boundMeeting) {
        args.meetingId = boundMeeting;
      }
      const result = executeTool(tool.name, args);
      calls.push({ name: tool.name, ok: result.ok, summary: result.summary, data: result.data });
      if (!result.ok) failed = true;
      if (tool.name === "meeting_open" && result.ok && result.data && typeof result.data === "object") {
        const data = result.data as { meetingId?: string };
        if (data.meetingId) {
          openMeetingId = data.meetingId;
          updateThread(threadId, { meetingId: data.meetingId });
          const meeting = getStore().get(data.meetingId);
          meeting.threadId = threadId;
          getStore().persist(meeting.id);
        }
      }
    }
    const toolReply = [...calls].reverse().find((call) => call.ok)?.summary;
    let reply = plan.replyFrom === "tool" ? toolReply || plan.reply : plan.reply;
    if (!reply) reply = toolReply || "Done.";
    if (openMeetingId) reply = `${reply} Open the room at /meetings/${openMeetingId}.`;
    const steps = finishSteps(plan, failed);
    const message = addMessage({ threadId, role: "assistant", content: reply, tools: { calls, plan: steps } });
    const saved = updateThread(threadId, {
      status: plan.pending ? "running" : "done",
      plan: { steps, pending: plan.pending },
    });
    const artifacts = listArtifacts({ threadId });
    const events = [
      { event: "plan", data: { steps } },
      ...calls.map((call) => ({ event: "tool", data: call })),
      ...chunkText(reply).map((piece) => ({ event: "delta", data: { text: piece } })),
      { event: "done", data: { message, thread: saved, artifacts, openMeetingId } },
    ];
    return sse(events);
  });
}

export function handleMeetingsGet() {
  return json({ meetings: listMeetings().filter((meeting) => meeting.status !== "scheduled") });
}

export async function handleMeetingsPost(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Working session";
  const scenario = body.scenario === "incident" ? "incident" : "general";
  const host = typeof body.host === "string" && body.host.trim() ? body.host.trim() : "You";
  const provider = typeof body.provider === "string" ? body.provider : "mock";
  const opened = executeTool("meeting_open", { title, scenario, host });
  const data = opened.data as { meetingId: string };
  const meeting = getStore().get(data.meetingId);
  ensureWorkspace(meeting.workspaceId, title);
  const thread = createThread({ title, workspaceId: meeting.workspaceId, meetingId: meeting.id, provider });
  meeting.threadId = thread.id;
  getStore().persist(meeting.id);
  return json({ meeting, thread }, 201);
}

export function handleIncidentLaunch() {
  const store = getStore();
  const state = store.reset("demo");
  state.status = "live";
  state.participants = [
    { id: "pA", name: "Priya", label: "A", micOn: false, present: true },
    { id: "pB", name: "Jordan", label: "B", micOn: false, present: true },
  ];
  ensureWorkspace("desk", "Desk");
  const existing = listThreads().find((thread) => thread.meetingId === "demo");
  const thread =
    existing ??
    createThread({ title: state.title, workspaceId: "desk", meetingId: "demo", provider: "mock" });
  state.threadId = thread.id;
  store.persist("demo");
  updateThread(thread.id, { meetingId: "demo", title: state.title, status: "idle" });
  return json({ meeting: store.get("demo"), thread: getThread(thread.id) });
}

export function handleMeetingGet(id: string) {
  const meeting = listMeetings().find((item) => item.id === id) ?? null;
  if (!meeting) return json({ error: "Meeting not found." }, 404);
  getStore().ensure(id);
  return json({ meeting: getStore().get(id) });
}

export async function handleMeetingJoin(request: Request, id: string) {
  if (!listMeetings().some((item) => item.id === id)) return json({ error: "Meeting not found." }, 404);
  const meeting = getStore().ensure(id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (code && code !== meeting.joinCode.toUpperCase()) return json({ error: "That join code does not match." }, 403);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Guest";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : name;
  if (!meeting.participants.some((person) => person.label === label)) {
    meeting.participants.push({ id: nid("p"), name, label, micOn: false, present: true });
  }
  meeting.status = "live";
  getStore().persist(id);
  return json({ meeting: getStore().get(id) });
}

export async function handleMeetingMic(request: Request, id: string) {
  const meeting = getStore().ensure(id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label : "";
  const micOn = Boolean(body.micOn);
  const person = meeting.participants.find((item) => item.label === label || item.id === body.participantId);
  if (person) person.micOn = micOn;
  getStore().persist(id);
  return json({ meeting: getStore().get(id) });
}

export function handleMeetingEnd(id: string) {
  return enqueue(async () => {
    const meeting = getStore().ensure(id);
    if (!meeting.threadId) {
      const thread = createThread({ title: meeting.title, workspaceId: meeting.workspaceId, meetingId: id, provider: "mock" });
      meeting.threadId = thread.id;
      getStore().persist(id);
    }
    const result = executeTool("meeting_summary", { meetingId: id, threadId: meeting.threadId, ended: "true" });
    const current = getStore().get(id);
    current.status = "ended";
    getStore().persist(id);
    const content = current.summary?.minutes || result.summary;
    addMessage({
      threadId: current.threadId!,
      role: "assistant",
      content: `Meeting ended. Minutes are in the workspace.\n\n${content}`,
      tools: { calls: [{ name: "meeting_summary", ok: result.ok, summary: result.summary }], plan: [] },
    });
    updateThread(current.threadId!, { status: "done", meetingId: id });
    return json({ meeting: getStore().get(id), threadId: current.threadId, summary: result.summary });
  });
}

export function handleWorkspaceFile(workspaceId: string, relativePath: string) {
  if (!relativePath) return json({ error: "Path is required." }, 400);
  try {
    const contents = readWorkspaceFile(workspaceId, relativePath);
    return json({ path: relativePath, contents });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not read the file." }, 400);
  }
}
