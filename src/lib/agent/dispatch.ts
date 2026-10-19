import { ui } from "@/lib/ui-text";
import { draftArtifact, writeArtifact } from "@/lib/agent/artifacts";
import { agentModelLabel, extractMeetingTurn, resolveAgentBackend } from "@/lib/agent/model";
import { bindJobExecutor, ensureJobExecutor, getJobRunner } from "@/lib/agent/runner";
import type { AgentJob } from "@/lib/agent/types";
import { collectEvidenceCached } from "@/lib/evidence/cache";
import { debateFromEvidence, evidenceMarkdown, reviewFromEvidence, selectFromEvidence } from "@/lib/evidence/select";
import { memoryFor } from "@/lib/work-tools";
import { getStore } from "@/lib/meeting-store";
import { routeSeatUtterance, syncSeatParticipants } from "@/lib/seats/orchestrator";
import { executeTool } from "@/lib/tools";
import { parseTargets } from "@/lib/evidence/claim";
import { isDeferral } from "@/lib/classifier";
import type { MeetingState, WorkKind, WorkStatus, Workstream } from "@/lib/types";

/** C2: the card never shows the raw error (it can carry paths or provider detail); the server log keeps it. */
export const JOB_FAILED_SUMMARY = ui.agent.jobFailed;

function paceMs() {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return 0;
  const raw = Number(process.env.TALK2BUILD_JOB_PACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 420;
}

function sleep(ms: number, signal: AbortSignal) {
  if (ms === 0) {
    if (signal.aborted) throw abortError();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const error = new Error("Job cancelled.");
  error.name = "AbortError";
  return error;
}

const TERMINAL: ReadonlySet<WorkStatus> = new Set<WorkStatus>(["cancelled"]);

/**
 * B9: the single write path for job/card status. Cards are keyed by jobId; a card already in a terminal
 * state (cancelled, incl. failed) is never overwritten by a later write for the same job.
 */
export function setJobStatus(meetingId: string, draft: Omit<Workstream, "id" | "updatedAt"> & { id?: string }) {
  const store = getStore();
  const state = store.ensure(meetingId);
  const current = draft.jobId
    ? state.workstreams.find((item) => item.jobId === draft.jobId)
    : state.workstreams.find((item) => !item.jobId && item.kind === draft.kind && item.title === draft.title);
  if (current && draft.jobId && TERMINAL.has(current.status)) return current;
  const next: Workstream = {
    id: current?.id ?? `work_${state.seq + 1}`,
    kind: draft.kind,
    title: draft.title,
    status: draft.status,
    summary: draft.summary,
    artifactPath: draft.artifactPath ?? current?.artifactPath,
    progress: draft.progress,
    jobId: draft.jobId ?? current?.jobId,
    speaker: draft.speaker ?? current?.speaker,
    evidence: draft.evidence ?? current?.evidence,
    selection: draft.selection ?? current?.selection,
    debate: draft.debate ?? current?.debate,
    debateGenerated: draft.debateGenerated ?? current?.debateGenerated,
    evidenceCachedAt: draft.evidenceCachedAt,
    updatedAt: new Date().toISOString(),
  };
  state.seq += 1;
  state.workstreams = [next, ...state.workstreams.filter((item) => item.id !== next.id)];
  store.persist(meetingId);
  return next;
}

async function runMeetingJob(job: AgentJob, signal: AbortSignal) {
  const steps = ["Reading what was just said", "Drafting the artifact", "Saving it to the meeting"];
  try {
    if (job.kind === "evidence") {
      await runEvidenceJob(job, signal);
      return;
    }
    for (const step of steps) {
      if (signal.aborted) throw abortError();
      setJobStatus(job.meetingId, {
        kind: job.kind,
        title: job.title,
        status: "working",
        summary: `${job.speaker}: ${step}`,
        progress: step,
        jobId: job.id,
        speaker: job.speaker,
      });
      await sleep(paceMs(), signal);
    }
    const artifact = await draftArtifact(job);
    if (signal.aborted) throw abortError();
    const artifactPath = writeArtifact(job.meetingId, artifact);
    setJobStatus(job.meetingId, {
      kind: job.kind,
      title: job.title,
      status: "ready",
      summary: artifact.summary,
      artifactPath,
      progress: "Saved",
      jobId: job.id,
      speaker: job.speaker,
    });
    getStore().addTrace(job.meetingId, { tool: job.kind, ok: true, summary: artifact.summary });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      setJobStatus(job.meetingId, {
        kind: job.kind,
        title: job.title,
        status: "cancelled",
        summary: "Cancelled.",
        progress: "Cancelled",
        jobId: job.id,
        speaker: job.speaker,
      });
      return;
    }
    console.error(`[talk2build] job ${job.id} failed:`, error instanceof Error ? error.message : error);
    setJobStatus(job.meetingId, {
      kind: job.kind,
      title: job.title,
      status: "cancelled",
      summary: JOB_FAILED_SUMMARY,
      progress: "Failed",
      jobId: job.id,
      speaker: job.speaker,
    });
  }
}

async function runEvidenceJob(job: AgentJob, signal: AbortSignal) {
  if (signal.aborted) throw abortError();
  syncSeatParticipants(job.meetingId);
  setJobStatus(job.meetingId, {
    kind: "evidence",
    title: "Evidence",
    status: "working",
    summary: `${job.speaker}: fetching GitHub, npm, and PyPI.`,
    progress: "Fetching public sources",
    jobId: job.id,
    speaker: job.speaker,
  });
  const { report, cachedAt } = await collectEvidenceCached(job.brief, fetch, signal);
  if (signal.aborted) throw abortError();
  const selection = selectFromEvidence(report);
  const review = reviewFromEvidence(report, selection);
  const artifactPath = writeArtifact(job.meetingId, {
    path: "docs/evidence.md",
    summary: selection.recommendation,
    body: evidenceMarkdown(report, selection),
  });
  setJobStatus(job.meetingId, {
    kind: "evidence",
    title: "Evidence",
    status: "ready",
    summary: report.note || `${report.options.length} options fetched.`,
    artifactPath,
    progress: "Saved",
    jobId: job.id,
    speaker: job.speaker,
    evidence: report,
    evidenceCachedAt: cachedAt ?? undefined,
  });
  setJobStatus(job.meetingId, {
    kind: "selection",
    title: "Tech selection",
    status: "ready",
    // E10: a recommendation is never a decision; it waits for a human and is not written to decision_record.
    summary: `${ui.agent.pendingHuman}${selection.recommendation}`,
    progress: selection.confidence,
    speaker: job.speaker,
    selection,
  });
  setJobStatus(job.meetingId, {
    kind: "review",
    title: "Requirement review",
    status: "ready",
    summary: review,
    progress: "Saved",
    speaker: job.speaker,
  });
  getStore().addTrace(job.meetingId, { tool: "evidence", ok: true, summary: selection.recommendation });
}

/**
 * S9: debateFromEvidence is deterministic text built from the evidence card. It is attached to the
 * card as an annotation marked "基于证据自动生成" and is never spoken as a seat. The conclusion it
 * carries waits for a human (status "waiting") and is not written to decision_record.
 */
function publishDebate(meetingId: string, speaker: string) {
  const state = getStore().get(meetingId);
  const evidenceCard = state.workstreams.find((item) => item.kind === "evidence" && item.evidence);
  if (!evidenceCard) return;
  const selectionCard = state.workstreams.find((item) => item.kind === "selection" && item.selection);
  const debate = debateFromEvidence(evidenceCard.evidence, selectionCard?.selection);
  setJobStatus(meetingId, {
    kind: "conclusion",
    title: "Conclusion",
    status: "waiting",
    summary: `${ui.agent.pendingHuman}${debate.conclusion}`,
    progress: ui.agent.generatedFromEvidence,
    speaker,
    debate,
    debateGenerated: "evidence",
  });
}

ensureJobExecutor(runMeetingJob);

export function useDefaultJobRunner() {
  bindJobExecutor(runMeetingJob);
}

function meetingContext(state: MeetingState) {
  const decisions = state.decisions.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None yet.";
  const memory = memoryFor(state.transcript.at(-1)?.text || state.title);
  return [`Title: ${state.title}`, "Decisions in this meeting:", decisions, "Memory:", ...memory.decisions, ...memory.preferences].join("\n");
}

export interface AgentWorkResult {
  started: AgentJob[];
  waiting: AgentJob[];
  decisions: string[];
}

/** One spoken line for what the agent just picked up. Null when it picked up nothing. */
export function agentAck(result: AgentWorkResult | null | undefined): string | null {
  if (!result) return null;
  const evidence = result.started.find((item) => item.kind === "evidence");
  if (evidence) {
    const labels = parseTargets(evidence.brief).map((target) => target.label);
    return ui.replies.evidence(labels.join(ui.replies.and));
  }
  const waiting = result.waiting[0];
  if (waiting) return ui.replies.waitingYes(waiting.title);
  if (result.started.length) return ui.replies.onIt(result.started.map((item) => ui.tree.title[item.title] ?? item.title).join(", "));
  if (result.decisions[0]) return ui.replies.decisionNoted(result.decisions[0]);
  return null;
}

export async function prepareAgentWork(input: { meetingId: string; speaker: string; text: string }): Promise<AgentWorkResult | null> {
  const store = getStore();
  const state = store.ensure(input.meetingId);
  if (state.scenario !== "general") return null;
  const result: AgentWorkResult = { started: [], waiting: [], decisions: [] };
  // F2: @seat / debate requests go to the seat orchestrator before normal extraction.
  const seat = routeSeatUtterance(input);
  if (seat.offlineDebate) publishDebate(input.meetingId, input.speaker);
  if (seat.handled) return null;
  const extraction = await extractMeetingTurn({
    meetingId: input.meetingId,
    speaker: input.speaker,
    text: input.text,
    context: meetingContext(state),
  });
  if (extraction.chatter) return null;
  // B10: evaluated once per utterance; a deferral drops code / confirm-gated jobs from any extraction source.
  const deferred = isDeferral(input.text);
  for (const decision of extraction.decisions) {
    executeTool("decision_record", { meetingId: input.meetingId, speaker: decision.speaker, text: decision.text });
    result.decisions.push(decision.text);
  }
  for (const item of extraction.actionItems) {
    executeTool("todo_add", { meetingId: input.meetingId, speaker: item.speaker, text: item.text });
  }
  if (extraction.suggestion) rememberSuggestion(input.meetingId, extraction.suggestion);
  const research = extraction.jobs.find((item) => item.kind === "research");
  if (research) {
    const hit = memoryFor(research.brief).decisions[0];
    if (hit) rememberSuggestion(input.meetingId, `From earlier: ${hit}`);
  }
  for (const extracted of extraction.jobs) {
    // B9 side fix: job ids are derived from title+brief, so repeating a request reused the old id and card.
    const taken = (id: string) => store.get(input.meetingId).workstreams.some((w) => w.jobId === id) || store.get(input.meetingId).confirmQueue.some((q) => q.payload?.jobId === id);
    if (deferred && (extracted.kind === "code" || extracted.needsConfirm)) continue;
    const item = taken(extracted.id) ? { ...extracted, id: `${extracted.id}-${store.get(input.meetingId).seq + 1}` } : extracted;
    if (item.needsConfirm || item.kind === "code") {
      const prompt = `I'll scaffold ${item.title}. ${item.brief} Say yes to confirm ${item.id}.`;
      executeTool("confirm_ask", {
        meetingId: input.meetingId,
        action: "scaffold_code",
        prompt,
        payload: { prompt: item.brief, jobId: item.id, title: item.title },
      });
      setJobStatus(input.meetingId, {
        kind: "code",
        title: item.title,
        status: "waiting",
        summary: prompt,
        progress: "Waiting for a yes",
        jobId: item.id,
        speaker: item.speaker,
      });
      result.waiting.push(item);
      continue;
    }
    setJobStatus(input.meetingId, {
      kind: item.kind as WorkKind,
      title: item.title,
      status: "working" as WorkStatus,
      summary: `${item.speaker} asked for ${item.title.toLowerCase()}.`,
      progress: "Queued",
      jobId: item.id,
      speaker: item.speaker,
    });
    getJobRunner().start(item);
    result.started.push(item);
  }
  store.addTrace(input.meetingId, {
    tool: "agent_extract",
    ok: true,
    summary: `${resolveAgentBackend()} · ${agentModelLabel()} · ${extraction.jobs.length} jobs`,
  });
  return result;
}

function rememberSuggestion(meetingId: string, text: string) {
  const store = getStore();
  const state = store.ensure(meetingId);
  if (state.suggestions.some((item) => item.text === text)) return;
  state.suggestions = [{ id: `sug_${state.seq + 1}`, text, at: new Date().toISOString() }, ...state.suggestions].slice(0, 6);
  state.seq += 1;
  store.persist(meetingId);
}

export function cancelAgentJob(meetingId: string, jobId: string) {
  const cancelled = getJobRunner().cancel(jobId);
  const state = getStore().ensure(meetingId);
  const card = state.workstreams.find((item) => item.jobId === jobId);
  if (card && card.status === "working") {
    setJobStatus(meetingId, { ...card, status: "cancelled", summary: "Cancelled.", progress: "Cancelled" });
  }
  return cancelled || Boolean(card);
}

export function cancelMeetingJobs(meetingId: string) {
  getJobRunner().cancelMeeting(meetingId);
  const state = getStore().ensure(meetingId);
  for (const card of state.workstreams) {
    if (card.status === "working") {
      setJobStatus(meetingId, { ...card, status: "cancelled", summary: "Cancelled when the meeting ended.", progress: "Cancelled" });
    }
  }
}
