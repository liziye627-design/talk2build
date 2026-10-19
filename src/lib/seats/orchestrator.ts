import { ui } from "@/lib/ui-text";
import { draftWithModel, resolveAgentBackend } from "@/lib/agent/model";
import { getStore, type MeetingStore } from "@/lib/meeting-store";
import { CONCLUSION_SYSTEM, SEAT_SYSTEM, buildCitationContext, parseConclusion, parseSeatReply, seatUserPrompt } from "@/lib/seats/prompts";
import { MENTION_HINT, ensureSeatParticipants, parseMentions, seatLabel } from "@/lib/seats/roster";
import { executeTool } from "@/lib/tools";
import type { ConclusionCard, MeetingState, SeatId, SeatRequest, SeatTurn } from "@/lib/types";

/** A seat model call. Returns null when the model is unavailable or failed; never throws for model errors. */
export type SeatModel = (system: string, user: string, signal: AbortSignal) => Promise<string | null>;

export const DEFAULT_ROUNDS = 2;
export const MAX_ROUNDS = 3;

/** S3: rounds are configurable, default 2, at most 3, at least 1. */
export function clampRounds(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ROUNDS;
  return Math.min(MAX_ROUNDS, Math.max(1, Math.round(value)));
}

interface SeatGlobal {
  __talk2buildSeats?: {
    model: SeatModel | null;
    availability: "online" | "offline" | null;
    running: Map<string, { controller: AbortController; done: Promise<void> }>;
  };
}

function runtime() {
  const g = globalThis as typeof globalThis & SeatGlobal;
  if (!g.__talk2buildSeats) g.__talk2buildSeats = { model: null, availability: null, running: new Map() };
  return g.__talk2buildSeats;
}

/** Test hook: inject a model and/or force availability. Pass nulls to restore defaults. */
export function configureSeats(input: { model?: SeatModel | null; availability?: "online" | "offline" | null }) {
  const rt = runtime();
  if (input.model !== undefined) rt.model = input.model;
  if (input.availability !== undefined) rt.availability = input.availability;
}

export function resetSeats() {
  const rt = runtime();
  for (const run of rt.running.values()) run.controller.abort();
  rt.running.clear();
  rt.model = null;
  rt.availability = null;
}

/** S6: no model key → offline. Demo playback (TALK2BUILD_DEMO) is not implemented in v1, so it also reports offline. */
export function seatAvailability(): "online" | "offline" {
  const forced = runtime().availability;
  if (forced) return forced;
  return resolveAgentBackend() === "fixture" ? "offline" : "online";
}

function timeoutMs() {
  const raw = Number(process.env.TALK2BUILD_SEAT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

function abortError() {
  const error = new Error("Seat debate stopped.");
  error.name = "AbortError";
  return error;
}

const defaultModel: SeatModel = async (system, user) => (await draftWithModel(system, user)).text;

/** One model call with a per-call timeout (spec: ≤20s per turn) and the stop signal. */
async function callModel(system: string, user: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) throw abortError();
  const model = runtime().model ?? defaultModel;
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(), timeoutMs());
  const onAbort = () => local.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await Promise.race([
      model(system, user, local.signal).catch(() => null),
      new Promise<null>((resolve) => local.signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]);
    if (signal.aborted) throw abortError();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export function syncSeatParticipants(meetingId: string) {
  const store = getStore();
  const state = store.ensure(meetingId);
  const next = ensureSeatParticipants(state.participants, seatAvailability());
  if (JSON.stringify(next) === JSON.stringify(state.participants)) return;
  state.participants = next;
  store.persist(meetingId);
}

function setSpeaking(meetingId: string, seatId: SeatId | null) {
  const store = getStore();
  const state = store.ensure(meetingId);
  const base = seatAvailability();
  for (const person of state.participants) {
    if (person.kind === "ai") person.aiStatus = person.seatId === seatId ? "speaking" : base;
  }
  store.persist(meetingId);
}

function notice(meetingId: string, text: string) {
  getStore().ingest(meetingId, { speaker: "Alexa", text, kind: "seat_status" });
}

/** S6 offline reply. Never produces seat content. */
export function offlineNotice(meetingId: string, seats: SeatId[]) {
  notice(meetingId, ui.seats.offline(seats.map(seatLabel).join(ui.seats.join)));
}

async function askSeat(
  meetingId: string,
  seatId: SeatId,
  question: string,
  debateId: string | null,
  round: number,
  signal: AbortSignal,
): Promise<SeatTurn | null> {
  const state = getStore().get(meetingId);
  const context = buildCitationContext(state);
  const transcript = debateId ? (state.seatTurns ?? []).filter((turn) => turn.debateId === debateId) : [];
  setSpeaking(meetingId, seatId);
  try {
    const raw = await callModel(SEAT_SYSTEM[seatId], seatUserPrompt({ question, context, transcript }), signal);
    const reply = raw ? parseSeatReply(raw, context) : null;
    if (!reply) {
      notice(meetingId, ui.seats.unavailable(seatLabel(seatId)));
      return null;
    }
    const turn = getStore().addSeatTurn(meetingId, { seatId, debateId, round, text: reply.text, citations: reply.citations, status: "done" });
    getStore().ingest(meetingId, { speaker: seatLabel(seatId), text: reply.text, kind: "seat" });
    return turn;
  } finally {
    setSpeaking(meetingId, null);
  }
}

async function runDebate(meetingId: string, topic: string, maxRounds: number, signal: AbortSignal) {
  const store = getStore();
  const rounds = clampRounds(maxRounds);
  const debate = store.createDebate(meetingId, { topic, maxRounds: rounds });
  try {
    for (let round = 1; round <= rounds; round += 1) {
      store.updateDebate(meetingId, debate.id, { round });
      for (const seatId of ["architect", "skeptic"] as SeatId[]) {
        const turn = await askSeat(meetingId, seatId, topic, debate.id, round, signal);
        if (!turn) {
          store.updateDebate(meetingId, debate.id, { status: "failed" });
          return;
        }
        const current = store.get(meetingId).seatDebates?.find((item) => item.id === debate.id);
        store.updateDebate(meetingId, debate.id, { turns: [...(current?.turns ?? []), turn.id] });
      }
    }
    const state = store.get(meetingId);
    const context = buildCitationContext(state);
    const transcript = (state.seatTurns ?? []).filter((turn) => turn.debateId === debate.id);
    const raw = await callModel(CONCLUSION_SYSTEM, seatUserPrompt({ question: topic, context, transcript }), signal);
    const parsed = raw ? parseConclusion(raw, context) : null;
    if (!parsed) {
      store.updateDebate(meetingId, debate.id, { status: "failed" });
      notice(meetingId, ui.seats.noConclusion);
      return;
    }
    const card = store.addConclusion(meetingId, { ...parsed, debateId: debate.id, topic, status: "pending" });
    store.updateDebate(meetingId, debate.id, { status: "concluded", conclusionId: card.id });
    askConclusion(meetingId, card);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      store.updateDebate(meetingId, debate.id, { status: "interrupted" });
      return;
    }
    store.updateDebate(meetingId, debate.id, { status: "failed" });
    throw error;
  }
}

/** S4: the card enters confirmQueue with its own id; yes binds to that id only. */
function askConclusion(meetingId: string, card: ConclusionCard) {
  executeTool("confirm_ask", {
    meetingId,
    action: "confirm_conclusion",
    prompt: ui.seats.confirmConclusion(card.recommendation, card.id),
    payload: { jobId: card.id, conclusionId: card.id, recommendation: card.recommendation, topic: card.topic },
  });
}

async function processRequest(meetingId: string, request: SeatRequest, signal: AbortSignal) {
  if (request.kind === "debate") {
    await runDebate(meetingId, request.topic ?? request.text, DEFAULT_ROUNDS, signal);
    return;
  }
  for (const seatId of request.seats) await askSeat(meetingId, seatId, request.text, null, 0, signal);
}

function startPump(meetingId: string, first: SeatRequest) {
  const rt = runtime();
  const controller = new AbortController();
  const done = (async () => {
    let next: SeatRequest | undefined = first;
    try {
      while (next && !controller.signal.aborted) {
        await processRequest(meetingId, next, controller.signal).catch((error: unknown) => {
          if (!(error instanceof Error && error.name === "AbortError")) {
            console.error("[talk2build] seat request failed:", error instanceof Error ? error.message : error);
          }
        });
        if (controller.signal.aborted) break;
        const queue = getStore().get(meetingId).seatQueue ?? [];
        next = queue[0];
        getStore().setSeatQueue(meetingId, queue.slice(1));
      }
    } finally {
      rt.running.delete(meetingId);
    }
  })();
  rt.running.set(meetingId, { controller, done });
}

export function seatsBusy(meetingId: string) {
  return runtime().running.has(meetingId);
}

export async function whenSeatsIdle(meetingId: string) {
  for (;;) {
    const run = runtime().running.get(meetingId);
    if (!run) return;
    await run.done;
  }
}

/** S5: stop aborts the running request, marks it interrupted and empties the queue. */
export function stopSeats(meetingId: string) {
  const run = runtime().running.get(meetingId);
  const store = getStore();
  const state = store.get(meetingId);
  const hadQueue = (state.seatQueue ?? []).length > 0;
  if (hadQueue) store.setSeatQueue(meetingId, []);
  if (!run) return hadQueue;
  run.controller.abort();
  for (const debate of state.seatDebates ?? []) {
    if (debate.status === "running") store.updateDebate(meetingId, debate.id, { status: "interrupted" });
  }
  setSpeaking(meetingId, null);
  return true;
}

/**
 * Entry from prepareAgentWork. Returns true when the utterance was a seat request
 * (so normal extraction must not also turn it into job cards).
 */
export function routeSeatUtterance(input: { meetingId: string; speaker: string; text: string }): {
  handled: boolean;
  offlineDebate: boolean;
} {
  const parsed = parseMentions(input.text);
  if (parsed.seats.length === 0) {
    if (parsed.unknown.length === 0) return { handled: false, offlineDebate: false };
    const humans = getStore().get(input.meetingId).participants.map((person) => person.label.toLowerCase());
    const missing = parsed.unknown.filter((name) => !humans.includes(name.toLowerCase()));
    if (missing.length === 0) return { handled: false, offlineDebate: false };
    notice(input.meetingId, ui.seats.unknownSeat(missing.map((name) => `@${name}`).join(ui.seats.join), MENTION_HINT));
    return { handled: true, offlineDebate: false };
  }
  syncSeatParticipants(input.meetingId);
  if (seatAvailability() === "offline") {
    offlineNotice(input.meetingId, parsed.seats);
    return { handled: true, offlineDebate: parsed.debateTopic !== null };
  }
  const request: SeatRequest = {
    id: `seatreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: parsed.debateTopic !== null ? "debate" : "ask",
    seats: parsed.seats,
    text: parsed.rest || input.text,
    topic: parsed.debateTopic,
    speaker: input.speaker,
    at: new Date().toISOString(),
  };
  if (seatsBusy(input.meetingId)) {
    const queue = getStore().get(input.meetingId).seatQueue ?? [];
    getStore().setSeatQueue(input.meetingId, [...queue, request]);
    return { handled: true, offlineDebate: false };
  }
  startPump(input.meetingId, request);
  return { handled: true, offlineDebate: false };
}

type SeatSnapshot = Pick<MeetingState, "seatTurns" | "seatDebates" | "conclusions" | "seatQueue" | "transcript">;

export function keepSeatState(state: MeetingState): SeatSnapshot {
  return structuredClone({
    seatTurns: state.seatTurns,
    seatDebates: state.seatDebates,
    conclusions: state.conclusions,
    seatQueue: state.seatQueue,
    transcript: state.transcript.filter((line) => line.kind === "seat" || line.kind === "seat_status"),
  });
}

/** Re-applies seat output after checkpoint_rollback restored an older snapshot. */
export function restoreSeatState(store: MeetingStore, meetingId: string, kept: SeatSnapshot) {
  const state = store.get(meetingId);
  state.seatTurns = kept.seatTurns;
  state.seatDebates = kept.seatDebates;
  state.conclusions = kept.conclusions;
  state.seatQueue = kept.seatQueue;
  const have = new Set(state.transcript.map((line) => line.id));
  state.transcript = [...state.transcript, ...kept.transcript.filter((line) => !have.has(line.id))];
  store.persist(meetingId);
}
