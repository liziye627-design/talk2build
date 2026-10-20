import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getJobRunner } from "@/lib/agent/runner";
import { resetStore } from "@/lib/meeting-store";
import { sttProviderId, sttStatus } from "@/lib/transcribe";
import type { MeetingState } from "@/lib/types";
import { startServer } from "@/server/standalone";

const env = { ...process.env };
function useStub() {
  process.env.TALK2BUILD_STT = "whisper";
  process.env.TALK2BUILD_WHISPER_PYTHON = process.execPath;
  process.env.TALK2BUILD_WHISPER_SCRIPT = path.join(process.cwd(), "tests/fixtures/stt-stub.mjs");
}

describe("speech-to-text provider selection", () => {
  afterEach(() => {
    process.env = { ...env };
  });
  it("is off by default and says how to turn it on", () => {
    delete process.env.TALK2BUILD_STT;
    expect(sttProviderId()).toBe("off");
    expect(sttStatus()).toMatchObject({ available: false });
    expect(sttStatus().note).toMatch(/TALK2BUILD_STT=whisper/);
  });
  it("Amazon Transcribe is reserved and reported as not implemented", () => {
    process.env.TALK2BUILD_STT = "transcribe";
    expect(sttStatus()).toMatchObject({ provider: "amazon-transcribe", available: false });
    expect(sttStatus().note).toMatch(/not implemented/);
  });
});

describe("POST /api/meetings/:id/transcribe", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer(0);
  });
  afterAll(async () => {
    await server.close();
    process.env = { ...env };
  });
  beforeEach(() => {
    resetStore();
    process.env = { ...env, TALK2BUILD_JOB_PACE_MS: "0" };
  });

  async function meeting() {
    const created = await fetch(`${server.url}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Live", host: "You", team: ["Maya", "Chris", "Priya"] }),
    });
    return ((await created.json()) as { meeting: { id: string } }).meeting.id;
  }
  const upload = (id: string, body: string, query = "speaker=Maya", type = "audio/wav") =>
    fetch(`${server.url}/api/meetings/${id}/transcribe?${query}`, { method: "POST", headers: { "content-type": type }, body });

  it("returns 501 when transcription is off, and the typed path still works", async () => {
    delete process.env.TALK2BUILD_STT;
    const id = await meeting();
    const response = await upload(id, "anything");
    expect(response.status).toBe(501);
    const typed = await fetch(`${server.url}/api/meetings/${id}/utterance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speaker: "Maya", text: "Is the pizza here yet?", source: "typed" }),
    });
    expect(typed.status).toBe(200);
  });

  it("validates speaker, content type and emptiness", async () => {
    useStub();
    const id = await meeting();
    expect((await upload(id, "x", "")).status).toBe(400);
    expect((await upload(id, "x", "speaker=Maya", "text/plain")).status).toBe(415);
    expect((await upload(id, "", "speaker=Maya")).status).toBe(400);
  });

  it("a transcribed clip becomes a meeting turn with its speaker and source, and starts the right card", async () => {
    useStub();
    const id = await meeting();
    const response = await upload(id, "Goal for this meeting: build Space Cat Courier, a tiny browser game, before the pizza gets here.");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transcription: { provider: string; text: string }; turn: { reply: string }; state: MeetingState };
    expect(body.transcription.provider).toBe("whisper-local");
    expect(body.turn.reply).toMatch(/^On it: Plan/);
    const line = body.state.transcript.find((entry) => entry.speaker === "Maya");
    expect(line).toMatchObject({ source: "whisper-local" });
    await getJobRunner().whenIdle();
    const state = ((await (await fetch(`${server.url}/api/meetings/${id}`)).json()) as { meeting: MeetingState }).meeting;
    expect(state.workstreams.some((stream) => stream.kind === "plan")).toBe(true);
  });

  it("chatter from the mic is parked like typed chatter", async () => {
    useStub();
    const id = await meeting();
    const body = (await (await upload(id, "Is the pizza here yet? I'm starving.", "speaker=Priya")).json()) as { state: MeetingState };
    expect(body.state.transcript.find((entry) => entry.speaker === "Priya")?.source).toBe("whisper-local");
    expect(body.state.workstreams).toHaveLength(0);
  });

  it("a decoder failure is reported, not turned into a fake line", async () => {
    useStub();
    const id = await meeting();
    const response = await upload(id, "BROKEN");
    expect(response.status).toBe(422);
    const state = ((await (await fetch(`${server.url}/api/meetings/${id}`)).json()) as { meeting: MeetingState }).meeting;
    expect(state.transcript).toHaveLength(0);
  });

  it("browser speech lines are tagged web-speech", async () => {
    const id = await meeting();
    const response = await fetch(`${server.url}/api/meetings/${id}/utterance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speaker: "Chris", text: "Is the pizza here yet?", source: "web-speech" }),
    });
    expect(response.status).toBe(200);
    const state = ((await (await fetch(`${server.url}/api/meetings/${id}`)).json()) as { meeting: MeetingState }).meeting;
    expect(state.transcript.find((entry) => entry.speaker === "Chris")?.source).toBe("web-speech");
  });
});
