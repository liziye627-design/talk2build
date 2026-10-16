import { expect, it } from "vitest";
import { collectEvidence } from "@/lib/evidence/fetch";
import type { EvidenceReport } from "@/lib/evidence/types";

async function liveNetwork() {
  if (process.env.TALK2BUILD_LIVE === "0") return false;
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: { "user-agent": "talk2build-evidence", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function metric(report: EvidenceReport, label: string, name: string) {
  return report.options.find((option) => option.label === label)?.metrics.find((item) => item.name === name);
}

it("live: GitHub and npm numbers for Express and Fastify", async (ctx) => {
  if (!(await liveNetwork())) ctx.skip();
  const report = await collectEvidence("Which is more popular, Express or Fastify?");
  const stars = metric(report, "Express", "GitHub stars");
  const downloads = metric(report, "Express", "npm downloads last week");
  expect(stars?.sourceUrl).toBe("https://api.github.com/repos/expressjs/express");
  expect(stars?.fetchedAt).toMatch(/^\d{4}-/);
  expect(typeof stars?.value).toBe("number");
  expect(stars?.value ?? 0).toBeGreaterThan(1000);
  expect(downloads?.sourceUrl).toBe("https://api.npmjs.org/downloads/point/last-week/express");
  expect(typeof downloads?.value).toBe("number");
  expect(downloads?.value ?? 0).toBeGreaterThan(1000);
  const fastify = metric(report, "Fastify", "GitHub stars");
  expect(fastify?.error ? fastify.error.length : fastify?.value ?? 0).toBeGreaterThan(0);
  const docs = report.options.find((option) => option.label === "Express");
  expect(docs?.docsSourceUrl).toBe("https://registry.npmjs.org/express");
  if (docs?.docsUrl) expect(docs.docsUrl).toMatch(/^https:\/\//);
}, 30_000);

it("live: PyPI recent downloads for requests", async (ctx) => {
  if (process.env.TALK2BUILD_LIVE === "0") ctx.skip();
  let response: Response;
  try {
    response = await fetch("https://pypistats.org/api/packages/requests/recent", {
      headers: { "user-agent": "talk2build-evidence" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    ctx.skip();
    return;
  }
  expect(response.status).toBeGreaterThan(0);
  if (!response.ok) return;
  const body = (await response.json()) as { data?: { last_week?: number } };
  expect(typeof body.data?.last_week).toBe("number");
  expect(body.data?.last_week ?? 0).toBeGreaterThan(0);
  const report = await collectEvidence("Which is more popular, requests or httpx?");
  const week = metric(report, "requests", "PyPI downloads last week");
  expect(week?.sourceUrl).toBe("https://pypistats.org/api/packages/requests/recent");
  expect(week?.fetchedAt).toMatch(/^\d{4}-/);
  if (!week?.error) expect(week?.value ?? 0).toBeGreaterThan(0);
}, 30_000);