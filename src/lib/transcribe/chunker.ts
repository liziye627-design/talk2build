/**
 * Near-real-time mic transcription: record in short self-contained segments (default 4 s) and upload
 * each one while the next is still recording. Each segment is a complete file (the recorder is
 * restarted per segment), because MediaRecorder timeslice chunks after the first lack a container
 * header and Whisper/ffmpeg cannot decode them on their own. Uploads run strictly in order.
 */
export interface RecorderLike {
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface ChunkedRecorderOptions {
  makeRecorder: () => RecorderLike;
  upload: (blob: Blob, index: number) => Promise<void>;
  segmentMs?: number;
  /** Segments smaller than this (bytes) are dropped as silence/empty. */
  minBytes?: number;
  onIdle?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DEFAULT_SEGMENT_MS = 4000;

export function createChunkedRecorder(options: ChunkedRecorderOptions) {
  const segmentMs = options.segmentMs ?? DEFAULT_SEGMENT_MS;
  const minBytes = options.minBytes ?? 1024;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let active = false;
  let current: RecorderLike | null = null;
  let timer: unknown = null;
  let index = 0;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  function enqueue(blob: Blob) {
    if (blob.size < minBytes) return;
    const n = index++;
    pending += 1;
    queue = queue
      .then(() => options.upload(blob, n))
      .catch(() => undefined)
      .finally(() => {
        pending -= 1;
        if (!active && pending === 0) options.onIdle?.();
      });
  }

  function startSegment() {
    const rec = options.makeRecorder();
    const parts: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) parts.push(event.data);
    };
    rec.onstop = () => {
      enqueue(new Blob(parts, { type: rec.mimeType || "audio/webm" }));
      if (active) startSegment();
      else if (pending === 0) options.onIdle?.();
    };
    current = rec;
    rec.start();
    timer = setTimer(() => {
      if (current === rec) rec.stop();
    }, segmentMs);
  }

  return {
    start() {
      if (active) return;
      active = true;
      startSegment();
    },
    stop() {
      active = false;
      if (timer !== null) clearTimer(timer);
      current?.stop();
      current = null;
    },
    get active() {
      return active;
    },
    /** Resolves once every uploaded segment has finished. */
    drain() {
      return queue;
    },
  };
}
