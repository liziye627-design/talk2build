import { classifyUtterance, type ClassifyInput } from "@/lib/classifier";
import { createProvider } from "@/lib/llm";
import type { Classification, MeetingState } from "@/lib/types";

export interface TurnPlan {
  classification: Classification;
  provider: string;
  model: string | null;
  degraded: boolean;
}

export function summarizeMeeting(state: MeetingState) {
  return [
    `timeline ${state.timeline.length}`,
    `decisions ${state.decisions.length}`,
    `requirements ${state.requirements.length}`,
    `todos ${state.todos.length}`,
    `chatter ${state.chatter.length}`,
    state.deploy ? `deploy ${state.deploy.service} ${state.deploy.version}` : "no deploy",
    state.pending ? `pending ${state.pending.action}` : "no pending",
    state.pullRequest ? "pr drafted" : "no pr",
  ].join("; ");
}

export async function planTurn(input: ClassifyInput & { stateSummary: string }): Promise<TurnPlan> {
  const provider = createProvider();
  try {
    const classification = await provider.plan(input);
    return { classification, provider: provider.id, model: provider.model, degraded: false };
  } catch {
    if (provider.id === "mock") throw new Error("Mock planner failed.");
    return {
      classification: classifyUtterance(input),
      provider: provider.id,
      model: provider.model,
      degraded: true,
    };
  }
}
