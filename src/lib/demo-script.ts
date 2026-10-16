import type { SpeakerId } from "@/lib/types";

export const REPLIES = {
  event: "已记录：凌晨 2:17，orders API，40% 报错。",
  correlate: "已关联：Redis 压力比报错早两分钟开始上升。",
  deploy: "找到了：batch-reconcile v2.3 在晚上 11:40 部署。要我拉取 diff 吗？",
  diff: "diff 显示连接池从 50 缩到了 20，而且没有设置超时。",
  decision: "根因已记录。我正在起草修复 PR：回滚连接池、加超时、加连接池耗尽告警。你说一声我就打开它。",
  todos: "已记录 2 条待办。",
  pr: "PR 草稿已就绪：改了 3 个文件，测试通过。",
  interrupt: "已回滚到上一个检查点。你希望换成什么？",
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
