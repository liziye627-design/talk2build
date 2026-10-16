import { REPLIES } from "@/lib/demo-script";
import { claimNeedsEvidence } from "@/lib/evidence/claim";
import { FIX_REQUIREMENTS, REDIS_METRICS, ROOT_CAUSE } from "@/lib/incident";
import type { Classification, PendingConfirm, PlannedTool, SpeakerId } from "@/lib/types";

export interface ClassifyInput {
  text: string;
  speaker: SpeakerId;
  pending: PendingConfirm | null;
  queue?: PendingConfirm[];
  scenario?: "general" | "incident";
}

function choosePending(text: string, pending: PendingConfirm | null, queue: PendingConfirm[] = []) {
  const named = [pending, ...queue].find((item) => {
    const jobId = item?.payload?.jobId;
    return typeof jobId === "string" && jobId.length > 0 && text.includes(jobId);
  });
  return named ?? pending;
}

function plan(
  kind: Classification["kind"],
  summary: string,
  tools: PlannedTool[],
  reply: string | null,
  confidence = 0.92,
): Classification {
  return {
    kind,
    confidence,
    summary,
    tools,
    reply,
    silent: reply === null,
  };
}

function heard(speaker: SpeakerId, text: string, kind: Classification["kind"]): PlannedTool[] {
  return [
    { name: "ingest_transcript", arguments: { speaker, text, kind } },
    { name: "classify_utterance", arguments: { speaker, text } },
  ];
}

export function isInterrupt(text: string) {
  return /^(stop|halt|rollback|不对|不对啊|停|停一下|停止)[!！.。\s]*$/i.test(text.trim());
}

function isReject(text: string) {
  return /^(no|nope|nah|don't|do not|cancel|别|先别|不用)[!！.。\s]*$/i.test(text.trim());
}

function isYes(value: string) {
  return /^(yes|yeah|yep|sure|ok|okay|go ahead|do it)[.!]?$/i.test(value);
}

/**
 * D12/D13: whole-sentence confirmation shared by confirm_conclusion and scaffold_code.
 * Accepts "yes", "yes <id>" (exact id, nothing else) or a bare Chinese yes. "yes, but not <id>" never confirms.
 */
function isWholeSentenceYes(value: string, jobId: unknown) {
  const match = /^(?:yes|yeah|yep|sure|ok|okay|go ahead|do it)[,\s]+(\S+?)[.!]?$/i.exec(value);
  const yesWithId = typeof jobId === "string" && jobId.length > 0 && match?.[1] === jobId;
  return isYes(value) || yesWithId || /^(确认|是的|好的?|可以)[!！.。\s]*$/.test(value);
}

/**
 * B10: the speaker is deferring or excluding code work ("先别写代码", "don't write the code yet", "yes, but not job_x").
 * English words use \b; Chinese phrases are plain substrings (\b never matches CJK).
 */
export function isDeferral(text: string): boolean {
  return /\b(don't|don’t|do not|not yet|later|hold off)\b/i.test(text) || /先别|不要|暂时不|别写/.test(text) || /job_/.test(text);
}

function isAffirmative(text: string, action: string, pending: PendingConfirm | null) {
  const value = text.trim();
  const jobId = pending?.payload?.jobId;
  if (action === "diff_fetch") {
    return /pull( the)? (diff|it)/i.test(value) || /^(yes|yeah|yep|sure|ok|okay)([, ]+pull it)?[.!]?$/i.test(value);
  }
  if (action === "pr_draft") {
    // D14: whole sentence only ("don't open the PR" must not confirm).
    return /^((yes|yeah|sure|ok|okay)[,\s]+)?open( the)? (pr|pull request)[.!]?$/i.test(value) || isWholeSentenceYes(value, jobId);
  }
  if (action === "write_doc") {
    return /write (it|that|the doc)/i.test(value) || isYes(value);
  }
  if (action === "create_issues") return /^((yes|yeah|sure|ok|okay)[,\s]+)?create (the )?issues[.!]?$/i.test(value) || isWholeSentenceYes(value, jobId); // D14
  if (action === "scaffold_code") return /^scaffold( it)?[.!]?$/i.test(value) || isWholeSentenceYes(value, jobId);
  if (action === "run_tests") return /run (the )?tests/i.test(value) || isYes(value);
  if (action === "confirm_conclusion") return isWholeSentenceYes(value, jobId);
  return false;
}

export function isChatter(text: string) {
  return (
    /\b(lunch|starving|hungry|coffee|weekend|weather|joke|haha|lol|dinner|breakfast)\b/i.test(text) ||
    /order lunch/i.test(text)
  );
}

export function extractActionItems(text: string): string[] {
  const splitAt = text.search(/action items?:\s*/i);
  const body = splitAt >= 0 ? text.slice(splitAt).replace(/action items?:\s*/i, "") : text;
  const normalized = body.replace(/,?\s+and\s+/gi, "|");
  const parts = normalized
    .split(/[|、，]|,\s+/)
    .map(cleanItem)
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [cleanItem(text)].filter(Boolean);
}

function cleanItem(value: string) {
  const trimmed = value.replace(/^[,\s]+|[.\s。!！]+$/g, "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function incidentContext(input: ClassifyInput) {
  return input.scenario !== "general";
}

function isIncidentRootCause(text: string) {
  return /that'?s the root cause/i.test(text) && /redis pool/i.test(text);
}

function isDecisionPhrase(text: string) {
  return /就这么定了|we decided|decision:|let's go with|we're going with|we are going with/i.test(text);
}

function decisionBody(text: string) {
  const marked = text.match(/就这么定了[:：]?\s*(.*)/);
  if (marked?.[1]?.trim()) return marked[1].trim();
  return text.trim();
}

export function classifyUtterance(input: ClassifyInput): Classification {
  const text = input.text.trim().replace(/\s+/g, " ");
  const { speaker } = input;
  const pending = choosePending(text, input.pending, input.queue);

  if (!text) {
    return plan("chatter", "Empty utterance", [], null, 0.2);
  }

  if (isInterrupt(text)) {
    return plan("interrupt", "Interrupt", [{ name: "checkpoint_rollback", arguments: {} }], REPLIES.interrupt, 0.99);
  }

  if (pending && isReject(text)) {
    return plan(
      "reject",
      "Confirmation declined",
      [
        ...heard(speaker, text, "reject"),
        pending.action === "confirm_conclusion"
          ? { name: "confirm_ask", arguments: { action: "clear", conclusionId: pending.payload?.conclusionId } }
          : { name: "confirm_ask", arguments: { action: "clear" } },
      ],
      "好的，不做了。你希望换成什么？",
    );
  }

  if (pending && isAffirmative(text, pending.action, pending)) {
    if (pending.action === "create_issues") {
      return plan(
        "confirm",
        "Create issues from the action items",
        [...heard(speaker, text, "confirm"), { name: "create_issues", arguments: pending.payload ?? {} }],
        "已根据待办创建 issue。",
      );
    }
    if (pending.action === "scaffold_code") {
      return plan(
        "confirm",
        "Scaffold the workspace and run tests",
        [
          ...heard(speaker, text, "confirm"),
          { name: "scaffold_code", arguments: pending.payload ?? {} },
          { name: "run_tests", arguments: {} },
        ],
        "脚手架已写入，测试已运行。",
      );
    }
    if (pending.action === "confirm_conclusion") {
      const payload = pending.payload ?? {};
      return plan(
        "confirm",
        "Record the confirmed seat conclusion",
        [
          ...heard(speaker, text, "confirm"),
          {
            name: "decision_record",
            arguments: { speaker, text: payload.recommendation ?? pending.prompt, conclusionId: payload.conclusionId },
          },
        ],
        "结论已写入决策记录。",
      );
    }
    if (pending.action === "run_tests") {
      return plan(
        "confirm",
        "Run the workspace tests",
        [...heard(speaker, text, "confirm"), { name: "run_tests", arguments: pending.payload ?? {} }],
        "测试已运行。",
      );
    }
    if (pending.action === "diff_fetch") {
      return plan(
        "confirm",
        "Pull the deploy diff",
        [...heard(speaker, text, "confirm"), { name: "diff_fetch", arguments: {} }],
        REPLIES.diff,
      );
    }
    if (pending.action === "pr_draft") {
      return plan(
        "confirm",
        "Open the fix pull request",
        [
          ...heard(speaker, text, "confirm"),
          { name: "scaffold_code", arguments: {} },
          { name: "pr_draft", arguments: {} },
          { name: "run_tests", arguments: {} },
          { name: "report_progress", arguments: {} },
        ],
        REPLIES.pr,
      );
    }
    if (pending.action !== "write_doc") {
      return plan("confirm", "Confirmation did not match a known action", heard(speaker, text, "confirm"), "我还需要一个更明确的确认。", 0.4);
    }
    const payload = pending.payload ?? {};
    return plan(
      "confirm",
      "Write the decision into the doc",
      [
        ...heard(speaker, text, "confirm"),
        {
          name: "write_doc",
          arguments: {
            title: payload.title ?? "Decision note",
            body: payload.body ?? pending.prompt,
          },
        },
      ],
      "已写入文档。",
    );
  }

  if (isChatter(text)) {
    return plan(
      "chatter",
      "Side conversation",
      [...heard(speaker, text, "chatter"), { name: "chatter_park", arguments: { speaker, text } }],
      null,
      0.97,
    );
  }

  if (/\baction items?\b|\btodos?\b/i.test(text)) {
    const items = extractActionItems(text);
    const tools = [
      ...heard(speaker, text, "todo"),
      ...items.map((item) => ({ name: "todo_add", arguments: { speaker, text: item } })),
    ];
    const reply =
      items.length === 2 ? REPLIES.todos : items.length === 1 ? "已记录 1 条待办。" : `已记录 ${items.length} 条待办。`;
    return plan("todo", items.join("; "), tools, reply);
  }

  const noted = text.match(/记一下[:：]?\s*(.*)/);
  if (noted) {
    const body = noted[1]?.trim();
    if (!body) {
      return plan("requirement", "Missing note", heard(speaker, text, "requirement"), "What should I note?", 0.7);
    }
    const item = cleanItem(body);
    return plan(
      "requirement",
      item,
      [...heard(speaker, text, "requirement"), { name: "requirement_add", arguments: { speaker, text: item } }],
      `Noted. ${item}`,
    );
  }

  if (incidentContext(input) && isIncidentRootCause(text)) {
    return plan(
      "decision",
      ROOT_CAUSE,
      [
        ...heard(speaker, text, "decision"),
        {
          name: "decision_record",
          arguments: { speaker, text: ROOT_CAUSE, requirements: FIX_REQUIREMENTS },
        },
        { name: "write_doc", arguments: {} },
        {
          name: "confirm_ask",
          arguments: { action: "pr_draft", prompt: REPLIES.decision },
        },
      ],
      REPLIES.decision,
    );
  }

  if (/root cause/i.test(text)) {
    const prompt = `Decision logged: ${text}. Want me to write it into the doc?`;
    return plan(
      "decision",
      text,
      [
        ...heard(speaker, text, "decision"),
        { name: "decision_record", arguments: { speaker, text } },
        {
          name: "confirm_ask",
          arguments: {
            action: "write_doc",
            prompt,
            payload: { title: "Decision note", body: text },
          },
        },
      ],
      prompt,
    );
  }

  if (isDecisionPhrase(text)) {
    const body = decisionBody(text);
    const prompt = `Decision logged: ${body}. Want me to write it into the doc?`;
    return plan(
      "decision",
      body,
      [
        ...heard(speaker, text, "decision"),
        { name: "decision_record", arguments: { speaker, text: body } },
        {
          name: "confirm_ask",
          arguments: {
            action: "write_doc",
            prompt,
            payload: { title: "Decision note", body },
          },
        },
      ],
      prompt,
    );
  }

  if (incidentContext(input) && /batch job|reconciliation|deployed last night|wasn'?t there a .*deploy/i.test(text)) {
    return plan(
      "deploy_query",
      "Look up the reconciliation deploy",
      [
        ...heard(speaker, text, "deploy_query"),
        { name: "deploy_lookup", arguments: { query: "reconciliation batch" } },
        {
          name: "confirm_ask",
          arguments: { action: "diff_fetch", prompt: REPLIES.deploy },
        },
      ],
      REPLIES.deploy,
    );
  }

  if (incidentContext(input) && /redis/i.test(text) && /(connection|grafana|climb|pressure|2:15|02:15)/i.test(text)) {
    return plan(
      "correlation",
      "Redis pressure preceded the errors",
      [
        ...heard(speaker, text, "correlation"),
        {
          name: "timeline_add",
          arguments: {
            speaker,
            timeLabel: "02:15",
            title: "Redis connections climbing",
            detail: "Grafana: Redis connections started climbing two minutes before the errors.",
            metrics: REDIS_METRICS,
          },
        },
        {
          name: "timeline_correlate",
          arguments: {
            fromTime: "02:15",
            toTime: "02:17",
            note: "Redis pressure started two minutes before the errors.",
          },
        },
      ],
      REPLIES.correlate,
    );
  }

  if (
    incidentContext(input) &&
    /pagerduty|orders? (service|api)|500s?|error/i.test(text) &&
    /(2:17|02:17|spiked|40%|woke)/i.test(text)
  ) {
    return plan(
      "event",
      "02:17 orders API 500 40%",
      [
        ...heard(speaker, text, "event"),
        {
          name: "timeline_add",
          arguments: {
            speaker,
            timeLabel: "02:17",
            title: "orders API 500 40%",
            detail: "PagerDuty: order service 500s spiked to 40%.",
          },
        },
      ],
      REPLIES.event,
    );
  }

  if (/we need|we should|must |requirement/i.test(text)) {
    const item = cleanItem(text);
    return plan(
      "requirement",
      item,
      [...heard(speaker, text, "requirement"), { name: "requirement_add", arguments: { speaker, text: item } }],
      `已记录需求：${item}`,
      0.74,
    );
  }

  const looksSocial =
    !claimNeedsEvidence(text) &&
    text.length < 80 &&
    !/\d/.test(text) &&
    !/api|service|redis|deploy|alert|flag|pool|test|scaffold|wireframe|architect|goal|milestone|spec|plan|code|research|verify|feasib/i.test(text) &&
    // B7: Chinese work keywords (no \b around CJK). Without these every Chinese work request was parked as chatter.
    !/规划|计划|里程碑|目标|设计|架构|接口|验证|校验|可行|调研|查一下|资料|选型|代码|实现|脚手架|测试|需求|模块|方案/.test(text);
  if (looksSocial) {
    return plan(
      "chatter",
      "Unscoped small talk",
      [...heard(speaker, text, "chatter"), { name: "chatter_park", arguments: { speaker, text } }],
      null,
      0.55,
    );
  }

  const item = cleanItem(text);
  return plan(
    "requirement",
    item,
    [...heard(speaker, text, "requirement"), { name: "requirement_add", arguments: { speaker, text: item } }],
    `已记录需求：${item}`,
    0.6,
  );
}
