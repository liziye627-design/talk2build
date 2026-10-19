import { ui } from "@/lib/ui-text";
import type { SpeakerId } from "@/lib/types";

export const REPLIES = {
  event: ui.replies.event,
  correlate: ui.replies.correlate,
  deploy: ui.replies.deploy,
  diff: ui.replies.diff,
  decision: ui.replies.decision,
  todos: ui.replies.todos,
  pr: ui.replies.pr,
  interrupt: ui.replies.interrupt,
} as const;

export interface DemoBeat {
  speaker: SpeakerId;
  text: string;
  reply: string | null;
}

export const DEMO_SCRIPT = {
  title:
    "Last night, 2:17 AM. The orders service went down. This morning, two engineers hold a post-mortem. Talk2Build is listening.",
  closing: "The meeting ended. So did the bug.",
  tagline: "Talk2Build — the meeting where the work gets done.",
  beats: [
    {
      speaker: "A",
      text: "PagerDuty woke me at 2:17. Order service 500s spiked to 40%.",
      reply: REPLIES.event,
    },
    {
      speaker: "B",
      text: "I checked Grafana. Redis connections started climbing at 2:15 — two minutes before the errors.",
      reply: REPLIES.correlate,
    },
    {
      speaker: "A",
      text: "Wasn't there a batch job deployed last night? The reconciliation one?",
      reply: REPLIES.deploy,
    },
    {
      speaker: "B",
      text: "Yes, pull it.",
      reply: REPLIES.diff,
    },
    {
      speaker: "A",
      text: "That's the root cause. The job drained the Redis pool.",
      reply: REPLIES.decision,
    },
    {
      speaker: "B",
      text: "Did anyone order lunch yet? I'm starving.",
      reply: null,
    },
    {
      speaker: "A",
      text: "Action items: add the pool alert, and put the job behind a feature flag.",
      reply: REPLIES.todos,
    },
    {
      speaker: "B",
      text: "Okay, open the PR.",
      reply: REPLIES.pr,
    },
  ] satisfies DemoBeat[],
};
