import { spawn } from "node:child_process";
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type LanguageCode,
  type TranscriptResultStream,
} from "@aws-sdk/client-transcribe-streaming";
import type { SttProvider, Transcription } from "@/lib/transcribe";

/**
 * Amazon Transcribe streaming (TALK2BUILD_STT=transcribe). UNVERIFIED against live AWS: this build has
 * no AWS credentials, so it is covered only by tests with a mocked client.
 *
 * The uploaded clip is decoded to 16 kHz mono PCM with ffmpeg and streamed in 100 ms audio events;
 * final (non-partial) results are joined into the transcript.
 */
export const PCM_RATE = 16000;
const FRAME_BYTES = (PCM_RATE * 2) / 10; // 100 ms of s16le

export interface StreamingClientLike {
  send(command: StartStreamTranscriptionCommand): Promise<{ TranscriptResultStream?: AsyncIterable<TranscriptResultStream> }>;
}

export function decodeToPcm(audio: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-nostdin", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", String(PCM_RATE), "pipe:1"]);
    const out: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    ff.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(out))) : reject(new Error(`ffmpeg failed: ${err.trim()}`))));
    ff.stdin.end(Buffer.from(audio));
  });
}

export async function* audioEvents(pcm: Uint8Array): AsyncGenerator<AudioStream> {
  for (let offset = 0; offset < pcm.byteLength; offset += FRAME_BYTES) {
    yield { AudioEvent: { AudioChunk: pcm.subarray(offset, offset + FRAME_BYTES) } };
  }
}

export function transcribeLanguage(language?: string): LanguageCode {
  if (!language) return (process.env.TALK2BUILD_TRANSCRIBE_LANGUAGE as LanguageCode) || "en-US";
  if (language.startsWith("zh")) return "zh-CN";
  if (language === "en") return "en-US";
  return language as LanguageCode;
}

export async function streamTranscribe(
  pcm: Uint8Array,
  language: LanguageCode,
  client: StreamingClientLike,
): Promise<string> {
  const response = await client.send(
    new StartStreamTranscriptionCommand({
      LanguageCode: language,
      MediaEncoding: "pcm",
      MediaSampleRateHertz: PCM_RATE,
      AudioStream: audioEvents(pcm),
    }),
  );
  const finals: string[] = [];
  for await (const event of response.TranscriptResultStream ?? []) {
    for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
      if (result.IsPartial) continue;
      const text = result.Alternatives?.[0]?.Transcript?.trim();
      if (text) finals.push(text);
    }
  }
  return finals.join(" ").trim();
}

export function createAmazonTranscribe(
  client: StreamingClientLike = new TranscribeStreamingClient({ region: process.env.AWS_REGION || "us-east-1" }),
  decode: (audio: Uint8Array) => Promise<Uint8Array> = decodeToPcm,
): SttProvider {
  return {
    id: "amazon-transcribe",
    async transcribe(audio, input): Promise<Transcription> {
      const started = Date.now();
      const pcm = await decode(audio);
      const language = transcribeLanguage(input.language);
      const text = await streamTranscribe(pcm, language, client);
      return { provider: "amazon-transcribe", text, language, durationSec: pcm.byteLength / (PCM_RATE * 2), ms: Date.now() - started };
    },
  };
}
