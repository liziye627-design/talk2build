import type { ThreadPending } from "@/lib/db";
import type { PlanStep } from "@/lib/db";
import type { PlannedTool } from "@/lib/types";

export interface ChatPlan {
  reply: string;
  replyFrom: "plan" | "tool";
  tools: PlannedTool[];
  steps: PlanStep[];
  pending: ThreadPending | null;
}

function steps(items: string[], active = 0): PlanStep[] {
  return items.map((text, index) => ({
    id: `step_${index + 1}`,
    text,
    status: index < active ? "done" : index === active ? "next" : "pending",
  }));
}

function isYes(text: string) {
  return /^(yes|yeah|yep|sure|ok|okay|go ahead|do it|please do)[.!]?$/i.test(text.trim());
}

function isNo(text: string) {
  return /^(no|nope|nah|don't|do not|cancel|stop|不对)[.!]?$/i.test(text.trim());
}

export function planChat(input: {
  text: string;
  pending: ThreadPending | null;
  threadId: string;
  meetingId: string | null;
}): ChatPlan {
  const text = input.text.trim().replace(/\s+/g, " ");
  const meetingId = input.meetingId || undefined;

  if (input.pending && isNo(text)) {
    return {
      reply: "Okay. I won't do that. Tell me what you want instead.",
      replyFrom: "plan",
      tools: [],
      steps: steps(["Wait for a clearer ask"], 0),
      pending: null,
    };
  }

  if (input.pending && isYes(text)) {
    const action = input.pending.action;
    const payload = input.pending.payload ?? {};
    if (action === "create_issues") {
      return {
        reply: "",
        replyFrom: "tool",
        tools: [{ name: "create_issues", arguments: { ...payload, threadId: input.threadId } }],
        steps: steps(["Confirm the issue list", "Write one markdown issue per action item"], 1),
        pending: null,
      };
    }
    if (action === "scaffold_code") {
      return {
        reply: "",
        replyFrom: "tool",
        tools: [
          { name: "scaffold_code", arguments: { ...payload, threadId: input.threadId } },
          { name: "run_tests", arguments: { ...payload } },
        ],
        steps: steps(["Confirm the scaffold", "Write the module and its test", "Run node --test"], 1),
        pending: null,
      };
    }
    if (action === "run_tests") {
      return {
        reply: "",
        replyFrom: "tool",
        tools: [{ name: "run_tests", arguments: { ...payload } }],
        steps: steps(["Confirm the test run", "Run node --test in the workspace"], 1),
        pending: null,
      };
    }
    return {
      reply: "That confirmation does not match a task I have waiting.",
      replyFrom: "plan",
      tools: [],
      steps: [],
      pending: null,
    };
  }

  if (/what did we decide|decid\w+ yesterday|yesterday.{0,40}decid/i.test(text)) {
    return {
      reply: "",
      replyFrom: "tool",
      tools: [{ name: "search_memory", arguments: { query: text, since: "yesterday", meetingId } }],
      steps: steps(["Search yesterday's decisions", "Answer with the decision, not the chatter"], 0),
      pending: null,
    };
  }

  if (/into issues|create issues|file (the )?issues/i.test(text)) {
    return {
      reply: "I'll turn the open action items into markdown issues in the workspace. Go ahead?",
      replyFrom: "plan",
      tools: [],
      steps: steps(["Find open action items", "Wait for a yes", "Write issues/*.md"], 1),
      pending: {
        action: "create_issues",
        prompt: "Create issues from the open action items?",
        payload: /yesterday/i.test(text) || !meetingId ? { scope: "all" } : { meetingId },
      },
    };
  }

  if (/write (a |the )?spec/i.test(text)) {
    const title = "Spec";
    const body = [
      "# Spec",
      "",
      "## Outcome",
      text.replace(/^write (a |the )?spec( for)?[: ]*/i, "").trim() || text,
      "",
      "## Acceptance",
      "- The behavior is written down before any code changes.",
      "- A test covers the happy path.",
      "- The spec lives in the workspace, not only in the chat.",
      "",
    ].join("\n");
    return {
      reply: "",
      replyFrom: "tool",
      tools: [{ name: "write_doc", arguments: { title, body, meetingId, threadId: input.threadId } }],
      steps: steps(["Draft the spec from the outcome", "Save it under docs/"], 0),
      pending: null,
    };
  }

  if (/scaffold/i.test(text) && /test/i.test(text)) {
    const prompt = text.replace(/^please\s+/i, "");
    return {
      reply: "I'll scaffold a small module and run its tests in this workspace. Go ahead?",
      replyFrom: "plan",
      tools: [],
      steps: steps(["Confirm the scaffold", "Write the module and a node:test", "Run the tests"], 0),
      pending: {
        action: "scaffold_code",
        prompt: "Scaffold and run tests?",
        payload: { prompt, meetingId },
      },
    };
  }

  if (/summar|minutes|write up the meeting/i.test(text)) {
    return {
      reply: "",
      replyFrom: "tool",
      tools: [{ name: "meeting_summary", arguments: { meetingId, threadId: input.threadId } }],
      steps: steps(["Read decisions, action items, and parked chatter", "Write the minutes into the task"], 0),
      pending: null,
    };
  }

  if (/start (a |the )?(meeting|room)|new meeting|open (a |the )?meeting/i.test(text)) {
    const title = /planning/i.test(text) ? "Planning" : "Working session";
    return {
      reply: "",
      replyFrom: "tool",
      tools: [{ name: "meeting_open", arguments: { title, threadId: input.threadId, host: "You" } }],
      steps: steps(["Open a live room", "Share the join code"], 0),
      pending: null,
    };
  }

  if (text.length > 12) {
    return {
      reply: `Logged as a task note. I can write a spec, turn action items into issues, scaffold code, or open a meeting around it.`,
      replyFrom: "plan",
      tools: [
        {
          name: "write_doc",
          arguments: {
            title: "Task note",
            body: `# Task note\n\n${text}\n`,
            meetingId,
            threadId: input.threadId,
          },
        },
      ],
      steps: steps(["Save the outcome as a note", "Wait for the next instruction"], 0),
      pending: null,
    };
  }

  return {
    reply: "Describe the result you want. I can pull yesterday's decision, file issues, write a spec, scaffold code, or open a meeting.",
    replyFrom: "plan",
    tools: [],
    steps: [],
    pending: null,
  };
}

export function finishSteps(plan: ChatPlan, failed: boolean): PlanStep[] {
  if (plan.steps.length === 0) return [];
  if (plan.pending) {
    return plan.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "done" : index === 1 ? "next" : "pending",
    }));
  }
  return plan.steps.map((step) => ({ ...step, status: failed ? step.status : "done" }));
}
