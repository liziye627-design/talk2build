import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordedExtraction } from "@/lib/agent/fixtures";
import { getJobRunner } from "@/lib/agent/runner";
import { GAME_PAGE_PATH } from "@/lib/agent/game-jam";
import { claimNeedsEvidence, parseTargets } from "@/lib/evidence/claim";
import { GAME_JAM_SCRIPT } from "@/lib/planning-script";
import { resetStore } from "@/lib/meeting-store";
import { startServer } from "@/server/standalone";
import type { MeetingState } from "@/lib/types";
import { readWorkspaceFile, workspaceDir } from "@/lib/workspace";

const line = (pattern: RegExp) => GAME_JAM_SCRIPT.find((beat) => pattern.test(beat.text))!;

describe("game-jam fixtures", () => {
  it("plan, two designs, feasibility, and a code job that waits for a yes", () => {
    const plan = recordedExtraction("m", "Maya", line(/^Goal/).text);
    expect(plan?.jobs.map((job) => job.kind)).toEqual(["plan"]);
    expect(plan?.decisions[0]?.text).toMatch(/Space Cat Courier/);
    expect(recordedExtraction("m", "Chris", line(/game loop/).text)?.jobs.map((job) => job.title)).toEqual(["Game architecture"]);
    expect(recordedExtraction("m", "Priya", line(/wireframe/).text)?.jobs.map((job) => job.title)).toEqual(["Game screen wireframe"]);
    expect(recordedExtraction("m", "Maya", line(/phone/).text)?.jobs.map((job) => job.kind)).toEqual(["verify"]);
    const code = recordedExtraction("m", "Chris", line(/scaffold the prototype/).text);
    expect(code?.jobs).toHaveLength(1);
    expect(code?.jobs[0]?.needsConfirm).toBe(true);
  });
  it("the Phaser vs PixiJS question asks for evidence", () => {
    const text = line(/Phaser or PixiJS/).text;
    expect(claimNeedsEvidence(text)).toBe(true);
    expect(parseTargets(text).map((target) => target.label)).toEqual(["Phaser", "PixiJS"]);
  });
});

describe("game-jam session over HTTP", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer(0);
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => resetStore());

  it("ends with a spec from the meeting, a playable template prototype, and green node tests", async () => {
    const created = await fetch(`${server.url}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Game jam", host: "You", team: ["Maya", "Chris", "Priya"] }),
    });
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    const say = async (speaker: string, text: string) => {
      const response = await fetch(`${server.url}/api/meetings/${meeting.id}/utterance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker, text }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { state: MeetingState }).state;
    };
    // The evidence line calls public APIs; it is covered by the live evidence tests, not here.
    const offline = GAME_JAM_SCRIPT.filter((beat) => !/Phaser or PixiJS/.test(beat.text) && beat.text !== "Yes" && !/Pizza's here/.test(beat.text));
    let state: MeetingState | null = null;
    for (const beat of offline) {
      state = await say(beat.speaker, beat.text);
      await getJobRunner().whenIdle();
    }
    expect(state?.pending?.action).toBe("scaffold_code");
    expect(state?.scaffold).toBeNull();
    const settled = ((await (await fetch(`${server.url}/api/meetings/${meeting.id}`)).json()) as { meeting: MeetingState }).meeting;
    expect(settled.workstreams.find((item) => item.title === "Game screen wireframe")?.artifactPath).toBe("design/game-screen.svg");
    expect(settled.decisions.some((item) => /plain canvas/i.test(item.text))).toBe(true);
    expect(settled.chatter.some((item) => /pizza/i.test(item.text))).toBe(true);

    const after = await say("Maya", "Yes");
    expect(after.pending).toBeNull();
    const code = after.workstreams.find((item) => item.kind === "code");
    expect(code?.status).toBe("ready");
    expect(code?.artifactPath).toBe(GAME_PAGE_PATH);
    expect(code?.progress).toMatch(/^node --test: (\d+)\/\1 passing$/);
    expect(after.pullRequest?.tests.length).toBeGreaterThanOrEqual(7);
    expect(after.pullRequest?.tests.every((test) => test.passed)).toBe(true);

    const spec = readWorkspaceFile(after.workspaceId, "docs/spec.md");
    expect(spec).toMatch(/Build Space Cat Courier/);
    expect(spec).toMatch(/plain canvas/i);
    expect(spec).toMatch(/Ship one playable level/);
    expect(spec).toMatch(/written ahead of time/);
    expect(spec).not.toMatch(/starving/);

    const page = await fetch(`${server.url}/api/workspaces/${after.workspaceId}/file?path=${encodeURIComponent(GAME_PAGE_PATH)}&raw=1`);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(page.headers.get("content-security-policy")).toMatch(/sandbox allow-scripts/);
    const html = await page.text();
    expect(html).toMatch(/<canvas id="game"/);
    expect(html).not.toMatch(/^export /m);

    const parked = await say("Priya", "Pizza's here!");
    expect(parked.chatter.at(-1)?.text).toMatch(/Pizza's here/);
    // The scaffolded tests also pass on their own.
    const run = spawnSync(process.execPath, ["--test"], { cwd: workspaceDir(after.workspaceId), encoding: "utf8" });
    expect(run.status).toBe(0);
  }, 30_000);
});

describe("agent acknowledgement", () => {
  it("says what the agent picked up instead of echoing the line", async () => {
    const { agentAck } = await import("@/lib/agent/dispatch");
    const job = (kind: string, title: string, brief = "x") => ({ id: kind, meetingId: "m", kind, title, brief, speaker: "Maya", needsConfirm: kind === "code" }) as never;
    expect(agentAck({ started: [job("design", "Game architecture")], waiting: [], decisions: [] })).toBe("On it: Game architecture.");
    expect(agentAck({ started: [job("evidence", "Evidence", "Phaser or PixiJS, which is more popular?")], waiting: [], decisions: [] })).toBe("Pulling live GitHub and npm numbers for Phaser and PixiJS.");
    expect(agentAck({ started: [], waiting: [job("code", "Space Cat Courier prototype")], decisions: [] })).toMatch(/says yes/);
    expect(agentAck({ started: [], waiting: [], decisions: ["Plain canvas."] })).toBe("Decision noted: Plain canvas.");
    expect(agentAck(null)).toBeNull();
  });
});
