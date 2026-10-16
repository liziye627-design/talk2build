import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/artifacts")>();
  return {
    ...actual,
    draftArtifact: async () => {
      throw new Error("ENOENT: open '/home/secret/talk2build/.env.local' (sk-test-123)");
    },
  };
});

import { JOB_FAILED_SUMMARY, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { getJobRunner } from "@/lib/agent/runner";
import { getStore, resetStore } from "@/lib/meeting-store";

afterEach(() => vi.restoreAllMocks());

describe("C2 failed job card", () => {
  it("shows generic text on the card; the raw error only goes to the server log", async () => {
    resetStore();
    const state = getStore().ensure("c2");
    state.scenario = "general";
    getStore().persist("c2");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useDefaultJobRunner();
    getJobRunner().start({ id: "job_fail", meetingId: "c2", kind: "plan", title: "Plan", brief: "x", speaker: "Maya", needsConfirm: false });
    await getJobRunner().whenIdle();
    const card = getStore().get("c2").workstreams.find((w) => w.jobId === "job_fail");
    expect(card?.summary).toBe(JOB_FAILED_SUMMARY);
    expect(card?.summary).toBe("任务失败，已记录日志");
    expect(JSON.stringify(card)).not.toMatch(/home\/secret|\.env|sk-test/);
    expect(log.mock.calls.flat().join(" ")).toMatch(/\/home\/secret/);
  });
});
