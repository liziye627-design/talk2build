import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sim = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/agent/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/model")>();
  return {
    ...actual,
    extractMeetingTurn: async (input: { meetingId: string; speaker: string; text: string }) => {
      if (!sim.on) return actual.extractMeetingTurn(input as never);
      // Simulated model output: a code job flagged needsConfirm, a confirm-gated design job and a plan job.
      const base = { meetingId: input.meetingId, speaker: input.speaker, brief: input.text };
      return {
        chatter: false,
        decisions: [],
        actionItems: [],
        suggestion: null,
        jobs: [
          { ...base, id: `job_${input.meetingId}_code_sim`, kind: "code", title: "Login page", needsConfirm: true },
          { ...base, id: `job_${input.meetingId}_design_sim`, kind: "design", title: "Gated design", needsConfirm: true },
          { ...base, id: `job_${input.meetingId}_plan_sim`, kind: "plan", title: "Plan", needsConfirm: false },
        ],
      };
    },
  };
});

import { isDeferral } from "@/lib/classifier";
import { prepareAgentWork, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { getJobRunner } from "@/lib/agent/runner";
import { getStore, resetStore } from "@/lib/meeting-store";

const M = "b10";
beforeEach(() => {
  process.env.TALK2BUILD_AGENT_BACKEND = "fixture";
  sim.on = false;
  resetStore();
  const state = getStore().ensure(M);
  state.scenario = "general";
  getStore().persist(M);
  useDefaultJobRunner();
});
afterEach(async () => {
  getJobRunner().cancelAll();
  await getJobRunner().whenIdle();
  delete process.env.TALK2BUILD_AGENT_BACKEND;
});

const cards = () => getStore().get(M).workstreams;
const codeQueued = () => {
  const s = getStore().get(M);
  return [s.pending, ...s.confirmQueue].filter((q) => q?.action === "scaffold_code").length;
};

describe("B10 isDeferral", () => {
  it.each(["先别写代码", "don't write the code yet", "yes, but not job_b10_code_x", "hold off on scaffolding", "Do NOT scaffold", "not yet", "later", "不要写代码", "暂时不写", "别写了"])(
    "true: %s",
    (text) => expect(isDeferral(text)).toBe(true),
  );
  it.each(["帮我写一个登录页的代码", "Write the code for a login page.", "规划一下登录页的设计", "scaffold it"])("false: %s", (text) =>
    expect(isDeferral(text)).toBe(false),
  );
});

describe("B10 deferral drops code/confirm-gated jobs only", () => {
  it.each(["先别写代码", "don't write the code yet", "hold off on scaffolding the login page code"])("mock extraction: '%s' creates no code card", async (text) => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text });
    expect(cards().some((w) => w.kind === "code")).toBe(false);
    expect(codeQueued()).toBe(0);
  });

  it("mock extraction: '先别写代码，先规划一下登录模块' => plan card, no code card", async () => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "先别写代码，先规划一下登录模块" });
    expect(cards().some((w) => w.kind === "code")).toBe(false);
    expect(cards().some((w) => w.kind === "plan")).toBe(true);
    expect(codeQueued()).toBe(0);
  });

  it("control: without deferral the same mock extraction still creates the code card", async () => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "帮我写一个登录页的代码" });
    expect(cards().some((w) => w.kind === "code" && w.status === "waiting")).toBe(true);
  });

  it("simulated model extraction: deferral drops code and needsConfirm jobs, keeps plan", async () => {
    sim.on = true;
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "yes, but not job_b10_code_sim — just plan it" });
    expect(cards().some((w) => w.kind === "code")).toBe(false);
    expect(cards().some((w) => w.title === "Gated design")).toBe(false);
    expect(cards().some((w) => w.kind === "plan")).toBe(true);
    expect(codeQueued()).toBe(0);
  });

  it("simulated model extraction control: no deferral keeps the code job", async () => {
    sim.on = true;
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "build the login page" });
    expect(cards().some((w) => w.kind === "code")).toBe(true);
  });
});
