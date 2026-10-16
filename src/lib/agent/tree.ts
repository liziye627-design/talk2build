import type { MeetingState, WorkKind, Workstream } from "@/lib/types";

const ORDER: WorkKind[] = ["plan", "design", "verify", "research", "code", "evidence", "selection", "review", "conclusion"];

export interface TreeBranch {
  id: string;
  label: string;
  layout: "stack" | "fork";
  items: Workstream[];
}

export function decisionGoal(meeting: MeetingState) {
  const plan = meeting.workstreams.find((item) => item.kind === "plan" && item.status === "ready");
  return plan?.summary || meeting.title;
}

export function buildDecisionTree(meeting: MeetingState): TreeBranch[] {
  const branches: TreeBranch[] = [];
  for (const kind of ORDER) {
    const items = meeting.workstreams.filter((item) => item.kind === kind);
    if (items.length === 0) continue;
    if (kind === "evidence") {
      const related = ["selection", "review", "conclusion"]
        .flatMap((relatedKind) => meeting.workstreams.filter((item) => item.kind === relatedKind));
      branches.push({
        id: "evidence",
        label: "Evidence",
        layout: "fork",
        items: [...items, ...related],
      });
      continue;
    }
    if (kind === "selection" || kind === "review" || kind === "conclusion") continue;
    branches.push({
      id: kind,
      label: kind,
      layout: items.length > 1 ? "fork" : "stack",
      items,
    });
  }
  return branches;
}
