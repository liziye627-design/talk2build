import { describe, expect, it } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import { buildDecisionTree, decisionGoal } from "@/lib/agent/tree";
import { claimNeedsEvidence, parseTargets } from "@/lib/evidence/claim";
import { collectEvidence } from "@/lib/evidence/fetch";
import { clearEvidenceCache } from "@/lib/evidence/cache";
import { debateFromEvidence, reviewFromEvidence, selectFromEvidence } from "@/lib/evidence/select";
import type { EvidenceReport } from "@/lib/evidence/types";
import { getStore, resetStore } from "@/lib/meeting-store";
import { prepareAgentWork } from "@/lib/agent/dispatch";
import { getJobRunner } from "@/lib/agent/runner";
import type { MeetingState } from "@/lib/types";

function numbersIn(text: string) {
  return text.match(/\d+/g) ?? [];
}

function allowedNumbers(report: EvidenceReport) {
  const allowed = new Set<string>();
  for (const option of report.options) {
    for (const metric of option.metrics) {
      if (typeof metric.value === "number") allowed.add(String(metric.value));
    }
  }
  return allowed;
}

function assertNoInventedNumbers(text: string, report: EvidenceReport) {
  const allowed = allowedNumbers(report);
  for (const value of numbersIn(text)) {
    expect(allowed.has(value), `${value} is not a fetched number`).toBe(true);
  }
}

function recordedFetch(): typeof fetch {
  const routes: Record<string, unknown> = {
    "https://api.github.com/repos/expressjs/express": { stargazers_count: 65000, open_issues_count: 50, pushed_at: "2026-10-01T00:00:00Z" },
    "https://api.github.com/repos/expressjs/express/releases/latest": { tag_name: "v4.21.0" },
    "https://api.npmjs.org/downloads/point/last-week/express": { downloads: 12000000 },
    "https://registry.npmjs.org/express": { homepage: "https://expressjs.com/" },
    "https://api.github.com/repos/fastify/fastify": { stargazers_count: 32000, open_issues_count: 12, pushed_at: "2026-10-02T00:00:00Z" },
    "https://api.github.com/repos/fastify/fastify/releases/latest": { tag_name: "v5.0.0" },
    "https://api.npmjs.org/downloads/point/last-week/fastify": { downloads: 3000000 },
    "https://registry.npmjs.org/fastify": { homepage: "https://fastify.dev/" },
  };
  return async (input) => {
    const url = String(input);
    if (url.includes("/repos/fastify/fastify/releases")) {
      return new Response("missing", { status: 404 });
    }
    const body = routes[url];
    if (!body) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

describe("evidence from recorded responses", () => {
  it("names express and fastify and ignores a sentence with no package", () => {
    expect(parseTargets("Which is more popular, Express or Fastify?").map((item) => item.label)).toEqual(["Express", "Fastify"]);
    expect(claimNeedsEvidence("Which is more popular, Express or Fastify?")).toBe(true);
    expect(claimNeedsEvidence("Did anyone order lunch yet? I'm starving.")).toBe(false);
    expect(
      classifyUtterance({
        text: "Which is more popular, Express or Fastify?",
        speaker: "Maya",
        pending: null,
        scenario: "general",
      }).kind,
    ).not.toBe("chatter");
  });

  it("keeps only fetched numbers and shows a failed release", async () => {
    const report = await collectEvidence("Which is more popular, Express or Fastify?", recordedFetch());
    const expressStars = report.options.find((item) => item.label === "Express")?.metrics.find((item) => item.name === "GitHub stars");
    expect(expressStars).toMatchObject({
      value: 65000,
      sourceUrl: "https://api.github.com/repos/expressjs/express",
    });
    expect(expressStars?.fetchedAt).toMatch(/^\d{4}-/);
    const docs = report.options.find((item) => item.label === "Express");
    expect(docs?.docsUrl).toBe("https://expressjs.com/");
    expect(docs?.docsSourceUrl).toBe("https://registry.npmjs.org/express");
    const failed = report.options.find((item) => item.label === "Fastify")?.metrics.find((item) => item.name === "GitHub latest release");
    expect(failed?.value).toBeNull();
    expect(failed?.error).toMatch(/No latest release/);
    const selection = selectFromEvidence(report);
    expect(selection.confidence).toBe("high");
    expect(selection.recommendation).toMatch(/Express leads on GitHub stars: 65000 stars/);
    expect(selection.recommendation).not.toMatch(/32001|999/);
    assertNoInventedNumbers(selection.recommendation, report);
    assertNoInventedNumbers(selection.pros.join(" "), report);
    const review = reviewFromEvidence(report, selection);
    expect(review).toMatch(/Not measured: speed, cost, and scale/);
    assertNoInventedNumbers(review.replace(/Not measured: speed, cost, and scale\. Confidence: high\. /, ""), report);
  });

  it("does not turn stars into a speed winner", async () => {
    const report = await collectEvidence("Which is faster, Express or Fastify?", recordedFetch());
    const selection = selectFromEvidence(report);
    expect(selection.confidence).toBe("low");
    expect(selection.recommendation).toMatch(/No speed recommendation/);
    expect(selection.recommendation).not.toMatch(/Express leads/);
    assertNoInventedNumbers(selection.recommendation, report);
  });

  it("writes no numbers when every fetch fails", async () => {
    const fetchImpl: typeof fetch = async () => new Response("no", { status: 503 });
    const report = await collectEvidence("Which is more popular, Express or Fastify?", fetchImpl);
    const selection = selectFromEvidence(report);
    expect(selection.confidence).toBe("low");
    expect(selection.recommendation).toMatch(/No recommendation/);
    expect(numbersIn(selection.recommendation)).toEqual([]);
    expect(selection.cons.some((item) => /503/.test(item))).toBe(true);
  });
});

describe("decision tree", () => {
  it("roots at the goal and forks design and evidence", () => {
    const meeting = {
      title: "Working session",
      workstreams: [
        { id: "1", kind: "plan", title: "Plan", status: "ready", summary: "Ship the export.", updatedAt: "" },
        { id: "2", kind: "design", title: "Architecture", status: "ready", summary: "Worker", updatedAt: "" },
        { id: "3", kind: "design", title: "API spec", status: "ready", summary: "POST", updatedAt: "" },
        {
          id: "4",
          kind: "evidence",
          title: "Evidence",
          status: "ready",
          summary: "2 options fetched.",
          updatedAt: "",
          evidence: { claim: "express vs fastify", question: "popularity", options: [], fetchedAt: "2026-10-16T00:00:00.000Z" },
        },
        { id: "5", kind: "selection", title: "Tech selection", status: "ready", summary: "Express leads.", updatedAt: "" },
      ],
    } as MeetingState;
    expect(decisionGoal(meeting)).toBe("Ship the export.");
    const tree = buildDecisionTree(meeting);
    expect(tree.map((branch) => branch.id)).toEqual(["plan", "design", "evidence"]);
    expect(tree.find((branch) => branch.id === "design")?.layout).toBe("fork");
    expect(tree.find((branch) => branch.id === "evidence")?.items.map((item) => item.kind)).toEqual(["evidence", "selection"]);
  });
});

describe("architect and skeptic", () => {
  it("debates only the fetched evidence", async () => {
    resetStore();
    clearEvidenceCache();
    const state = getStore().ensure("debate");
    state.scenario = "general";
    state.title = "Choice";
    getStore().persist("debate");
    const original = globalThis.fetch;
    globalThis.fetch = recordedFetch();
    try {
      await prepareAgentWork({ meetingId: "debate", speaker: "Maya", text: "Which is more popular, Express or Fastify?" });
      await getJobRunner().whenIdle();
      await prepareAgentWork({ meetingId: "debate", speaker: "You", text: "@architect @skeptic debate this branch" });
    } finally {
      globalThis.fetch = original;
    }
    const meeting = getStore().get("debate");
    // S9/S1 (T2B-002): seats are "AI 架构师/AI 质疑者" marked kind "ai", not English "Architect/Skeptic".
    expect(meeting.participants.map((person) => person.label)).toEqual(expect.arrayContaining(["AI 架构师", "AI 质疑者"]));
    expect(meeting.participants.filter((person) => person.kind === "ai")).toHaveLength(2);
    const conclusion = meeting.workstreams.find((item) => item.kind === "conclusion");
    // S9: the deterministic text is an evidence annotation waiting for a human, not a ready conclusion.
    expect(conclusion?.status).toBe("waiting");
    expect(conclusion?.debateGenerated).toBe("evidence");
    expect(conclusion?.debate?.architect).toMatch(/65000 stars/);
    expect(conclusion?.debate?.skeptic).toMatch(/Fastify GitHub latest release/);
    const report = meeting.workstreams.find((item) => item.kind === "evidence")?.evidence;
    if (!report) throw new Error("missing evidence");
    assertNoInventedNumbers(conclusion?.debate?.conclusion || "", report);
    // S9: no seat speaks the deterministic text (was: a "Skeptic" transcript line existed).
    expect(meeting.transcript.some((line) => line.speaker === "Skeptic" || line.speaker === "AI 质疑者" || line.speaker === "Architect" || line.speaker === "AI 架构师")).toBe(false);
    expect(meeting.decisions).toHaveLength(0);
    expect(meeting.workstreams.some((item) => item.kind === "design")).toBe(false);
  });

  it("refuses a debate before any fetch", () => {
    const debate = debateFromEvidence(undefined, undefined);
    expect(debate.conclusion).toMatch(/No conclusion/);
    expect(numbersIn(debate.architect + debate.skeptic + debate.conclusion)).toEqual([]);
  });
});
