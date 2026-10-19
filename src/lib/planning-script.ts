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

/** Demo v2: the Space Cat Courier game jam. Recorded fixtures answer these lines in mock mode. */
export const GAME_JAM_SCRIPT: PlanningBeat[] = [
  {
    speaker: "Maya",
    text: "Goal for this meeting: build Space Cat Courier, a tiny browser game, before the pizza gets here. Milestone is one playable level, then a high score.",
  },
  {
    speaker: "Chris",
    text: "Let's sketch the architecture. A game loop, keyboard and touch input, and a canvas renderer. Asteroids get faster every ten parcels.",
  },
  {
    speaker: "Priya",
    text: "Can you wireframe the game screen? The cat on the left, a fuel bar and the parcel count up top.",
  },
  { speaker: "Chris", text: "Phaser or PixiJS, which is more popular?" },
  { speaker: "Maya", text: "Phaser has the stars, but for one level we'll code it in plain canvas. Zero dependencies." },
  { speaker: "Priya", text: "Is the pizza here yet? I'm starving." },
  { speaker: "Maya", text: "Before we build it, check that it's feasible on a phone." },
  { speaker: "Chris", text: "Turn our decisions into a spec, scaffold the prototype, and run the tests." },
  { speaker: "Maya", text: "Yes" },
  { speaker: "Priya", text: "Pizza's here!" },
];
