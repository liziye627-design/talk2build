"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Play, RotateCcw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiffColumn, PoolColumn, TranscriptColumn } from "@/components/room-columns";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import { isInterrupt } from "@/lib/classifier";
import { emptyMeeting } from "@/lib/meeting-defaults";
import type { MeetingState, SpeakerId } from "@/lib/types";

interface TurnResponse {
  reply: string | null;
  silent: boolean;
  progress: string | null;
  kind: string;
  trace: { tool: string; ok: boolean; summary: string }[];
  state: MeetingState;
  provider: string;
  degraded?: boolean;
  error?: string;
}

interface PublicConfig {
  provider: string;
  model: string | null;
  protocol: string;
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
    const utter = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) {
        window.setTimeout(resolve, 280);
        return;
      }
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
      utterance.onerror = () => {
        window.clearTimeout(timer);
        resolve();
      };
      synth.cancel();
      synth.speak(utterance);
    };
    if (synth.getVoices().length > 0) {
      utter();
      return;
    }
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      synth.removeEventListener("voiceschanged", onVoices);
      utter();
    };
    const onVoices = () => begin();
    synth.addEventListener("voiceschanged", onVoices);
    window.setTimeout(begin, 200);
  });
}

export function MeetingRoom() {
  const [state, setState] = useState<MeetingState>(emptyMeeting("demo"));
  const [speaker, setSpeaker] = useState<SpeakerId>("A");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [phase, setPhase] = useState<"idle" | "title" | "live" | "end">("idle");
  const [caption, setCaption] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [animatePr, setAnimatePr] = useState(false);
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [instead, setInstead] = useState("");
  const [mobileTab, setMobileTab] = useState("transcript");
  const [playing, setPlaying] = useState(false);
  const gen = useRef(0);
  const recognition = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const seenInterrupt = useRef<string | null>(null);
  const speakerRef = useRef<SpeakerId>("A");

  useEffect(() => {
    speakerRef.current = speaker;
  }, [speaker]);

  useEffect(() => {
    void fetch("/api/meeting")
      .then((response) => response.json())
      .then((body: { state: MeetingState }) => setState(body.state))
      .catch(() => setError("The meeting state didn't load."));
    void fetch("/api/config")
      .then((response) => response.json())
      .then((body: PublicConfig) => setConfig(body))
      .catch(() => undefined);
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    const last = state.transcript.at(-1);
    if (last?.kind === "interrupt" && last.id !== seenInterrupt.current) {
      seenInterrupt.current = last.id;
      setInterruptOpen(true);
    }
  }, [state.transcript]);

  async function submit(text: string, who: SpeakerId = speakerRef.current) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setBusy(true);
    setError(null);
    setDraft("");
    if (isInterrupt(cleaned)) window.speechSynthesis?.cancel();
    try {
      const response = await fetch("/api/alexa/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speaker: who, text: cleaned, source: listeningRef.current ? "microphone" : "typed" }),
      });
      const body = (await response.json()) as TurnResponse & { error?: string };
      if (!response.ok || !body.state) {
        setError(body.error || "That line didn't land.");
        return body;
      }
      const hadPr = state.pullRequest !== null;
      setState(body.state);
      if (!hadPr && body.state.pullRequest) setAnimatePr(true);
      if (body.reply) {
        setCaption(body.reply);
        await speak(body.reply);
      } else {
        setCaption(null);
      }
      if (body.progress) {
        setProgress(body.progress);
        await speak(body.progress);
      }
      return body;
    } catch {
      setError("Alexa+ couldn't reach the MCP server.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    gen.current += 1;
    window.speechSynthesis?.cancel();
    setPhase("idle");
    setCaption(null);
    setProgress(null);
    setAnimatePr(false);
    const response = await fetch("/api/meeting/reset", { method: "POST" });
    const body = (await response.json()) as { state: MeetingState };
    setState(body.state);
  }

  async function playScript() {
    if (playing) return;
    setPlaying(true);
    const token = ++gen.current;
    try {
      setPhase("title");
      setError(null);
      const resetResponse = await fetch("/api/meeting/reset", { method: "POST" });
      const resetBody = (await resetResponse.json()) as { state: MeetingState };
      if (gen.current !== token) return;
      setState(resetBody.state);
      setAnimatePr(false);
      await wait(1700);
      if (gen.current !== token) return;
      setPhase("live");
      for (const beat of DEMO_SCRIPT.beats) {
        if (gen.current !== token) return;
        setSpeaker(beat.speaker);
        speakerRef.current = beat.speaker;
        for (let index = 1; index <= beat.text.length; index += 1) {
          if (gen.current !== token) return;
          setDraft(beat.text.slice(0, index));
          await wait(12);
        }
        if (gen.current !== token) return;
        setBusy(true);
        const response = await fetch("/api/alexa/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ speaker: beat.speaker, text: beat.text, source: "script" }),
        });
        const body = (await response.json()) as TurnResponse & { error?: string };
        if (gen.current !== token) return;
        setBusy(false);
        setDraft("");
        if (!response.ok || !body.state) {
          setError(body.error || "The scripted beat failed.");
          setPhase("live");
          return;
        }
        setState(body.state);
        if (body.state.pullRequest) setAnimatePr(true);
        if (body.reply) {
          setCaption(body.reply);
          await speak(body.reply);
        }
        if (gen.current !== token) return;
        if (body.progress) {
          setProgress(body.progress);
          await speak(body.progress);
        }
        await wait(400);
      }
      if (gen.current === token) setPhase("end");
    } finally {
      setBusy(false);
      setPlaying(false);
    }
  }

  function stopPlayback() {
    gen.current += 1;
    window.speechSynthesis?.cancel();
    setPhase("live");
    void submit("stop");
  }

  function toggleMic() {
    if (listening) {
      listeningRef.current = false;
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setMicError("This browser has no Web Speech API. Use scripted playback or type the line.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index]?.[0]?.transcript ?? "";
        if (event.results[index]?.isFinal) finalText += piece;
        else interim += piece;
      }
      if (interim) setDraft(interim);
      const spoken = finalText.trim();
      if (!spoken) return;
      if (isInterrupt(spoken)) {
        gen.current += 1;
        window.speechSynthesis?.cancel();
      }
      void submit(spoken);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed") setMicError("Microphone permission is blocked.");
      else if (event.error !== "no-speech" && event.error !== "aborted") {
        setMicError(`Speech recognition error: ${event.error}`);
      }
    };
    rec.onend = () => {
      if (!listeningRef.current) return;
      try {
        rec.start();
      } catch {
        setListening(false);
        listeningRef.current = false;
      }
    };
    recognition.current = rec;
    listeningRef.current = true;
    setMicError(null);
    setListening(true);
    rec.start();
  }

  const lastTrace = state.toolTrace.slice(-6).reverse();

  return (
    <div className="flex h-dvh flex-col">
      <div className="h-1 bg-line" />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-6">
        <div>
          <p className="font-[family-name:var(--font-display)] text-2xl italic tracking-tight text-ink">Talk2Build</p>
          <p className="text-xs text-muted">Orders postmortem · 15 Oct 2026 · the meeting where the work gets done</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="alexa">Alexa+</Badge>
          <Badge>MCP {config?.protocol ?? "2025-11-25"}</Badge>
          <Badge variant={config?.provider === "mock" ? "muted" : "ok"}>
            {config?.provider === "mock" ? "Mock model" : `${config?.provider ?? "model"}${config?.model ? ` · ${config.model}` : ""}`}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => void reset()}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </header>

      <div className="px-4 pt-3 lg:hidden">
        <Tabs value={mobileTab} onValueChange={setMobileTab}>
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="pool">Pool</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <main className="grid min-h-0 flex-1 gap-3 p-3 md:p-4 lg:grid-cols-3">
        <div className={mobileTab === "transcript" ? "min-h-0 lg:h-full" : "hidden min-h-0 lg:block lg:h-full"}>
          <TranscriptColumn state={state} />
        </div>
        <div className={mobileTab === "pool" ? "min-h-0 lg:h-full" : "hidden min-h-0 lg:block lg:h-full"}>
          <PoolColumn state={state} />
        </div>
        <div className={mobileTab === "diff" ? "min-h-0 lg:h-full" : "hidden min-h-0 lg:block lg:h-full"}>
          <DiffColumn state={state} animate={animatePr} />
        </div>
      </main>

      <footer className="border-t border-line bg-surface px-3 py-3 md:px-4">
        {error ? (
          <p role="alert" className="mb-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {micError ? <p className="mb-2 text-xs text-brand">{micError}</p> : null}
        {progress ? (
          <p className="mb-2 font-mono text-[11px] text-brand" data-testid="progress">
            {progress}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-full bg-sunken p-1">
            {(["A", "B"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSpeaker(id)}
                className={`rounded-lg px-3 py-1 text-xs ${speaker === id ? "bg-brand text-white" : "text-muted"}`}
              >
                Speaker {id}
              </button>
            ))}
          </div>
          <form
            className="flex min-w-[16rem] flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(draft);
            }}
          >
            <label className="sr-only" htmlFor="utterance">
              Utterance
            </label>
            <input
              id="utterance"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={listening ? "Listening…" : "Say it, or type it. Try “stop” or “不对”."}
              className="h-10 flex-1 rounded-full border border-line bg-sunken px-4 text-sm text-ink outline-none placeholder:text-faint"
            />
            <Button type="submit" variant="secondary" disabled={busy || !draft.trim()}>
              Send
            </Button>
          </form>
          <Button type="button" variant={listening ? "danger" : "outline"} onClick={toggleMic} aria-pressed={listening}>
            <Mic className="h-4 w-4" />
            {listening ? "Mute" : "Mic"}
          </Button>
          <Button type="button" onClick={() => void playScript()} disabled={busy || playing} data-testid="play-demo">
            <Play className="h-4 w-4" />
            Play demo
          </Button>
          <Button type="button" variant="danger" onClick={stopPlayback} data-testid="interrupt">
            <Square className="h-3.5 w-3.5" />
            Stop / 不对
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-brand" data-testid="alexa-reply" aria-live="polite">
            {busy ? "Alexa+ is working the room…" : caption || "Alexa+ is on the line."}
          </p>
          {state.pending ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void submit(state.pending?.action === "pr_draft" ? "Okay, open the PR." : "Yes, pull it.")}
            >
              {state.pending.action === "pr_draft" ? "Open the PR" : state.pending.action === "diff_fetch" ? "Pull the diff" : "Yes"}
            </Button>
          ) : null}
        </div>
        {lastTrace.length > 0 ? (
          <p className="mt-2 truncate font-mono text-[10px] text-faint" data-testid="tool-trace">
            {lastTrace.map((entry) => entry.tool).join("  ·  ")}
          </p>
        ) : null}
      </footer>

      {phase === "title" || phase === "end" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-canvas/88 px-6 text-center">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
              {phase === "title" ? "2:17 AM" : "After"}
            </p>
            <p className="mt-4 font-[family-name:var(--font-display)] text-3xl leading-tight text-ink md:text-4xl">
              {phase === "title" ? DEMO_SCRIPT.title : DEMO_SCRIPT.closing}
            </p>
            {phase === "end" ? <p className="mt-4 text-brand">{DEMO_SCRIPT.tagline}</p> : null}
            {phase === "end" ? (
              <Button className="mt-6" onClick={() => setPhase("live")}>
                Back to the room
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog open={interruptOpen} onOpenChange={setInterruptOpen}>
        <DialogContent>
          <DialogTitle>Rolled back.</DialogTitle>
          <DialogDescription>What do you want instead?</DialogDescription>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = instead.trim();
              setInstead("");
              setInterruptOpen(false);
              if (next) void submit(next);
            }}
          >
            <input
              value={instead}
              onChange={(event) => setInstead(event.target.value)}
              placeholder="Say the correction"
              className="h-10 flex-1 rounded-full border border-line bg-sunken px-4 text-sm outline-none"
            />
            <Button type="submit">Tell Alexa+</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
