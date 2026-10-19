import { ui } from "@/lib/ui-text";
import { buildDecisionTree, decisionGoal } from "@/lib/agent/tree";
import { chartMetric } from "@/lib/evidence/select";
import { failureLabel, isThirdParty, metricDisplayable, metricValueText, reportOffline, sourceName } from "@/lib/evidence/display";
import type { EvidenceOption, EvidenceReport, TechSelection } from "@/lib/evidence/types";
import type { MeetingState, Workstream } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

/** Confirm prompts end with the job id so a spoken "yes <id>" can pick one; the card does not need to show it. */
export function displayPrompt(text: string) {
  return text.replace(/\s*Say yes to confirm \S+\.?$/, " Say yes to confirm.");
}

function statusVariant(status: Workstream["status"]) {
  if (status === "ready") return "ok" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "working") return "b" as const;
  return "muted" as const;
}

function EvidenceChart({ report }: { report: EvidenceReport }) {
  const metricName = chartMetric(report);
  if (!metricName) return <p className="text-xs text-[#888]">{ui.tree.noNumbers}</p>;
  const bars = report.options
    .map((option) => {
      const metric = option.metrics.find((item) => item.name === metricName && item.value != null && metricDisplayable(item));
      return metric && metric.value != null ? { label: option.label, value: metric.value } : null;
    })
    .filter((item): item is { label: string; value: number } => Boolean(item));
  if (bars.length === 0) return <p className="text-xs text-[#888]">{ui.tree.noNumbers}</p>;
  const max = Math.max(...bars.map((item) => item.value), 1);
  const width = 240;
  const height = 18 + bars.length * 28;
  return (
    <svg data-testid="evidence-chart" viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label={metricName}>
      <text x="0" y="12" fontSize="10" fill="#666">
        {metricName}
      </text>
      {bars.map((bar, index) => {
        const y = 20 + index * 28;
        const barWidth = Math.max(2, Math.round((bar.value / max) * (width - 70)));
        return (
          <g key={bar.label}>
            <text x="0" y={y + 12} fontSize="10" fill="#222">
              {bar.label}
            </text>
            <rect x="64" y={y} width={barWidth} height="14" rx="3" fill="#006fff" />
          </g>
        );
      })}
    </svg>
  );
}

function EvidenceBody({ report, cachedAt }: { report: EvidenceReport; cachedAt?: string }) {
  if (reportOffline(report)) {
    return (
      <p className="mt-3 rounded bg-[#fff4e5] px-2 py-1 text-xs text-[#b26b00]" data-testid="evidence-offline">
        {ui.tree.offline}
      </p>
    );
  }
  return (
    <div className="mt-3">
      {cachedAt ? (
        <p className="text-[11px] text-[#888]" data-testid="evidence-cached">
          {ui.tree.cachedAt}{cachedAt}
        </p>
      ) : null}
      {report.note ? <p className="text-xs leading-5 text-[#666]">{report.note}</p> : null}
      <div className="mt-2 grid grid-cols-2 gap-2" data-testid="evidence-forks">
        {report.options.map((option) => (
          <OptionFork key={option.label} option={option} />
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table data-testid="evidence-table" className="w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="text-[#888]">
              <th className="py-1 pr-2 font-medium">{ui.tree.option}</th>
              <th className="py-1 pr-2 font-medium">{ui.tree.metric}</th>
              <th className="py-1 pr-2 font-medium">{ui.tree.value}</th>
              <th className="py-1 font-medium">{ui.tree.source}</th>
            </tr>
          </thead>
          <tbody>
            {report.options.flatMap((option) =>
              option.metrics.map((metric) => (
                <tr key={`${option.label}-${metric.name}`} className={`border-t border-[#eee] align-top ${isThirdParty(metric.sourceUrl) ? "bg-[#fffaf2] italic" : ""}`}>
                  <td className="py-1 pr-2">{option.label}</td>
                  <td className="py-1 pr-2">{metric.name}</td>
                  <td className="py-1 pr-2" data-testid="evidence-value">
                    {failureLabel(metric) ? (
                      <span className="text-[#d93026]" title={metric.error}>
                        {failureLabel(metric)}
                      </span>
                    ) : (
                      (metricValueText(metric) ?? ui.tree.noData)
                    )}
                  </td>
                  <td className="py-1">
                    {isThirdParty(metric.sourceUrl) ? (
                      <span className="mb-0.5 inline-block rounded border border-dashed border-[#b26b00] bg-[#fff8ec] px-1 text-[10px] text-[#b26b00]" data-testid="source-third-party">
                        {sourceName(metric.sourceUrl)}
                      </span>
                    ) : (
                      <span className="block text-[#666]">{sourceName(metric.sourceUrl) ?? ui.tree.unknownSource}</span>
                    )}
                    <a className="break-all text-[#006fff]" href={metric.sourceUrl} target="_blank" rel="noreferrer">
                      {metric.sourceUrl.replace("https://", "")}
                    </a>
                    <span className="mt-0.5 block text-[#999]">{metric.fetchedAt}</span>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <EvidenceChart report={report} />
      <ul className="mt-2 space-y-1 text-[11px] text-[#666]">
        {report.options.map((option) => (
          <li key={`${option.label}-docs`}>
            {option.docsUrl ? (
              <>
                {option.label} {ui.tree.docs}{" "}
                <a className="text-[#006fff]" href={option.docsUrl} target="_blank" rel="noreferrer">
                  {option.docsUrl}
                </a>
                {option.docsSourceUrl ? <span>{ui.tree.docsFrom(option.docsSourceUrl)}</span> : null}
              </>
            ) : (
              <span>
                {ui.tree.docsMissing(option.label, option.docsError)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionFork({ option }: { option: EvidenceOption }) {
  const stars = option.metrics.find((metric) => metric.name === "GitHub stars");
  return (
    <div className="rounded-md border border-[#e5e5e5] bg-white p-2">
      <p className="text-xs font-medium">{option.label}</p>
      <p className="mt-1 text-[11px] text-[#666]">{stars && failureLabel(stars) ? failureLabel(stars) : stars && metricDisplayable(stars) && stars.value != null ? `${stars.value} stars` : ui.tree.noData}</p>
    </div>
  );
}

function SelectionBody({ selection }: { selection: TechSelection }) {
  return (
    <div className="mt-2 text-xs leading-5" data-testid="tech-selection">
      <p className="text-[#b26b00]" data-testid="selection-pending">{ui.tree.selectionPending}</p>
      <p>{ui.tree.confidence}{CONFIDENCE[selection.confidence] ?? selection.confidence}</p>
      <ul className="mt-1 list-disc pl-4">
        {selection.pros.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {selection.cons.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-[#666]">
          {selection.cons.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {selection.sources.length > 0 ? (
        <ul className="mt-1 text-[11px] text-[#888]">
          {selection.sources.map((url) => (
            <li key={url}>
              {ui.tree.sourcePrefix}{sourceName(url) ?? ui.tree.unknownSource}{" "}
              <a className="break-all text-[#006fff]" href={url} target="_blank" rel="noreferrer">
                {url.replace("https://", "")}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-[#888]">{ui.tree.sourceNone}</p>
      )}
    </div>
  );
}

const CONFIDENCE: Record<string, string> = ui.tree.confidenceLevel;
const KIND_LABEL: Record<string, string> = ui.tree.kind;
const TITLE_LABEL: Record<string, string> = ui.tree.title;
const STATUS_TEXT: Record<string, string> = ui.tree.jobStatus;

function JobCard({ stream, onCancel, workspaceId }: { stream: Workstream; onCancel: (jobId: string) => void; workspaceId: string }) {
  const raw = stream.artifactPath ? `/api/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(stream.artifactPath)}&raw=1` : null;
  return (
    <article className="rounded-xl border border-[#e9eaeb] bg-[#fafafa] p-3" data-testid="workstream">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#666]">{KIND_LABEL[stream.kind] ?? stream.kind}</p>
        <Badge variant={statusVariant(stream.status)}>{STATUS_TEXT[stream.status] ?? stream.status}</Badge>
      </div>
      <h3 className="mt-2 text-sm font-medium">{TITLE_LABEL[stream.title] ?? stream.title}</h3>
      <p className="mt-1 text-xs leading-5 text-[#333]" data-testid={stream.kind === "review" ? "requirement-review" : undefined}>
        {displayPrompt(stream.summary)}
      </p>
      {stream.progress ? (
        <p className="mt-1 text-xs text-[#006fff]" data-testid="job-progress">
          {stream.progress}
        </p>
      ) : null}
      {raw && stream.status === "ready" && stream.artifactPath?.endsWith(".svg") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={raw} alt={stream.title} className="mt-2 w-full rounded-lg border border-[#e5e5e5]" data-testid="artifact-preview" />
      ) : null}
      {raw && stream.status === "ready" && stream.artifactPath?.endsWith(".html") ? (
        <a href={raw} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded bg-[#006fff] px-2.5 py-1 text-xs text-white" data-testid="play-prototype">
          ▶ {ui.tree.play}
        </a>
      ) : null}
      {stream.artifactPath ? <p className="mt-2 font-mono text-[10px] text-[#888]">{stream.artifactPath}</p> : null}
      {stream.evidence ? <EvidenceBody report={stream.evidence} cachedAt={stream.evidenceCachedAt} /> : null}
      {stream.selection ? <SelectionBody selection={stream.selection} /> : null}
      {stream.debate ? (
        <div className="mt-2 space-y-1 text-xs leading-5" data-testid="conclusion-card">
          {/* S9: deterministic text from the evidence card, not spoken by any AI seat. */}
          <p className="inline-block rounded bg-[#eef3ff] px-1.5 py-0.5 text-[10px] text-[#3a5ccc]" data-testid="generated-from-evidence">
            {ui.tree.generated}
          </p>
          <p>
            <span className="text-[#666]">{ui.tree.proposal}</span> {stream.debate.architect}
          </p>
          <p>
            <span className="text-[#666]">{ui.tree.risksAndCounter}</span> {stream.debate.skeptic}
          </p>
        </div>
      ) : null}
      {stream.status === "working" && stream.jobId ? (
        <button type="button" className="mt-2 text-xs text-[#888]" data-testid="cancel-job" onClick={() => onCancel(stream.jobId!)}>
          {ui.tree.cancel}
        </button>
      ) : null}
    </article>
  );
}

export function DecisionTree({
  meeting,
  onCancel,
  onDebate,
}: {
  meeting: MeetingState;
  onCancel: (jobId: string) => void;
  onDebate: () => void;
}) {
  const branches = buildDecisionTree(meeting);
  const evidenceReady = meeting.workstreams.some((item) => item.kind === "evidence" && item.status === "ready");
  return (
    <div data-testid="decision-tree">
      <p className="text-xs text-[#888]">{ui.tree.goal}</p>
      <p className="mt-1 text-sm font-medium leading-6" data-testid="tree-goal">
        {decisionGoal(meeting)}
      </p>
      <div className="mt-3 space-y-3 border-l-2 border-[#006fff] pl-3">
        {branches.map((branch) => (
          <section key={branch.id}>
            <p className="text-[11px] uppercase tracking-wide text-[#006fff]">{KIND_LABEL[branch.label.toLowerCase()] ?? branch.label}</p>
            <div className={branch.layout === "fork" ? "mt-2 grid grid-cols-1 gap-2" : "mt-2 space-y-2"}>
              {branch.layout === "fork" && branch.id !== "evidence" ? (
                <div className="grid grid-cols-2 gap-2">
                  {branch.items.map((item) => (
                    <JobCard key={item.id} stream={item} onCancel={onCancel} workspaceId={meeting.workspaceId} />
                  ))}
                </div>
              ) : (
                branch.items.map((item) => <JobCard key={item.id} stream={item} onCancel={onCancel} workspaceId={meeting.workspaceId} />)
              )}
            </div>
          </section>
        ))}
      </div>
      {evidenceReady ? (
        <button type="button" className="mt-3 text-xs text-[#006fff]" data-testid="debate-branch" onClick={onDebate}>
          {ui.tree.debateBranch}
        </button>
      ) : null}
    </div>
  );
}
