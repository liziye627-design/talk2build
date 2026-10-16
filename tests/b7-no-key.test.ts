import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { keywordExtraction } from "@/lib/agent/fixtures";
import { getJobRunner } from "@/lib/agent/runner";
import { classifyUtterance } from "@/lib/classifier";
import { resetStore } from "@/lib/meeting-store";
import { parseMentions } from "@/lib/seats/roster";
import { startServer } from "@/server/standalone";
import type { MeetingState } from "@/lib/types";

const ZH_CODE = "帮我写一个登录页的代码";
const ZH_PLAN = "规划一下登录页的设计";
const ZH_DEMO = "帮我规划一下登录模块，再调研一下用哪个鉴权库";
const EN = "Let's plan the milestone and check that the API is feasible";
const CHITCHAT = "今天中午吃什么好呢";

function kinds(text: string) {
  return keywordExtraction("m", "Maya", text).jobs.map((job) => job.kind);
}

describe("B7 fixtures: Chinese keywords without a model key", () => {
  it("extracts jobs from Chinese and English work phrases", () => {
    expect(kinds(ZH_CODE)).toEqual(["code"]);
    expect(kinds(ZH_PLAN)).toEqual(expect.arrayContaining(["plan", "design"]));
    expect(kinds(ZH_DEMO)).toEqual(expect.arrayContaining(["plan", "research"]));
    // baseline recorded fixture (/feasible/) wins for this phrase: verify + research
    expect(kinds(EN)).toEqual(["verify", "research"]);
    expect(kinds(CHITCHAT)).toEqual([]);
  });

  it("code jobs always need confirmation; Chinese briefs keep distinct ids", () => {
    const code = keywordExtraction("m", "Maya", ZH_CODE).jobs[0];
    expect(code?.needsConfirm).toBe(true);
    const a = keywordExtraction("m", "Maya", "规划一下登录页").jobs[0]?.id;
    const b = keywordExtraction("m", "Maya", "规划一下支付页").jobs[0]?.id;
    expect(a).not.toBe(b);
  });

  it("the classifier no longer parks Chinese work requests as chatter; chit-chat stays parked", () => {
    for (const text of [ZH_CODE, ZH_PLAN, ZH_DEMO, EN]) {
      expect(classifyUtterance({ text, speaker: "Maya", pending: null, scenario: "general" }).kind).not.toBe("chatter");
    }
    expect(classifyUtterance({ text: CHITCHAT, speaker: "Maya", pending: null, scenario: "general" }).kind).toBe("chatter");
  });
});

describe("B5 seat mentions by display name", () => {
  it("matches @AI 架构师 / @AI质疑者 / aliases", () => {
    expect(parseMentions("@AI 架构师 导出用队列吗").seats).toEqual(["architect"]);
    expect(parseMentions("＠AI质疑者 风险呢").seats).toEqual(["skeptic"]);
    expect(parseMentions("@AI 架构师 @AI 质疑者 辩一下 方案A")).toMatchObject({ seats: ["architect", "skeptic"], unknown: [], debateTopic: "方案A" });
    expect(parseMentions("@架构师 @质疑者").unknown).toEqual([]);
  });
});

describe("B7/B6 through the real HTTP utterance entry (no model key)", () => {
  let server: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    vi.stubEnv("TALK2BUILD_AGENT", "fixture");
    vi.stubEnv("TALK2BUILD_JOB_PACE_MS", "0");
    server = await startServer(0);
  });
  afterAll(async () => {
    await getJobRunner().whenIdle();
    await server.close();
    vi.unstubAllEnvs();
  });
  beforeEach(() => resetStore());

  async function newMeeting() {
    const created = await fetch(`${server.url}/api/meetings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "B7" }) });
    return ((await created.json()) as { meeting: MeetingState }).meeting;
  }

  async function say(id: string, text: string) {
    const res = await fetch(`${server.url}/api/meetings/${id}/utterance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speaker: "Maya", text }) });
    expect(res.status).toBe(200);
    return (await res.json()) as { kind: string; reply: string | null; state: MeetingState };
  }

  it("B6: a new meeting already lists both AI seats (offline) on create and first GET", async () => {
    const meeting = await newMeeting();
    expect(meeting.participants.filter((p) => p.kind === "ai").map((p) => [p.label, p.aiStatus])).toEqual([
      ["AI 架构师", "offline"],
      ["AI 质疑者", "offline"],
    ]);
    const got = (await (await fetch(`${server.url}/api/meetings/${meeting.id}`)).json()) as { meeting: MeetingState };
    expect(got.meeting.participants.filter((p) => p.kind === "ai")).toHaveLength(2);
  });

  it("Mika's demo phrase creates cancellable plan/research jobs, and cancel works", async () => {
    const { id } = await newMeeting();
    const body = await say(id, ZH_DEMO);
    expect(body.kind).not.toBe("chatter");
    expect(body.reply).toMatch(/已记录需求/);
    const working = body.state.workstreams.filter((w) => w.jobId && w.status === "working");
    expect(working.map((w) => w.kind)).toEqual(expect.arrayContaining(["plan", "research"]));
    const res = await fetch(`${server.url}/api/meetings/${id}/jobs/${encodeURIComponent(working[0]!.jobId!)}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cancelled: boolean }).cancelled).toBe(true);
  });

  it("规划一下登录页的设计 and the English phrase create jobs", async () => {
    const { id } = await newMeeting();
    const zh = await say(id, ZH_PLAN);
    expect(zh.state.workstreams.some((w) => w.kind === "plan" && w.jobId)).toBe(true);
    const en = await say(id, EN);
    expect(en.state.workstreams.some((w) => w.kind === "verify" && w.jobId)).toBe(true);
  });

  it("帮我写一个登录页的代码 creates a code job waiting in the confirm queue (no cancel button by design)", async () => {
    const { id } = await newMeeting();
    const body = await say(id, ZH_CODE);
    const card = body.state.workstreams.find((w) => w.kind === "code");
    expect(card?.status).toBe("waiting");
    expect(body.state.pending?.action).toBe("scaffold_code");
    expect(body.state.pending?.jobId).toBe(card?.jobId);
  });

  it("chit-chat with no keywords stays parked (已搁置)", async () => {
    const { id } = await newMeeting();
    const body = await say(id, CHITCHAT);
    expect(body.kind).toBe("chatter");
    expect(body.state.chatter.map((c) => c.text)).toContain(CHITCHAT);
    expect(body.state.workstreams).toHaveLength(0);
  });
});
