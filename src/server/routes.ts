import { getAlexaClient } from "@/alexa/client";
import { REPLIES } from "@/lib/demo-script";
import { enqueue } from "@/lib/mutex";
import { getStore } from "@/lib/meeting-store";
import { planTurn, summarizeMeeting } from "@/lib/planner";
import { providerPublicConfig } from "@/lib/llm";
import type { PlannedTool, SpeakerId } from "@/lib/types";
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
  if (speaker !== "A" && speaker !== "B") return json({ error: "Speaker must be A or B." }, 400);

  const store = getStore();
  const meeting = store.ensure(meetingId);
  let planned;
  try {
    planned = await planTurn({
      text,
      speaker,
      pending: meeting.pending,
      stateSummary: summarizeMeeting(meeting),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Planner failed." }, 502);
  }

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
      const failure = await runTools(planned.classification.tools);
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

    if (planned.classification.reply) {
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

    return json({
      reply: planned.classification.reply,
      silent: planned.classification.silent,
      progress,
      kind: planned.classification.kind,
      trace,
      state: store.get(meetingId),
      provider: planned.provider,
      model: planned.model,
      degraded: planned.degraded,
      speaker: speaker as SpeakerId,
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
  if (pathname === "/.well-known/oauth-protected-resource") return handleProtectedResource(request);
  if (pathname === "/.well-known/oauth-authorization-server") return handleAuthorizationServer(request);
  if (pathname === "/oauth/authorize") return handleAuthorize(request);
  if (pathname === "/oauth/token" && request.method === "POST") return handleToken(request);
  return json({ error: "Not found" }, 404);
}
