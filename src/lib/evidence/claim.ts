import type { EvidenceQuestion, PackageTarget } from "@/lib/evidence/types";

const CATALOG: Array<PackageTarget & { keys: string[] }> = [
  { keys: ["express"], label: "Express", github: { owner: "expressjs", repo: "express" }, npm: "express" },
  { keys: ["fastify"], label: "Fastify", github: { owner: "fastify", repo: "fastify" }, npm: "fastify" },
  { keys: ["react"], label: "React", github: { owner: "facebook", repo: "react" }, npm: "react" },
  { keys: ["vue"], label: "Vue", github: { owner: "vuejs", repo: "core" }, npm: "vue" },
  { keys: ["prisma"], label: "Prisma", github: { owner: "prisma", repo: "prisma" }, npm: "prisma" },
  { keys: ["drizzle"], label: "Drizzle", github: { owner: "drizzle-team", repo: "drizzle-orm" }, npm: "drizzle-orm" },
  { keys: ["requests"], label: "requests", github: { owner: "psf", repo: "requests" }, pypi: "requests" },
  { keys: ["httpx"], label: "httpx", github: { owner: "encode", repo: "httpx" }, pypi: "httpx" },
  { keys: ["postgres", "postgresql"], label: "PostgreSQL", github: { owner: "postgres", repo: "postgres" } },
  { keys: ["redis"], label: "Redis", github: { owner: "redis", repo: "redis" } },
];

export function questionKind(text: string): EvidenceQuestion {
  if (/\b(faster|latency|performance|throughput)\b/i.test(text)) return "speed";
  if (/\b(cheap|cheaper|cost|price|expensive)\b/i.test(text)) return "cost";
  if (/\bscale\b|\bqps\b|how many users|\btraffic\b/i.test(text)) return "scale";
  if (/\b(popular|stars|downloads|adoption)\b/i.test(text)) return "popularity";
  return "choice";
}

export function parseTargets(text: string): PackageTarget[] {
  const found: PackageTarget[] = [];
  const seen = new Set<string>();
  for (const entry of CATALOG) {
    if (entry.keys.some((key) => new RegExp(`\\b${key}\\b`, "i").test(text))) {
      found.push({ label: entry.label, github: entry.github, npm: entry.npm, pypi: entry.pypi });
      seen.add(entry.label.toLowerCase());
    }
  }
  for (const match of text.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
    const label = `${match[1]}/${match[2]}`;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    found.push({ label, github: { owner: match[1]!, repo: match[2]!.replace(/\.git$/, "") } });
  }
  return found;
}

export function claimNeedsEvidence(text: string) {
  const targets = parseTargets(text);
  if (targets.length >= 2) return true;
  if (targets.length === 1 && /vs|versus|which|compare|faster|popular|cheaper|cost|scale/i.test(text)) return true;
  if (/which is (faster|more popular|cheaper)|more popular|tech choice/i.test(text) && targets.length > 0) return true;
  return false;
}
