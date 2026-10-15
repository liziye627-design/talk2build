export interface PlanningBeat {
  speaker: string;
  text: string;
}

export const PLANNING_SCRIPT: PlanningBeat[] = [
  {
    speaker: "Maya",
    text: "Goal for this meeting: ship the billing export as a nightly job. Milestone is the flag, then the runbook.",
  },
  {
    speaker: "Chris",
    text: "Let's sketch the architecture. An export worker reads invoices and writes a CSV. The API is POST /exports.",
  },
  {
    speaker: "Priya",
    text: "Can you wireframe the export settings screen? A toggle for the nightly job and a last-run time.",
  },
  {
    speaker: "Chris",
    text: "Did anyone order lunch yet? I'm starving.",
  },
  {
    speaker: "Maya",
    text: "Before we build it, check that a nightly job is feasible and pull what we already decided.",
  },
  {
    speaker: "Priya",
    text: "Run the tests once the scaffold is in.",
  },
  {
    speaker: "Maya",
    text: "Yes",
  },
];
