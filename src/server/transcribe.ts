import { getStore } from "@/lib/meeting-store";
import { MAX_AUDIO_BYTES, sttProvider, sttStatus, SttUnavailableError } from "@/lib/transcribe";
import { TRANSCRIPT_SOURCES, type TranscriptSource } from "@/lib/types";
import { handleTurn } from "@/server/routes";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function handleSttConfig() {
  return json(sttStatus());
}

/** Tag the newest matching transcript line with how it arrived (typed, web-speech, whisper-local…). */
export function stampSource(meetingId: string, text: string, source: unknown) {
  if (typeof source !== "string" || !TRANSCRIPT_SOURCES.includes(source as TranscriptSource)) return;
  getStore().stampSource(meetingId, text.trim(), source as TranscriptSource);
}

/**
 * POST /api/meetings/:id/transcribe?speaker=Maya[&language=en]
 * Body: raw audio (audio/wav, audio/webm, audio/ogg…). The audio is transcribed by the configured
 * provider, and a non-empty transcript goes through the same meeting-turn pipeline as a typed line.
 */
export async function handleMeetingTranscribe(request: Request, meetingId: string) {
  const url = new URL(request.url);
  const speaker = (url.searchParams.get("speaker") || "").trim();
  const language = (url.searchParams.get("language") || "").trim() || undefined;
  const mime = (request.headers.get("content-type") || "").toLowerCase();
  if (!speaker) return json({ error: "speaker is required (the participant who is talking)." }, 400);
  if (!mime.startsWith("audio/") && !mime.startsWith("video/webm")) return json({ error: "Send the audio as the request body with an audio/* content-type." }, 415);
  const store = getStore();

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_AUDIO_BYTES) return json({ error: "Audio chunk is larger than 10 MB." }, 413);
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: "Audio chunk is larger than 10 MB." }, 413);
  if (audio.byteLength === 0) return json({ error: "Empty audio." }, 400);

  let provider;
  try {
    provider = await sttProvider();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Transcription is not configured.", status: sttStatus() }, 501);
  }
  let transcription;
  try {
    transcription = await provider.transcribe(audio, { mime, language });
  } catch (error) {
    const status = error instanceof SttUnavailableError ? 503 : 422;
    return json({ error: `Transcription failed: ${error instanceof Error ? error.message : String(error)}` }, status);
  }
  if (!transcription.text) return json({ transcription, turn: null, state: store.get(meetingId) });

  const response = await handleTurn(
    new Request(request.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: transcription.text, speaker, meetingId }),
    }),
  );
  const turn = (await response.json()) as Record<string, unknown>;
  if (response.ok) stampSource(meetingId, transcription.text, transcription.provider);
  return json({ transcription, turn, state: store.get(meetingId) }, response.ok ? 200 : response.status);
}
