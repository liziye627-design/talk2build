import { parseTargets, questionKind } from "@/lib/evidence/claim";
import type { EvidenceMetric, EvidenceOption, EvidenceReport, PackageTarget } from "@/lib/evidence/types";

const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "talk2build-evidence",
};

function nowIso() {
  return new Date().toISOString();
}

function numberMetric(name: string, value: number, unit: string, sourceUrl: string, fetchedAt: string): EvidenceMetric {
  return { name, value, text: null, unit, sourceUrl, fetchedAt };
}

function textMetric(name: string, text: string, sourceUrl: string, fetchedAt: string): EvidenceMetric {
  return { name, value: null, text, unit: "", sourceUrl, fetchedAt };
}

function failed(name: string, sourceUrl: string, fetchedAt: string, error: string): EvidenceMetric {
  return { name, value: null, text: null, unit: "", sourceUrl, fetchedAt, error };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function fetchGitHub(target: PackageTarget, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<EvidenceMetric[]> {
  if (!target.github) return [];
  const { owner, repo } = target.github;
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const releaseUrl = `${repoUrl}/releases/latest`;
  const fetchedAt = nowIso();
  const metrics: EvidenceMetric[] = [];
  try {
    const response = await fetchImpl(repoUrl, { headers: GITHUB_HEADERS, signal });
    if (!response.ok) {
      const error = `GitHub returned ${response.status}.`;
      metrics.push(failed("GitHub stars", repoUrl, fetchedAt, error), failed("GitHub open_issues_count", repoUrl, fetchedAt, error), failed("GitHub pushed_at", repoUrl, fetchedAt, error));
    } else {
      const body = asRecord(await readJson(response));
      if (typeof body?.stargazers_count === "number") metrics.push(numberMetric("GitHub stars", body.stargazers_count, "stars", repoUrl, fetchedAt));
      else metrics.push(failed("GitHub stars", repoUrl, fetchedAt, "Response had no stargazers_count."));
      if (typeof body?.open_issues_count === "number") metrics.push(numberMetric("GitHub open_issues_count", body.open_issues_count, "count", repoUrl, fetchedAt));
      else metrics.push(failed("GitHub open_issues_count", repoUrl, fetchedAt, "Response had no open_issues_count."));
      if (typeof body?.pushed_at === "string") metrics.push(textMetric("GitHub pushed_at", body.pushed_at, repoUrl, fetchedAt));
      else metrics.push(failed("GitHub pushed_at", repoUrl, fetchedAt, "Response had no pushed_at."));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub request failed.";
    metrics.push(failed("GitHub stars", repoUrl, fetchedAt, message), failed("GitHub open_issues_count", repoUrl, fetchedAt, message), failed("GitHub pushed_at", repoUrl, fetchedAt, message));
  }
  const releaseAt = nowIso();
  try {
    const response = await fetchImpl(releaseUrl, { headers: GITHUB_HEADERS, signal });
    if (response.status === 404) {
      metrics.push(failed("GitHub latest release", releaseUrl, releaseAt, "No latest release."));
    } else if (!response.ok) {
      metrics.push(failed("GitHub latest release", releaseUrl, releaseAt, `GitHub returned ${response.status}.`));
    } else {
      const body = asRecord(await readJson(response));
      const tag = typeof body?.tag_name === "string" ? body.tag_name : "";
      if (!tag) metrics.push(failed("GitHub latest release", releaseUrl, releaseAt, "Response had no tag_name."));
      else metrics.push(textMetric("GitHub latest release", tag, releaseUrl, releaseAt));
    }
  } catch (error) {
    metrics.push(failed("GitHub latest release", releaseUrl, releaseAt, error instanceof Error ? error.message : "Release request failed."));
  }
  return metrics;
}

async function fetchNpm(name: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<{ metrics: EvidenceMetric[]; docsUrl: string | null; docsSourceUrl: string | null; docsError?: string }> {
  const downloadsUrl = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`;
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const fetchedAt = nowIso();
  const metrics: EvidenceMetric[] = [];
  try {
    const response = await fetchImpl(downloadsUrl, { signal });
    if (!response.ok) metrics.push(failed("npm downloads last week", downloadsUrl, fetchedAt, `npm returned ${response.status}.`));
    else {
      const body = asRecord(await readJson(response));
      if (typeof body?.downloads === "number") metrics.push(numberMetric("npm downloads last week", body.downloads, "downloads", downloadsUrl, fetchedAt));
      else metrics.push(failed("npm downloads last week", downloadsUrl, fetchedAt, "Response had no downloads number."));
    }
  } catch (error) {
    metrics.push(failed("npm downloads last week", downloadsUrl, fetchedAt, error instanceof Error ? error.message : "npm request failed."));
  }
  try {
    const response = await fetchImpl(registryUrl, { signal });
    if (!response.ok) return { metrics, docsUrl: null, docsSourceUrl: registryUrl, docsError: `npm registry returned ${response.status}.` };
    const body = asRecord(await readJson(response));
    const homepage = typeof body?.homepage === "string" && body.homepage.startsWith("http") ? body.homepage : null;
    if (!homepage) return { metrics, docsUrl: null, docsSourceUrl: registryUrl, docsError: "Registry response had no homepage URL." };
    return { metrics, docsUrl: homepage, docsSourceUrl: registryUrl };
  } catch (error) {
    return { metrics, docsUrl: null, docsSourceUrl: registryUrl, docsError: error instanceof Error ? error.message : "Registry request failed." };
  }
}

async function fetchPypi(name: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<{ metrics: EvidenceMetric[]; docsUrl: string | null; docsSourceUrl: string | null; docsError?: string }> {
  const statsUrl = `https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`;
  const projectUrl = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const fetchedAt = nowIso();
  const metrics: EvidenceMetric[] = [];
  try {
    const response = await fetchImpl(statsUrl, { signal, headers: { "user-agent": "talk2build-evidence" } });
    if (!response.ok) metrics.push(failed("PyPI downloads last week", statsUrl, fetchedAt, `PyPI stats returned ${response.status}.`));
    else {
      const body = asRecord(await readJson(response));
      const data = asRecord(body?.data);
      if (typeof data?.last_week === "number") metrics.push(numberMetric("PyPI downloads last week", data.last_week, "downloads", statsUrl, fetchedAt));
      else metrics.push(failed("PyPI downloads last week", statsUrl, fetchedAt, "Response had no last_week number."));
    }
  } catch (error) {
    metrics.push(failed("PyPI downloads last week", statsUrl, fetchedAt, error instanceof Error ? error.message : "PyPI stats request failed."));
  }
  try {
    const response = await fetchImpl(projectUrl, { signal, headers: { "user-agent": "talk2build-evidence" } });
    if (!response.ok) return { metrics, docsUrl: null, docsSourceUrl: projectUrl, docsError: `PyPI returned ${response.status}.` };
    const body = asRecord(await readJson(response));
    const info = asRecord(body?.info);
    const urls = asRecord(info?.project_urls);
    const docs = typeof urls?.Documentation === "string" ? urls.Documentation : typeof info?.home_page === "string" ? info.home_page : null;
    if (!docs || !docs.startsWith("http")) return { metrics, docsUrl: null, docsSourceUrl: projectUrl, docsError: "PyPI response had no documentation URL." };
    return { metrics, docsUrl: docs, docsSourceUrl: projectUrl };
  } catch (error) {
    return { metrics, docsUrl: null, docsSourceUrl: projectUrl, docsError: error instanceof Error ? error.message : "PyPI request failed." };
  }
}

export async function collectEvidence(text: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<EvidenceReport> {
  const targets = parseTargets(text);
  const fetchedAt = nowIso();
  if (targets.length === 0) {
    return {
      claim: text,
      question: questionKind(text),
      options: [],
      fetchedAt,
      note: "No named package or repository to fetch. No numbers were invented.",
    };
  }
  const options: EvidenceOption[] = [];
  for (const target of targets) {
    const metrics: EvidenceMetric[] = [];
    let docsUrl: string | null = null;
    let docsSourceUrl: string | null = null;
    let docsError: string | undefined;
    metrics.push(...(await fetchGitHub(target, fetchImpl, signal)));
    if (target.npm) {
      const npm = await fetchNpm(target.npm, fetchImpl, signal);
      metrics.push(...npm.metrics);
      docsUrl = npm.docsUrl;
      docsSourceUrl = npm.docsSourceUrl;
      docsError = npm.docsError;
    }
    if (target.pypi) {
      const pypi = await fetchPypi(target.pypi, fetchImpl, signal);
      metrics.push(...pypi.metrics);
      if (!docsUrl) {
        docsUrl = pypi.docsUrl;
        docsSourceUrl = pypi.docsSourceUrl;
        docsError = pypi.docsError;
      }
    }
    options.push({ label: target.label, metrics, docsUrl, docsSourceUrl, docsError });
  }
  return { claim: text, question: questionKind(text), options, fetchedAt };
}
