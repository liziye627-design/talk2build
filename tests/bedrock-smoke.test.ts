import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("npm run bedrock:smoke", () => {
  it("refuses to call anything without AWS credentials", () => {
    const env = { ...process.env };
    for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_PROFILE"]) delete env[key];
    const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/bedrock-smoke.ts"], { env, encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/No call was made/);
  }, 30000);
});
