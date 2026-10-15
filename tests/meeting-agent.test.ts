import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLANNING_SCRIPT } from "@/lib/planning-script";
import { facilitateUtterance } from "@/lib/facilitator";
import { yesterdayIso } from "@/lib/time";
import { getStore, resetStore } from "@/lib/meeting-store";
import { startServer } from "@/server/standalone";
import type { MeetingState } from "@/lib/types";

describe("facilitator", () => {
  it("plans, designs, and asks before tests, and ignores lunch", () => {
    const plan = facilitateUtterance(PLANNING_SCRIPT[0]!.text);
    expect(plan?.tools.map((tool) => tool.name)).toContain("plan_update");
    const design = facilitateUtterance(PLANNING_SCRIPT[1]!.text);
    expect(design?.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["design_draft", "design_draft"]));
    const lunch = facilitateUtterance(PLANNING_SCRIPT[3]!.text);
    expect(lunch).toBeNull();
    const tests = facilitateUtterance(PLANNING_SCRIPT[5]!.text);
    expect(tests?.tools.some((tool) => tool.name === "confirm_ask")).toBe(true);
    expect(tests?.tools.some((tool) => tool.name === "run_tests")).toBe(false);
  });
});

describe("a working session drives the agent panel", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer(0);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    resetStore();
    const store = getStore();
    const state = store.ensure("review-yesterday");
    const when = yesterdayIso();
    state.title = "API review";
    state.status = "ended";
    state.scenario = "general";
    state.decisions = [
      {
        id: "dec_seed",
        text: "Ship the billing export as a nightly job, not a request-path call.",
        speaker: "Maya",
        at: when,
      },
    ];
    store.persist("review-yesterday");
  });

  it("builds plan, design, research, and waits to run tests", async () => {
    const created = await fetch(`${server.url}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Billing export", host: "You", team: ["Maya", "Chris", "Priya"] }),
    });
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    let latest: MeetingState | null = null;
    for (const beat of PLANNING_SCRIPT.slice(0, 6)) {
      const response = await fetch(`${server.url}/api/meetings/${meeting.id}/utterance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker: beat.speaker, text: beat.text }),
      });
      expect(response.status).toBe(200);
      latest = ((await response.json()) as { state: MeetingState }).state;
    }
    if (!latest) throw new Error("missing meeting");
    expect(latest.workstreams.map((item) => item.kind)).toEqual(expect.arrayContaining(["plan", "design", "verify", "research"]));
    expect(latest.workstreams.some((item) => /wireframe/i.test(item.title))).toBe(true);
    expect(latest.chatter.some((item) => /lunch/i.test(item.text))).toBe(true);
    expect(latest.requirements.some((item) => /lunch/i.test(item.text))).toBe(false);
    expect(latest.suggestions[0]?.text).toMatch(/nightly job/);
    expect(latest.pending?.action).toBe("scaffold_code");
    expect(latest.scaffold).toBeNull();
  }, 20_000);
});
