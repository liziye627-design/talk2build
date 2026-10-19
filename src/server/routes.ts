import { getAlexaClient } from "@/alexa/client";
import { REPLIES } from "@/lib/demo-script";
import { enqueue } from "@/lib/mutex";
import { getStore } from "@/lib/meeting-store";
import { agentAck, prepareAgentWork } from "@/lib/agent/dispatch";
import { restoreSeatState, keepSeatState, stopSeats } from "@/lib/seats/orchestrator";
import { planTurn, summarizeMeeting } from "@/lib/planner";
import { providerPublicConfig } from "@/lib/llm";
import type { PlannedTool } from "@/lib/types";
import { PROTOCOL_VERSION } from "@/lib/types";
import {
  authorizationServerMetadata,
  authRequired,
  demoToken,
  exchangeCode,
  issueCode,
  issuerFrom,
  protectedResourceMetadata,
} from "@/server/oauth";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  });
}

export function handleHealth() {
  return json({ ok: true, protocol: PROTOCOL_VERSION, name: "talk2build" });
}

export function handleConfig() {
  return json({
    ...providerPublicConfig(),
    protocol: PROTOCOL_VERSION,
    alexa: "mcp-addon",
    authRequired: authRequired(),
    mcpPath: "/mcp",
  });
}

export function handleMeetingGet() {
  return json({ state: getStore().ensure("demo") });
}

export function handleMeetingReset() {
  return enqueue(async () => json({ state: getStore().reset("demo") }));
}

export function handleProtectedResource(request: Request) {
  return json(protectedResourceMetadata(issuerFrom(request)));
}

export function handleAuthorizationServer(request: Request) {
  return json(authorizationServerMetadata(issuerFrom(request)));
}

export function handleAuthorize(request: Request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("code_challenge") || "";
  const method = url.searchParams.get("code_challenge_method") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const state = url.searchParams.get("state") || "";
  const resource = url.searchParams.get("resource") || `${issuerFrom(request)}/mcp`;
  if (!challenge || method !== "S256" || !redirectUri) {
    return json({ error: "invalid_request", error_description: "PKCE S256, code_challenge, and redirect_uri are required." }, 400);
  }
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return json({ error: "invalid_request", error_description: "redirect_uri is not a URL." }, 400);
  }
  const code = issueCode(challenge, resource);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);
  return Response.redirect(target, 302);
}

export async function handleToken(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let fields: Record<string, string> = {};
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") fields[key] = value;
    }
  } else {
    const text = await request.text();
    fields = Object.fromEntries(new URLSearchParams(text));
  }
  if (fields.grant_type !== "authorization_code") {
    return json({ error: "unsupported_grant_type" }, 400);
  }
  const exchanged = exchangeCode({
    code: fields.code || "",
    verifier: fields.code_verifier || "",
    resource: fields.resource,
  });
  if (!exchanged.ok) return json({ error: exchanged.error }, 400);
  return json(exchanged.body);
}

export function handleTurn(request: Request) {
  return enqueue(() => runTurn(request));
}

async function runTurn(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const speaker = body.speaker;
  const meetingId = typeof body.meetingId === "string" && body.meetingId.trim() ? body.meetingId.trim() : "demo";
  if (!text) return json({ error: "Utterance text is required." }, 400);
  if (typeof speaker !== "string" || !speaker.trim()) return json({ error: "Speaker is required." }, 400);

  const store = getStore();
  const meeting = store.ensure(meetingId);
  let planned;
  try {
    planned = await planTurn({
      text,
      speaker: speaker.trim(),
      pending: meeting.pending,
      queue: meeting.confirmQueue,
      stateSummary: summarizeMeeting(meeting),
      scenario: meeting.scenario,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Planner failed." }, 502);
  }

  const runAgent =
    meeting.scenario === "general" &&
    planned.classification.kind !== "interrupt" &&
    planned.classification.kind !== "chatter" &&
    planned.classification.kind !== "confirm" &&
    planned.classification.kind !== "reject";

  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";
  const mcpUrl = process.env.MCP_INTERNAL_URL || `${proto}://${host}/mcp`;
  const client = getAlexaClient(mcpUrl, authRequired() ? demoToken() : undefined);
  const trace: { tool: string; ok: boolean; summary: string }[] = [];

  const runTools = async (tools: PlannedTool[]) => {
    for (const call of tools) {
      const result = await client.callTool(call.name, { ...call.arguments, meetingId });
      trace.push({ tool: call.name, ok: result.ok, summary: result.summary });
      if (!result.ok) return result.summary;
    }
    return null;
  };

  try {
    if (planned.classification.kind === "interrupt") {
      // S5: stop/不对 halts a running seat debate first; seat turns survive the rollback ("保留已生成内容").
      const seatsWereRunning = stopSeats(meetingId);
      const kept = seatsWereRunning ? keepSeatState(store.get(meetingId)) : null;
      const failure = await runTools(planned.classification.tools);
      if (kept) restoreSeatState(store, meetingId, kept);
      const reply = failure ? failure : (planned.classification.reply ?? REPLIES.interrupt);
      if (!failure) {
        store.ingest(meetingId, { speaker: "Alexa", text: reply, kind: "interrupt" });
      }
      return json(
        {
          reply,
          silent: false,
          progress: null,
          kind: "interrupt",
          trace,
          state: store.get(meetingId),
          provider: planned.provider,
          model: planned.model,
          degraded: planned.degraded,
          error: failure,
        },
        failure ? 422 : 200,
      );
    }

    store.checkpoint(meetingId);
    const failure = await runTools(planned.classification.tools);
    if (failure) {
      store.rollback(meetingId);
      return json(
        { error: failure, trace, state: store.get(meetingId), kind: planned.classification.kind },
        422,
      );
    }

    let progress: string | null = null;
    const progressCall = [...trace].reverse().find((entry) => entry.tool === "report_progress");
    if (progressCall) progress = progressCall.summary;

    // A general-meeting line the classifier only logged as a requirement waits for the agent:
    // if the agent picked up work, Alexa+ says what it picked up instead of echoing the line back.
    const deferReply = runAgent && planned.classification.kind === "requirement";
    if (planned.classification.reply && !deferReply) {
      store.ingest(meetingId, {
        speaker: "Alexa",
        text: planned.classification.reply,
        kind: "reply",
      });
    }

    if (planned.classification.kind !== "chatter") {
      const count = store.bumpSubstantive(meetingId);
      const already = planned.classification.tools.some((tool) => tool.name === "report_progress");
      if (count % 3 === 0 && !already) {
        const result = await client.callTool("report_progress", { meetingId });
        trace.push({ tool: "report_progress", ok: result.ok, summary: result.summary });
        if (result.ok) progress = result.summary;
      }
    }

    let reply = planned.classification.reply;
    if (runAgent) {
      try {
        const picked = await prepareAgentWork({ meetingId, speaker: speaker.trim(), text });
        if (deferReply) reply = agentAck(picked) ?? reply;
      } catch (error) {
        store.addTrace(meetingId, {
          tool: "agent_extract",
          ok: false,
          summary: error instanceof Error ? error.message : "The agent could not read that line.",
        });
      }
    }

    if (deferReply && reply) store.ingest(meetingId, { speaker: "Alexa", text: reply, kind: "reply" });

    return json({
      reply,
      silent: planned.classification.silent,
      progress,
      kind: planned.classification.kind,
      trace,
      state: store.get(meetingId),
      provider: planned.provider,
      model: planned.model,
      degraded: planned.degraded,
      speaker: speaker.trim(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Alexa+ could not reach the MCP server." }, 502);
  }
}

export async function routeHttp(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/mcp") {
    const { handleMcp } = await import("@/mcp/handler");
    return handleMcp(request);
  }
  if (pathname === "/health") return handleHealth();
  if (pathname === "/api/config") return handleConfig();
  if (pathname === "/api/meeting" && request.method === "GET") return handleMeetingGet();
  if (pathname === "/api/meeting/reset" && request.method === "POST") return handleMeetingReset();
  if (pathname === "/api/alexa/turn" && request.method === "POST") return handleTurn(request);
  if (pathname === "/api/bootstrap" && request.method === "GET") {
    const { handleBootstrap } = await import("@/server/product");
    return handleBootstrap();
  }
  if (pathname === "/api/threads" && (request.method === "GET" || request.method === "POST")) {
    const { handleThreads } = await import("@/server/product");
    return handleThreads(request);
  }
  if (pathname === "/api/meetings" && request.method === "GET") {
    const { handleMeetingsGet } = await import("@/server/product");
    return handleMeetingsGet();
  }
  if (pathname === "/api/meetings" && request.method === "POST") {
    const { handleMeetingsPost } = await import("@/server/product");
    return handleMeetingsPost(request);
  }
  if (pathname === "/api/meetings/schedule" && request.method === "POST") {
    const { handleSchedule } = await import("@/server/product");
    return handleSchedule(request);
  }
  if (pathname === "/api/meetings/join-code" && request.method === "POST") {
    const { handleJoinCode } = await import("@/server/product");
    return handleJoinCode(request);
  }
  if (pathname === "/api/meetings/incident" && request.method === "POST") {
    const { handleIncidentLaunch } = await import("@/server/product");
    return handleIncidentLaunch();
  }
  const threadMessage = pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (threadMessage && request.method === "POST") {
    const { handleThreadMessage } = await import("@/server/product");
    return handleThreadMessage(request, decodeURIComponent(threadMessage[1] || ""));
  }
  const threadGet = pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (threadGet && request.method === "GET") {
    const { handleThreadGet } = await import("@/server/product");
    return handleThreadGet(decodeURIComponent(threadGet[1] || ""));
  }
  const meetingAction = pathname.match(/^\/api\/meetings\/([^/]+)\/(join|utterance|mic|end)$/);
  if (meetingAction) {
    const id = decodeURIComponent(meetingAction[1] || "");
    const action = meetingAction[2];
    const product = await import("@/server/product");
    if (action === "join" && request.method === "POST") return product.handleMeetingJoin(request, id);
    if (action === "mic" && request.method === "POST") return product.handleMeetingMic(request, id);
    if (action === "end" && request.method === "POST") return product.handleMeetingEnd(id);
    if (action === "utterance" && request.method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      const payload = { ...body, meetingId: id };
      return handleTurn(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(payload) }));
    }
  }
  const jobCancel = pathname.match(/^\/api\/meetings\/([^/]+)\/jobs\/([^/]+)\/cancel$/);
  if (jobCancel && request.method === "POST") {
    const { cancelJobAuthorized } = await import("@/server/cancel-job");
    const { unauthorizedResponse } = await import("@/server/meeting-session");
    const meetingId = decodeURIComponent(jobCancel[1] || "");
    const jobId = decodeURIComponent(jobCancel[2] || "");
    const result = cancelJobAuthorized({ headers: request.headers, meetingId, jobId });
    if (result.error) return unauthorizedResponse();
    return json({ cancelled: result.cancelled, meeting: getStore().get(meetingId) });
  }
  const meetingGet = pathname.match(/^\/api\/meetings\/([^/]+)$/);
  if (meetingGet && request.method === "GET") {
    const { handleMeetingGet } = await import("@/server/product");
    return handleMeetingGet(decodeURIComponent(meetingGet[1] || ""), request);
  }
  const workspaceFile = pathname.match(/^\/api\/workspaces\/([^/]+)\/file$/);
  if (workspaceFile && request.method === "GET") {
    const { handleWorkspaceFile } = await import("@/server/product");
    const url = new URL(request.url);
    return handleWorkspaceFile(decodeURIComponent(workspaceFile[1] || ""), url.searchParams.get("path") || "", url.searchParams.get("raw") === "1");
  }
  if (pathname === "/.well-known/oauth-protected-resource") return handleProtectedResource(request);
  if (pathname === "/.well-known/oauth-authorization-server") return handleAuthorizationServer(request);
  if (pathname === "/oauth/authorize") return handleAuthorize(request);
  if (pathname === "/oauth/token" && request.method === "POST") return handleToken(request);
  return json({ error: "Not found" }, 404);
}
