import type { MeetingState } from "@/lib/types";

export function buildProgressReport(state: MeetingState): string {
  const requirements = state.requirements.length;
  const decisions = state.decisions.length;
  const todos = state.todos.length;
  const pr = state.pullRequest
    ? `fix PR drafted across ${state.pullRequest.files.length} files`
    : "no pull request yet";
  const tests = !state.pullRequest
    ? "tests not run"
    : state.pullRequest.tests.every((test) => test.passed)
      ? "tests passing"
      : "tests failing";

  if (state.scenario !== "incident" && !state.pullRequest && requirements === 0 && decisions === 0) {
    return `Progress: ${state.transcript.length} lines in, ${todos} action items, no decision yet.`;
  }

  if (!state.pullRequest && requirements === 0 && decisions === 0) {
    const deploy = state.deploy
      ? `${state.deploy.service} ${state.deploy.version} is the deploy to inspect`
      : "still looking for the deploy";
    return `Progress: incident timeline is up, and ${deploy}.`;
  }

  return `Progress: ${requirements} requirements updated, ${decisions} decision logged, ${todos} action items, ${pr}, ${tests}.`;
}
