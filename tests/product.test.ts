import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import { planChat } from "@/lib/chat-planner";
import { getStore, reopenStore, resetStore } from "@/lib/meeting-store";
import { yesterdayIso } from "@/lib/time";
import { executeTool } from "@/lib/tools";
import { readWorkspaceFile } from "@/lib/workspace";
import { startServer } from "@/server/standalone";

function parseSse(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.trim().startsWith("event:"))
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const raw = block.match(/^data: (.+)$/m)?.[1] ?? "null";
      return { event, data: JSON.parse(raw) as Record<string, unknown> };
    });
}

describe("persistence and general tools", () => {
  beforeEach(() => {
    resetStore();
  });

  it("reloads a meeting after the memory cache is dropped", () => {
    executeTool("decision_record", { speaker: "Maya", text: "Ship nightly exports.", meetingId: "keep" });
    reopenStore();
    const state = getStore().ensure("keep");
    expect(state.decisions[0]?.text).toMatch(/nightly exports/);
    expect(state.scenario).toBe("general");
  });

  it("scaffolds a real module and runs node --test", () => {
    const scaffold = executeTool("scaffold_code", { meetingId: "gen-check", prompt: "billing export checker" });
    expect(scaffold.ok).toBe(true);
    const tests = executeTool("run_tests", { meetingId: "gen-check" });
    expect(tests.summary).toBe("Tests passing.");
    const escaped = executeTool("read_file", { meetingId: "gen-check", path: "../talk2build.sqlite" });
    expect(escaped.ok).toBe(false);
    expect(escaped.summary).toMatch(/leaves the workspace/);
  });

  it("does not turn a generic root cause into the Redis pull request", () => {
    const spoken = classifyUtterance({
      text: "That's the root cause, the cache was full.",
      speaker: "A",
      pending: null,
      scenario: "general",
    });
    expect(spoken.tools.some((tool) => tool.name === "pr_draft")).toBe(false);
    expect(spoken.tools.some((tool) => tool.arguments.action === "pr_draft")).toBe(false);
    expect(spoken.tools.some((tool) => tool.name === "decision_record")).toBe(true);
  });
});

describe("tasks and meetings over HTTP", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer(0);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    resetStore();
  });

  it("answers yesterday's decision and writes issues after a yes", async () => {
    const store = getStore();
    const state = store.ensure("review-yesterday");
    const when = yesterdayIso();
    state.title = "API review";
    state.status = "ended";
    state.scenario = "general";
    state.workspaceId = "desk";
    state.decisions = [
      {
        id: "dec_seed",
        text: "Ship the billing export as a nightly job, not a request-path call.",
        speaker: "Maya",
        at: when,
      },
    ];
    state.todos = [
      { id: "todo_1", text: "Add a billing export flag", speaker: "Maya", done: false, at: when },
      { id: "todo_2", text: "Write the export runbook", speaker: "Chris", done: false, at: when },
    ];
    store.persist("review-yesterday");

    const created = await fetch(`${server.url}/api/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New task", workspaceId: "desk", provider: "mock" }),
    });
    const thread = ((await created.json()) as { thread: { id: string } }).thread;

    const asked = await fetch(`${server.url}/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "What did we decide yesterday?" }),
    });
    const askedEvents = parseSse(await asked.text());
    const askedDone = askedEvents.find((item) => item.event === "done");
    const askedMessage = askedDone?.data.message as { content: string };
    expect(askedMessage.content).toMatch(/nightly job/);
    expect(askedEvents.some((item) => item.event === "tool" && (item.data as { name: string }).name === "search_memory")).toBe(true);
    expect(askedEvents.some((item) => item.event === "plan")).toBe(true);

    const pending = planChat({
      text: "Turn yesterday's action items into issues",
      pending: null,
      threadId: thread.id,
      meetingId: null,
    });
    expect(pending.pending?.action).toBe("create_issues");

    const prompted = await fetch(`${server.url}/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Turn yesterday's action items into issues" }),
    });
    expect((await prompted.text()).length).toBeGreaterThan(0);

    const accepted = await fetch(`${server.url}/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "yes" }),
    });
    const acceptedText = await accepted.text();
    expect(acceptedText).toMatch(/billing export flag/);
    const flag = readWorkspaceFile("desk", "issues/01-add-a-billing-export-flag.md");
    expect(flag).toMatch(/Add a billing export flag/);
  });

  it("ends a meeting and posts the minutes back to the task", async () => {
    const created = await fetch(`${server.url}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Planning", host: "Maya" }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { meeting: { id: string; joinCode: string }; thread: { id: string } };
    const said = await fetch(`${server.url}/api/meetings/${body.meeting.id}/utterance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speaker: "Maya", text: "记一下 ship the export as a nightly job" }),
    });
    expect(said.status).toBe(200);
    const ended = await fetch(`${server.url}/api/meetings/${body.meeting.id}/end`, { method: "POST" });
    const summary = (await ended.json()) as { meeting: { status: string; summary: { minutes: string } }; threadId: string };
    expect(summary.meeting.status).toBe("ended");
    expect(summary.meeting.summary.minutes).toMatch(/nightly job/);
    const thread = await fetch(`${server.url}/api/threads/${summary.threadId}`);
    const threadBody = (await thread.json()) as { messages: { content: string }[] };
    expect(threadBody.messages.some((message) => /Meeting ended/.test(message.content))).toBe(true);
    expect(threadBody.messages.some((message) => /nightly job/.test(message.content))).toBe(true);
  });
});
