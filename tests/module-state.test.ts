import { describe, expect, it, vi } from "vitest";

// D12 audit: state that both the server-action bundle and the route bundle touch must survive a second module copy.
describe("D12 process-wide state across module copies", () => {
  it("meeting store / confirmQueue, evidence cache, seat runtime and job runner are shared", async () => {
    const storeA = await import("@/lib/meeting-store");
    const cacheA = await import("@/lib/evidence/cache");
    const seatsA = await import("@/lib/seats/orchestrator");
    const runnerA = await import("@/lib/agent/runner");
    await import("@/lib/agent/dispatch");
    storeA.resetStore();
    const state = storeA.getStore().ensure("d12");
    state.confirmQueue.push({ action: "scaffold_code", prompt: "p", payload: { jobId: "job_q" } } as never);
    seatsA.configureSeats({ availability: "offline" });
    const runner = runnerA.getJobRunner();
    cacheA.clearEvidenceCache();
    const cacheMap = (globalThis as { __talk2buildEvidenceCache?: unknown }).__talk2buildEvidenceCache;
    expect(cacheMap).toBeInstanceOf(Map);

    vi.resetModules();
    const storeB = await import("@/lib/meeting-store");
    const cacheB = await import("@/lib/evidence/cache");
    const seatsB = await import("@/lib/seats/orchestrator");
    const runnerB = await import("@/lib/agent/runner");
    await import("@/lib/agent/dispatch");
    expect(storeB).not.toBe(storeA);
    expect(storeB.getStore()).toBe(storeA.getStore());
    expect(storeB.getStore().get("d12").confirmQueue.map((q) => q.payload?.jobId)).toEqual(["job_q"]);
    expect(cacheB).not.toBe(cacheA);
    cacheB.clearEvidenceCache();
    expect((globalThis as { __talk2buildEvidenceCache?: unknown }).__talk2buildEvidenceCache).toBe(cacheMap);
    expect(seatsB.seatAvailability()).toBe("offline");
    expect(runnerB.getJobRunner()).toBe(runner);
    seatsB.configureSeats({ availability: null });
  });
});
