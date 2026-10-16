import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseExtraction } from "@/lib/agent/fixtures";
import { prepareAgentWork, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { extractMeetingTurn } from "@/lib/agent/model";
import { JobRunner, getJobRunner, resetJobRunner } from "@/lib/agent/runner";
import type { AgentJob } from "@/lib/agent/types";
import { getStore, resetStore } from "@/lib/meeting-store";
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
});

describe("openai-compatible stub", () => {
  let server: Server | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    useDefaultJobRunner();
    resetJobRunner();
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
