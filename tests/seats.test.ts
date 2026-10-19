import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import { prepareAgentWork } from "@/lib/agent/dispatch";
import { getStore, resetStore } from "@/lib/meeting-store";
import { buildCitationContext } from "@/lib/seats/prompts";
import { configureSeats, keepSeatState, resetSeats, restoreSeatState, stopSeats, whenSeatsIdle, type SeatModel } from "@/lib/seats/orchestrator";
import { parseMentions } from "@/lib/seats/roster";
import { executeTool } from "@/lib/tools";
import type { EvidenceReport } from "@/lib/evidence/types";
import type { MeetingState } from "@/lib/types";

const M = "seats";

function general() {
  resetStore();
  const state = getStore().ensure(M);
  state.scenario = "general";
  state.title = "Seats";
  getStore().persist(M);
  return state;
}

/** Runs every planned tool, the same way the utterance route does. */
function say(text: string, speaker = "Maya") {
  const state = getStore().get(M);
  const plan = classifyUtterance({ text, speaker, pending: state.pending, queue: state.confirmQueue, scenario: "general" });
  for (const tool of plan.tools) executeTool(tool.name, { ...tool.arguments, meetingId: M });
  return plan;
}

function scripted(): { model: SeatModel; calls: string[] } {
  const calls: string[] = [];
  const model: SeatModel = async (system) => {
    calls.push(system.includes("close a debate") ? "C" : system.startsWith("You are AI 架构师") ? "A" : "S");
    if (system.includes("close a debate")) {
      return JSON.stringify({ recommendation: "先用 SQLite", reasons: ["简单"], risks: ["并发写"], humanDecisions: ["何时迁移"], citations: [] });
    }
    return JSON.stringify({ text: `第${calls.length}次发言`, citations: [] });
  };
  return { model, calls };
}

beforeEach(() => {
  resetSeats();
  general();
});

afterEach(() => {
  resetSeats();
  vi.unstubAllEnvs();
});

describe("seats", () => {
  it("1 parses Chinese/English aliases, full-width @, and unknown seats", () => {
    expect(parseMentions("@架构师 导出用队列还是同步？").seats).toEqual(["architect"]);
    expect(parseMentions("＠Skeptic 有什么风险").seats).toEqual(["skeptic"]);
    expect(parseMentions("@ARCHITECT @challenger debate SQLite vs Postgres")).toMatchObject({ seats: ["architect", "skeptic"], debateTopic: "SQLite vs Postgres" });
    expect(parseMentions("@架构师 @质疑者 辩一下 方案A").debateTopic).toBe("方案A");
    expect(parseMentions("@产品经理 你怎么看")).toMatchObject({ seats: [], unknown: ["产品经理"] });
  });

  it("1b unknown seat gets a 'does not exist' reply and no job cards", async () => {
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@产品经理 你怎么看" });
    const state = getStore().get(M);
    expect(state.transcript.at(-1)?.text).toMatch(/No such seat: @产品经理/);
    expect(state.workstreams).toHaveLength(0);
  });

  it("2 fixture backend: @架构师 is offline, no scripted seat content", async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "fixture");
    const { model, calls } = scripted();
    configureSeats({ model });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 导出功能用队列还是同步？" });
    await whenSeatsIdle(M);
    const state = getStore().get(M);
    expect(calls).toEqual([]);
    expect(state.seatTurns ?? []).toHaveLength(0);
    expect(state.transcript.some((line) => line.speaker === "AI Architect")).toBe(false);
    expect(state.transcript.at(-1)?.text).toMatch(/unavailable \(offline/);
    expect(state.participants.filter((p) => p.kind === "ai").map((p) => p.aiStatus)).toEqual(["offline", "offline"]);
  });

  it("3 debate alternates A,S,A,S then yields a pending conclusion card in confirmQueue", async () => {
    const { model, calls } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 方案A 用 SQLite vs Postgres" });
    await whenSeatsIdle(M);
    const state = getStore().get(M);
    expect(calls).toEqual(["A", "S", "A", "S", "C"]);
    expect((state.seatTurns ?? []).map((t) => t.seatId)).toEqual(["architect", "skeptic", "architect", "skeptic"]);
    expect(state.transcript.filter((l) => l.kind === "seat").map((l) => l.speaker)).toEqual(["AI Architect", "AI Skeptic", "AI Architect", "AI Skeptic"]);
    const card = state.conclusions?.[0];
    expect(card?.status).toBe("pending");
    expect(state.seatDebates?.[0]).toMatchObject({ status: "concluded", conclusionId: card?.id, maxRounds: 2 });
    expect(state.pending).toMatchObject({ action: "confirm_conclusion", jobId: card?.id });
    expect(state.decisions).toHaveLength(0);
    expect(state.workstreams).toHaveLength(0);
  });

  it("4 maxRounds is clamped to 1..3 (default 2)", async () => {
    const { clampRounds, DEFAULT_ROUNDS } = await import("@/lib/seats/orchestrator");
    expect(DEFAULT_ROUNDS).toBe(2);
    expect(clampRounds(9)).toBe(3);
    expect(clampRounds(0)).toBe(1);
    expect(clampRounds(2)).toBe(2);
    expect(clampRounds(Number.NaN)).toBe(2);
  });

  it("5 stop mid-debate → interrupted, no conclusion, queue cleared, turns kept across rollback", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let n = 0;
    configureSeats({
      availability: "online",
      model: async (_s, _u, signal) => {
        n += 1;
        if (n === 2) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return null;
        }
        await gate;
        return JSON.stringify({ text: `turn ${n}`, citations: [] });
      },
    });
    getStore().checkpoint(M);
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@architect @skeptic debate Redis vs SQS" });
    await prepareAgentWork({ meetingId: M, speaker: "Lee", text: "@质疑者 成本呢" });
    expect(getStore().get(M).seatQueue).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(n).toBe(2));
    const kept = keepSeatState(getStore().get(M));
    expect(stopSeats(M)).toBe(true);
    await whenSeatsIdle(M);
    const snapshot = keepSeatState(getStore().get(M));
    executeTool("checkpoint_rollback", { meetingId: M });
    restoreSeatState(getStore(), M, snapshot);
    const state = getStore().get(M);
    expect(kept.seatTurns).toHaveLength(1);
    expect(state.seatTurns).toHaveLength(1);
    expect(state.seatDebates?.[0]?.status).toBe("interrupted");
    expect(state.conclusions ?? []).toHaveLength(0);
    expect(state.seatQueue).toEqual([]);
    expect(state.pending).toBeNull();
  });

  it("6 a new @ during a debate is queued and runs after it, without interrupting", async () => {
    const { model, calls } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 队列" });
    await prepareAgentWork({ meetingId: M, speaker: "Lee", text: "@质疑者 成本呢" });
    expect(getStore().get(M).seatQueue).toHaveLength(1);
    await whenSeatsIdle(M);
    expect(calls).toEqual(["A", "S", "A", "S", "C", "S"]);
    expect(getStore().get(M).seatDebates?.[0]?.status).toBe("concluded");
    expect(getStore().get(M).seatQueue).toEqual([]);
  });

  it("7 yes confirms only the pending conclusion id and writes decision_record", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    const id = getStore().get(M).conclusions?.[0]?.id;
    say("yes", "Maya");
    const state = getStore().get(M);
    expect(state.decisions.map((d) => d.text)).toEqual(["先用 SQLite"]);
    expect(state.conclusions?.[0]).toMatchObject({ id, status: "confirmed", decisionId: state.decisions[0]?.id });
    expect(state.pending).toBeNull();
  });

  it("7b no rejects the conclusion and writes nothing", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    say("no", "Maya");
    const state = getStore().get(M);
    expect(state.conclusions?.[0]?.status).toBe("rejected");
    expect(state.decisions).toHaveLength(0);
    expect(state.pending).toBeNull();
  });

  it("8 with scaffold_code pending, the conclusion queues; yes <conclusionId> confirms only that card", async () => {
    executeTool("confirm_ask", { meetingId: M, action: "scaffold_code", prompt: "scaffold export", payload: { jobId: "job_x", prompt: "x" } });
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    let state = getStore().get(M);
    const id = state.conclusions?.[0]?.id ?? "";
    expect(state.pending?.action).toBe("scaffold_code");
    expect(state.confirmQueue.map((item) => item.jobId)).toEqual([id]);
    say(`yes ${id}`, "Maya");
    state = getStore().get(M);
    expect(state.conclusions?.[0]?.status).toBe("confirmed");
    expect(state.pending?.action).toBe("scaffold_code");
    expect(state.confirmQueue).toEqual([]);
    expect(state.scaffold).toBeNull();
  });

  it("9 refIds not in the context are dropped", async () => {
    getStore().recordDecision(M, "Maya", "Use Postgres");
    const decisionId = getStore().get(M).decisions[0]?.id;
    configureSeats({
      availability: "online",
      model: async () => JSON.stringify({ text: "按已定决策", citations: [decisionId, "dec_999", "made_up"] }),
    });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@architect 怎么做" });
    await whenSeatsIdle(M);
    expect(getStore().get(M).seatTurns?.[0]?.citations.map((c) => c.refId)).toEqual([decisionId]);
  });

  it("10 failed evidence puts no number in the seat context", () => {
    const report: EvidenceReport = {
      claim: "express vs fastify",
      question: "popularity",
      fetchedAt: "2026-10-16T00:00:00Z",
      options: [
        {
          label: "Express",
          docsUrl: null,
          docsSourceUrl: null,
          metrics: [{ name: "GitHub stars", value: null, text: null, unit: "", sourceUrl: "https://api.github.com/repos/expressjs/express", fetchedAt: "2026-10-16T00:00:00Z", error: "GitHub returned 403.", errorCode: "rate_limited" }],
        },
      ],
    };
    const state = { ...getStore().get(M), workstreams: [{ id: "work_1", kind: "evidence", title: "Evidence", status: "ready", summary: "", updatedAt: "", evidence: report }] } as MeetingState;
    const context = buildCitationContext(state);
    const text = context.lines.join("\n");
    expect(text).toMatch(/数据不可用/);
    expect(text.replace(/work_1|2026-10-16T00:00:00Z/g, "")).not.toMatch(/\d/);
  });

  it("11 no model + @architect: no seat-spoken deterministic text; evidence annotation is marked generated", async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "fixture");
    const state = getStore().get(M);
    state.workstreams.push({
      id: "work_ev",
      kind: "evidence",
      title: "Evidence",
      status: "ready",
      summary: "",
      updatedAt: "",
      evidence: { claim: "express vs fastify", question: "popularity", fetchedAt: "2026-10-16T00:00:00Z", options: [] },
    });
    getStore().persist(M);
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@architect @skeptic debate this branch" });
    const after = getStore().get(M);
    expect(after.transcript.some((l) => ["AI Architect", "AI Skeptic", "AI 架构师", "AI 质疑者", "Architect", "Skeptic"].includes(l.speaker))).toBe(false);
    const conclusion = after.workstreams.find((w) => w.kind === "conclusion");
    expect(conclusion?.debateGenerated).toBe("evidence");
  });

  it("12 publishDebate's conclusion card is waiting and adds no decisions", async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "fixture");
    const state = getStore().get(M);
    state.workstreams.push({
      id: "work_ev",
      kind: "evidence",
      title: "Evidence",
      status: "ready",
      summary: "",
      updatedAt: "",
      evidence: { claim: "express vs fastify", question: "popularity", fetchedAt: "2026-10-16T00:00:00Z", options: [] },
    });
    getStore().persist(M);
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@architect @skeptic debate this branch" });
    const after = getStore().get(M);
    const conclusion = after.workstreams.find((w) => w.kind === "conclusion");
    expect(conclusion?.status).toBe("waiting");
    expect(conclusion?.summary).toMatch(/^Awaiting a human/);
    expect(after.decisions).toHaveLength(0);
    expect(after.pending).toBeNull();
  });

  it("12b no evidence card + offline debate: no conclusion card at all", async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "fixture");
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@architect @skeptic debate this branch" });
    expect(getStore().get(M).workstreams).toHaveLength(0);
  });

  it("model failure mid-debate → debate failed, no fabricated turn", async () => {
    configureSeats({ availability: "online", model: async () => null });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    const state = getStore().get(M);
    expect(state.seatTurns ?? []).toHaveLength(0);
    expect(state.seatDebates?.[0]?.status).toBe("failed");
    expect(state.conclusions ?? []).toHaveLength(0);
  });
  it("D1 two pending conclusion cards: yes <id> confirms only that one", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 队列" });
    await whenSeatsIdle(M);
    const [first, second] = getStore().get(M).conclusions ?? [];
    expect(first?.status).toBe("pending");
    expect(second?.status).toBe("pending");
    say(`yes ${second?.id}`, "Maya");
    const state = getStore().get(M);
    expect(state.conclusions?.map((c) => c.status)).toEqual(["pending", "confirmed"]);
    expect(state.decisions).toHaveLength(1);
    expect(state.pending?.jobId).toBe(first?.id);
  });
  it("D11b rejecting a conclusion removes only that card from the confirm queue", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    const id = getStore().get(M).conclusions?.[0]?.id;
    executeTool("confirm_ask", { meetingId: M, action: "scaffold_code", prompt: "scaffold export", payload: { jobId: "job_keep", prompt: "x" } });
    executeTool("confirm_ask", { meetingId: M, action: "scaffold_code", prompt: "scaffold other", payload: { jobId: "job_keep2", prompt: "y" } });
    let state = getStore().get(M);
    expect(state.pending?.jobId).toBe(id);
    expect(state.confirmQueue.map((item) => item.jobId)).toEqual(["job_keep", "job_keep2"]);
    say("no", "Maya");
    state = getStore().get(M);
    expect(state.conclusions?.[0]).toMatchObject({ id, status: "rejected" });
    expect(state.decisions).toHaveLength(0);
    expect([state.pending, ...state.confirmQueue].map((item) => item?.jobId)).toEqual(["job_keep", "job_keep2"]);
    expect(state.pending?.action).toBe("scaffold_code");
  });
  it("D11c a Chinese yes (确认) confirms the pending conclusion and writes decision_record", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    say("确认", "Maya");
    const state = getStore().get(M);
    expect(state.conclusions?.[0]?.status).toBe("confirmed");
    expect(state.decisions.map((d) => d.text)).toEqual(["先用 SQLite"]);
  });
  it.each(["好，我们继续", "可以开始了吗", "yes, but not now", "好的我们下周再说"])("D11d '%s' does not confirm a queued conclusion", async (text) => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    const id = getStore().get(M).conclusions?.[0]?.id;
    say(text, "Maya");
    const state = getStore().get(M);
    expect(state.conclusions?.[0]?.status).toBe("pending");
    expect(state.pending?.jobId).toBe(id);
    expect(state.decisions).toHaveLength(0);
  });
  it("D11e 'yes, but not <id>' does not confirm that conclusion", async () => {
    const { model } = scripted();
    configureSeats({ model, availability: "online" });
    await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "@架构师 @质疑者 辩一下 存储" });
    await whenSeatsIdle(M);
    const id = getStore().get(M).conclusions?.[0]?.id;
    say(`yes, but not ${id}`, "Maya");
    const state = getStore().get(M);
    expect(state.conclusions?.[0]?.status).toBe("pending");
    expect(state.decisions).toHaveLength(0);
  });
});
