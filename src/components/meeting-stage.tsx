"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Play, Square, Video, VideoOff } from "lucide-react";
import { DiffColumn, PoolColumn } from "@/components/room-columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import { PLANNING_SCRIPT } from "@/lib/planning-script";
import { isInterrupt } from "@/lib/classifier";
import type { MeetingState } from "@/lib/types";

interface TurnResponse {
  reply: string | null;
  silent: boolean;
  state: MeetingState;
  error?: string;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function speak(text: string) {
  return new Promise<void>((resolve) => {
    const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (!synth) {
      resolve();
      return;
    }
    let started = false;
    const utter = () => {
      if (started) return;
      const voices = synth.getVoices();
      if (voices.length === 0) {
        window.setTimeout(resolve, 280);
        return;
      }
      started = true;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.03;
      const english = voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
      if (english) utterance.voice = english;
      const timer = window.setTimeout(() => {
        synth.cancel();
        resolve();
      }, Math.min(8000, 700 + text.length * 38));
      utterance.onend = () => {
        window.clearTimeout(timer);
        resolve();
      };
      synth.cancel();
      synth.speak(utterance);
    };
    synth.addEventListener("voiceschanged", utter, { once: true });
    window.setTimeout(utter, 60);
  });
}

export function MeetingStage({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<MeetingState | null>(null);
  const [error, setError] = useState("");
  const [speaker, setSpeaker] = useState("A");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [endedNote, setEndedNote] = useState("");
  const [askInstead, setAskInstead] = useState(false);
  const [panel, setPanel] = useState<"agent" | "pool" | "diff">("agent");
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopPlay = useRef(false);
  const recognition = useRef<SpeechRecognition | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/meetings/${meetingId}`);
    if (!response.ok) {
      setError("This meeting is not on the desk.");
      return;
    }
    const body = (await response.json()) as { meeting: MeetingState };
    setMeeting(body.meeting);
    setSpeaker((current) => body.meeting.participants.find((person) => person.label === current)?.label || body.meeting.participants[0]?.label || current);
  }, [meetingId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const revealedDiff = useRef(false);
  useEffect(() => {
    if (revealedDiff.current) return;
    if (meeting?.incidentDiff || meeting?.pullRequest) {
      revealedDiff.current = true;
      setPanel("diff");
    }
  }, [meeting?.incidentDiff, meeting?.pullRequest]);

  async function say(text: string, who = speaker) {
    const response = await fetch(`/api/meetings/${meetingId}/utterance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, speaker: who }),
    });
    const body = (await response.json()) as TurnResponse;
    if (!response.ok) throw new Error(body.error || "The room could not hear that.");
    setMeeting(body.state);
    if (isInterrupt(text)) setAskInstead(true);
    if (body.reply) await speak(body.reply);
    return body;
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setError("");
    try {
      await say(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  async function playPlanning() {
    if (!meeting || playing) return;
    setPlaying(true);
    stopPlay.current = false;
    setBusy(true);
    setPanel("agent");
    try {
      for (const beat of PLANNING_SCRIPT) {
        if (stopPlay.current) break;
        await say(beat.text, beat.speaker);
        await wait(350);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Playback stopped.");
    } finally {
      setBusy(false);
      setPlaying(false);
    }
  }

  async function playScript() {
    if (!meeting || playing) return;
    setPlaying(true);
    stopPlay.current = false;
    setBusy(true);
    try {
      for (const beat of DEMO_SCRIPT.beats) {
        if (stopPlay.current) break;
        await say(beat.text, beat.speaker);
        await wait(400);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Playback stopped.");
    } finally {
      setBusy(false);
      setPlaying(false);
    }
  }

  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!cameraOn || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOn, speaker]);

  async function toggleCamera() {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraOn(false);
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraOn(true);
    } catch {
      setCameraOn(false);
      setError("Camera stayed off. Avatars stay up for the room.");
    }
  }

  function toggleMic() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      setError("This browser has no speech recognition.");
      return;
    }
    if (listening && recognition.current) {
      recognition.current.stop();
      setListening(false);
      void fetch(`/api/meetings/${meetingId}/mic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: speaker, micOn: false }),
      });
      return;
    }
    const session = new Speech();
    recognition.current = session;
    session.lang = "en-US";
    session.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) void say(said).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Mic failed."));
    };
    session.onend = () => setListening(false);
    session.onerror = () => setListening(false);
    setListening(true);
    void fetch(`/api/meetings/${meetingId}/mic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: speaker, micOn: true }),
    });
    session.start();
  }

  async function endMeeting() {
    setBusy(true);
    const response = await fetch(`/api/meetings/${meetingId}/end`, { method: "POST" });
    const body = (await response.json()) as { meeting: MeetingState; threadId: string; summary: string };
    setMeeting(body.meeting);
    setEndedNote(body.summary);
    setBusy(false);
  }

  if (!meeting) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas text-ink">
        <p className="text-sm text-body">{error || "Opening the room…"}</p>
      </div>
    );
  }

  const captions = meeting.transcript.slice(-2);

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink" data-testid="meeting-stage">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-4">
        <div>
          <p className="text-xs text-muted">Live room · {meeting.joinCode}</p>
          <h1 className="text-base font-semibold tracking-tight">{meeting.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meeting.status === "live" ? "ok" : "muted"}>{meeting.status}</Badge>
          <Link href="/" className="text-sm text-brand">
            Meetings
          </Link>
          {meeting.scenario === "incident" ? (
            <Button variant="secondary" size="sm" onClick={() => void playScript()} disabled={playing || meeting.status === "ended"} data-testid="play-demo">
              <Play className="h-3.5 w-3.5" />
              Play the 2:17 script
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void playPlanning()} disabled={playing || meeting.status === "ended"} data-testid="play-session">
              <Play className="h-3.5 w-3.5" />
              Play a working session
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => void endMeeting()} disabled={busy || meeting.status === "ended"} data-testid="end-meeting">
            End meeting
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-0 flex-col">
          <div className="grid flex-1 content-center grid-cols-2 gap-4 p-6" data-testid="video-grid">
            {meeting.participants.length === 0 ? (
              <p className="text-sm text-muted">Nobody has joined yet.</p>
            ) : (
              meeting.participants.map((person) => {
                const speaking = meeting.transcript.at(-1)?.speaker === person.label;
                const self = person.label === speaker;
                return (
                  <article
                    key={person.id}
                    className={`relative flex min-h-44 flex-col items-center justify-center overflow-hidden rounded-xl border shadow-card ${speaking ? "border-brand" : "border-line"} bg-surface`}
                  >
                    {self && cameraOn ? (
                      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
                    ) : (
                      <div className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-medium ${speaking ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}>
                        {person.name.slice(0, 1)}
                      </div>
                    )}
                    <p className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow-card">
                      {person.micOn || (listening && self) ? <Mic className="h-3 w-3 text-ok" /> : <MicOff className="h-3 w-3" />}
                      {person.name}
                      {speaking ? <span className="text-brand">speaking</span> : null}
                    </p>
                  </article>
                );
              })
            )}
          </div>
          <div className="mx-6 mb-4 min-h-16 rounded-xl border border-line bg-surface px-4 py-3 shadow-card" data-testid="captions">
            {captions.length === 0 ? (
              <p className="text-sm text-muted">Captions will land here as people talk.</p>
            ) : (
              captions.map((line) => (
                <p key={line.id} className="text-sm leading-6">
                  <span className="mr-2 text-xs font-medium text-brand">{line.speaker}</span>
                  {line.text}
                </p>
              ))
            )}
          </div>
          <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-4">
            <label className="text-xs text-muted">
              Speaking as
              <select
                id="speaking-as"
                name="speaker"
                aria-label="Speaking as"
                value={speaker}
                onChange={(event) => setSpeaker(event.target.value)}
                className="ml-2 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              >
                {(meeting.participants.length > 0 ? meeting.participants : [{ label: speaker, name: speaker }]).map((person) => (
                  <option key={person.label} value={person.label} className="bg-surface">
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              id="meeting-composer"
              name="utterance"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Say it, or type it"
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-4 text-sm text-ink outline-none placeholder:text-muted"
              data-testid="meeting-composer"
            />
            <Button type="button" variant={listening ? "danger" : "secondary"} size="icon" onClick={toggleMic} aria-label="Microphone">
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button type="button" variant={cameraOn ? "default" : "secondary"} size="icon" onClick={() => void toggleCamera()} aria-label="Camera">
              {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </Button>
            <Button type="submit" disabled={busy || !draft.trim()}>
              Send
            </Button>
          </form>
          {error ? <p className="px-4 pb-3 text-sm text-danger">{error}</p> : null}
        </section>
        <aside className="min-h-0 border-t border-line bg-surface p-5 lg:border-l lg:border-t-0">
          {meeting.status === "ended" && meeting.summary ? (
            <div className="mb-3 max-h-64 overflow-auto rounded-2xl border border-line bg-surface p-4" data-testid="minutes">
              <p className="text-xs font-medium text-muted">Minutes</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-body">{meeting.summary.minutes}</pre>
              {meeting.threadId ? (
                <button type="button" className="mt-3 text-sm text-brand" onClick={() => router.push("/tasks")}>
                  Open the task desk
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="mb-2 flex gap-1">
            <Button type="button" size="sm" variant={panel === "agent" ? "default" : "ghost"} onClick={() => setPanel("agent")}>
              Agent
            </Button>
            <Button type="button" size="sm" variant={panel === "pool" ? "default" : "ghost"} onClick={() => setPanel("pool")}>
              Pool
            </Button>
            {meeting.scenario === "incident" ? (
              <Button type="button" size="sm" variant={panel === "diff" ? "default" : "ghost"} onClick={() => setPanel("diff")}>
                Diff
              </Button>
            ) : null}
          </div>
          <div className="h-[calc(100%-3rem)] min-h-0 overflow-y-auto" data-testid="agent-panel">
            {panel === "diff" && meeting.scenario === "incident" ? (
              <DiffColumn state={meeting} animate={false} />
            ) : panel === "pool" ? (
              <PoolColumn state={meeting} />
            ) : (
              <AgentCards meeting={meeting} />
            )}
          </div>
        </aside>
      </div>

      <details className="border-t border-line px-4 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm text-body">Requirement pool</summary>
        <div className="mt-2 h-80">
          <PoolColumn state={meeting} />
        </div>
      </details>

      <Dialog open={askInstead} onOpenChange={setAskInstead}>
        <DialogContent>
          <DialogTitle>Rolled back</DialogTitle>
          <DialogDescription>What do you want instead?</DialogDescription>
        </DialogContent>
      </Dialog>

      {endedNote && meeting.status === "ended" ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
          {endedNote} The notes are on the linked task.
        </div>
      ) : null}
    </div>
  );
}

function AgentCards({ meeting }: { meeting: MeetingState }) {
  const suggestion = meeting.suggestions[0];
  return (
    <div className="space-y-4 pr-1">
      {suggestion ? (
        <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm leading-6 text-brand-deep" data-testid="suggestion">
          {suggestion.text}
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted">
          The agent works while you talk. A plan, a design, a check, or a reference shows up here without a separate prompt.
        </p>
      )}
      {meeting.pending ? (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm leading-6 text-warn" data-testid="confirm-wait">
          Waiting for a yes. {meeting.pending.prompt}
        </p>
      ) : null}
      {meeting.workstreams.length === 0 ? null : (
        meeting.workstreams.map((stream) => (
          <article key={stream.id} className="rounded-xl border border-line bg-canvas p-4" data-testid="workstream">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium capitalize text-muted">{stream.kind}</p>
              <Badge variant={stream.status === "waiting" ? "muted" : "ok"}>{stream.status}</Badge>
            </div>
            <h3 className="mt-2 text-sm font-medium">{stream.title}</h3>
            <p className="mt-1 text-xs leading-5 text-body">{stream.summary}</p>
            {stream.artifactPath ? <p className="mt-2 font-mono text-[10px] text-muted">{stream.artifactPath}</p> : null}
          </article>
        ))
      )}
      {meeting.chatter.length > 0 ? (
        <p className="text-xs leading-5 text-muted">Parked, not in the plan: {meeting.chatter.at(-1)?.text}</p>
      ) : null}
    </div>
  );
}
