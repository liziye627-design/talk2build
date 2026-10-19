import { ui } from "@/lib/ui-text";
import type { EvidenceErrorCode, EvidenceMetric, EvidenceReport } from "@/lib/evidence/types";

/**
 * O1 (decided in spec-rev2): pypistats.org is a third-party source, not PyPI itself.
 * Flip this flag to relabel or hide it in one place.
 */
export const PYPISTATS_LABEL = ui.evidence.pypistats;

/** E3: data-source name derived from the URL domain. Unknown domains return null (not displayable). */
export function sourceName(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "github.com" || host === "api.github.com") return "GitHub";
  if (host === "registry.npmjs.org" || host === "api.npmjs.org" || host === "www.npmjs.com") return "npm";
  if (host === "pypi.org") return "PyPI";
  if (host === "pypistats.org") return PYPISTATS_LABEL;
  return null;
}

const CODE_LABEL: Record<EvidenceErrorCode, string> = ui.evidence.codes;

/** E4: prefer the structured errorCode; fall back to the error text for older reports. */
export function failureCode(metric: Pick<EvidenceMetric, "error" | "errorCode">): EvidenceErrorCode | null {
  if (!metric.error && !metric.errorCode) return null;
  if (metric.errorCode) return metric.errorCode;
  const error = metric.error ?? "";
  if (/timeout|abort/i.test(error)) return "timeout";
  if (/\b(403|429)\b/.test(error)) return "rate_limited";
  if (/\b404\b|no latest release/i.test(error)) return "not_found";
  if (/response had no|json|parse/i.test(error)) return "parse";
  return "network";
}

export function failureLabel(metric: Pick<EvidenceMetric, "error" | "errorCode">): string | null {
  const code = failureCode(metric);
  return code ? ui.evidence.failed(CODE_LABEL[code]) : null;
}

/** E3/E4: a number is shown only with no error, a known source, a URL and a fetch time. */
export function metricDisplayable(metric: EvidenceMetric): boolean {
  if (metric.error || metric.errorCode) return false;
  if (!metric.sourceUrl || !metric.fetchedAt || !sourceName(metric.sourceUrl)) return false;
  return metric.value != null || metric.text != null;
}

export function metricValueText(metric: EvidenceMetric): string | null {
  if (!metricDisplayable(metric)) return null;
  return metric.value != null ? `${metric.value} ${metric.unit}`.trim() : metric.text;
}

/** E7: every source failed for network-ish reasons → whole card is "离线，无数据". */
export function reportOffline(report: EvidenceReport): boolean {
  const metrics = report.options.flatMap((option) => option.metrics);
  if (metrics.length === 0) return false;
  return metrics.every((metric) => {
    const code = failureCode(metric);
    return code === "network" || code === "timeout";
  });
}

/** spec-rev2 O1: pypistats.org is accepted as a labelled third-party source, shown apart from official PyPI fields. */
export function isThirdParty(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === "pypistats.org";
  } catch {
    return false;
  }
}
