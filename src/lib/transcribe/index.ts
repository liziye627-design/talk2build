import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Speech-to-text providers for live meetings.
 *
 * - "whisper-local": faster-whisper in a local Python worker (scripts/whisper_worker.py). No API key.
 * - "amazon-transcribe": reserved. Not implemented yet; selecting it reports that honestly.
 * - "off": the default. The browser can still use the Web Speech API for live captions.
 *
 * Select with TALK2BUILD_STT. TALK2BUILD_WHISPER_PYTHON points at a Python that has faster-whisper.
 */
export type SttProviderId = "whisper-local" | "amazon-transcribe" | "off";

export interface Transcription {
  provider: SttProviderId;
  text: string;
  language?: string;
  durationSec?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  ms: number;
}

export interface SttProvider {
  id: SttProviderId;
  transcribe(audio: Uint8Array, input: { mime: string; language?: string }): Promise<Transcription>;
}

export class SttUnavailableError extends Error {}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function sttProviderId(): SttProviderId {
  const raw = (process.env.TALK2BUILD_STT || "").trim().toLowerCase();
  if (raw === "whisper" || raw === "whisper-local") return "whisper-local";
  if (raw === "transcribe" || raw === "amazon-transcribe") return "amazon-transcribe";
  return "off";
}

export function sttStatus() {
  const id = sttProviderId();
  if (id === "whisper-local") return { provider: id, available: true, note: "Local faster-whisper worker. No API key." };
  if (id === "amazon-transcribe") {
    return { provider: id, available: false, note: "Amazon Transcribe streaming is planned but not implemented in this build." };
  }
  return { provider: id, available: false, note: "Server transcription is off. Set TALK2BUILD_STT=whisper to enable local Whisper." };
}

function extensionFor(mime: string) {
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  return ".bin";
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };

class WhisperWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, Pending>();

  private start() {
    const python = process.env.TALK2BUILD_WHISPER_PYTHON || "python3";
    const script = process.env.TALK2BUILD_WHISPER_SCRIPT || path.join(process.cwd(), "scripts", "whisper_worker.py");
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.child = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.ready) return resolve();
        const id = typeof message.id === "string" ? message.id : "";
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        waiter.resolve(message);
      });
      child.on("exit", (code) => {
        const error = new SttUnavailableError(`Whisper worker exited (${code ?? "signal"}). ${stderr.trim().split("\n").at(-1) ?? ""}`.trim());
        reject(error);
        for (const waiter of this.pending.values()) waiter.reject(error);
        this.pending.clear();
        this.child = null;
        this.ready = null;
      });
      child.on("error", (error) => reject(new SttUnavailableError(`Could not start ${python}: ${error.message}`)));
    });
  }

  async run(file: string, language?: string) {
    if (!this.child || !this.ready) this.start();
    await this.ready;
    const id = randomUUID();
    const result = new Promise<Record<string, unknown>>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child!.stdin.write(`${JSON.stringify({ id, path: file, language })}\n`);
    return result;
  }
}

let worker: WhisperWorker | null = null;

export const whisperLocal: SttProvider = {
  id: "whisper-local",
  async transcribe(audio, input) {
    const started = Date.now();
    const dir = await mkdtemp(path.join(tmpdir(), "t2b-stt-"));
    const file = path.join(dir, `chunk${extensionFor(input.mime)}`);
    try {
      await writeFile(file, audio);
      worker ??= new WhisperWorker();
      const result = await worker.run(file, input.language);
      if (typeof result.error === "string") throw new Error(result.error);
      return {
        provider: "whisper-local",
        text: String(result.text ?? "").trim(),
        language: typeof result.language === "string" ? result.language : undefined,
        durationSec: typeof result.duration === "number" ? result.duration : undefined,
        segments: Array.isArray(result.segments) ? (result.segments as Transcription["segments"]) : undefined,
        ms: Date.now() - started,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

export function sttProvider(): SttProvider {
  const id = sttProviderId();
  if (id === "whisper-local") return whisperLocal;
  throw new SttUnavailableError(sttStatus().note);
}
