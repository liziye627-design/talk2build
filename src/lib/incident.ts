import type {
  DeployRecord,
  DiffFile,
  PullRequestDraft,
  ScaffoldFile,
  TestResult,
} from "@/lib/types";

export const ROOT_CAUSE =
  "Root cause: batch-reconcile v2.3 drained the Redis pool by shrinking max_connections from 50 to 20 and removing the command timeout.";

export const FIX_REQUIREMENTS = [
  "Roll the Redis pool back to 50 connections",
  "Set a command timeout on the reconcile job",
  "Add a pool-exhaustion alert",
];

export const REDIS_METRICS = [
  { t: "02:10", connections: 12 },
  { t: "02:13", connections: 18 },
  { t: "02:15", connections: 41 },
  { t: "02:16", connections: 20 },
  { t: "02:17", connections: 20, note: "pool exhausted, errors begin" },
];

export const DEPLOYS: DeployRecord[] = [
  {
    service: "orders-api",
    version: "v1.8.2",
    deployedAt: "2026-10-14T18:02:00-07:00",
    deployedLabel: "6:02 PM",
    author: "maya",
    environment: "prod",
    commit: "c0ffee1",
    summary: "Timeout tweak on the checkout handler. No Redis changes.",
  },
  {
    service: "batch-reconcile",
    version: "v2.3",
    deployedAt: "2026-10-14T23:40:00-07:00",
    deployedLabel: "11:40 PM",
    author: "release-bot",
    environment: "prod",
    commit: "a1c4e91",
    summary:
      "Nightly reconciliation job. Redis pool max_connections lowered from 50 to 20 and the command timeout removed.",
  },
];

export function lookupDeploy(query: string): DeployRecord | null {
  const q = query.toLowerCase();
  if (/reconcil|batch/.test(q)) {
    return DEPLOYS.find((deploy) => deploy.service === "batch-reconcile") ?? null;
  }
  const words = q.split(/\s+/).filter((word) => word.length > 2);
  return (
    DEPLOYS.find((deploy) => {
      const hay = `${deploy.service} ${deploy.version} ${deploy.summary}`.toLowerCase();
      return words.some((word) => hay.includes(word));
    }) ?? null
  );
}

export function incidentDiff(): DiffFile[] {
  return [
    {
      path: "jobs/batch-reconcile/config.yaml",
      language: "yaml",
      lines: [
        { type: "ctx", text: "service: batch-reconcile" },
        { type: "ctx", text: "redis:" },
        { type: "del", text: "  max_connections: 50", highlight: "shrink" },
        { type: "add", text: "  max_connections: 20", highlight: "shrink" },
        { type: "del", text: "  command_timeout_ms: 200", highlight: "missing-timeout" },
        { type: "ctx", text: "  batch_size: 500" },
      ],
    },
  ];
}

export const FIX_FILES: ScaffoldFile[] = [
  {
    path: "jobs/batch-reconcile/config.yaml",
    contents: [
      "service: batch-reconcile",
      "redis:",
      "  max_connections: 50",
      "  command_timeout_ms: 200",
      "  batch_size: 500",
      "",
    ].join("\n"),
  },
  {
    path: "alerts/redis_pool_exhaustion.yaml",
    contents: [
      "alert: RedisPoolExhaustion",
      "expr: redis_connected_clients / redis_config_maxclients > 0.8",
      "for: 1m",
      "labels:",
      "  severity: page",
      "annotations:",
      "  summary: Redis connection pool is near exhaustion",
      "",
    ].join("\n"),
  },
  {
    path: "jobs/batch-reconcile/flags.py",
    contents: [
      '"""Feature flag for the nightly reconciliation job."""',
      "",
      "FEATURE_RECONCILE_ENABLED = False",
      "",
      "",
      "def reconcile_enabled() -> bool:",
      "    return FEATURE_RECONCILE_ENABLED",
      "",
    ].join("\n"),
  },
];

export function fixPullRequestFiles(): DiffFile[] {
  return [
    {
      path: "jobs/batch-reconcile/config.yaml",
      language: "yaml",
      lines: [
        { type: "ctx", text: "service: batch-reconcile" },
        { type: "ctx", text: "redis:" },
        { type: "del", text: "  max_connections: 20" },
        { type: "add", text: "  max_connections: 50", highlight: "fix" },
        { type: "add", text: "  command_timeout_ms: 200", highlight: "fix" },
        { type: "ctx", text: "  batch_size: 500" },
      ],
    },
    {
      path: "alerts/redis_pool_exhaustion.yaml",
      language: "yaml",
      lines: [
        { type: "add", text: "alert: RedisPoolExhaustion", highlight: "fix" },
        { type: "add", text: "expr: redis_connected_clients / redis_config_maxclients > 0.8" },
        { type: "add", text: "for: 1m" },
        { type: "add", text: "labels:" },
        { type: "add", text: "  severity: page" },
        { type: "add", text: "annotations:" },
        { type: "add", text: "  summary: Redis connection pool is near exhaustion" },
      ],
    },
    {
      path: "jobs/batch-reconcile/flags.py",
      language: "python",
      lines: [
        { type: "add", text: '"""Feature flag for the nightly reconciliation job."""' },
        { type: "add", text: "FEATURE_RECONCILE_ENABLED = False", highlight: "fix" },
        { type: "add", text: "def reconcile_enabled() -> bool:" },
        { type: "add", text: "    return FEATURE_RECONCILE_ENABLED" },
      ],
    },
  ];
}

export function pullRequestShell(): Omit<PullRequestDraft, "tests"> {
  return {
    title: "fix: restore Redis pool and guard batch-reconcile",
    branch: "fix/redis-pool-exhaustion",
    base: "main",
    status: "draft",
    body: [
      "## Summary",
      "- Roll `max_connections` back from 20 to 50.",
      "- Restore `command_timeout_ms: 200` on the reconcile job.",
      "- Page when the Redis pool crosses 80% and default the job's feature flag to off.",
      "",
      "Root cause: batch-reconcile v2.3, deployed at 11:40 PM, drained the pool two minutes before the 2:17 AM error spike.",
    ].join("\n"),
    files: fixPullRequestFiles(),
  };
}

export function evaluateTests(files: ScaffoldFile[] | null): TestResult[] {
  const byPath = new Map((files ?? []).map((file) => [file.path, file.contents]));
  const config = byPath.get("jobs/batch-reconcile/config.yaml") ?? "";
  const alert = byPath.get("alerts/redis_pool_exhaustion.yaml") ?? "";
  const flags = byPath.get("jobs/batch-reconcile/flags.py") ?? "";

  const poolRestored = /max_connections:\s*50/.test(config) && !/max_connections:\s*20/.test(config);
  const timeoutSet = /command_timeout_ms:\s*200/.test(config);
  const alertPages = /RedisPoolExhaustion/.test(alert) && /severity:\s*page/.test(alert);
  const flagOff = /FEATURE_RECONCILE_ENABLED\s*=\s*False/.test(flags);

  return [
    {
      name: "restores max_connections to 50",
      passed: poolRestored,
      detail: poolRestored
        ? "config.yaml sets max_connections: 50"
        : "expected max_connections: 50 and no leftover 20",
    },
    {
      name: "sets command_timeout_ms",
      passed: timeoutSet,
      detail: timeoutSet
        ? "command_timeout_ms: 200 is present"
        : "command timeout is still missing",
    },
    {
      name: "pages on Redis pool exhaustion",
      passed: alertPages,
      detail: alertPages
        ? "RedisPoolExhaustion pages at 80% of max clients"
        : "pool exhaustion alert is missing",
    },
    {
      name: "gates reconcile behind a default-off flag",
      passed: flagOff,
      detail: flagOff
        ? "FEATURE_RECONCILE_ENABLED defaults to False"
        : "feature flag is missing or not default-off",
    },
  ];
}

export function incidentDiffText(): string {
  return [
    "diff --git a/jobs/batch-reconcile/config.yaml b/jobs/batch-reconcile/config.yaml",
    "--- a/jobs/batch-reconcile/config.yaml",
    "+++ b/jobs/batch-reconcile/config.yaml",
    "@@",
    " service: batch-reconcile",
    " redis:",
    "-  max_connections: 50",
    "+  max_connections: 20",
    "-  command_timeout_ms: 200",
    "   batch_size: 500",
  ].join("\n");
}
