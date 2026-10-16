import { buildDecisionTree, decisionGoal } from "@/lib/agent/tree";
import { chartMetric } from "@/lib/evidence/select";
import { failureLabel, isThirdParty, metricDisplayable, metricValueText, reportOffline, sourceName } from "@/lib/evidence/display";
import type { EvidenceOption, EvidenceReport, TechSelection } from "@/lib/evidence/types";
import type { MeetingState, Workstream } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

function statusVariant(status: Workstream["status"]) {
  if (status === "ready") return "ok" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "working") return "b" as const;
  return "muted" as const;
}

function EvidenceChart({ report }: { report: EvidenceReport }) {
  const metricName = chartMetric(report);
  if (!metricName) return <p className="text-xs text-[#888]">没有可对比的数字。</p>;
  const bars = report.options
    .map((option) => {
      const metric = option.metrics.find((item) => item.name === metricName && item.value != null && metricDisplayable(item));
      return metric && metric.value != null ? { label: option.label, value: metric.value } : null;
    })
    .filter((item): item is { label: string; value: number } => Boolean(item));
  if (bars.length === 0) return <p className="text-xs text-[#888]">没有可对比的数字。</p>;
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
        离线，无数据：所有来源都拉取失败，没有展示任何数字。
      </p>
    );
  }
  return (
    <div className="mt-3">
      {cachedAt ? (
        <p className="text-[11px] text-[#888]" data-testid="evidence-cached">
          缓存于 {cachedAt}
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
              <th className="py-1 pr-2 font-medium">候选</th>
              <th className="py-1 pr-2 font-medium">指标</th>
              <th className="py-1 pr-2 font-medium">数值</th>
              <th className="py-1 font-medium">来源</th>
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
                      (metricValueText(metric) ?? "无数据")
                    )}
                  </td>
                  <td className="py-1">
                    {isThirdParty(metric.sourceUrl) ? (
                      <span className="mb-0.5 inline-block rounded border border-dashed border-[#b26b00] bg-[#fff8ec] px-1 text-[10px] text-[#b26b00]" data-testid="source-third-party">
                        {sourceName(metric.sourceUrl)}
                      </span>
                    ) : (
                      <span className="block text-[#666]">{sourceName(metric.sourceUrl) ?? "未知来源"}</span>
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
                {option.label} 文档{" "}
                <a className="text-[#006fff]" href={option.docsUrl} target="_blank" rel="noreferrer">
                  {option.docsUrl}
                </a>
                {option.docsSourceUrl ? <span>（来源 {option.docsSourceUrl}）</span> : null}
              </>
            ) : (
              <span>
                {option.label} 文档：{option.docsError ? `拉取失败（${option.docsError}）` : "未列出"}
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
      <p className="mt-1 text-[11px] text-[#666]">{stars && failureLabel(stars) ? failureLabel(stars) : stars && metricDisplayable(stars) && stars.value != null ? `${stars.value} stars` : "无数据"}</p>
    </div>
  );
}

function SelectionBody({ selection }: { selection: TechSelection }) {
  return (
    <div className="mt-2 text-xs leading-5" data-testid="tech-selection">
      <p className="text-[#b26b00]" data-testid="selection-pending">待人确认：推荐不会自动写入决策记录。</p>
      <p>置信度 {CONFIDENCE[selection.confidence] ?? selection.confidence}</p>
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
              来源：{sourceName(url) ?? "未知来源"}{" "}
              <a className="break-all text-[#006fff]" href={url} target="_blank" rel="noreferrer">
                {url.replace("https://", "")}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] text-[#888]">来源：无</p>
      )}
    </div>
  );
}

const CONFIDENCE: Record<string, string> = { low: "低", medium: "中", high: "高" };
const KIND_LABEL: Record<string, string> = {
  plan: "计划",
  design: "设计",
  verify: "检查",
  research: "调研",
  code: "代码",
  evidence: "证据",
  selection: "技术选型",
  review: "需求评审",
  conclusion: "结论",
};
const TITLE_LABEL: Record<string, string> = { Evidence: "证据", "Tech selection": "技术选型", Conclusion: "结论", "Requirement review": "需求评审" };
const STATUS_TEXT: Record<string, string> = { working: "进行中", ready: "就绪", waiting: "待人确认", cancelled: "已取消" };

function JobCard({ stream, onCancel }: { stream: Workstream; onCancel: (jobId: string) => void }) {
  return (
    <article className="rounded-xl border border-[#e9eaeb] bg-[#fafafa] p-3" data-testid="workstream">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#666]">{KIND_LABEL[stream.kind] ?? stream.kind}</p>
        <Badge variant={statusVariant(stream.status)}>{STATUS_TEXT[stream.status] ?? stream.status}</Badge>
      </div>
      <h3 className="mt-2 text-sm font-medium">{TITLE_LABEL[stream.title] ?? stream.title}</h3>
      <p className="mt-1 text-xs leading-5 text-[#333]" data-testid={stream.kind === "review" ? "requirement-review" : undefined}>
        {stream.summary}
      </p>
      {stream.progress ? (
        <p className="mt-1 text-xs text-[#006fff]" data-testid="job-progress">
          {stream.progress}
        </p>
      ) : null}
      {stream.artifactPath ? <p className="mt-2 font-mono text-[10px] text-[#888]">{stream.artifactPath}</p> : null}
      {stream.evidence ? <EvidenceBody report={stream.evidence} cachedAt={stream.evidenceCachedAt} /> : null}
      {stream.selection ? <SelectionBody selection={stream.selection} /> : null}
      {stream.debate ? (
        <div className="mt-2 space-y-1 text-xs leading-5" data-testid="conclusion-card">
          {/* S9: deterministic text from the evidence card, not spoken by any AI seat. */}
          <p className="inline-block rounded bg-[#eef3ff] px-1.5 py-0.5 text-[10px] text-[#3a5ccc]" data-testid="generated-from-evidence">
            基于证据自动生成 · 非 AI 席位发言
          </p>
          <p>
            <span className="text-[#666]">方案要点：</span> {stream.debate.architect}
          </p>
          <p>
            <span className="text-[#666]">风险与反例：</span> {stream.debate.skeptic}
          </p>
        </div>
      ) : null}
      {stream.status === "working" && stream.jobId ? (
        <button type="button" className="mt-2 text-xs text-[#888]" data-testid="cancel-job" onClick={() => onCancel(stream.jobId!)}>
          取消
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
      <p className="text-xs text-[#888]">目标</p>
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
                    <JobCard key={item.id} stream={item} onCancel={onCancel} />
                  ))}
                </div>
              ) : (
                branch.items.map((item) => <JobCard key={item.id} stream={item} onCancel={onCancel} />)
              )}
            </div>
          </section>
        ))}
      </div>
      {evidenceReady ? (
        <button type="button" className="mt-3 text-xs text-[#006fff]" data-testid="debate-branch" onClick={onDebate}>
          @架构师 @质疑者 辩论这一支
        </button>
      ) : null}
    </div>
  );
}
