import type { EvidenceReport } from "@/lib/evidence/types";
import { metricValueText } from "@/lib/evidence/display";
import type { Citation, MeetingState, SeatId, SeatTurn } from "@/lib/types";
import { seatLabel } from "@/lib/seats/roster";

const SHARED = [
  "You are a seat in a live engineering meeting. You only discuss. You never run code, call tools, or write anything (S8).",
  "Cite only refIds listed in Context. Never invent a refId.",
  "Use only numbers that appear verbatim in Context. If an evidence item says 数据不可用, say 数据不可用 and give no number.",
  "Answer in Chinese, at most 3 sentences.",
  'Return JSON only: {"text": string, "citations": [refId, ...]}.',
].join(" ");

export const SEAT_SYSTEM: Record<SeatId, string> = {
  architect: `You are AI 架构师. Focus on the proposal, interfaces and trade-offs. ${SHARED}`,
  skeptic: `You are AI 质疑者. Focus on risks, failure cases, counter-examples and cost. ${SHARED}`,
};

export const CONCLUSION_SYSTEM = [
  "You close a debate between AI 架构师 and AI 质疑者. You only summarise; you never decide for the humans.",
  "Cite only refIds listed in Context. Use only numbers that appear verbatim in Context.",
  'Return JSON only: {"recommendation": string, "reasons": string[<=3], "risks": string[<=3], "humanDecisions": string[], "citations": [refId, ...]}.',
].join(" ");

export interface CitationContext {
  citations: Citation[];
  lines: string[];
}

function evidenceLines(report: EvidenceReport) {
  const lines: string[] = [];
  for (const option of report.options) {
    for (const metric of option.metrics) {
      const value = metricValueText(metric);
      lines.push(`${option.label} ${metric.name}: ${value ?? "数据不可用"}`);
    }
  }
  return lines;
}

/** S3: everything a seat may cite. Failed evidence carries no number (case 10). */
export function buildCitationContext(state: MeetingState): CitationContext {
  const citations: Citation[] = [];
  const lines: string[] = [];
  for (const item of state.decisions) {
    citations.push({ kind: "decision", refId: item.id, label: item.text });
    lines.push(`[${item.id}] decision: ${item.text}`);
  }
  for (const item of state.requirements) {
    citations.push({ kind: "requirement", refId: item.id, label: item.text });
    lines.push(`[${item.id}] requirement: ${item.text}`);
  }
  for (const card of state.workstreams) {
    if (card.kind !== "evidence" || !card.evidence) continue;
    citations.push({ kind: "evidence", refId: card.id, label: card.evidence.claim });
    lines.push(`[${card.id}] evidence for "${card.evidence.claim}":`, ...evidenceLines(card.evidence).map((line) => `  ${line}`));
  }
  return { citations, lines };
}

export function seatUserPrompt(input: { question: string; context: CitationContext; transcript: SeatTurn[] }) {
  const turns = input.transcript.map((turn) => `${seatLabel(turn.seatId)}: ${turn.text}`);
  return ["Question or topic:", input.question, "", "Context:", ...(input.context.lines.length ? input.context.lines : ["(none)"]), "", "Debate so far:", ...(turns.length ? turns : ["(none)"])].join("\n");
}

function extractObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Case 9: refIds not in context are dropped. */
export function keepKnownCitations(refIds: unknown, context: CitationContext): Citation[] {
  if (!Array.isArray(refIds)) return [];
  const out: Citation[] = [];
  for (const ref of refIds) {
    const hit = context.citations.find((item) => item.refId === ref);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function strings(value: unknown, max: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, max) : [];
}

export function parseSeatReply(raw: string, context: CitationContext): { text: string; citations: Citation[] } | null {
  const body = extractObject(raw);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return null;
  return { text, citations: keepKnownCitations(body?.citations, context) };
}

export function parseConclusion(raw: string, context: CitationContext) {
  const body = extractObject(raw);
  const recommendation = typeof body?.recommendation === "string" ? body.recommendation.trim() : "";
  if (!recommendation) return null;
  return {
    recommendation,
    reasons: strings(body?.reasons, 3),
    risks: strings(body?.risks, 3),
    humanDecisions: strings(body?.humanDecisions, 5),
    citations: keepKnownCitations(body?.citations, context),
  };
}
