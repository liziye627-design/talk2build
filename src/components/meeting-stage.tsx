"use client";

import { ASSISTANT_NAME } from "@/lib/branding";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  RectangleHorizontal,
  Square,
  UserPlus,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { cancelMeetingJob } from "@/app/actions/cancel-job";
import { DiffColumn, PoolColumn } from "@/components/room-columns";
import { DecisionTree } from "@/components/decision-tree";
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
  const [view, setView] = useState<"grid" | "speaker">("grid");
  const [drawer, setDrawer] = useState<"none" | "members" | "chat">("none");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [recordingLocal, setRecordingLocal] = useState(false);
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
    const timer = window.setInterval(() => void refresh(), 800);
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
  const speakingLabel = meeting.transcript.at(-1)?.speaker;
  const stageFont = { fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",Inter,sans-serif' } as const;

  function toggleDrawer(next: "members" | "chat") {
    setDrawer((current) => (current === next ? "none" : next));
  }

  return (
    <div className="flex h-dvh flex-col bg-[#1c1c1c] text-white" style={stageFont} data-testid="meeting-stage">
      <header className="flex h-12 shrink-0 items-center justify-between bg-[#1c1c1c] px-4 text-[13px]">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-white/70 hover:text-white">
            会议
          </Link>
          <h1 className="truncate">{meeting.title}</h1>
          <span className="text-white/50">{meeting.joinCode}</span>
          {recordingLocal ? <span className="text-[11px] text-[#ff5a5a]">录制中</span> : null}
        </div>
        <div className="flex items-center gap-1 rounded-md bg-white/10 p-0.5">
          <button type="button" className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "grid" ? "bg-white/15" : "text-white/70"}`} onClick={() => setView("grid")}>
            <LayoutGrid className="h-3.5 w-3.5" /> 宫格
          </button>
          <button type="button" className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "speaker" ? "bg-white/15" : "text-white/70"}`} onClick={() => setView("speaker")}>
            <RectangleHorizontal className="h-3.5 w-3.5" /> 演讲者
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="relative flex min-h-0 flex-col">
          <div className={`grid min-h-0 flex-1 gap-1.5 p-2 ${view === "speaker" ? "grid-cols-[minmax(0,1fr)_148px] pb-16" : `${gridCols(meeting.participants.length)} auto-rows-fr pb-16`}`} data-testid="video-grid" style={drawer !== "none" ? { marginRight: "18rem" } : undefined}>
            {meeting.participants.length === 0 ? (
              <p className="text-sm text-white/50">还没有人入会。</p>
            ) : view === "speaker" ? (
              <>
                <Tile
                  person={meeting.participants.find((person) => person.label === speakingLabel) ?? meeting.participants[0]!}
                  speaking
                  self={(meeting.participants.find((person) => person.label === speakingLabel) ?? meeting.participants[0]!).label === speaker}
                  cameraOn={cameraOn}
                  videoRef={videoRef}
                  large
                />
                <div className="flex flex-col gap-1.5 overflow-y-auto">
                  {meeting.participants
                    .filter((person) => person.label !== (speakingLabel ?? meeting.participants[0]?.label))
                    .map((person) => (
                      <Tile key={person.id} person={person} speaking={false} self={person.label === speaker} cameraOn={cameraOn} videoRef={videoRef} />
                    ))}
                </div>
              </>
            ) : (
              meeting.participants.map((person) => (
                <Tile
                  key={person.id}
                  person={person}
                  speaking={speakingLabel === person.label}
                  self={person.label === speaker}
                  cameraOn={cameraOn}
                  videoRef={videoRef}
                  listening={listening}
                />
              ))
            )}
          </div>
          {sharing ? <p className="pointer-events-none absolute left-3 top-3 rounded bg-[#006fff] px-2 py-1 text-xs">正在共享屏幕</p> : null}
          <div style={drawer !== "none" ? { right: "19rem" } : undefined} className="pointer-events-none absolute inset-x-4 bottom-3 max-h-14 overflow-hidden rounded bg-black/55 px-3 py-2" data-testid="captions">
            {captions.length === 0 ? (
              <p className="text-sm text-white/50">字幕会显示在这里。</p>
            ) : (
              captions.map((line) => (
                <p key={line.id} className="text-sm leading-6">
                  <span className="mr-2 text-xs text-[#7eb6ff]">{displaySpeaker(line.speaker)}</span>
                  {line.text}
                </p>
              ))
            )}
          </div>
          {drawer !== "none" ? (
            <aside className="absolute bottom-0 right-0 top-0 flex w-72 flex-col border-l border-white/10 bg-[#f7f7f7] text-[#1a1a1a]">
              <header className="flex items-center justify-between border-b border-[#eee] px-4 py-3 text-sm">
                {drawer === "members" ? `成员 (${meeting.participants.length})` : "聊天"}
                <button type="button" className="text-[#888]" onClick={() => setDrawer("none")}>
                  关闭
                </button>
              </header>
              {drawer === "members" ? (
                <ul className="flex-1 overflow-y-auto px-2 py-2">
                  {meeting.participants.map((person) => (
                    <li key={person.id} className="flex items-center justify-between rounded px-2 py-2 text-sm hover:bg-[#efefef]">
                      <span>{person.name}</span>
                      {person.micOn || (listening && person.label === speaker) ? <Mic className="h-3.5 w-3.5 text-[#006fff]" /> : <MicOff className="h-3.5 w-3.5 text-[#999]" />}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                    {meeting.transcript.length === 0 ? <p className="text-sm text-[#888]">还没有消息。</p> : null}
                    {meeting.transcript.map((line) => (
                      <p key={line.id} className="text-sm leading-6">
                        <span className="mr-2 text-xs text-[#006fff]">{displaySpeaker(line.speaker)}</span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                  <form onSubmit={(event) => void submit(event)} className="border-t border-[#eee] p-3">
                    <label className="mb-2 block text-xs text-[#888]">
                      发言人
                      <select id="speaking-as" name="speaker" aria-label="发言人" value={speaker} onChange={(event) => setSpeaker(event.target.value)} className="ml-2 bg-transparent text-sm text-[#222]">
                        {meeting.participants.filter((person) => person.kind !== "ai").map((person) => (
                          <option key={person.label} value={person.label}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <input id="meeting-composer" name="utterance" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="说点什么，或 @架构师 @质疑者" className="h-9 min-w-0 flex-1 rounded border border-[#e5e5e5] px-3 text-sm text-[#222] outline-none" data-testid="meeting-composer" />
                      <button type="submit" className="rounded bg-[#006fff] px-3 text-sm text-white" disabled={busy || !draft.trim()}>
                        发送
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </aside>
          ) : null}
          {error ? <p className="px-4 pb-2 text-sm text-[#ff8d8d]">{error}</p> : null}
        </section>

        <aside className="flex min-h-0 flex-col border-l border-white/10 bg-white text-[#1a1a1a]">
          <header className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
            <p className="text-sm">{ASSISTANT_NAME}</p>
            <div className="flex gap-2 text-xs">
              <button type="button" className={panel === "agent" ? "text-[#006fff]" : "text-[#888]"} onClick={() => setPanel("agent")}>
                工作
              </button>
              <button type="button" className={panel === "pool" ? "text-[#006fff]" : "text-[#888]"} onClick={() => setPanel("pool")}>
                记录
              </button>
              {meeting.scenario === "incident" ? (
                <button type="button" className={panel === "diff" ? "text-[#006fff]" : "text-[#888]"} onClick={() => setPanel("diff")}>
                  变更
                </button>
              ) : null}
            </div>
          </header>
          {meeting.status === "ended" && meeting.summary ? (
            <div className="max-h-40 overflow-auto border-b border-[#eee] px-4 py-3" data-testid="minutes">
              <p className="text-xs text-[#888]">会议纪要</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#444]">{meeting.summary.minutes}</pre>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="agent-panel">
            {panel === "diff" && meeting.scenario === "incident" ? (
              <DiffColumn state={meeting} animate={false} />
            ) : panel === "pool" ? (
              <PoolColumn state={meeting} />
            ) : (
              <AgentCards
                meeting={meeting}
                onCancel={(jobId) => {
                  void cancelMeetingJob(meeting.id, jobId).then((result) => {
                    if (result.error) setError("无权取消：会话已失效，请刷新页面后重试。");
                    return refresh();
                  });
                }}
                onDebate={() => void say("@architect @skeptic debate this branch", "You")}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="relative flex h-[76px] shrink-0 items-center bg-[#242424] px-3">
        <div className="flex flex-1 items-end justify-center gap-1">
          <BarButton icon={listening ? Mic : MicOff} label={listening ? "静音" : "解除静音"} active={listening} onClick={toggleMic} />
          <BarButton icon={cameraOn ? Video : VideoOff} label={cameraOn ? "关闭视频" : "开启视频"} active={cameraOn} onClick={() => void toggleCamera()} />
          <BarButton icon={MonitorUp} label="共享屏幕" active={sharing} onClick={() => setSharing((value) => !value)} />
          <BarButton
            icon={UserPlus}
            label="邀请"
            onClick={() => {
              void navigator.clipboard?.writeText(meeting.joinCode);
              setError(`会议号 ${meeting.joinCode} 已复制`);
            }}
          />
          <BarButton icon={Users} label="成员" active={drawer === "members"} onClick={() => toggleDrawer("members")} />
          <BarButton icon={MessageSquare} label="聊天" active={drawer === "chat"} onClick={() => toggleDrawer("chat")} />
          <BarButton icon={Square} label="录制" active={recordingLocal} onClick={() => setRecordingLocal((value) => !value)} />
          <BarButton icon={MoreHorizontal} label="更多" active={moreOpen} onClick={() => setMoreOpen((value) => !value)} />
        </div>
        <button type="button" className="absolute right-4 rounded bg-[#f24747] px-4 py-1.5 text-sm text-white disabled:opacity-40" onClick={() => void endMeeting()} disabled={busy || meeting.status === "ended"} data-testid="end-meeting">
          结束
        </button>
        <div className={`absolute bottom-[80px] left-1/2 z-10 w-56 -translate-x-1/2 rounded-md bg-white py-1 text-sm text-[#222] shadow-float ${moreOpen ? "" : "hidden"}`}>
            {meeting.scenario === "incident" ? (
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f5f5f5]" onClick={() => void playScript()} disabled={playing || meeting.status === "ended"} data-testid="play-demo">
                播放 2:17 演练
              </button>
            ) : (
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f5f5f5]" onClick={() => void playPlanning()} disabled={playing || meeting.status === "ended"} data-testid="play-session">
                播放一段工作会话
              </button>
            )}
            {meeting.threadId ? (
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#f5f5f5]" onClick={() => router.push("/tasks")}>
                打开任务台
              </button>
            ) : null}
          </div>
        </footer>

      <Dialog open={askInstead} onOpenChange={setAskInstead}>
        <DialogContent>
          <DialogTitle>已回退</DialogTitle>
          <DialogDescription>你想改成什么？</DialogDescription>
        </DialogContent>
      </Dialog>

      {endedNote && meeting.status === "ended" ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded bg-[#123524] px-4 py-3 text-sm text-[#d7f5ea]">
          {endedNote}
        </div>
      ) : null}
    </div>
  );
}

function BarButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: typeof Mic;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={`flex w-[68px] flex-col items-center gap-1 py-1 text-[11px] ${active ? "text-[#7eb6ff]" : "text-white/90"}`}>
      <Icon className="h-5 w-5" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function Tile({
  person,
  speaking,
  self,
  cameraOn,
  videoRef,
  large = false,
  listening = false,
}: {
  person: MeetingState["participants"][number];
  speaking: boolean;
  self: boolean;
  cameraOn: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  large?: boolean;
  listening?: boolean;
}) {
  return (
    <article className={`relative flex items-center justify-center overflow-hidden rounded-md bg-[#2b2b2b] ${large ? "min-h-0" : "min-h-36"} ${person.kind === "ai" ? "bg-[#1f2a3a]" : ""} ${speaking || person.aiStatus === "speaking" ? "ring-2 ring-[#006fff]" : ""}`}>
      {self && cameraOn ? (
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
      ) : (
        <div className={`flex items-center justify-center rounded-full bg-[#3a3a3a] text-white ${large ? "h-24 w-24 text-3xl" : "h-14 w-14 text-lg"}`}>{person.name.slice(0, 1)}</div>
      )}
      {person.kind === "ai" ? (
        <p className="absolute right-2 top-2 rounded bg-[#006fff] px-1.5 py-0.5 text-[10px]" data-testid="seat-badge">
          AI · {AI_STATUS_LABEL[person.aiStatus ?? "offline"]}
        </p>
      ) : null}
      <p className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-xs">
        {person.micOn || (listening && self) ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3 text-white/70" />}
        {person.name}
      </p>
    </article>
  );
}

function AgentCards({ meeting, onCancel, onDebate }: { meeting: MeetingState; onCancel: (jobId: string) => void; onDebate: () => void }) {
  const suggestion = meeting.suggestions[0];
  return (
    <div className="space-y-4 pr-1">
      {suggestion ? (
        <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm leading-6 text-brand-deep" data-testid="suggestion">
          {suggestion.text}
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted">
          你们开会时，{ASSISTANT_NAME}会同步整理计划、设计、检查和参考资料，不需要单独下指令。
        </p>
      )}
      {meeting.pending ? (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm leading-6 text-warn" data-testid="confirm-wait">
          等待口头确认：{meeting.pending.prompt}
        </p>
      ) : null}
      {meeting.chatter.length > 0 ? (
        <p className="text-xs leading-5 text-muted" data-testid="parked-chatter">
          已搁置，不进入计划：{meeting.chatter.at(-1)?.text}
        </p>
      ) : null}
      <SeatPanel meeting={meeting} />
      {meeting.workstreams.length === 0 ? null : <DecisionTree meeting={meeting} onCancel={onCancel} onDebate={onDebate} />}
    </div>
  );
}

const AI_STATUS_LABEL: Record<"online" | "offline" | "speaking" | "demo", string> = {
  online: "在线",
  offline: "离线",
  speaking: "发言中",
  demo: "演示",
};

/** Q7: columns follow the head count (AI seats included) instead of a fixed two. */
function gridCols(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-3";
  return "grid-cols-4";
}

const DEBATE_STATUS: Record<string, string> = { running: "进行中", concluded: "已结束", interrupted: "已中断", failed: "失败" };
const CONCLUSION_STATUS: Record<string, string> = { pending: "待人确认", confirmed: "已确认", rejected: "已否决", incomplete: "未完成" };

/** F2: seat turns, debates and conclusion cards in the right panel. */
function SeatPanel({ meeting }: { meeting: MeetingState }) {
  const turns = meeting.seatTurns ?? [];
  const debates = meeting.seatDebates ?? [];
  const conclusions = meeting.conclusions ?? [];
  const queue = meeting.seatQueue ?? [];
  if (turns.length === 0 && debates.length === 0 && conclusions.length === 0) return null;
  const label = (id: string) => (id === "architect" ? "AI 架构师" : "AI 质疑者");
  return (
    <section className="space-y-2" data-testid="seat-panel">
      <p className="text-xs text-[#888]">AI 席位</p>
      {debates.map((debate) => (
        <div key={debate.id} className="rounded-lg border border-[#e9eaeb] p-3 text-xs leading-5" data-testid="seat-debate">
          <p className="font-medium">
            辩论：{debate.topic} · 第 {debate.round}/{debate.maxRounds} 轮 · {DEBATE_STATUS[debate.status] ?? debate.status}
          </p>
          {turns
            .filter((turn) => turn.debateId === debate.id)
            .map((turn) => (
              <p key={turn.id} className="mt-1">
                <span className="text-[#006fff]">{label(turn.seatId)}：</span>
                {turn.text}
                {turn.citations.length > 0 ? <span className="text-[#888]"> （引用：{turn.citations.map((c) => c.label).join("；")}）</span> : null}
              </p>
            ))}
        </div>
      ))}
      {turns
        .filter((turn) => turn.debateId === null)
        .map((turn) => (
          <p key={turn.id} className="rounded-lg bg-[#fafafa] p-3 text-xs leading-5" data-testid="seat-turn">
            <span className="text-[#006fff]">{label(turn.seatId)}：</span>
            {turn.text}
          </p>
        ))}
      {queue.length > 0 ? <p className="text-xs text-[#888]">排队中：{queue.length} 个请求</p> : null}
      {conclusions.map((card) => (
        <article key={card.id} className="rounded-lg border border-[#006fff]/40 bg-[#f5f9ff] p-3 text-xs leading-5" data-testid="seat-conclusion">
          <p className="font-medium">
            结论卡 {card.id} · {CONCLUSION_STATUS[card.status] ?? card.status}
          </p>
          <p className="mt-1">分支：{card.topic}</p>
          <p>推荐：{card.recommendation}</p>
          {card.reasons.length > 0 ? <p>理由：{card.reasons.join("；")}</p> : null}
          {card.risks.length > 0 ? <p>风险：{card.risks.join("；")}</p> : null}
          {card.humanDecisions.length > 0 ? <p>需要人决定：{card.humanDecisions.join("；")}</p> : null}
          {card.citations.length > 0 ? <p className="text-[#888]">引用：{card.citations.map((c) => c.label).join("；")}</p> : null}
          {card.status === "pending" ? <p className="mt-1 text-[#b26b00]">说 &quot;yes {card.id}&quot; 写入决策记录。</p> : null}
        </article>
      ))}
    </section>
  );
}

/** B3: transcript lines from the assistant are stored as "Alexa"; show the agreed display name. */
function displaySpeaker(speaker: string) {
  return speaker === "Alexa" ? ASSISTANT_NAME : speaker;
}
