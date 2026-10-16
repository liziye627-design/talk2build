import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelAgentJob, prepareAgentWork, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { getJobRunner } from "@/lib/agent/runner";
import { getStore, resetStore } from "@/lib/meeting-store";

const M = "b9";
const PHRASE = "规划一下登录页的设计";

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.TALK2BUILD_AGENT_BACKEND = "fixture";
  resetStore();
  const state = getStore().ensure(M);
  state.scenario = "general";
  getStore().persist(M);
  useDefaultJobRunner();
});
afterEach(() => {
  delete process.env.TALK2BUILD_AGENT_BACKEND;
});

const planCards = () => getStore().get(M).workstreams.filter((w) => w.kind === "plan");

describe("B9 one card per job", () => {
  it("two same-name plan jobs: cancel the first, the second completes on its own card, the first stays cancelled", async () => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: PHRASE });
    const firstJob = planCards()[0]?.jobId;
    expect(firstJob).toBeTruthy();
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: PHRASE });
    const cards = planCards();
    expect(cards).toHaveLength(2);
    const secondJob = cards.find((c) => c.jobId !== firstJob)?.jobId;
    expect(secondJob).toBeTruthy();
    expect(cancelAgentJob(M, firstJob!)).toBe(true);
    await getJobRunner().whenIdle();
    const first = planCards().find((c) => c.jobId === firstJob);
    const second = planCards().find((c) => c.jobId === secondJob);
    expect(first?.status).toBe("cancelled");
    expect(second?.status).toBe("ready");
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("B9 batch from one utterance", () => {
  it("plan+design from one utterance: cancel only plan, design completes, plan stays cancelled", async () => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "规划一下登录页，再设计一下界面" });
    const ws = getStore().get(M).workstreams;
    const plan = ws.find((w) => w.kind === "plan");
    const design = ws.find((w) => w.kind === "design");
    expect(plan?.jobId && design?.jobId).toBeTruthy();
    expect(cancelAgentJob(M, plan!.jobId!)).toBe(true);
    await getJobRunner().whenIdle();
    const after = getStore().get(M).workstreams;
    expect(after.find((w) => w.jobId === plan!.jobId)?.status).toBe("cancelled");
    expect(after.find((w) => w.jobId === design!.jobId)?.status).toBe("ready");
  });

  it("setJobStatus never overwrites a cancelled card with a later ready write", async () => {
    const { setJobStatus } = await import("@/lib/agent/dispatch");
    setJobStatus(M, { kind: "plan", title: "Plan", status: "cancelled", summary: "Cancelled.", jobId: "job_x" });
    setJobStatus(M, { kind: "plan", title: "Plan", status: "ready", summary: "done", jobId: "job_x" });
    expect(getStore().get(M).workstreams.find((w) => w.jobId === "job_x")?.status).toBe("cancelled");
  });

  it("the runner is process-wide: a second module instance cancels jobs started by the first", async () => {
    const { vi } = await import("vitest");
    const g = globalThis as { __talk2buildRunner?: unknown };
    expect(g.__talk2buildRunner).toBeTruthy();
    vi.resetModules();
    const other = await import("@/lib/agent/dispatch");
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: PHRASE });
    const jobId = getStore().get(M).workstreams.find((w) => w.kind === "plan")!.jobId!;
    expect(other.cancelAgentJob(M, jobId)).toBe(true);
    await getJobRunner().whenIdle();
    expect(getStore().get(M).workstreams.find((w) => w.jobId === jobId)?.status).toBe("cancelled");
  });
});
