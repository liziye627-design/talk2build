import type { AgentJob } from "@/lib/agent/types";

export type JobExecute = (job: AgentJob, signal: AbortSignal) => Promise<void>;

export class JobRunner {
  private slots: number;
  private waiters: Array<() => void> = [];
  private active = new Map<string, { meetingId: string; controller: AbortController }>();
  private inflight: Promise<void>[] = [];

  constructor(
    concurrency: number,
    private readonly execute: JobExecute,
  ) {
    this.slots = Math.max(1, concurrency);
  }

  start(job: AgentJob) {
    const controller = new AbortController();
    this.active.set(job.id, { meetingId: job.meetingId, controller });
    const task = this.acquire()
      .then(async () => {
        try {
          if (!controller.signal.aborted) await this.execute(job, controller.signal);
        } finally {
          this.active.delete(job.id);
          this.release();
        }
      })
      .then(
        () => undefined,
        () => undefined,
      );
    this.inflight.push(task);
    void task.finally(() => {
      this.inflight = this.inflight.filter((item) => item !== task);
    });
  }

  cancel(jobId: string) {
    const running = this.active.get(jobId);
    if (!running) return false;
    running.controller.abort();
    return true;
  }

  cancelMeeting(meetingId: string) {
    for (const [id, running] of this.active) {
      if (running.meetingId === meetingId) this.cancel(id);
    }
  }

  cancelAll() {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  whenIdle() {
    return Promise.all(this.inflight).then(() => undefined);
  }

  private acquire() {
    if (this.slots > 0) {
      this.slots -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.slots += 1;
  }
}

// B9: one runner per process. Next bundles the server action and the HTTP routes as separate module
// instances; module-level state gave the cancel action its own empty runner, so cancel never reached the job.
interface RunnerGlobal {
  __talk2buildRunner?: { runner: JobRunner | null; executor: JobExecute | null };
}
const slot = (() => {
  const g = globalThis as typeof globalThis & RunnerGlobal;
  if (!g.__talk2buildRunner) g.__talk2buildRunner = { runner: null, executor: null };
  return g.__talk2buildRunner;
})();

/** Module-load registration: a second bundle loading dispatch must not drop the live runner and its jobs. */
export function ensureJobExecutor(execute: JobExecute) {
  if (!slot.executor) slot.executor = execute;
}

export function bindJobExecutor(execute: JobExecute) {
  slot.executor = execute;
  slot.runner = null;
}

export function getJobRunner() {
  if (!slot.runner) {
    if (!slot.executor) throw new Error("Job runner has no executor.");
    slot.runner = new JobRunner(3, slot.executor);
  }
  return slot.runner;
}

export function resetJobRunner(execute?: JobExecute) {
  slot.runner?.cancelAll();
  if (execute) slot.executor = execute;
  slot.runner = null;
}
