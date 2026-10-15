interface MutexGlobal {
  __talk2buildQueue?: Promise<unknown>;
}

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const g = globalThis as typeof globalThis & MutexGlobal;
  const previous = g.__talk2buildQueue ?? Promise.resolve();
  const run = previous.then(task, task);
  g.__talk2buildQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
