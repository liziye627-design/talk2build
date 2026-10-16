import { afterEach, describe, expect, it } from "vitest";
import { clearEvidenceCache, collectEvidenceCached, EVIDENCE_CACHE_TTL_MS } from "@/lib/evidence/cache";
import { failureLabel, isThirdParty, metricDisplayable, metricValueText, reportOffline, sourceName } from "@/lib/evidence/display";
import { collectEvidence, errorCodeFor } from "@/lib/evidence/fetch";
import type { EvidenceMetric } from "@/lib/evidence/types";
import { prepareAgentWork } from "@/lib/agent/dispatch";
import { getJobRunner } from "@/lib/agent/runner";
import { getStore, resetStore } from "@/lib/meeting-store";

const AT = "2026-10-16T00:00:00.000Z";
function metric(patch: Partial<EvidenceMetric>): EvidenceMetric {
  return { name: "GitHub stars", value: 10, text: null, unit: "stars", sourceUrl: "https://api.github.com/repos/a/b", fetchedAt: AT, ...patch };
}

function okFetch(counter: { n: number }): typeof fetch {
  return async (input) => {
    counter.n += 1;
    const url = String(input);
    if (url.includes("api.github.com/repos/") && !url.includes("releases")) return Response.json({ stargazers_count: 5, open_issues_count: 1, pushed_at: AT });
    if (url.includes("releases")) return Response.json({ tag_name: "v1" });
    if (url.includes("api.npmjs.org")) return Response.json({ downloads: 7 });
    return Response.json({ homepage: "https://x.dev/" });
  };
}

afterEach(() => clearEvidenceCache());

describe("evidence display layer", () => {
  it("names GitHub, npm and PyPI from the URL; pypistats is labelled third-party", () => {
    expect(sourceName("https://api.github.com/repos/a/b")).toBe("GitHub");
    expect(sourceName("https://api.npmjs.org/downloads/point/last-week/x")).toBe("npm");
    expect(sourceName("https://registry.npmjs.org/x")).toBe("npm");
    expect(sourceName("https://pypi.org/pypi/x/json")).toBe("PyPI");
    expect(sourceName("https://pypistats.org/api/packages/x/recent")).toBe("pypistats（第三方）");
    expect(sourceName("https://evil.example/")).toBeNull();
  });

  it("shows no number when error is set or source/time is missing", () => {
    expect(metricValueText(metric({}))).toBe("10 stars");
    expect(metricDisplayable(metric({ value: null, error: "GitHub returned 403.", errorCode: "rate_limited" }))).toBe(false);
    expect(metricDisplayable(metric({ sourceUrl: "" }))).toBe(false);
    expect(metricDisplayable(metric({ fetchedAt: "" }))).toBe(false);
    expect(metricValueText(metric({ error: "x" }))).toBeNull();
  });

  it("maps failures: 403/429 → 限流, 404 → 未找到, timeout → 超时", () => {
    expect(failureLabel({ error: "GitHub returned 403.", errorCode: errorCodeFor("GitHub returned 403.") })).toBe("拉取失败：限流");
    expect(failureLabel({ error: "npm returned 429." })).toBe("拉取失败：限流");
    expect(failureLabel({ error: "x", errorCode: errorCodeFor("GitHub returned 404.") })).toBe("拉取失败：未找到");
    expect(errorCodeFor("The operation was aborted due to timeout")).toBe("timeout");
    expect(errorCodeFor("Response had no downloads number.")).toBe("parse");
    expect(errorCodeFor("fetch failed")).toBe("network");
  });

  it("fetch.ts fills errorCode on every failed metric", async () => {
    const report = await collectEvidence("Which is more popular, Express or Fastify?", async () => new Response("no", { status: 429 }));
    const failed = report.options.flatMap((o) => o.metrics);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((m) => m.error && m.errorCode === "rate_limited" && m.value === null)).toBe(true);
  });

  it("all-network failure is shown as offline", async () => {
    const report = await collectEvidence("Which is more popular, Express or Fastify?", async () => {
      throw new TypeError("fetch failed");
    });
    expect(reportOffline(report)).toBe(true);
  });

  it("caches for 10 minutes and refetches after 11", async () => {
    const counter = { n: 0 };
    let now = 1_000_000;
    const first = await collectEvidenceCached("Which is more popular, Express or Fastify?", okFetch(counter), undefined, { now: () => now });
    expect(first.cachedAt).toBeNull();
    const calls = counter.n;
    now += 9 * 60 * 1000;
    const second = await collectEvidenceCached("express vs fastify, which is more popular?", okFetch(counter), undefined, { now: () => now });
    expect(counter.n).toBe(calls);
    expect(second.cachedAt).toBe(new Date(1_000_000).toISOString());
    now += 2 * 60 * 1000;
    expect(now - 1_000_000).toBeGreaterThan(EVIDENCE_CACHE_TTL_MS);
    const third = await collectEvidenceCached("Which is more popular, Express or Fastify?", okFetch(counter), undefined, { now: () => now });
    expect(counter.n).toBe(calls * 2);
    expect(third.cachedAt).toBeNull();
  });

  it("times out a hanging source after the wrapper timeout", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    const { report } = await collectEvidenceCached("Which is more popular, Express or Fastify?", hang, undefined, { timeoutMs: 20 });
    const metrics = report.options.flatMap((o) => o.metrics);
    expect(metrics.every((m) => m.errorCode === "timeout")).toBe(true);
  });

  it("selection card is marked 待人确认 and adds no decision (E10)", async () => {
    resetStore();
    const state = getStore().ensure("e10");
    state.scenario = "general";
    getStore().persist("e10");
    const original = globalThis.fetch;
    globalThis.fetch = okFetch({ n: 0 });
    try {
      await prepareAgentWork({ meetingId: "e10", speaker: "Maya", text: "Which is more popular, Express or Fastify?" });
      await getJobRunner().whenIdle();
    } finally {
      globalThis.fetch = original;
    }
    const meeting = getStore().get("e10");
    const selection = meeting.workstreams.find((w) => w.kind === "selection");
    expect(selection?.summary).toMatch(/^待人确认/);
    expect(meeting.decisions).toHaveLength(0);
  });
  it("spec-rev2 O1: pypistats is a distinct third-party source and a failure is not backfilled", async () => {
    expect(isThirdParty("https://pypistats.org/api/packages/requests/recent")).toBe(true);
    expect(isThirdParty("https://pypi.org/pypi/requests/json")).toBe(false);
    const report = await collectEvidence("Which is more popular, requests or httpx?", async (input) => {
      const url = String(input);
      if (url.includes("pypistats.org")) return new Response("busy", { status: 429 });
      if (url.includes("pypi.org")) return Response.json({ info: { home_page: "https://requests.readthedocs.io" } });
      return new Response("missing", { status: 404 });
    });
    const week = report.options.flatMap((o) => o.metrics).filter((m) => m.name === "PyPI downloads last week");
    expect(week.length).toBeGreaterThan(0);
    for (const m of week) {
      expect(sourceName(m.sourceUrl)).toBe("pypistats（第三方）");
      expect(m.value).toBeNull();
      expect(metricValueText(m)).toBeNull();
      expect(failureLabel(m)).toBe("拉取失败：限流");
    }
  });
});
