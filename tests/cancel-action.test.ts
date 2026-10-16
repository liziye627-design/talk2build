import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cancelActionModule from "@/app/actions/cancel-job";
import { bindJobExecutor, getJobRunner, resetJobRunner } from "@/lib/agent/runner";
import { useDefaultJobRunner } from "@/lib/agent/dispatch";
import { resetStore } from "@/lib/meeting-store";
import type { AgentJob } from "@/lib/agent/types";
import { cancelJobAuthorized } from "@/server/cancel-job";
import {
  SESSION_TTL_MS,
  assertProductionSessionSecret,
  authorizeCancel,
  issueMeetingSession,
  sessionCookieName,
  verifyMeetingSession,
} from "@/server/meeting-session";
import { handleMeetingGet, handleMeetingsPost } from "@/server/product";
import { routeHttp } from "@/server/routes";

const SECRET = "test-session-secret-0123456789abcdef-xyz";
const TOKEN = "test-mcp-token-0123456789abcdef";

function holdJob(meetingId: string, id = "job_hold"): AgentJob {
  return { id, meetingId, kind: "plan", title: "Plan", brief: "x", speaker: "Maya", needsConfirm: false };
}

function production() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALK2BUILD_SESSION_SECRET", SECRET);
  vi.stubEnv("MCP_DEMO_TOKEN", TOKEN);
}

function holdRunner() {
  resetJobRunner();
  bindJobExecutor((_job, signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })));
}

function cookieHeader(meetingId: string, value = issueMeetingSession(meetingId)) {
  return new Headers({ cookie: `${sessionCookieName(meetingId)}=${value}` });
}

beforeEach(() => holdRunner());

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of ["m1", "m2", "mA", "mB"]) getJobRunner().cancelMeeting(id);
  await getJobRunner().whenIdle();
  resetJobRunner();
  useDefaultJobRunner();
});

describe("C1 cancel auth (design-rev3-c1)", () => {
  it("1 production, no cookie and no Bearer → rejected and the job keeps running", () => {
    production();
    getJobRunner().start(holdJob("m1"));
    expect(cancelJobAuthorized({ headers: new Headers(), meetingId: "m1", jobId: "job_hold" })).toEqual({ cancelled: false, error: "Unauthorized" });
    expect(cancelJobAuthorized({ headers: new Headers({ authorization: "Bearer talk2build-demo" }), meetingId: "m1", jobId: "job_hold" }).cancelled).toBe(false);
    // still cancellable afterwards → it was not cancelled by the rejected calls
    expect(cancelJobAuthorized({ headers: cookieHeader("m1"), meetingId: "m1", jobId: "job_hold" }).cancelled).toBe(true);
  });

  it("2 production, valid session cookie → cancel succeeds", () => {
    production();
    getJobRunner().start(holdJob("m2"));
    expect(cancelJobAuthorized({ headers: cookieHeader("m2"), meetingId: "m2", jobId: "job_hold" })).toEqual({ cancelled: true });
  });

  it("3 cookie for meeting A is rejected for meeting B", () => {
    production();
    getJobRunner().start(holdJob("mB"));
    const cookieForA = issueMeetingSession("mA");
    expect(verifyMeetingSession(cookieForA, "mA")).toBe(true);
    expect(verifyMeetingSession(cookieForA, "mB")).toBe(false);
    // A's cookie value presented under B's cookie name, and under A's name, both fail for B.
    expect(authorizeCancel({ headers: cookieHeader("mB", cookieForA), meetingId: "mB" })).toBe(false);
    expect(authorizeCancel({ headers: cookieHeader("mA", cookieForA), meetingId: "mB" })).toBe(false);
    expect(cancelJobAuthorized({ headers: cookieHeader("mB", cookieForA), meetingId: "mB", jobId: "job_hold" }).cancelled).toBe(false);
  });

  it("4 tampered HMAC or expired session → rejected", () => {
    production();
    const good = issueMeetingSession("m1");
    const [id, exp, mac] = good.split(".") as [string, string, string];
    const flipped = `${id}.${exp}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(verifyMeetingSession(flipped, "m1")).toBe(false);
    expect(verifyMeetingSession(`${id}.${Number(exp) + 1000}.${mac}`, "m1")).toBe(false);
    expect(verifyMeetingSession(`${id}.${exp}.short`, "m1")).toBe(false);
    expect(verifyMeetingSession("garbage", "m1")).toBe(false);
    const old = issueMeetingSession("m1", Date.now() - SESSION_TTL_MS - 1000);
    expect(verifyMeetingSession(old, "m1")).toBe(false);
    // a different secret invalidates existing cookies
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", `${SECRET}-rotated`);
    expect(verifyMeetingSession(good, "m1")).toBe(false);
  });

  it("5 Bearer still works on the HTTP cancel endpoint; no credentials → 401; cross-site Origin with cookie → 401", async () => {
    production();
    getJobRunner().start(holdJob("m1"));
    const url = "http://localhost/api/meetings/m1/jobs/job_hold/cancel";
    const denied = await routeHttp(new Request(url, { method: "POST", headers: { host: "localhost" } }));
    expect(denied.status).toBe(401);
    const crossSite = await routeHttp(
      new Request(url, { method: "POST", headers: { host: "localhost", origin: "https://evil.example", cookie: `${sessionCookieName("m1")}=${issueMeetingSession("m1")}` } }),
    );
    expect(crossSite.status).toBe(401);
    const ok = await routeHttp(new Request(url, { method: "POST", headers: { host: "localhost", authorization: `Bearer ${TOKEN}` } }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { cancelled: boolean }).cancelled).toBe(true);
  });

  it("6 the 'use server' file exports only cancelMeetingJob", () => {
    expect(Object.keys(cancelActionModule).sort()).toEqual(["cancelMeetingJob"]);
  });

  it("7 GET meeting state sets an HttpOnly SameSite=Strict meeting cookie", async () => {
    resetStore();
    const created = await handleMeetingsPost(new Request("http://localhost/api/meetings", { method: "POST", body: JSON.stringify({ title: "Cookie" }) }));
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    production();
    const response = handleMeetingGet(meeting.id, new Request(`https://talk2build.example/api/meetings/${meeting.id}`));
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain(`${sessionCookieName(meeting.id)}=`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Secure/);
    const value = setCookie.split(";")[0]!.split("=").slice(1).join("=");
    expect(verifyMeetingSession(value, meeting.id)).toBe(true);
  });

  it("7b plain HTTP request → cookie without Secure (even in production)", async () => {
    resetStore();
    const created = await handleMeetingsPost(new Request("http://localhost/api/meetings", { method: "POST", body: JSON.stringify({ title: "Plain" }) }));
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    production();
    const setCookie = handleMeetingGet(meeting.id, new Request(`http://localhost/api/meetings/${meeting.id}`)).headers.get("set-cookie") || "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).not.toMatch(/Secure/);
  });

  it("7c x-forwarded-proto: https → cookie with Secure (even outside production)", async () => {
    resetStore();
    const created = await handleMeetingsPost(new Request("http://localhost/api/meetings", { method: "POST", body: JSON.stringify({ title: "Proxied" }) }));
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    vi.stubEnv("NODE_ENV", "test");
    const request = new Request(`http://localhost/api/meetings/${meeting.id}`, { headers: { "x-forwarded-proto": "https" } });
    const setCookie = handleMeetingGet(meeting.id, request).headers.get("set-cookie") || "";
    expect(setCookie).toMatch(/; Secure/);
  });

  it("8 production startup fails without TALK2BUILD_SESSION_SECRET; dev uses a random secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", "");
    expect(() => assertProductionSessionSecret()).toThrow(/TALK2BUILD_SESSION_SECRET/);
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", "too-short");
    expect(() => assertProductionSessionSecret()).toThrow(/TALK2BUILD_SESSION_SECRET/);
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", SECRET);
    expect(() => assertProductionSessionSecret()).not.toThrow();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", "");
    expect(() => assertProductionSessionSecret()).not.toThrow();
    expect(verifyMeetingSession(issueMeetingSession("m1"), "m1")).toBe(true);
  });

  it("9 production without TALK2BUILD_SESSION_SECRET fails closed: no cookie issued, cancel rejected", async () => {
    resetStore();
    const created = await handleMeetingsPost(new Request("http://localhost/api/meetings", { method: "POST", body: JSON.stringify({ title: "Closed" }) }));
    const { meeting } = (await created.json()) as { meeting: { id: string } };
    // a cookie minted while a secret existed
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", SECRET);
    const minted = issueMeetingSession(meeting.id);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MCP_DEMO_TOKEN", TOKEN);
    vi.stubEnv("TALK2BUILD_SESSION_SECRET", "");
    expect(() => issueMeetingSession(meeting.id)).toThrow(/TALK2BUILD_SESSION_SECRET/);
    expect(() => handleMeetingGet(meeting.id, new Request("https://x.example/"))).toThrow(/TALK2BUILD_SESSION_SECRET/);
    getJobRunner().start(holdJob(meeting.id));
    expect(verifyMeetingSession(minted, meeting.id)).toBe(false);
    expect(authorizeCancel({ headers: cookieHeader(meeting.id, minted), meetingId: meeting.id })).toBe(false);
    expect(authorizeCancel({ headers: new Headers(), meetingId: meeting.id })).toBe(false);
    expect(cancelJobAuthorized({ headers: cookieHeader(meeting.id, minted), meetingId: meeting.id, jobId: "job_hold" })).toEqual({ cancelled: false, error: "Unauthorized" });
    const http = await routeHttp(
      new Request(`http://localhost/api/meetings/${meeting.id}/jobs/job_hold/cancel`, { method: "POST", headers: { host: "localhost", cookie: `${sessionCookieName(meeting.id)}=${minted}` } }),
    );
    expect(http.status).toBe(401);
    getJobRunner().cancelMeeting(meeting.id);
  });

  it("auth off (local dev) → allowed without credentials", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MCP_REQUIRE_AUTH", "false");
    expect(authorizeCancel({ headers: new Headers(), meetingId: "m1" })).toBe(true);
  });
});
