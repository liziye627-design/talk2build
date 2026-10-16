import type { Participant, SeatId } from "@/lib/types";

export interface SeatDefinition {
  id: SeatId;
  label: string;
  aliases: string[];
}

export const SEATS: SeatDefinition[] = [
  { id: "architect", label: "AI 架构师", aliases: ["架构师", "architect"] },
  { id: "skeptic", label: "AI 质疑者", aliases: ["质疑者", "skeptic", "challenger"] },
];

export function seatLabel(id: SeatId) {
  return SEATS.find((seat) => seat.id === id)?.label ?? id;
}

export interface MentionParse {
  seats: SeatId[];
  unknown: string[];
  debateTopic: string | null;
  /** Text with every @mention removed. */
  rest: string;
}

const MENTION = /[@＠]([\p{L}\p{N}_-]+)/gu;
const DEBATE_WORD = /(辩一下|辩论|debate)/i;

/** S2/S3: full-width or half-width @, case-insensitive, Chinese and English aliases. */
/** B5: "@AI 架构师" / "@ AI质疑者" (display names, with or without the space) collapse to the bare alias. */
function normalizeSeatNames(text: string) {
  return text.replace(/[@＠]\s*AI\s*(架构师|质疑者)/gi, "@$1");
}

/** Names that actually parse, for the "seat does not exist" hint. */
export const MENTION_HINT = "@AI 架构师 / @架构师 / @architect、@AI 质疑者 / @质疑者 / @skeptic";

export function parseMentions(input: string): MentionParse {
  const text = normalizeSeatNames(input);
  const seats: SeatId[] = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const name = (match[1] ?? "").toLowerCase();
    const seat = SEATS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === name));
    if (seat) {
      if (!seats.includes(seat.id)) seats.push(seat.id);
    } else if (!unknown.includes(match[1] ?? "")) {
      unknown.push(match[1] ?? "");
    }
  }
  const rest = text.replace(MENTION, " ").replace(/\s+/g, " ").trim();
  let debateTopic: string | null = null;
  if (seats.length === 2) {
    const hit = rest.match(DEBATE_WORD);
    if (hit && hit.index != null) {
      const after = rest.slice(hit.index + hit[0].length).replace(/^[\s:：,，]+/, "").trim();
      debateTopic = after || rest.replace(DEBATE_WORD, "").trim() || "当前分支";
    }
  }
  return { seats, unknown, debateTopic, rest };
}

export function seatParticipant(seat: SeatDefinition, aiStatus: NonNullable<Participant["aiStatus"]>): Participant {
  return { id: `p_seat_${seat.id}`, name: seat.label, label: seat.label, micOn: false, present: true, kind: "ai", seatId: seat.id, aiStatus };
}

/** S1: both seats sit in the participant list, marked as AI. Replaces dispatch.ts seatEngineers. */
export function ensureSeatParticipants(participants: Participant[], aiStatus: NonNullable<Participant["aiStatus"]>) {
  const humans = participants.filter((person) => person.kind !== "ai" && person.label !== "Architect" && person.label !== "Skeptic");
  const seats = SEATS.map((seat) => {
    const existing = participants.find((person) => person.seatId === seat.id);
    const status = existing?.aiStatus === "speaking" ? "speaking" : aiStatus;
    return seatParticipant(seat, status);
  });
  return [...humans, ...seats];
}
