import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordedExtraction } from "@/lib/agent/fixtures";
import { getJobRunner } from "@/lib/agent/runner";
import { PLANNING_SCRIPT } from "@/lib/planning-script";
import { yesterdayIso } from "@/lib/time";
import { getStore, resetStore } from "@/lib/meeting-store";
import { startServer } from "@/server/standalone";
import type { MeetingState } from "@/lib/types";
import { readWorkspaceFile } from "@/lib/workspace";

describe("recorded meeting extraction", () => {
  it("plans, designs, and asks before tests, and parks lunch", () => {
    const plan = recordedExtraction("m", "Maya", PLANNING_SCRIPT[0]!.text);
    expect(plan?.jobs.map((item) => item.kind)).toContain("plan");
    expect(plan?.decisions[0]?.speaker).toBe("Maya");
    const design = recordedExtraction("m", "Chris", PLANNING_SCRIPT[1]!.text);
    expect(design?.jobs.map((item) => item.title)).toEqual(expect.arrayContaining(["Architecture", "API spec"]));
    const lunch = recordedExtraction("m", "Chris", PLANNING_SCRIPT[3]!.text);
    expect(lunch?.jobs).toEqual([]);
    expect(lunch?.chatter).toMatch(/lunch|starving/i);
    const tests = recordedExtraction("m", "Priya", PLANNING_SCRIPT[5]!.text);
    expect(tests?.jobs.every((item) => item.needsConfirm)).toBe(true);
    expect(tests?.jobs.some((item) => item.kind === "code")).toBe(true);
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
    expect(latest.pending?.action).toBe("scaffold_code");
    expect(latest.scaffold).toBeNull();
    await getJobRunner().whenIdle();
    const settled = await fetch(`${server.url}/api/meetings/${meeting.id}`);
    latest = ((await settled.json()) as { meeting: MeetingState }).meeting;
    expect(latest.workstreams.map((item) => item.kind)).toEqual(expect.arrayContaining(["plan", "design", "verify", "research"]));
    expect(latest.workstreams.filter((item) => item.kind !== "code").every((item) => item.status === "ready")).toBe(true);
    expect(latest.workstreams.some((item) => /wireframe/i.test(item.title))).toBe(true);
    expect(latest.chatter.some((item) => /lunch/i.test(item.text))).toBe(true);
    expect(latest.requirements.some((item) => /lunch/i.test(item.text))).toBe(false);
    expect(latest.suggestions[0]?.text).toMatch(/nightly job/);
    expect(latest.decisions.some((item) => item.speaker === "Maya")).toBe(true);
    const research = readWorkspaceFile(latest.workspaceId, "docs/research.md");
    expect(research).toMatch(/## Sources/);
    expect(research).toMatch(/nightly job/);
    expect(research).not.toMatch(/https?:\/\//);

    const yes = await fetch(`${server.url}/api/meetings/${meeting.id}/utterance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speaker: "Maya", text: "Yes" }),
    });
    const after = ((await yes.json()) as { state: MeetingState }).state;
    expect(after.pending).toBeNull();
    expect(after.scaffold?.length).toBeGreaterThan(0);
    expect(after.workstreams.find((item) => item.kind === "code")?.status).toBe("ready");
    expect(after.pullRequest?.status).toBe("draft");
    const patch = readWorkspaceFile(after.workspaceId, "docs/patch.diff");
    expect(patch).toMatch(/diff --git/);
  }, 20_000);
});
