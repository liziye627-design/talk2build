import { classifyUtterance, type ClassifyInput } from "@/lib/classifier";
import { TOOL_NAMES } from "@/lib/tools";
import type { Classification, UtteranceKind } from "@/lib/types";

const KINDS = new Set<UtteranceKind>([
  "event",
  "correlation",
  "deploy_query",
  "confirm",
  "reject",
  "decision",
  "todo",
  "chatter",
  "requirement",
  "interrupt",
]);

const ALLOWED = new Set<string>(TOOL_NAMES);

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Model response did not contain a JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parsePlan(raw: string, input: ClassifyInput): Classification {
  const value = extractJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plan JSON must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || !KINDS.has(record.kind as UtteranceKind)) {
    throw new Error("Plan is missing a known kind.");
  }
  const tools = Array.isArray(record.tools) ? record.tools : [];
  const planned = tools.map((tool) => {
    if (!tool || typeof tool !== "object") throw new Error("Tool entry is not an object.");
    const entry = tool as Record<string, unknown>;
    if (typeof entry.name !== "string" || !ALLOWED.has(entry.name)) {
      throw new Error(`Unknown tool in plan: ${String(entry.name)}`);
    }
    const args =
      entry.arguments && typeof entry.arguments === "object" && !Array.isArray(entry.arguments)
        ? (entry.arguments as Record<string, unknown>)
        : {};
    return { name: entry.name, arguments: args };
  });
  const reply = record.reply === null || typeof record.reply === "string" ? record.reply : null;
  const silent = typeof record.silent === "boolean" ? record.silent : reply === null;
  if (planned.length === 0 && record.kind !== "interrupt") {
    const fallback = classifyUtterance(input);
    return { ...fallback, reply: reply ?? fallback.reply, silent };
  }
  return {
    kind: record.kind as UtteranceKind,
    confidence: typeof record.confidence === "number" ? record.confidence : 0.7,
    summary: typeof record.summary === "string" ? record.summary : input.text,
    tools: planned,
    reply,
    silent,
  };
}

export function plannerPrompt(input: ClassifyInput & { stateSummary: string }) {
  const system = [
    "You are Alexa+, the voice front-end for Talk2Build.",
    "A meeting is in progress. Choose MCP tools and a short spoken reply.",
    "Return one JSON object with keys kind, summary, reply, silent, tools.",
    "tools is an array of { name, arguments }.",
    "kind is one of: event, correlation, deploy_query, confirm, reject, decision, todo, chatter, requirement, interrupt.",
    "Chatter is silent: reply null, silent true, and the only side effect is chatter_park.",
    "Explicit 记一下 files a requirement. 就这么定了 records a decision.",
    "stop and 不对 are interrupts and call checkpoint_rollback.",
    "Do not open a pull request until the room confirms. Large actions use confirm_ask first.",
    "Docs can be written immediately.",
    "Known incident facts: batch-reconcile v2.3 deployed at 11:40 PM; max_connections changed from 50 to 20; command timeout was removed; errors spiked at 02:17; Redis connections climbed at 02:15.",
    `Allowed tools: ${TOOL_NAMES.join(", ")}.`,
  ].join(" ");
  const user = JSON.stringify({
    speaker: input.speaker,
    utterance: input.text,
    pending: input.pending,
    state: input.stateSummary,
  });
  return { system, user };
}
