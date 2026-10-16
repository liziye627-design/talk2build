"use client";

import { STATUS_LABEL } from "@/lib/branding";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, LogIn, MonitorUp, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface MeetingCard {
  id: string;
  title: string;
  status: string;
  joinCode: string;
  scheduledFor: string | null;
  updatedAt: string;
  scenario: string;
}

const actions = [
  { id: "join", label: "加入会议", icon: LogIn },
  { id: "quick", label: "快速会议", icon: Video },
  { id: "schedule", label: "预定会议", icon: CalendarPlus },
  { id: "share", label: "共享屏幕", icon: MonitorUp },
] as const;

export function MeetingHome() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingCard[]>([]);
  const [error, setError] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [code, setCode] = useState("TB-ROOM");
  const [displayName, setDisplayName] = useState("You");
  const [title, setTitle] = useState("Billing export working session");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/meetings");
    if (!response.ok) throw new Error("Could not load meetings.");
    const body = (await response.json()) as { meetings: MeetingCard[] };
    setMeetings(body.meetings);
  }

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load."));
  }, []);

  async function start(nextTitle = "Working session") {
    setBusy(true);
    setError("");
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: nextTitle, host: displayName || "You", team: ["Maya", "Chris", "Priya"] }),
    });
    const body = (await response.json()) as { meeting?: { id: string }; error?: string };
    setBusy(false);
    if (!response.ok || !body.meeting) {
      setError(body.error || "Could not start the meeting.");
      return;
    }
    router.push(`/meetings/${body.meeting.id}`);
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/meetings/join-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json()) as { meeting?: { id: string }; error?: string };
    setBusy(false);
    if (!response.ok || !body.meeting) {
      setError(body.error || "That code did not match.");
      return;
    }
    router.push(`/meetings/${body.meeting.id}`);
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/meetings/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, when }),
    });
    const body = (await response.json()) as { meeting?: MeetingCard; error?: string };
    setBusy(false);
    if (!response.ok || !body.meeting) {
      setError(body.error || "Could not schedule.");
      return;
    }
    setScheduleOpen(false);
    await load();
  }

  const personal = meetings.find((meeting) => meeting.id === "personal");
  const recent = meetings.filter((meeting) => meeting.id !== "personal");

  function onAction(id: (typeof actions)[number]["id"]) {
    if (id === "join") {
      setError("");
      setJoinOpen(true);
      return;
    }
    if (id === "schedule") {
      setError("");
      setScheduleOpen(true);
      return;
    }
    if (id === "share") {
      void start("屏幕共享");
      return;
    }
    void start();
  }

  return (
    <div className="flex h-dvh bg-white text-[#1a1a1a]" style={{ fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",Inter,sans-serif' }}>
      <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-[#ececec] bg-[#f3f3f4] py-4">
        <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-lg bg-[#006fff] text-sm font-semibold text-white">会</div>
        <RailItem active label="会议" />
        <RailItem label="录制" />
        <a href="/tasks" className="mt-1 flex w-full flex-col items-center gap-1 py-3 text-[11px] text-[#8a8a8a] hover:text-[#006fff]">
          <span className="h-5 w-5 rounded-md border border-current" />
          任务
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end px-8 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#006fff] text-xs text-white">Y</span>
            <span>You</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-10 pb-10">
          <div className="flex items-start justify-center gap-14 pt-6">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy}
                  data-testid={action.id === "quick" ? "start-meeting" : action.id === "join" ? "join-meeting" : action.id === "schedule" ? "schedule-meeting" : undefined}
                  onClick={() => onAction(action.id)}
                  aria-label={action.label}
                  className="flex w-16 flex-col items-center gap-3 text-[13px] text-[#222] disabled:opacity-50"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#006fff] text-white" aria-hidden="true">
                    <Icon className="h-6 w-6" strokeWidth={1.75} />
                  </span>
                  {action.label}
                </button>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-[#8d8d8d]">
            个人会议号 {personal?.joinCode ?? "TB-ROOM"}
            <button type="button" className="ml-3 text-[#006fff]" onClick={() => personal && router.push(`/meetings/${personal.id}`)}>
              进入
            </button>
          </p>

          <section className="mt-10">
            <h2 className="text-sm text-[#666]">会议列表</h2>
            {error && !joinOpen ? <p className="mt-3 text-sm text-[#e34d59]">{error}</p> : null}
            <ul className="mt-3 divide-y divide-[#f0f0f0] border-t border-[#f0f0f0]">
              {recent.length === 0 ? (
                <li className="py-10 text-sm text-[#8d8d8d]">还没有预定会议。快速会议不会出现在这里。</li>
              ) : (
                recent.map((meeting) => (
                  <li key={meeting.id} className="flex items-center gap-6 py-4">
                    <span className="w-28 shrink-0 text-xs text-[#8d8d8d]">{meeting.scheduledFor ? meeting.scheduledFor.replace("T", " ").slice(0, 16) : (STATUS_LABEL[meeting.status as keyof typeof STATUS_LABEL] ?? meeting.status)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{meeting.title}</span>
                      <span className="mt-1 block text-xs text-[#8d8d8d]">{meeting.joinCode}</span>
                    </span>
                    <button type="button" className="text-sm text-[#006fff]" onClick={() => router.push(`/meetings/${meeting.id}`)}>
                      进入
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              className="mt-4 text-xs text-[#8d8d8d] hover:text-[#006fff]"
              onClick={() => {
                void fetch("/api/meetings/incident", { method: "POST" }).then(() => router.push("/meetings/demo"));
              }}
            >
              2:17 演练
            </button>
          </section>
        </main>
      </div>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogTitle>加入会议</DialogTitle>
          <DialogDescription>输入会议号和你在会中显示的名称。</DialogDescription>
          <form onSubmit={(event) => void join(event)} className="mt-4 space-y-3">
            <Input id="join-code" name="code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="会议号" aria-label="会议号" />
            <Input id="join-name" name="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} aria-label="您的名称" />
            <label className="flex items-center gap-2 text-sm text-[#444]">
              <input type="checkbox" name="mic" defaultChecked /> 自动连接音频
            </label>
            <label className="flex items-center gap-2 text-sm text-[#444]">
              <input type="checkbox" name="camera" /> 入会开启摄像头
            </label>
            <Button type="submit" disabled={busy || !code.trim()} className="w-full bg-[#006fff] hover:bg-[#0057d6]">
              加入会议
            </Button>
            {error ? <p className="text-sm text-[#e34d59]">{error}</p> : null}
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogTitle>预定会议</DialogTitle>
          <DialogDescription>填写主题和时间。预定后会出现在会议列表。</DialogDescription>
          <form onSubmit={(event) => void schedule(event)} className="mt-4 space-y-3">
            <Input id="schedule-title" name="title" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="会议主题" />
            <Input id="schedule-when" name="when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} aria-label="开始时间" />
            <Button type="submit" disabled={busy} className="w-full bg-[#006fff] hover:bg-[#0057d6]">
              预定
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RailItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div className={`flex w-full flex-col items-center gap-1 py-3 text-[11px] ${active ? "text-[#006fff]" : "text-[#8a8a8a]"}`}>
      <span className={`h-5 w-5 rounded-md border ${active ? "border-[#006fff] bg-[#e8f2ff]" : "border-current"}`} />
      {label}
    </div>
  );
}
