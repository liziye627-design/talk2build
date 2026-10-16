import { draftArtifact, writeArtifact } from "@/lib/agent/artifacts";
import { agentModelLabel, extractMeetingTurn, resolveAgentBackend } from "@/lib/agent/model";
import { bindJobExecutor, getJobRunner } from "@/lib/agent/runner";
import type { AgentJob } from "@/lib/agent/types";
import { memoryFor } from "@/lib/work-tools";
import { getStore } from "@/lib/meeting-store";
import { executeTool } from "@/lib/tools";
import type { MeetingState, WorkKind, WorkStatus, Workstream } from "@/lib/types";

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

function publish(meetingId: string, draft: Omit<Workstream, "id" | "updatedAt"> & { id?: string }) {
  const store = getStore();
  const state = store.ensure(meetingId);
  const current = state.workstreams.find((item) => item.kind === draft.kind && item.title === draft.title);
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
    for (const step of steps) {
      if (signal.aborted) throw abortError();
      publish(job.meetingId, {
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
    publish(job.meetingId, {
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
      publish(job.meetingId, {
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
    publish(job.meetingId, {
      kind: job.kind,
      title: job.title,
      status: "cancelled",
      summary: error instanceof Error ? error.message : "The job failed.",
      progress: "Failed",
      jobId: job.id,
      speaker: job.speaker,
    });
  }
}

bindJobExecutor(runMeetingJob);

export function useDefaultJobRunner() {
  bindJobExecutor(runMeetingJob);
}

function meetingContext(state: MeetingState) {
  const decisions = state.decisions.map((item) => `- ${item.text} (${item.speaker})`).join("\n") || "- None yet.";
  const memory = memoryFor(state.transcript.at(-1)?.text || state.title);
  return [`Title: ${state.title}`, "Decisions in this meeting:", decisions, "Memory:", ...memory.decisions, ...memory.preferences].join("\n");
}

export async function prepareAgentWork(input: { meetingId: string; speaker: string; text: string }) {
  const store = getStore();
  const state = store.ensure(input.meetingId);
  if (state.scenario !== "general") return;
  const extraction = await extractMeetingTurn({
    meetingId: input.meetingId,
    speaker: input.speaker,
    text: input.text,
    context: meetingContext(state),
  });
  if (extraction.chatter) return;
  for (const decision of extraction.decisions) {
    executeTool("decision_record", { meetingId: input.meetingId, speaker: decision.speaker, text: decision.text });
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
  for (const item of extraction.jobs) {
    if (item.needsConfirm || item.kind === "code") {
      const prompt = "I'll scaffold the export checker and run its tests. Say yes.";
      executeTool("confirm_ask", {
        meetingId: input.meetingId,
        action: "scaffold_code",
        prompt,
        payload: { prompt: item.brief },
      });
      publish(input.meetingId, {
        kind: "code",
        title: item.title,
        status: "waiting",
        summary: prompt,
        progress: "Waiting for a yes",
        jobId: item.id,
        speaker: item.speaker,
      });
      continue;
    }
    publish(input.meetingId, {
      kind: item.kind as WorkKind,
      title: item.title,
      status: "working" as WorkStatus,
      summary: `${item.speaker} asked for ${item.title.toLowerCase()}.`,
      progress: "Queued",
      jobId: item.id,
      speaker: item.speaker,
    });
    getJobRunner().start(item);
  }
  store.addTrace(input.meetingId, {
    tool: "agent_extract",
    ok: true,
    summary: `${resolveAgentBackend()} · ${agentModelLabel()} · ${extraction.jobs.length} jobs`,
  });
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
    publish(meetingId, { ...card, status: "cancelled", summary: "Cancelled.", progress: "Cancelled" });
  }
  return cancelled || Boolean(card);
}

export function cancelMeetingJobs(meetingId: string) {
  getJobRunner().cancelMeeting(meetingId);
  const state = getStore().ensure(meetingId);
  for (const card of state.workstreams) {
    if (card.status === "working") {
      publish(meetingId, { ...card, status: "cancelled", summary: "Cancelled when the meeting ended.", progress: "Cancelled" });
    }
  }
}
