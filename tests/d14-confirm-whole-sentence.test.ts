import { describe, expect, it } from "vitest";
import { classifyUtterance } from "@/lib/classifier";
import type { ConfirmAction, PendingConfirm } from "@/lib/types";

const ID = "job_d14_1";
function pending(action: ConfirmAction): PendingConfirm {
  return { id: "pc_1", jobId: ID, prompt: "p", action, payload: { jobId: ID } };
}
function confirms(action: ConfirmAction, text: string) {
  const plan = classifyUtterance({ text, speaker: "Maya", pending: pending(action), queue: [], scenario: "general" });
  return plan.tools.some((t) => t.name === action);
}

describe("D14 pr_draft / create_issues confirm only on a whole sentence", () => {
  it.each(["don't open the PR", "do not open the pull request yet", "please don't open the PR"])("pr_draft negative: %s", (text) => {
    expect(confirms("pr_draft", text)).toBe(false);
  });
  it.each(["don't create issues", "let's not create the issues", "don't create the issues yet"])("create_issues negative: %s", (text) => {
    expect(confirms("create_issues", text)).toBe(false);
  });
  it.each(["open the PR", "Open the pull request.", "yes", `yes ${ID}`, "确认", "Okay, open the PR."])("pr_draft positive: %s", (text) => {
    expect(confirms("pr_draft", text)).toBe(true);
  });
  it.each(["create issues", "Create the issues!", "yes", `yes ${ID}`, "确认", "Sure, create the issues."])("create_issues positive: %s", (text) => {
    expect(confirms("create_issues", text)).toBe(true);
  });
});
