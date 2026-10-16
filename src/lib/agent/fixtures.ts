import type { AgentJob, Extraction } from "@/lib/agent/types";
import { claimNeedsEvidence } from "@/lib/evidence/claim";

const JOB_KINDS = new Set(["plan", "design", "verify", "research", "code", "evidence", "selection", "review", "conclusion"]);

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
}

function job(meetingId: string, speaker: string, kind: AgentJob["kind"], title: string, brief: string, needsConfirm = false): AgentJob {
  return {
    id: `job_${meetingId}_${kind}_${slug(title)}_${slug(brief).slice(0, 24)}`,
    meetingId,
    kind,
    title,
    brief,
    speaker,
    needsConfirm: kind === "code" ? true : needsConfirm,
  };
}

function base(speaker: string, meetingId: string, jobs: AgentJob[], extra: Partial<Extraction> = {}): Extraction {
  return {
    speaker,
    intents: jobs.map((item) => ({ kind: item.kind, summary: item.title, speaker })),
    decisions: extra.decisions ?? [],
    actionItems: extra.actionItems ?? [],
    jobs,
    chatter: extra.chatter ?? null,
    suggestion: extra.suggestion ?? null,
  };
}

/** Recorded extractions for the billing-export working session. */
export function recordedExtraction(meetingId: string, speaker: string, text: string): Extraction | null {
  if (/goal for this meeting/i.test(text)) {
    return base(speaker, meetingId, [job(meetingId, speaker, "plan", "Plan", text)], {
      decisions: [{ text: "Ship the billing export as a nightly job.", speaker }],
      actionItems: [
        { text: "Ship the flag for the nightly billing export.", speaker },
        { text: "Write the runbook.", speaker },
      ],
    });
  }
  if (/sketch the architecture/i.test(text)) {
    return base(speaker, meetingId, [
      job(meetingId, speaker, "design", "Architecture", text),
      job(meetingId, speaker, "design", "API spec", text),
    ]);
  }
  if (/wireframe/i.test(text)) {
    return base(speaker, meetingId, [job(meetingId, speaker, "design", "Settings wireframe", text)]);
  }
  if (/lunch|starving/i.test(text)) {
    return base(speaker, meetingId, [], { chatter: text });
  }
  if (/feasible|already decided|pull what/i.test(text)) {
    return base(speaker, meetingId, [
      job(meetingId, speaker, "verify", "Feasibility", text),
      job(meetingId, speaker, "research", "Research", text),
    ]);
  }
  if (/run the tests once the scaffold is in/i.test(text)) {
    return base(speaker, meetingId, [job(meetingId, speaker, "code", "Export checker", text, true)]);
  }
  return null;
}

// Chinese keywords are deliberately not wrapped in \b (ASCII-only boundary, never matches CJK).
const CODE_PATTERN = /scaffold|run (the )?tests|write (the )?code|写代码|写.{0,12}代码|实现一下|生成代码|搭.{0,6}脚手架|跑一下测试|运行测试/i;
const PLAN_PATTERN = /\b(goal|milestone|plan)\b|规划|计划|里程碑|目标/i;
const DESIGN_PATTERN = /architect|diagram|worker|设计|架构|画.{0,4}图/i;
const VERIFY_PATTERN = /feasib|validate|check that|verify|验证|校验|可行/i;
const RESEARCH_PATTERN = /already decided|look up|what did we|reference|research|pull what|调研|查一下|查查|资料|选型|哪个.{0,8}库/i;

function codeClauses(text: string) {
  const pieces = text
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const hits = pieces.filter((part) => CODE_PATTERN.test(part));
  if (hits.length > 1) return hits;
  if (CODE_PATTERN.test(text)) return [text.replace(/\s+/g, " ").trim()];
  return [];
}

export function keywordExtraction(meetingId: string, speaker: string, text: string): Extraction {
  const recorded = recordedExtraction(meetingId, speaker, text);
  if (recorded) return recorded;
  const jobs: AgentJob[] = [];
  if (PLAN_PATTERN.test(text)) jobs.push(job(meetingId, speaker, "plan", "Plan", text));
  const designText = text.replace(/@architect\b/gi, "");
  if (/wireframe|mockup|settings screen/i.test(designText)) jobs.push(job(meetingId, speaker, "design", "Settings wireframe", text));
  else if (DESIGN_PATTERN.test(designText)) jobs.push(job(meetingId, speaker, "design", "Architecture", text));
  if (/\bAPI\b|endpoint|POST \//i.test(text)) jobs.push(job(meetingId, speaker, "design", "API spec", text));
  if (VERIFY_PATTERN.test(text)) jobs.push(job(meetingId, speaker, "verify", "Feasibility", text));
  if (RESEARCH_PATTERN.test(text)) {
    jobs.push(job(meetingId, speaker, "research", "Research", text));
  }
  for (const clause of codeClauses(text)) {
    const title = clause.replace(/\s+/g, " ").trim().slice(0, 80) || "Code";
    jobs.push(job(meetingId, speaker, "code", title, clause, true));
  }
  if (claimNeedsEvidence(text)) jobs.push(job(meetingId, speaker, "evidence", "Evidence", text));
  return base(speaker, meetingId, jobs);
}

export function parseExtraction(raw: string, meetingId: string, speaker: string, text: string): Extraction {
  const parsed = JSON.parse(extractObject(raw)) as Record<string, unknown>;
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const built = jobs.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    if (!JOB_KINDS.has(kind)) return [];
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : kind;
    const brief = typeof record.brief === "string" && record.brief.trim() ? record.brief.trim() : text;
    return [
      job(
        meetingId,
        typeof record.speaker === "string" ? record.speaker : speaker,
        kind as AgentJob["kind"],
        title,
        brief,
        record.needsConfirm === true,
      ),
    ].map((item) => ({ ...item, id: `${item.id}-${index}` }));
  });
  const readList = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Record<string, unknown>;
          if (typeof record.text !== "string" || !record.text.trim()) return [];
          return [{ text: record.text.trim(), speaker: typeof record.speaker === "string" ? record.speaker : speaker }];
        })
      : [];
  return {
    speaker,
    intents: readList(parsed.intents).map((item) => ({ kind: "intent", summary: item.text, speaker: item.speaker })),
    decisions: readList(parsed.decisions),
    actionItems: readList(parsed.actionItems),
    jobs: built,
    chatter: typeof parsed.chatter === "string" ? parsed.chatter : null,
    suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion : null,
  };
}

function extractObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model response did not contain a JSON object.");
  return candidate.slice(start, end + 1);
}
