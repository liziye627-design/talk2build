import { parseTargets, questionKind } from "@/lib/evidence/claim";
import { collectEvidence } from "@/lib/evidence/fetch";
import type { EvidenceReport } from "@/lib/evidence/types";

/** E5: same targets + question reuse a report for 10 minutes. */
export const EVIDENCE_CACHE_TTL_MS = 10 * 60 * 1000;
/** E4: every single source request is cut off after 5 seconds. */
export const EVIDENCE_TIMEOUT_MS = 5000;

interface CacheEntry {
  report: EvidenceReport;
  cachedAt: string;
  storedAtMs: number;
}

interface CacheGlobal {
  __talk2buildEvidenceCache?: Map<string, CacheEntry>;
}

function cache() {
  const g = globalThis as typeof globalThis & CacheGlobal;
  if (!g.__talk2buildEvidenceCache) g.__talk2buildEvidenceCache = new Map();
  return g.__talk2buildEvidenceCache;
}

export function clearEvidenceCache() {
  cache().clear();
}

export function evidenceCacheKey(text: string) {
  const targets = parseTargets(text)
    .map((target) => [target.github ? `gh:${target.github.owner}/${target.github.repo}` : "", target.npm ? `npm:${target.npm}` : "", target.pypi ? `pypi:${target.pypi}` : ""].filter(Boolean).join("+").toLowerCase())
    .sort();
  return `${questionKind(text)}|${targets.join(",")}`;
}

/** Wraps fetch so each request gets its own 5s timeout, merged with the caller's signal. */
export function withTimeout(fetchImpl: typeof fetch, timeoutMs = EVIDENCE_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, signal });
  };
}

function anySucceeded(report: EvidenceReport) {
  return report.options.some((option) => option.metrics.some((metric) => !metric.error && (metric.value != null || metric.text != null)));
}

export async function collectEvidenceCached(
  text: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  options: { now?: () => number; timeoutMs?: number } = {},
): Promise<{ report: EvidenceReport; cachedAt: string | null }> {
  const now = options.now ?? Date.now;
  const key = evidenceCacheKey(text);
  const hit = cache().get(key);
  if (hit && now() - hit.storedAtMs < EVIDENCE_CACHE_TTL_MS) {
    return { report: { ...hit.report, claim: text }, cachedAt: hit.cachedAt };
  }
  if (hit) cache().delete(key);
  const report = await collectEvidence(text, withTimeout(fetchImpl, options.timeoutMs), signal);
  // Only cache reports that actually reached a source; failures should be retried, not replayed.
  if (!signal?.aborted && anySucceeded(report)) {
    const storedAtMs = now();
    cache().set(key, { report, cachedAt: new Date(storedAtMs).toISOString(), storedAtMs });
  }
  return { report, cachedAt: null };
}
