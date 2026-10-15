import type { SpeakerId } from "@/lib/types";

export const REPLIES = {
  event: "Logged. 2:17 AM, orders API, 40% errors.",
  correlate: "Correlated: Redis pressure started two minutes before the errors.",
  deploy:
    "Found it — batch-reconcile v2.3 deployed at 11:40 PM. Want me to pull the diff?",
  diff: "The diff shows the pool was shrunk from 50 to 20 connections, and no timeout was set.",
  decision:
    "Root cause logged. I'm drafting the fix PR — pool rollback, timeouts, and a pool-exhaustion alert. Say the word and I'll open it.",
  todos: "Two action items captured.",
  pr: "PR draft ready. Three files changed, tests passing.",
  interrupt: "Rolled back to the last checkpoint. What do you want instead?",
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
