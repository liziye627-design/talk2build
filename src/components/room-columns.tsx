import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiffFile, MeetingState } from "@/lib/types";

function Column({
  kicker,
  title,
  children,
  testId,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="flex h-full min-h-[28rem] flex-col rounded-2xl border border-white/10 bg-[#121821]/90 lg:min-h-0" data-testid={testId}>
      <header className="border-b border-white/8 px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa3b2]">{kicker}</p>
        <h2 className="mt-1 text-sm text-[#f3efe6]">{title}</h2>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">{children}</div>
      </ScrollArea>
    </section>
  );
}

export function TranscriptColumn({ state }: { state: MeetingState }) {
  return (
    <Column kicker="01  Live" title="Transcript" testId="transcript">
      {state.transcript.length === 0 ? (
        <p className="text-sm leading-6 text-[#9aa3b2]">
          The room is quiet. Unmute a microphone, type a line, or play the incident script when this is the 2:17 AM review.
        </p>
      ) : (
        state.transcript.map((line) => (
          <article key={line.id} className="grid grid-cols-[auto_1fr] gap-3">
            <Badge variant={line.speaker === "A" ? "a" : line.speaker === "B" ? "b" : "alexa"}>
              {line.speaker === "Alexa" ? "Alexa+" : line.speaker}
            </Badge>
            <div>
              <p className={line.speaker === "Alexa" ? "text-sm leading-6 text-[#d5defc]" : "text-sm leading-6 text-[#f3efe6]"}>
                {line.text}
              </p>
              {line.kind && line.speaker !== "Alexa" ? (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#9aa3b2]">{line.kind}</p>
              ) : null}
            </div>
          </article>
        ))
      )}
    </Column>
  );
}

export function PoolColumn({ state }: { state: MeetingState }) {
  return (
    <Column kicker="02  Pool" title="Timeline, decisions, chatter" testId="pool">
      <div data-testid="timeline">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#9aa3b2]">Timeline</p>
        {state.timeline.length === 0 ? (
          <p className="mt-2 text-sm text-[#9aa3b2]">Nothing on the timeline yet. Alexa+ is listening.</p>
        ) : (
          <ol className="mt-3 space-y-3 border-l border-white/10 pl-4">
            {state.timeline.map((event) => (
              <li key={event.id}>
                <p className="font-mono text-xs text-[#e7b15a]">{event.timeLabel}</p>
                <p className="text-sm text-[#f3efe6]">{event.title}</p>
                <p className="text-xs leading-5 text-[#9aa3b2]">{event.detail}</p>
                {event.correlationNote ? (
                  <p className="mt-1 text-xs text-[#9eb6ff]">Linked. {event.correlationNote}</p>
                ) : null}
                {event.metrics ? <Spark samples={event.metrics} /> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div data-testid="decision-pool" className="border-t border-white/8 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#9aa3b2]">Decisions and requirements</p>
        {state.decisions.length === 0 && state.requirements.length === 0 ? (
          <p className="mt-2 text-sm text-[#9aa3b2]">Decisions land here, with the name of who made them.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {state.decisions.map((item) => (
              <li key={item.id} className="rounded-xl bg-white/4 px-3 py-2">
                <Badge variant={item.speaker === "A" ? "a" : "b"}>{item.speaker}</Badge>
                <p className="mt-1 text-sm leading-5 text-[#f3efe6]">{item.text}</p>
              </li>
            ))}
            {state.requirements.map((item) => (
              <li key={item.id} className="text-sm leading-5 text-[#d7deea]">
                <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7ddec8]">{item.speaker}</span>
                {item.text}
              </li>
            ))}
          </ul>
        )}
        {state.todos.length > 0 ? (
          <ul className="mt-3 space-y-1" data-testid="todos">
            {state.todos.map((item) => (
              <li key={item.id} className="text-sm text-[#f3efe6]">
                <span className="mr-2 font-mono text-[10px] text-[#e7b15a]">TODO</span>
                {item.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div data-testid="chatter" className="rounded-xl border border-dashed border-[#c4b6a6]/30 bg-[#c4b6a6]/5 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#c4b6a6]">Chatter · 水聊</p>
        <p className="mt-1 text-xs text-[#9aa3b2]">Parked. Not in the requirement pool.</p>
        {state.chatter.length === 0 ? (
          <p className="mt-2 text-sm text-[#9aa3b2]">Side talk stays in this column. Alexa+ stays quiet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {state.chatter.map((item) => (
              <li key={item.id} className="text-sm text-[#d9d0c4]">
                <span className="mr-2 font-mono text-[10px]">{item.speaker}</span>
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Column>
  );
}

export function DiffColumn({ state, animate }: { state: MeetingState; animate: boolean }) {
  return (
    <Column kicker="03  Change" title="Diff and pull request" testId="diff-column">
      {state.deploy ? (
        <article className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid="deploy-card">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#e7b15a]">Deploy</p>
          <p className="mt-1 text-sm text-[#f3efe6]">
            {state.deploy.service} {state.deploy.version}
          </p>
          <p className="text-xs text-[#9aa3b2]">
            {state.deploy.deployedLabel} · {state.deploy.environment} · {state.deploy.commit} · {state.deploy.author}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#c9d0da]">{state.deploy.summary}</p>
        </article>
      ) : (
        <p className="text-sm text-[#9aa3b2]">No deploy card yet. Ask about the batch job.</p>
      )}

      <div data-testid="diff">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9aa3b2]">Incident diff</p>
        {state.incidentDiff ? (
          <DiffList files={state.incidentDiff} animate={false} />
        ) : (
          <p className="mt-2 text-sm text-[#9aa3b2]">No deploy diff pulled.</p>
        )}
      </div>

      <div data-testid="pr">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9aa3b2]">Pull request</p>
        {state.pullRequest ? (
          <div className="mt-2">
            <p className="text-sm text-[#f3efe6]">{state.pullRequest.title}</p>
            <p className="font-mono text-[11px] text-[#9aa3b2]">
              {state.pullRequest.branch} → {state.pullRequest.base} · {state.pullRequest.status}
            </p>
            <DiffList files={state.pullRequest.files} animate={animate} />
            <ul className="mt-3 space-y-1">
              {state.pullRequest.tests.map((test) => (
                <li key={test.name} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-[#d7deea]">{test.name}</span>
                  <Badge variant={test.passed ? "ok" : "danger"}>{test.passed ? "pass" : "fail"}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#9aa3b2]">The fix stays a draft until someone says to open it.</p>
        )}
      </div>

      {state.docs[0] ? (
        <article className="border-t border-white/8 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9aa3b2]">Doc</p>
          <p className="mt-1 text-sm text-[#f3efe6]">{state.docs[0].title}</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#9aa3b2]">
            {state.docs[0].body}
          </pre>
        </article>
      ) : null}
    </Column>
  );
}

function Spark({ samples }: { samples: { t: string; connections: number }[] }) {
  const max = Math.max(...samples.map((sample) => sample.connections), 1);
  const width = 140;
  const height = 36;
  const path = samples
    .map((sample, index) => {
      const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * width;
      const y = height - (sample.connections / max) * (height - 6) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-9 w-36" aria-hidden>
      <path d={path} fill="none" stroke="#ff6d6d" strokeWidth="1.6" />
    </svg>
  );
}

function DiffList({ files, animate }: { files: DiffFile[]; animate: boolean }) {
  const lines = files.flatMap((file) => file.lines.map((line) => ({ file: file.path, line })));
  return (
    <div className="mt-2 space-y-3">
      {files.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-xl border border-white/10 bg-[#0c1016]">
          <p className="border-b border-white/8 px-3 py-1.5 font-mono text-[11px] text-[#c9d0da]">{file.path}</p>
          <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-5">
            {file.lines.map((line, index) => {
              const flatIndex = lines.findIndex((item) => item.file === file.path && item.line === line);
              return (
                <div
                  key={`${file.path}-${index}`}
                  className={lineClass(line.type, line.highlight)}
                  style={animate ? { animation: `line-in 0.25s ease both`, animationDelay: `${flatIndex * 28}ms` } : undefined}
                >
                  <span className="mr-2 text-[#667085]">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                  {line.text}
                </div>
              );
            })}
          </pre>
        </div>
      ))}
    </div>
  );
}

function lineClass(type: string, highlight?: string) {
  if (highlight === "shrink" || highlight === "missing-timeout") return "bg-[#ff6d6d]/15 text-[#ffb4b4]";
  if (highlight === "fix" || type === "add") return "bg-[#5ddeaf]/10 text-[#b7f3d8]";
  if (type === "del") return "bg-[#ff6d6d]/10 text-[#ffb4b4]";
  return "text-[#9aa3b2]";
}
