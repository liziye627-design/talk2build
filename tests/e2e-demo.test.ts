import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import { startServer } from "@/server/standalone";
import type { MeetingState } from "@/lib/types";

interface TurnBody {
  reply: string | null;
  silent: boolean;
  progress: string | null;
  kind: string;
  trace: { tool: string; ok: boolean; summary: string }[];
  state: MeetingState;
  provider: string;
  error?: string;
}

let server: Awaited<ReturnType<typeof startServer>>;

async function say(speaker: string, text: string) {
  const response = await fetch(`${server.url}/api/alexa/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ speaker, text, source: "script" }),
  });
  const body = (await response.json()) as TurnBody;
  return { status: response.status, body };
}

beforeAll(async () => {
  server = await startServer(0);
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await fetch(`${server.url}/api/meeting/reset`, { method: "POST" });
});

describe("scripted 2:17 AM postmortem", () => {
  it("runs the demo and leaves a decision, todos, a three-file PR, and green tests", async () => {
    const turns = [];
    for (const beat of DEMO_SCRIPT.beats) {
      const turn = await say(beat.speaker, beat.text);
      expect(turn.status).toBe(200);
      expect(turn.body.reply).toBe(beat.reply);
      expect(turn.body.provider).toBe("mock");
      expect(turn.body.trace.every((entry) => entry.ok)).toBe(true);
      turns.push(turn.body);
    }

    expect(turns[0]?.trace.map((entry) => entry.tool)).toEqual(
      expect.arrayContaining(["ingest_transcript", "classify_utterance", "timeline_add"]),
    );
    expect(turns[2]?.progress).toMatch(/batch-reconcile v2\.3/);
    expect(turns[5]?.silent).toBe(true);

    const state = turns.at(-1)?.state;
    if (!state) throw new Error("missing final state");

    expect(state.timeline.map((event) => event.timeLabel)).toEqual(["02:15", "02:17"]);
    expect(state.timeline.every((event) => event.linkedIds.length > 0)).toBe(true);
    expect(state.timeline.find((event) => event.timeLabel === "02:15")?.correlationNote).toMatch(/two minutes/);
    expect(state.deploy?.version).toBe("v2.3");
    expect(state.deploy?.deployedLabel).toBe("11:40 PM");
    expect(state.deploy?.service).toBe("batch-reconcile");

    const highlights = (state.incidentDiff ?? []).flatMap((file) => file.lines.map((line) => line.highlight));
    expect(highlights).toContain("shrink");
    expect(highlights).toContain("missing-timeout");

    expect(state.decisions[0]?.text.toLowerCase()).toContain("root cause");
    expect(state.decisions[0]?.text).toMatch(/50/);
    expect(state.decisions[0]?.text).toMatch(/20/);
    expect(state.requirements).toHaveLength(3);
    expect(state.requirements.some((item) => /lunch/i.test(item.text))).toBe(false);
    expect(state.chatter.some((item) => /lunch/i.test(item.text))).toBe(true);
    expect(state.todos.map((item) => item.text.toLowerCase()).join(" ")).toMatch(/pool alert/);
    expect(state.todos.map((item) => item.text.toLowerCase()).join(" ")).toMatch(/feature flag/);
    expect(state.docs[0]?.body.toLowerCase()).toContain("root cause");
    expect(state.pullRequest?.files).toHaveLength(3);
    expect(state.pullRequest?.status).toBe("draft");
    expect(state.pullRequest?.tests.every((test) => test.passed)).toBe(true);
    expect(state.progress.length).toBeGreaterThanOrEqual(2);
    expect(state.transcript.some((line) => line.speaker === "Alexa" && line.text.includes("tests pass"))).toBe(true);
  });

  it("rolls the last checkpoint back on stop and on 不对", async () => {
    const first = await say("A", "PagerDuty woke me at 2:17. Order service 500s spiked to 40%.");
    expect(first.body.state.timeline).toHaveLength(1);
    const noted = await say("A", "记一下 the on-call handoff");
    expect(noted.body.state.requirements).toHaveLength(1);

    const stopped = await say("B", "stop");
    expect(stopped.status).toBe(200);
    expect(stopped.body.reply).toMatch(/last checkpoint/);
    expect(stopped.body.state.timeline).toHaveLength(1);
    expect(stopped.body.state.requirements).toHaveLength(0);
    expect(stopped.body.state.transcript.at(-1)?.text).toMatch(/What should it be instead/);

    await say("A", "记一下 a second note");
    const chinese = await say("A", "不对");
    expect(chinese.body.state.requirements).toHaveLength(0);
    expect(chinese.body.state.timeline).toHaveLength(1);
  });
});
