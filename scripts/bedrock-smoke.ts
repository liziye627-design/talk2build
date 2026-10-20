/**
 * One live Amazon Bedrock Converse call through the same planner the app uses.
 * Needs your own AWS credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or
 * AWS_BEARER_TOKEN_BEDROCK, or AWS_PROFILE) and model access in AWS_REGION.
 * Without credentials it exits 2 and makes no network call.
 *
 *   AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run bedrock:smoke
 */
import { bedrockPlan } from "@/lib/llm/bedrock";
import { bedrockCredentialState } from "@/lib/agent/model";

async function main() {
  if (bedrockCredentialState() !== "ready" && !process.env.AWS_PROFILE?.trim()) {
    console.error("No AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, AWS_BEARER_TOKEN_BEDROCK, or AWS_PROFILE. No call was made.");
    process.exit(2);
  }
  const model = process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const started = Date.now();
  const plan = await bedrockPlan({
    text: "Goal for this meeting: build Space Cat Courier, a tiny browser game, before the pizza gets here.",
    speaker: "A",
    pending: null,
    scenario: "general",
    stateSummary: "New meeting. No decisions yet.",
  });
  const ms = Date.now() - started;
  console.log(JSON.stringify({ provider: "bedrock", model, region, latencyMs: ms, at: new Date().toISOString(), plan }, null, 2));
}

main().catch((error) => {
  console.error(`Bedrock call failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
