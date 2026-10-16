import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import { parseExtraction } from "@/lib/agent/fixtures";
import { prepareAgentWork, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { extractMeetingTurn, resolveAgentBackend } from "@/lib/agent/model";
import { JobRunner, getJobRunner, resetJobRunner } from "@/lib/agent/runner";
import type { AgentJob } from "@/lib/agent/types";
import { getStore, resetStore } from "@/lib/meeting-store";
import { executeTool } from "@/lib/tools";
import { readWorkspaceFile } from "@/lib/workspace";

function sampleJob(id: string, title = "Plan"): AgentJob {
  return { id, meetingId: "m", kind: "plan", title, brief: "nightly export", speaker: "Maya", needsConfirm: false };
}

describe("job runner", () => {
  it("runs jobs concurrently up to the limit", async () => {
    let current = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = new JobRunner(3, async () => {
      current += 1;
      peak = Math.max(peak, current);
      await hold;
      current -= 1;
    });
    runner.start(sampleJob("a"));
    runner.start(sampleJob("b", "Design"));
    runner.start(sampleJob("c", "Research"));
    await vi.waitFor(() => {
      expect(peak).toBe(3);
    });
    release();
    await runner.whenIdle();
    expect(current).toBe(0);
  });

  it("cancels a running job", async () => {
    const runner = new JobRunner(2, (_job, signal) => {
      return new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });
    runner.start(sampleJob("slow"));
    await vi.waitFor(() => {
      expect(runner.cancel("slow")).toBe(true);
    });
    await runner.whenIdle();
    expect(runner.cancel("slow")).toBe(false);
  });
});

describe("confirmation gate", () => {
  afterEach(() => {
    useDefaultJobRunner();
    resetStore();
  });

  it("queues code work and does not scaffold until a yes", async () => {
    const state = getStore().ensure("gate");
    state.scenario = "general";
    state.title = "Gate";
    getStore().persist("gate");
    await prepareAgentWork({
      meetingId: "gate",
      speaker: "Priya",
      text: "Run the tests once the scaffold is in.",
    });
    const meeting = getStore().get("gate");
    expect(meeting.pending?.action).toBe("scaffold_code");
    expect(meeting.scaffold).toBeNull();
    expect(meeting.workstreams.find((item) => item.kind === "code")?.status).toBe("waiting");
  });

  it("names each code job and binds yes to that job id", async () => {
    const state = getStore().ensure("gates");
    state.scenario = "general";
    state.title = "Gates";
    getStore().persist("gates");
    await prepareAgentWork({ meetingId: "gates", speaker: "Priya", text: "Scaffold the billing reconciler." });
    await prepareAgentWork({ meetingId: "gates", speaker: "Chris", text: "Scaffold the invoice mailer." });
    const meeting = getStore().get("gates");
    const waiting = meeting.workstreams.filter((item) => item.kind === "code" && item.status === "waiting");
    expect(waiting).toHaveLength(2);
    expect(meeting.pending?.prompt).toMatch(/billing reconciler/i);
    expect(meeting.pending?.prompt).not.toBe("I'll scaffold the export checker and run its tests. Say yes.");
    const firstId = String(meeting.pending?.payload?.jobId || "");
    const second = meeting.confirmQueue?.[0];
    const secondId = String(second?.payload?.jobId || "");
    expect(waiting.map((item) => item.jobId)).toEqual(expect.arrayContaining([firstId, secondId]));
    expect(second?.prompt).toMatch(/invoice mailer/i);

    const targeted = classifyUtterance({
      text: `Yes ${secondId}`,
      speaker: "Chris",
      pending: meeting.pending,
      queue: meeting.confirmQueue,
      scenario: "general",
    });
    const scaffold = targeted.tools.find((tool) => tool.name === "scaffold_code");
    expect(scaffold?.arguments.jobId).toBe(secondId);
    executeTool("scaffold_code", { meetingId: "gates", ...(scaffold?.arguments ?? {}) });

    const after = getStore().get("gates");
    expect(after.workstreams.find((item) => item.jobId === secondId)?.status).toBe("ready");
    expect(after.workstreams.find((item) => item.jobId === firstId)?.status).toBe("waiting");
    expect(after.pending?.payload?.jobId).toBe(firstId);
    expect(after.pending?.prompt).toMatch(/billing reconciler/i);
    expect(after.confirmQueue ?? []).toHaveLength(0);
  });

  it("queues two code jobs from one turn and readies only the confirmed job", async () => {
    const state = getStore().ensure("pair");
    state.scenario = "general";
    state.title = "Pair";
    getStore().persist("pair");
    await prepareAgentWork({
      meetingId: "pair",
      speaker: "Priya",
      text: "Scaffold the billing reconciler and scaffold the invoice mailer.",
    });
    const meeting = getStore().get("pair");
    const waiting = meeting.workstreams.filter((item) => item.kind === "code" && item.status === "waiting");
    expect(waiting).toHaveLength(2);
    const queued = [meeting.pending, ...(meeting.confirmQueue ?? [])].filter((item) => item != null);
    const byJob = new Map(queued.map((item) => [item.jobId, item]));
    expect(byJob.size).toBe(2);
    const mailer = waiting.find((item) => /invoice mailer/i.test(item.title || item.summary));
    const billing = waiting.find((item) => /billing reconciler/i.test(item.title || item.summary));
    expect(mailer?.jobId).toBeTruthy();
    expect(billing?.jobId).toBeTruthy();
    expect(byJob.has(mailer?.jobId)).toBe(true);
    expect(byJob.has(billing?.jobId)).toBe(true);

    const yes = classifyUtterance({
      text: `Yes ${mailer?.jobId}`,
      speaker: "Priya",
      pending: meeting.pending,
      queue: meeting.confirmQueue,
      scenario: "general",
    });
    const scaffold = yes.tools.find((tool) => tool.name === "scaffold_code");
    expect(scaffold?.arguments.jobId).toBe(mailer?.jobId);
    executeTool("scaffold_code", { meetingId: "pair", ...(scaffold?.arguments ?? {}) });

    const after = getStore().get("pair");
    expect(after.workstreams.find((item) => item.jobId === mailer?.jobId)?.status).toBe("ready");
    expect(after.workstreams.find((item) => item.jobId === billing?.jobId)?.status).toBe("waiting");
    expect(after.pending?.jobId).toBe(billing?.jobId);
    expect(after.confirmQueue.find((item) => item.jobId === mailer?.jobId)).toBeUndefined();
  });
});

describe("bedrock credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("skips Bedrock when only one AWS key is set", () => {
    vi.stubEnv("TALK2BUILD_AGENT", "");
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_ONLY");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("NEBIUS_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveAgentBackend()).toBe("fixture");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/Skipping Bedrock/);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/AWS_SECRET_ACCESS_KEY/);
  });

  it("selects Bedrock when both keys are set, or when a bearer token exists", () => {
    vi.stubEnv("TALK2BUILD_AGENT", "");
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_BOTH");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "");
    vi.stubEnv("OPENAI_API_KEY", "should-not-win");
    expect(resolveAgentBackend()).toBe("bedrock");

    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "bearer-token");
    expect(resolveAgentBackend()).toBe("bedrock");
  });
});

describe("openai-compatible stub", () => {
  let server: Server | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    useDefaultJobRunner();
    resetJobRunner();
    resetStore();
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
      server = null;
    }
  });

  it("extracts a plan from the stub and writes the drafted artifact", async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        const system = payload.messages?.find((message) => message.role === "system")?.content || "";
        const content = system.includes("extract work")
          ? JSON.stringify({
              intents: [{ kind: "plan", summary: "Plan the export", speaker: "Maya" }],
              decisions: [{ text: "Ship the export nightly.", speaker: "Maya" }],
              actionItems: [{ text: "Write the flag.", speaker: "Maya" }],
              jobs: [{ kind: "plan", title: "Plan", brief: "Speaker Maya: nightly export worker", speaker: "Maya", needsConfirm: false }],
              chatter: null,
              suggestion: null,
            })
          : "# Plan\n\nSpeaker: Maya\n\nA nightly export worker stays off the request path.\n";
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv("OPENAI_MODEL", "stub-model");

    const extracted = await extractMeetingTurn({
      meetingId: "stubbed",
      speaker: "Maya",
      text: "Let's plan the nightly export.",
      context: "No earlier notes.",
    });
    expect(extracted.jobs.map((item) => item.kind)).toEqual(["plan"]);
    expect(extracted.decisions[0]).toMatchObject({ speaker: "Maya", text: "Ship the export nightly." });
    expect(extracted.actionItems[0]?.speaker).toBe("Maya");

    const meeting = getStore().reset("stubbed");
    meeting.scenario = "general";
    meeting.title = "Stubbed";
    getStore().persist("stubbed");
    await prepareAgentWork({ meetingId: "stubbed", speaker: "Maya", text: "Let's plan the nightly export." });
    await getJobRunner().whenIdle();
    const saved = getStore().get("stubbed");
    expect(saved.workstreams.find((item) => item.kind === "plan")?.status).toBe("ready");
    const plan = readWorkspaceFile(saved.workspaceId, "docs/plan.md");
    expect(plan).toMatch(/Maya/);
    expect(plan).not.toMatch(/https?:\/\//);
  });

  it("falls back to the template when the model errors and hides the raw error", async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-secret-999");
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("OPENAI_MODEL", "stub-model");
    vi.stubGlobal("fetch", () => Promise.reject(new Error("upstream blew up sk-test-secret-999")));
    const meeting = getStore().reset("fallback");
    meeting.scenario = "general";
    meeting.title = "Fallback";
    getStore().persist("fallback");
    await prepareAgentWork({
      meetingId: "fallback",
      speaker: "Maya",
      text: "Let's plan the nightly export milestones.",
    });
    await getJobRunner().whenIdle();
    const saved = getStore().get("fallback");
    const card = saved.workstreams.find((item) => item.kind === "plan");
    expect(card?.status).toBe("ready");
    expect(card?.summary).toMatch(/template/i);
    expect(JSON.stringify(card)).not.toMatch(/sk-test-secret-999/);
    const plan = readWorkspaceFile(saved.workspaceId, "docs/plan.md");
    expect(plan).toMatch(/Maya/);
    expect(plan).not.toMatch(/sk-test-secret-999/);
  });

  it("rejects a model job whose kind is unknown", () => {
    expect(() =>
      parseExtraction(
        JSON.stringify({ jobs: [{ kind: "drop_database", title: "Nope", brief: "x" }] }),
        "m",
        "Maya",
        "x",
      ),
    ).not.toThrow();
    const parsed = parseExtraction(
      JSON.stringify({ jobs: [{ kind: "drop_database", title: "Nope", brief: "x" }, { kind: "plan", title: "Plan", brief: "keep" }] }),
      "m",
      "Maya",
      "keep the plan",
    );
    expect(parsed.jobs.map((item) => item.kind)).toEqual(["plan"]);
  });
});
