"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Play, Square } from "lucide-react";
import { DiffColumn, PoolColumn } from "@/components/room-columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DEMO_SCRIPT } from "@/lib/demo-script";
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
  const [panel, setPanel] = useState<"pool" | "diff">("pool");
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
      <div className="flex h-dvh items-center justify-center bg-[#07090d] text-[#f3efe6]">
        <p className="text-sm text-[#c9d0da]">{error || "Opening the room…"}</p>
      </div>
    );
  }

  const captions = meeting.transcript.slice(-2);

  return (
    <div className="flex h-dvh flex-col bg-[#07090d] text-[#f3efe6]" data-testid="meeting-stage">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9aa3b2]">Live room · {meeting.joinCode}</p>
          <h1 className="text-lg">{meeting.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meeting.status === "live" ? "ok" : "muted"}>{meeting.status}</Badge>
          <Link href="/" className="text-sm text-[#9eb6ff]">
            Tasks
          </Link>
          {meeting.scenario === "incident" ? (
            <Button variant="secondary" size="sm" onClick={() => void playScript()} disabled={playing || meeting.status === "ended"} data-testid="play-demo">
              <Play className="h-3.5 w-3.5" />
              Play the 2:17 script
            </Button>
          ) : null}
          <Button variant="danger" size="sm" onClick={() => void endMeeting()} disabled={busy || meeting.status === "ended"} data-testid="end-meeting">
            End meeting
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-0 flex-col">
          <div className="grid flex-1 grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {meeting.participants.length === 0 ? (
              <p className="text-sm text-[#8b93a1]">Nobody has joined yet.</p>
            ) : (
              meeting.participants.map((person) => {
                const speaking = meeting.transcript.at(-1)?.speaker === person.label;
                return (
                  <article
                    key={person.id}
                    className={`flex flex-col justify-between rounded-2xl border p-4 ${speaking ? "border-[#e7b15a]/70 bg-[#e7b15a]/10" : "border-white/10 bg-[#121821]"}`}
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg">
                      {person.name.slice(0, 1)}
                    </div>
                    <div className="mt-4">
                      <p className="text-sm">{person.name}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-[#9aa3b2]">
                        {person.micOn || (listening && speaker === person.label) ? <Mic className="h-3 w-3 text-[#5ddeaf]" /> : <MicOff className="h-3 w-3" />}
                        {person.label}
                      </p>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <div className="mx-4 mb-3 min-h-16 rounded-2xl border border-white/10 bg-black/30 px-4 py-3" data-testid="captions">
            {captions.length === 0 ? (
              <p className="text-sm text-[#8b93a1]">Captions will land here as people talk.</p>
            ) : (
              captions.map((line) => (
                <p key={line.id} className="text-sm leading-6">
                  <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#e7b15a]">{line.speaker}</span>
                  {line.text}
                </p>
              ))
            )}
          </div>
          <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
            <label className="text-xs text-[#9aa3b2]">
              Speaking as
              <select
                aria-label="Speaking as"
                value={speaker}
                onChange={(event) => setSpeaker(event.target.value)}
                className="ml-2 rounded-full border border-white/10 bg-transparent px-2 py-1 text-sm text-[#f3efe6]"
              >
                {(meeting.participants.length > 0 ? meeting.participants : [{ label: speaker, name: speaker }]).map((person) => (
                  <option key={person.label} value={person.label} className="bg-[#121821]">
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Say it, or type it"
              className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-sm outline-none"
              data-testid="meeting-composer"
            />
            <Button type="button" variant={listening ? "danger" : "secondary"} size="icon" onClick={toggleMic} aria-label="Microphone">
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button type="submit" disabled={busy || !draft.trim()}>
              Send
            </Button>
          </form>
          {error ? <p className="px-4 pb-3 text-sm text-[#ff8d8d]">{error}</p> : null}
        </section>
        <aside className="hidden min-h-0 border-l border-white/10 p-3 lg:block">
          {meeting.status === "ended" && meeting.summary ? (
            <div className="mb-3 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-[#121821] p-4" data-testid="minutes">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#e7b15a]">Minutes</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#d7deea]">{meeting.summary.minutes}</pre>
              {meeting.threadId ? (
                <button type="button" className="mt-3 text-sm text-[#9eb6ff]" onClick={() => router.push("/")}>
                  Back to the task
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="mb-2 flex gap-1">
            <Button type="button" size="sm" variant={panel === "pool" ? "default" : "ghost"} onClick={() => setPanel("pool")}>
              Pool
            </Button>
            {meeting.scenario === "incident" ? (
              <Button type="button" size="sm" variant={panel === "diff" ? "default" : "ghost"} onClick={() => setPanel("diff")}>
                Diff
              </Button>
            ) : null}
          </div>
          <div className="h-[calc(100%-3rem)] min-h-0">
            {panel === "diff" && meeting.scenario === "incident" ? (
              <DiffColumn state={meeting} animate={false} />
            ) : (
              <PoolColumn state={meeting} />
            )}
          </div>
        </aside>
      </div>

      <details className="border-t border-white/10 px-4 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm text-[#c9d0da]">Requirement pool</summary>
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
        <div className="pointer-events-none fixed bottom-4 left-1/2 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-[#5ddeaf]/30 bg-[#10211c] px-4 py-3 text-sm text-[#d7f5ea]">
          {endedNote} The notes are on the linked task.
        </div>
      ) : null}
    </div>
  );
}
