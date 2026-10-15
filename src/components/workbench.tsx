"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Check,
  Circle,
  FileText,
  FolderOpen,
  Loader2,
  Mic,
  Plus,
  Search,
  Square,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ThreadRow {
  id: string;
  title: string;
  workspaceId: string;
  meetingId: string | null;
  provider: string;
  status: "idle" | "running" | "done";
  plan: { steps: PlanStep[]; pending: { prompt: string } | null };
}

interface PlanStep {
  id: string;
  text: string;
  status: "done" | "next" | "pending";
}

interface ToolCall {
  name: string;
  ok: boolean;
  summary: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: { calls?: ToolCall[]; plan?: PlanStep[] } | null;
}

interface Artifact {
  id: string;
  workspaceId: string;
  path: string;
  title: string;
  kind: string;
}

interface Workspace {
  id: string;
  name: string;
}

interface MeetingCard {
  id: string;
  title: string;
  status: string;
  joinCode: string;
}

interface Bootstrap {
  threads: ThreadRow[];
  meetings: MeetingCard[];
  workspaces: Workspace[];
  providers: { id: string; label: string; model: string }[];
}

const SUGGESTIONS = [
  { id: "yesterday", label: "What did we decide yesterday?" },
  { id: "issues", label: "Turn yesterday's action items into issues" },
  { id: "spec", label: "Write a spec for the nightly billing export" },
  { id: "scaffold", label: "Scaffold an export checker and run its tests" },
  { id: "meeting", label: "Start a planning meeting" },
];

function linkify(text: string) {
  const parts = text.split(/(\/meetings\/[A-Za-z0-9_-]+)/g);
  return parts.map((part, index) =>
    part.startsWith("/meetings/") ? (
      <a key={`${part}-${index}`} href={part} className="text-[#9eb6ff] underline-offset-2 hover:underline">
        {part}
      </a>
    ) : (
      <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
    ),
  );
}

export function Workbench() {
  const router = useRouter();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [liveTools, setLiveTools] = useState<ToolCall[]>([]);
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState("mock");
  const [workspaceId, setWorkspaceId] = useState("desk");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [preview, setPreview] = useState<{ path: string; contents: string } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const recognition = useRef<SpeechRecognition | null>(null);

  async function loadBoot() {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error("Could not load the desk.");
    const body = (await response.json()) as Bootstrap;
    setBoot(body);
    if (!body.workspaces.some((item) => item.id === workspaceId) && body.workspaces[0]) {
      setWorkspaceId(body.workspaces[0].id);
    }
    return body;
  }

  useEffect(() => {
    loadBoot().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load."));
    // Mount only. Later refreshes call loadBoot directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, streaming, liveTools]);

  const threads = useMemo(() => {
    const items = boot?.threads ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((thread) => thread.title.toLowerCase().includes(needle));
  }, [boot, query]);

  async function openThread(id: string) {
    setActiveId(id);
    setNavOpen(false);
    setPreview(null);
    setStreaming("");
    setLiveTools([]);
    const response = await fetch(`/api/threads/${id}`);
    const body = (await response.json()) as { thread: ThreadRow; messages: ChatMessage[]; artifacts: Artifact[] };
    setMessages(body.messages);
    setArtifacts(body.artifacts);
    setProvider(body.thread.provider || "mock");
    setWorkspaceId(body.thread.workspaceId || "desk");
    const last = [...body.messages].reverse().find((message) => message.role === "assistant");
    setPlan(last?.tools?.plan ?? body.thread.plan.steps ?? []);
  }

  async function createTask() {
    const response = await fetch("/api/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, provider }),
    });
    const body = (await response.json()) as { thread: ThreadRow };
    await loadBoot();
    setActiveId(body.thread.id);
    setMessages([]);
    setArtifacts([]);
    setPlan([]);
    setLiveTools([]);
    setPreview(null);
    setNavOpen(false);
    return body.thread.id;
  }

  async function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setError("");
    setBusy(true);
    setDraft("");
    setStreaming("");
    setLiveTools([]);
    let threadId = activeId;
    try {
      if (!threadId) threadId = await createTask();
      setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: value }]);
      const response = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value, provider, workspaceId }),
      });
      if (!response.ok || !response.body) {
        const failure = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failure.error || "The task did not run.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = block.match(/^event: (.+)$/m)?.[1];
          const dataLine = block.match(/^data: (.+)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine) as {
            steps?: PlanStep[];
            name?: string;
            ok?: boolean;
            summary?: string;
            text?: string;
            message?: ChatMessage;
            artifacts?: Artifact[];
            openMeetingId?: string | null;
          };
          if (event === "plan" && data.steps) setPlan(data.steps);
          if (event === "tool" && data.name) {
            setLiveTools((current) => [...current, { name: data.name!, ok: Boolean(data.ok), summary: data.summary || "" }]);
          }
          if (event === "delta" && data.text) {
            assembled += data.text;
            setStreaming(assembled);
          }
          if (event === "done" && data.message) {
            setMessages((current) => [...current, data.message!]);
            setArtifacts(data.artifacts ?? []);
            setStreaming("");
            if (data.message.tools?.plan) setPlan(data.message.tools.plan);
          }
        }
      }
      await loadBoot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      setError("This browser has no speech recognition. Type the task instead.");
      return;
    }
    if (listening && recognition.current) {
      recognition.current.stop();
      setListening(false);
      return;
    }
    const session = new Speech();
    recognition.current = session;
    session.lang = "en-US";
    session.interimResults = false;
    session.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) void send(said);
    };
    session.onend = () => setListening(false);
    session.onerror = () => setListening(false);
    setListening(true);
    session.start();
  }

  async function openIncident() {
    const response = await fetch("/api/meetings/incident", { method: "POST" });
    const body = (await response.json()) as { meeting: { id: string } };
    router.push(`/meetings/${body.meeting.id}`);
  }

  async function showArtifact(artifact: Artifact) {
    const response = await fetch(`/api/workspaces/${artifact.workspaceId}/file?path=${encodeURIComponent(artifact.path)}`);
    const body = (await response.json()) as { contents?: string; error?: string; path: string };
    setPreview({ path: artifact.path, contents: body.contents || body.error || "" });
  }

  const active = boot?.threads.find((thread) => thread.id === activeId) ?? null;
  const toolNames = [
    ...new Set([
      ...liveTools.map((call) => call.name),
      ...messages.flatMap((message) => message.tools?.calls?.map((call) => call.name) ?? []),
    ]),
  ];

  return (
    <div className="flex h-dvh overflow-hidden bg-[#0b0e13] text-[#f3efe6]">
      <aside
        className={`${navOpen ? "flex" : "hidden"} absolute z-20 h-full w-72 flex-col border-r border-white/10 bg-[#0e1218] lg:static lg:flex`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa3b2]">Talk2Build</p>
            <p className="text-sm text-[#f3efe6]">Tasks</p>
          </div>
          <Button size="sm" onClick={() => void createTask()} data-testid="new-task">
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        </div>
        <div className="px-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8b93a1]" />
            <Input
              id="task-search"
              name="task-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks"
              className="pl-9"
              aria-label="Search tasks"
            />
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
          {threads.length === 0 ? (
            <p className="px-2 py-3 text-sm text-[#8b93a1]">No tasks yet. Describe an outcome to start one.</p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => void openThread(thread.id)}
                className={`flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/6 ${activeId === thread.id ? "bg-white/8" : ""}`}
              >
                <span className="line-clamp-2">{thread.title}</span>
                <Badge variant={thread.status === "running" ? "ok" : "muted"}>{thread.status}</Badge>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-white/10 p-3">
          <p className="px-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9aa3b2]">Meetings</p>
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {(boot?.meetings ?? []).map((meeting) => (
              <a key={meeting.id} href={`/meetings/${meeting.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-white/6">
                <span className="block truncate">{meeting.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8b93a1]">
                  {meeting.status} · {meeting.joinCode}
                </span>
              </a>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void openIncident()}
            className="mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-[#c9d0da] hover:bg-white/6"
            data-testid="incident-demo"
          >
            Incident demo
            <span className="mt-0.5 block text-xs text-[#8b93a1]">2:17 AM orders postmortem</span>
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setNavOpen((open) => !open)}>
              Tasks
            </Button>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#9aa3b2]">Task</p>
              <h1 className="text-sm">{active?.title ?? "New task"}</h1>
            </div>
          </div>
          {active?.meetingId ? (
            <a href={`/meetings/${active.meetingId}`} className="text-xs text-[#9eb6ff]">
              Open meeting
            </a>
          ) : null}
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-10">
          {messages.length === 0 && !streaming ? (
            <div className="mx-auto flex max-w-2xl flex-col items-start pt-10 lg:pt-20">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#e7b15a]">Talk2Build</p>
              <h2 className="mt-3 font-[family-name:var(--font-fraunces)] text-4xl leading-tight text-[#f6f1e7] sm:text-5xl">
                More than chat. Get the work done.
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-[#b7c0cc]">
                Describe the result you want. Talk2Build lays out the steps, runs the tools, and leaves the files in the workspace.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {SUGGESTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`suggestion-${item.id}`}
                    onClick={() => void send(item.label)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-[#e7e1d6] hover:border-[#e7b15a]/40"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-8" : ""}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8b93a1]">
                    {message.role === "user" ? "You" : "Talk2Build"}
                  </p>
                  <div
                    className={
                      message.role === "user"
                        ? "mt-1 rounded-2xl bg-white/8 px-4 py-3 text-sm leading-6"
                        : "mt-1 text-sm leading-7 text-[#f3efe6]"
                    }
                  >
                    {linkify(message.content)}
                  </div>
                  {message.tools?.calls && message.tools.calls.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {message.tools.calls.map((call, index) => (
                        <ToolCard key={`${message.id}-${call.name}-${index}`} call={call} />
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {liveTools.map((call, index) => (
                <ToolCard key={`live-${call.name}-${index}`} call={call} />
              ))}
              {streaming ? (
                <p className="text-sm leading-7">
                  {streaming}
                  <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-[#e7b15a]" />
                </p>
              ) : null}
            </div>
          )}
        </div>

        {error ? <p className="px-6 pb-2 text-sm text-[#ff8d8d]">{error}</p> : null}

        <form
          className="px-4 pb-4 lg:px-10"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-[#121821] p-3 shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
            <textarea
              id="task-composer"
              name="task"
              data-testid="composer"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={2}
              placeholder="Describe the result. A decision, a spec, a fix, a meeting."
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-[#8b93a1]"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-xs text-[#c9d0da]">
                <FolderOpen className="h-3.5 w-3.5" />
                <select
                  id="workspace-picker"
                  name="workspace"
                  aria-label="Workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  className="bg-transparent outline-none"
                >
                  {(boot?.workspaces ?? [{ id: "desk", name: "Desk" }]).map((workspace) => (
                    <option key={workspace.id} value={workspace.id} className="bg-[#121821]">
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-xs text-[#c9d0da]">
                <select
                  id="model-picker"
                  name="model"
                  aria-label="Model"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="bg-transparent outline-none"
                  data-testid="model-picker"
                >
                  {(boot?.providers ?? []).map((item) => (
                    <option key={item.id} value={item.id} className="bg-[#121821]">
                      {item.label} · {item.model}
                    </option>
                  ))}
                </select>
              </label>
              <span className="hidden text-xs text-[#8b93a1] sm:inline">{workspaceId}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" size="icon" onClick={toggleMic} aria-label={listening ? "Stop microphone" : "Microphone"}>
                  {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button type="submit" size="icon" disabled={busy || !draft.trim()} data-testid="send" aria-label="Send">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </section>

      <aside className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-[#10151c] lg:flex" data-testid="task-monitor">
        <Monitor plan={plan} artifacts={artifacts} tools={toolNames} preview={preview} busy={busy} onOpen={(artifact) => void showArtifact(artifact)} />
      </aside>
    </div>
  );
}

function ToolCard({ call }: { call: ToolCall }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#10151c] px-3 py-2" data-testid="tool-card">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-[#9eb6ff]">{call.name}</p>
        <Badge variant={call.ok ? "ok" : "danger"}>{call.ok ? "done" : "failed"}</Badge>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#c9d0da]">{call.summary}</p>
    </div>
  );
}

function Monitor({
  plan,
  artifacts,
  tools,
  preview,
  busy,
  onOpen,
}: {
  plan: PlanStep[];
  artifacts: Artifact[];
  tools: string[];
  preview: { path: string; contents: string } | null;
  busy: boolean;
  onOpen: (artifact: Artifact) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#e7b15a]">Task monitor</p>
      <h2 className="mt-1 text-sm">Plan, files, tools</h2>

      <section className="mt-5">
        <h3 className="text-xs uppercase tracking-[0.16em] text-[#9aa3b2]">To-do</h3>
        {plan.length === 0 ? (
          <p className="mt-2 text-sm text-[#8b93a1]">{busy ? "Planning the next step." : "Steps show up when a task is running."}</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {plan.map((step) => (
              <li key={step.id} className="flex gap-2 text-sm leading-5">
                {step.status === "done" ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#5ddeaf]" />
                ) : (
                  <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${step.status === "next" ? "text-[#e7b15a]" : "text-[#5c6570]"}`} />
                )}
                <span className={step.status === "done" ? "text-[#c9d0da]" : "text-[#f3efe6]"}>{step.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <h3 className="flex items-center gap-1 text-xs uppercase tracking-[0.16em] text-[#9aa3b2]">
          <FileText className="h-3.5 w-3.5" /> Artifacts
        </h3>
        {artifacts.length === 0 ? (
          <p className="mt-2 text-sm text-[#8b93a1]">Files written for this task land here.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button type="button" onClick={() => onOpen(artifact)} className="w-full truncate rounded-lg px-2 py-1 text-left font-mono text-xs text-[#d5defc] hover:bg-white/6">
                  {artifact.path}
                </button>
              </li>
            ))}
          </ul>
        )}
        {preview ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] leading-5 text-[#d7deea]" data-testid="artifact-preview">
            {preview.path}
            {"\n\n"}
            {preview.contents}
          </pre>
        ) : null}
      </section>

      <section className="mt-6">
        <h3 className="flex items-center gap-1 text-xs uppercase tracking-[0.16em] text-[#9aa3b2]">
          <Wrench className="h-3.5 w-3.5" /> Skills & MCP
        </h3>
        {tools.length === 0 ? (
          <p className="mt-2 text-sm text-[#8b93a1]">Tool calls from the MCP server show up as they run.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {tools.map((name) => (
              <Badge key={name} variant="default">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
