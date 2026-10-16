export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { nodeStartupError } = await import("../scripts/check-node.mjs");
  const message = nodeStartupError();
  if (message) {
    console.error(message);
    throw new Error(message);
  }
  const { assertProductionToken } = await import("@/server/oauth");
  assertProductionToken();
}
