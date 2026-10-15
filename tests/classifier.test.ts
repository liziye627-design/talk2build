import { describe, expect, it } from "vitest";
import { classifyUtterance, extractActionItems, isChatter, isInterrupt } from "@/lib/classifier";
import { DEMO_SCRIPT, REPLIES } from "@/lib/demo-script";
import type { PendingConfirm } from "@/lib/types";

const pendingDiff: PendingConfirm = {
  id: "ask_1",
  action: "diff_fetch",
  prompt: REPLIES.deploy,
};

const pendingPr: PendingConfirm = {
  id: "ask_2",
  action: "pr_draft",
  prompt: REPLIES.decision,
};

describe("classifyUtterance", () => {
  it("labels each beat of the 2:17 AM script", () => {
    const kinds = ["event", "correlation", "deploy_query", "confirm", "decision", "chatter", "todo", "confirm"];
    let pending: PendingConfirm | null = null;
    DEMO_SCRIPT.beats.forEach((beat, index) => {
      const result = classifyUtterance({ text: beat.text, speaker: beat.speaker, pending });
      expect(result.kind).toBe(kinds[index]);
      expect(result.reply).toBe(beat.reply);
      if (result.kind === "chatter") expect(result.silent).toBe(true);
      if (result.kind === "deploy_query") pending = pendingDiff;
      if (result.kind === "confirm" && pending?.action === "diff_fetch") pending = null;
      if (result.kind === "decision") pending = pendingPr;
    });
  });

  it("parks lunch talk and stays silent", () => {
    const result = classifyUtterance({
      text: "Did anyone order lunch yet? I'm starving.",
      speaker: "B",
      pending: null,
    });
    expect(isChatter(result.summary) || result.kind === "chatter").toBe(true);
    expect(result.tools.map((tool) => tool.name)).toContain("chatter_park");
    expect(result.tools.map((tool) => tool.name)).not.toContain("decision_record");
    expect(result.reply).toBeNull();
  });

  it("treats stop and 不对 as interrupts", () => {
    for (const text of ["stop", "不对", "不对。", "停一下"]) {
      const result = classifyUtterance({ text, speaker: "A", pending: pendingPr });
      expect(isInterrupt(text)).toBe(true);
      expect(result.kind).toBe("interrupt");
      expect(result.tools[0]?.name).toBe("checkpoint_rollback");
    }
  });

  it("files 记一下 directly and locks 就这么定了 as a decision", () => {
    const note = classifyUtterance({ text: "记一下 the on-call handoff", speaker: "A", pending: null });
    expect(note.kind).toBe("requirement");
    expect(note.tools.some((tool) => tool.name === "requirement_add")).toBe(true);
    expect(note.reply).toMatch(/Noted/);

    const decision = classifyUtterance({ text: "就这么定了 Postgres for users", speaker: "B", pending: null });
    expect(decision.kind).toBe("decision");
    expect(decision.tools.some((tool) => tool.name === "decision_record")).toBe(true);
    expect(decision.tools.some((tool) => tool.name === "confirm_ask")).toBe(true);
    expect(decision.tools.some((tool) => tool.name === "pr_draft")).toBe(false);
  });

  it("splits the two action items", () => {
    expect(extractActionItems("Action items: add the pool alert, and put the job behind a feature flag.")).toEqual([
      "Add the pool alert",
      "Put the job behind a feature flag",
    ]);
  });
});
