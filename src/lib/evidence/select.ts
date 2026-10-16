import type { Debate, EvidenceMetric, EvidenceReport, TechSelection } from "@/lib/evidence/types";

function succeeded(metric: EvidenceMetric | undefined): metric is EvidenceMetric & { value: number } {
  return Boolean(metric && metric.error == null && typeof metric.value === "number");
}

function comparable(report: EvidenceReport, name: string) {
  return report.options
    .map((option) => ({ label: option.label, metric: option.metrics.find((item) => item.name === name) }))
    .filter((item) => succeeded(item.metric))
    .map((item) => ({ label: item.label, metric: item.metric as EvidenceMetric & { value: number } }));
}

function cite(metric: EvidenceMetric & { value: number }) {
  return `${metric.value} ${metric.unit} (${metric.sourceUrl})`;
}

export function chartMetric(report: EvidenceReport) {
  for (const name of ["GitHub stars", "npm downloads last week", "PyPI downloads last week"]) {
    if (comparable(report, name).length >= 2) return name;
  }
  for (const name of ["GitHub stars", "npm downloads last week", "PyPI downloads last week"]) {
    if (comparable(report, name).length >= 1) return name;
  }
  return null;
}

export function selectFromEvidence(report: EvidenceReport): TechSelection {
  const sources = report.options.flatMap((option) => option.metrics.filter((metric) => !metric.error).map((metric) => metric.sourceUrl));
  const uniqueSources = [...new Set(sources)];
  const unanswered =
    report.question === "speed"
      ? "No speed recommendation. No latency source was fetched."
      : report.question === "cost"
        ? "No cost recommendation. No price source was fetched."
        : report.question === "scale"
          ? "No scale recommendation. No capacity source was fetched."
          : null;
  const stars = comparable(report, "GitHub stars");
  const downloads = comparable(report, "npm downloads last week");
  const pypi = comparable(report, "PyPI downloads last week");
  const series = stars.length >= 2 ? stars : downloads.length >= 2 ? downloads : pypi.length >= 2 ? pypi : [];
  const failures = report.options.flatMap((option) =>
    option.metrics.filter((metric) => metric.error).map((metric) => `${option.label} ${metric.name}: ${metric.error}`),
  );
  if (report.options.length === 0) {
    return {
      recommendation: report.note || "No recommendation. Nothing was fetched.",
      confidence: "low",
      pros: [],
      cons: ["No public source was queried."],
      sources: [],
    };
  }
  if (series.length < 2) {
    return {
      recommendation: unanswered || "No recommendation. Fewer than two options returned a comparable number.",
      confidence: "low",
      pros: report.options.flatMap((option) => option.metrics.filter(succeeded).map((metric) => `${option.label}: ${cite(metric as EvidenceMetric & { value: number })}`)),
      cons: failures.length ? failures : ["Not enough comparable numbers."],
      sources: uniqueSources,
    };
  }
  const ranked = [...series].sort((a, b) => b.metric.value - a.metric.value);
  const leader = ranked[0]!;
  const runner = ranked[1]!;
  const ratio = runner.metric.value === 0 ? Number.POSITIVE_INFINITY : leader.metric.value / runner.metric.value;
  const confidence = unanswered ? "low" : ratio >= 1.25 ? "high" : "medium";
  const recommendation = unanswered
    ? `${unanswered} On ${leader.metric.name}, ${leader.label} is ${cite(leader.metric)} and ${runner.label} is ${cite(runner.metric)}.`
    : `${leader.label} leads on ${leader.metric.name}: ${cite(leader.metric)}. ${runner.label} is ${cite(runner.metric)}.`;
  return {
    recommendation,
    confidence,
    pros: ranked.map((item) => `${item.label}: ${cite(item.metric)}`),
    cons: [
      ...failures,
      ...(unanswered ? [unanswered] : []),
      ...(report.question === "choice" ? ["Speed, cost, and scale were not measured."] : []),
    ],
    sources: uniqueSources,
  };
}

export function reviewFromEvidence(report: EvidenceReport, selection: TechSelection) {
  const measured = report.options.flatMap((option) => option.metrics.filter((metric) => !metric.error).map((metric) => `${option.label} ${metric.name}`));
  const missed =
    report.question === "speed" ? "speed" : report.question === "cost" ? "cost" : report.question === "scale" ? "scale" : "speed, cost, and scale";
  return [
    `Requirement: ${report.claim}`,
    measured.length ? `Measured: ${measured.join("; ")}.` : "Measured: nothing.",
    `Not measured: ${missed}.`,
    `Confidence: ${selection.confidence}.`,
    selection.recommendation,
  ].join(" ");
}

export function debateFromEvidence(report: EvidenceReport | undefined, selection: TechSelection | undefined): Debate {
  if (!report || !selection) {
    return {
      architect: "I have no fetched numbers for this branch yet.",
      skeptic: "I will not score a branch with no sources.",
      conclusion: "No conclusion. Evidence has not been fetched.",
    };
  }
  const failed = report.options.flatMap((option) => option.metrics.filter((metric) => metric.error).map((metric) => `${option.label} ${metric.name}`));
  return {
    architect: selection.recommendation,
    skeptic: failed.length
      ? `These fetches failed and stay out of the score: ${failed.join("; ")}. ${report.question === "popularity" ? "Popularity is only the metrics that returned." : "The asked question is not fully measured."}`
      : `Every requested source returned. ${report.question === "speed" || report.question === "cost" || report.question === "scale" ? "That still does not answer the asked question." : "The comparison is only as wide as those sources."}`,
    conclusion: `${selection.recommendation} Confidence ${selection.confidence}.`,
  };
}

export function evidenceMarkdown(report: EvidenceReport, selection: TechSelection) {
  const lines = [`# Evidence`, "", report.claim, "", `Fetched ${report.fetchedAt}`, ""];
  for (const option of report.options) {
    lines.push(`## ${option.label}`, "");
    for (const metric of option.metrics) {
      const shown = metric.error ? `failed: ${metric.error}` : metric.value != null ? `${metric.value} ${metric.unit}` : metric.text || "empty";
      lines.push(`- ${metric.name}: ${shown}`, `  - ${metric.sourceUrl}`, `  - ${metric.fetchedAt}`);
    }
    if (option.docsUrl) lines.push(`- Docs: ${option.docsUrl}`, `  - listed by ${option.docsSourceUrl}`);
    else if (option.docsError) lines.push(`- Docs failed: ${option.docsError}`);
    lines.push("");
  }
  lines.push("## Selection", "", selection.recommendation, "", `Confidence: ${selection.confidence}`, "");
  return lines.join("\n");
}
