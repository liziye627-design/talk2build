import { describe, expect, it } from "vitest";
import { StartStreamTranscriptionCommand } from "@aws-sdk/client-transcribe-streaming";
import { audioEvents, createAmazonTranscribe, transcribeLanguage, type StreamingClientLike } from "@/lib/transcribe/amazon";
import { createChunkedRecorder, type RecorderLike } from "@/lib/transcribe/chunker";

class FakeRecorder implements RecorderLike {
  mimeType = "audio/webm";
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  constructor(private bytes: number) {}
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(this.bytes)]) });
    this.onstop?.();
  }
}

describe("chunked (near-real-time) mic transcription", () => {
  it("rotates self-contained segments and uploads them in order while recording continues", async () => {
    const timers: Array<() => void> = [];
    const sizes = [4000, 5000, 3000];
    const uploaded: Array<[number, number]> = [];
    let made = 0;
    const chunked = createChunkedRecorder({
      makeRecorder: () => new FakeRecorder(sizes[made++] ?? 2000),
      upload: async (blob, index) => {
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 1));
        uploaded.push([index, blob.size]);
      },
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined,
    });
    chunked.start();
    timers[0](); // segment 0 ends, segment 1 starts
    timers[1](); // segment 1 ends, segment 2 starts
    expect(made).toBe(3);
    chunked.stop(); // segment 2 flushed
    await chunked.drain();
    expect(uploaded).toEqual([
      [0, 4000],
      [1, 5000],
      [2, 3000],
    ]);
    expect(chunked.active).toBe(false);
  });

  it("drops empty/silent segments and keeps going after a failed upload", async () => {
    const timers: Array<() => void> = [];
    const sizes = [10, 4000, 4000];
    let made = 0;
    const seen: number[] = [];
    const chunked = createChunkedRecorder({
      makeRecorder: () => new FakeRecorder(sizes[made++] ?? 0),
      upload: async (_blob, index) => {
        seen.push(index);
        if (index === 0) throw new Error("network");
      },
      setTimer: (fn) => timers.push(fn),
    });
    chunked.start();
    timers[0]();
    timers[1]();
    chunked.stop();
    await chunked.drain();
    expect(seen).toEqual([0, 1]);
  });
});

describe("Amazon Transcribe streaming (mocked client, unverified live)", () => {
  it("streams 100 ms PCM frames and joins only final results", async () => {
    const sent: StartStreamTranscriptionCommand[] = [];
    let frames = 0;
    const client: StreamingClientLike = {
      async send(command) {
        sent.push(command);
        for await (const event of command.input.AudioStream ?? []) if (event.AudioEvent) frames += 1;
        async function* results() {
          yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: "let's" }] }] } } };
          yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "Let's ship the pizza game." }] }] } } };
          yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "Maya owns the art." }] }] } } };
        }
        return { TranscriptResultStream: results() as never };
      },
    };
    const pcm = new Uint8Array(16000 * 2); // 1 s
    const stt = createAmazonTranscribe(client, async () => pcm);
    const out = await stt.transcribe(new Uint8Array([1]), { mime: "audio/webm", language: "en" });
    expect(out).toMatchObject({ provider: "amazon-transcribe", text: "Let's ship the pizza game. Maya owns the art.", language: "en-US", durationSec: 1 });
    expect(frames).toBe(10);
    expect(sent[0].input).toMatchObject({ MediaEncoding: "pcm", MediaSampleRateHertz: 16000, LanguageCode: "en-US" });
  });

  it("maps languages and frames audio", async () => {
    expect(transcribeLanguage("zh")).toBe("zh-CN");
    expect(transcribeLanguage("en")).toBe("en-US");
    let n = 0;
    for await (const event of audioEvents(new Uint8Array(3201))) if (event.AudioEvent) n += 1;
    expect(n).toBe(2);
  });
});

describe("Whisper loop cleanup", () => {
  it("collapses runaway repeats from cut-off chunks but keeps normal text", async () => {
    const { collapseRepeats } = await import("@/lib/transcribe");
    expect(collapseRepeats("signed up. 8 8 8 8 8 8 8")).toBe("signed up. 8");
    expect(collapseRepeats("sign uhh alright okay so so so so so so")).toBe("sign uhh alright okay so");
    expect(collapseRepeats("Priya owns the copy, Chris builds the form")).toBe("Priya owns the copy, Chris builds the form");
    expect(collapseRepeats("no no no")).toBe("no no no");
  });
});
