import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import { prepareAgentWork, useDefaultJobRunner } from "@/lib/agent/dispatch";
import { getStore, resetStore } from "@/lib/meeting-store";
import { executeTool } from "@/lib/tools";

const M = "d13";

beforeEach(async () => {
  process.env.TALK2BUILD_AGENT_BACKEND = "fixture";
  resetStore();
  const state = getStore().ensure(M);
  state.scenario = "general";
  getStore().persist(M);
  useDefaultJobRunner();
  await prepareAgentWork({ meetingId: M, speaker: "Maya", text: "帮我写一个登录页的代码" });
});
afterEach(() => {
  delete process.env.TALK2BUILD_AGENT_BACKEND;
});

function say(text: string) {
  const state = getStore().get(M);
  const plan = classifyUtterance({ text, speaker: "Maya", pending: state.pending, queue: state.confirmQueue, scenario: "general" });
  for (const tool of plan.tools) executeTool(tool.name, { ...tool.arguments, meetingId: M });
  return plan;
}
const codeCard = () => getStore().get(M).workstreams.find((w) => w.kind === "code");
const jobId = () => getStore().get(M).pending?.jobId as string;

describe("D13 scaffold_code confirms only on a whole-sentence yes", () => {
  it("starts as a code job waiting for confirmation", () => {
    expect(getStore().get(M).pending?.action).toBe("scaffold_code");
    expect(codeCard()?.status).toBe("waiting");
  });

  it.each([(id: string) => `yes, but not ${id}`, () => "don't scaffold yet", () => "Yes but let's scaffold later", () => "好，我们继续"])(
    "negative #%# does not confirm the code job",
    (make) => {
      const id = jobId();
      const plan = say(make(id));
      expect(plan.tools.some((t) => t.name === "scaffold_code")).toBe(false);
      const state = getStore().get(M);
      expect(state.pending?.jobId).toBe(id);
      expect(codeCard()?.status).toBe("waiting");
      expect(state.scaffold).toBeNull();
    },
  );

  it.each([() => "yes", (id: string) => `yes ${id}`, () => "scaffold it", () => "Scaffold.", () => "确认"])("positive #%# confirms the code job", (make) => {
    const id = jobId();
    const plan = say(make(id));
    expect(plan.tools.find((t) => t.name === "scaffold_code")?.arguments.jobId).toBe(id);
    const state = getStore().get(M);
    expect(state.pending).toBeNull();
    expect(codeCard()?.status).toBe("ready");
  });
});
