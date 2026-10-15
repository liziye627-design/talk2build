"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, LogIn, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export function MeetingHome() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingCard[]>([]);
  const [error, setError] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [code, setCode] = useState("");
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

  async function start() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Working session", host: "You", team: ["Maya", "Chris", "Priya"] }),
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

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-8 py-8">
        <div>
          <p className="text-sm text-muted">Talk2Build</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Meetings</h1>
        </div>
        <a href="/tasks" className="text-sm text-brand">
          Task desk
        </a>
      </header>

      <main className="mx-auto grid max-w-5xl gap-10 px-8 pb-20 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="space-y-3">
          <Button className="h-11 w-full" onClick={() => void start()} disabled={busy} data-testid="start-meeting">
            <Video className="h-4 w-4" />
            Start meeting
          </Button>
          <Button variant="secondary" className="h-11 w-full" onClick={() => setJoinOpen(true)} data-testid="join-meeting">
            <LogIn className="h-4 w-4" />
            Join
          </Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => setScheduleOpen(true)} data-testid="schedule-meeting">
            <CalendarPlus className="h-4 w-4" />
            Schedule
          </Button>
          <article className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <p className="text-xs text-muted">Your room</p>
            <p className="mt-3 font-mono text-xl tracking-wide text-ink">{personal?.joinCode ?? "TB-ROOM"}</p>
            <p className="mt-3 text-sm leading-6 text-body">Share the code. The agent already knows the decisions from yesterday when the room starts talking.</p>
            {personal ? (
              <Button variant="ghost" size="sm" className="mt-3 px-0 text-brand" onClick={() => router.push(`/meetings/${personal.id}`)}>
                Open your room
              </Button>
            ) : null}
          </article>
          <Button
            variant="ghost"
            className="w-full text-muted"
            onClick={() => {
              void fetch("/api/meetings/incident", { method: "POST" }).then(() => router.push("/meetings/demo"));
            }}
          >
            Incident demo
          </Button>
        </section>

        <section>
          <h2 className="text-sm font-medium text-body">Recent</h2>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <ul className="mt-4 space-y-2">
            {recent.length === 0 ? (
              <li className="rounded-xl border border-dashed border-line px-5 py-12 text-sm text-muted">
                No meetings yet. Start one and the room will keep the plan, the designs, and the checks.
              </li>
            ) : (
              recent.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/meetings/${meeting.id}`)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4 text-left shadow-card hover:border-brand/30"
                  >
                    <span>
                      <span className="block text-sm font-medium">{meeting.title}</span>
                      <span className="mt-1 block text-xs text-muted">
                        {meeting.joinCode}
                        {meeting.scheduledFor ? ` · ${meeting.scheduledFor}` : ""}
                      </span>
                    </span>
                    <Badge variant={meeting.status === "live" ? "ok" : "muted"}>{meeting.status}</Badge>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent>
          <DialogTitle>Join a meeting</DialogTitle>
          <DialogDescription>Use the code from the invite. Your room is TB-ROOM.</DialogDescription>
          <form onSubmit={(event) => void join(event)} className="mt-4 flex gap-2">
            <Input id="join-code" name="code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="TB-ROOM" aria-label="Meeting code" />
            <Button type="submit" disabled={busy || !code.trim()}>
              Join
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogTitle>Schedule</DialogTitle>
          <DialogDescription>The room stays on the list until someone starts it.</DialogDescription>
          <form onSubmit={(event) => void schedule(event)} className="mt-4 space-y-3">
            <Input id="schedule-title" name="title" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Meeting title" />
            <Input id="schedule-when" name="when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} aria-label="When" />
            <Button type="submit" disabled={busy}>
              Add to the list
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
