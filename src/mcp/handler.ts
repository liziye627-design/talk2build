import { incidentDiffText } from "@/lib/incident";
import { executeTool, toolDefinitions } from "@/lib/tools";
import { createSession, deleteSession, getSession, rememberEvent, type McpSession } from "@/mcp/sessions";
import { authRequired, isAcceptedToken } from "@/server/oauth";
import { PROTOCOL_VERSION } from "@/lib/types";

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

function rpcError(status: number, id: string | number | null, code: number, message: string, sessionId?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status, headers });
}

function accepted(sessionId?: string) {
  const headers = new Headers({ "cache-control": "no-cache" });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return new Response(null, { status: 202, headers });
}

function wantsSse(accept: string | null) {
  if (!accept) return false;
  const parts = accept.split(",").map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "");
  const sse = parts.indexOf("text/event-stream");
  const json = parts.indexOf("application/json");
  if (sse === -1) return false;
  if (json === -1) return true;
  return sse < json;
}

function allowOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = request.headers.get("host");
  if (host && url.host === host) return true;
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  const extra = (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function encodeResult(request: Request, session: McpSession | null, id: string | number | null, result: unknown) {
  const payload = { jsonrpc: "2.0", id, result };
  const headers = new Headers({ "cache-control": "no-cache" });
  if (session) headers.set("mcp-session-id", session.id);
  if (wantsSse(request.headers.get("accept")) && session) {
    const eventId = rememberEvent(session, JSON.stringify(payload));
    headers.set("content-type", "text/event-stream");
    const body = `id: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`;
    return new Response(body, { status: 200, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

function toolResult(name: string, args: Record<string, unknown>) {
  const executed = executeTool(name, args);
  return {
    content: [
      {
        type: "text",
        text: executed.data ? `${executed.summary}\n${JSON.stringify(executed.data)}` : executed.summary,
      },
    ],
    structuredContent: {
      ok: executed.ok,
      summary: executed.summary,
      data: executed.data ?? null,
    },
    isError: !executed.ok,
  };
}

function dispatch(method: string, params: Record<string, unknown>, session: McpSession) {
  if (method === "ping") return { ok: true as const, result: {} };
  if (method === "logging/setLevel") {
    session.logLevel = typeof params.level === "string" ? params.level : session.logLevel;
    return { ok: true as const, result: {} };
  }
  if (method === "tools/list") {
    return { ok: true as const, result: { tools: toolDefinitions() } };
  }
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : null;
    if (!name || !args) return { ok: false as const, code: -32602, message: "tools/call needs name and arguments." };
    return { ok: true as const, result: toolResult(name, args) };
  }
  if (method === "resources/list") {
    return {
      ok: true as const,
      result: {
        resources: [
          {
            uri: "talk2build://incident/batch-reconcile-v2.3",
            name: "batch-reconcile v2.3 diff",
            description: "Overnight diff that shrank max_connections from 50 to 20 and removed the command timeout.",
            mimeType: "text/x-diff",
          },
        ],
      },
    };
  }
  if (method === "resources/read") {
    const uri = typeof params.uri === "string" ? params.uri : "";
    if (uri !== "talk2build://incident/batch-reconcile-v2.3") {
      return { ok: false as const, code: -32002, message: `Unknown resource: ${uri}` };
    }
    return {
      ok: true as const,
      result: {
        contents: [
          {
            uri,
            mimeType: "text/x-diff",
            text: incidentDiffText(),
          },
        ],
      },
    };
  }
  if (method === "prompts/list") {
    return {
      ok: true as const,
      result: {
        prompts: [
          {
            name: "facilitate-postmortem",
            description: "Run a Talk2Build postmortem. Classify every utterance, park chatter, and ask before opening a pull request.",
          },
        ],
      },
    };
  }
  if (method === "prompts/get") {
    const name = typeof params.name === "string" ? params.name : "";
    if (name !== "facilitate-postmortem") {
      return { ok: false as const, code: -32602, message: `Unknown prompt: ${name}` };
    }
    return {
      ok: true as const,
      result: {
        description: "Facilitation prompt for the 2:17 AM orders incident.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Listen to the postmortem. Log the 2:17 AM error spike, correlate Redis, look up batch-reconcile v2.3, and wait for a yes before opening the fix PR. Park lunch talk in chatter.",
            },
          },
        ],
      },
    };
  }
  return { ok: false as const, code: -32601, message: `Method not found: ${method}` };
}

export async function handleMcp(request: Request): Promise<Response> {
  if (!allowOrigin(request)) {
    return rpcError(403, null, -32002, "Forbidden origin");
  }

  if (authRequired()) {
    const header = request.headers.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!isAcceptedToken(token)) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  if (request.method === "GET") return handleListen(request);
  if (request.method === "DELETE") return handleDelete(request);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const accept = request.headers.get("accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return rpcError(400, null, -32600, "Accept must include application/json and text/event-stream.");
  }

  const raw = await request.text();
  let message: JsonRpc;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) || !parsed || typeof parsed !== "object") {
      return rpcError(400, null, -32600, "Expected a single JSON-RPC object.");
    }
    message = parsed as JsonRpc;
  } catch {
    return rpcError(400, null, -32700, "Parse error");
  }

  const sessionHeader = request.headers.get("mcp-session-id");
  if (message.method === undefined && (message.result !== undefined || message.error !== undefined)) {
    return accepted(sessionHeader ?? undefined);
  }
  if (typeof message.method === "string" && message.method.startsWith("notifications/")) {
    return accepted(sessionHeader ?? undefined);
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(400, message.id ?? null, -32600, "Invalid Request");
  }

  if (message.method === "initialize") {
    const params = message.params ?? {};
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    if (!requested) return rpcError(400, message.id ?? null, -32602, "protocolVersion is required.");
    const session = createSession();
    return encodeResult(request, session, message.id ?? null, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
        logging: {},
      },
      serverInfo: {
        name: "talk2build",
        title: "Talk2Build",
        version: "1.0.0",
        description: "Meeting-native MCP server for Alexa+. Tools listen to a working session and produce a doc, a diff, and a pull request.",
      },
      instructions:
        "Classify every utterance. Park chatter away from the requirement pool. Ask before scaffolding a pull request. stop or 不对 rolls back to the last checkpoint. The 2:17 AM incident is batch-reconcile v2.3: max_connections 50 to 20, command timeout removed.",
    });
  }

  const session = getSession(sessionHeader);
  if (!sessionHeader) return rpcError(400, message.id ?? null, -32600, "MCP-Session-Id header is required.");
  if (!session) return rpcError(404, message.id ?? null, -32001, "Session not found.");

  const headerVersion = request.headers.get("mcp-protocol-version");
  const version = headerVersion || session.protocolVersion;
  if (version !== PROTOCOL_VERSION) {
    return rpcError(400, message.id ?? null, -32600, `Unsupported MCP-Protocol-Version: ${version}`);
  }

  const params =
    message.params && typeof message.params === "object" && !Array.isArray(message.params) ? message.params : {};
  const outcome = dispatch(message.method, params, session);
  if (!outcome.ok) return rpcError(200, message.id ?? null, outcome.code, outcome.message, session.id);
  return encodeResult(request, session, message.id ?? null, outcome.result);
}

function handleListen(request: Request) {
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/event-stream")) {
    return rpcError(400, null, -32600, "GET requires Accept: text/event-stream.");
  }
  const session = getSession(request.headers.get("mcp-session-id"));
  if (!session) return rpcError(400, null, -32600, "MCP-Session-Id header is required.");
  const headerVersion = request.headers.get("mcp-protocol-version");
  if (headerVersion && headerVersion !== PROTOCOL_VERSION) {
    return rpcError(400, null, -32600, `Unsupported MCP-Protocol-Version: ${headerVersion}`);
  }
  const last = request.headers.get("last-event-id");
  const pending = last ? session.events.filter((event) => event.id > last) : [];
  const notice = {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: session.logLevel, logger: "talk2build", data: "Talk2Build MCP session ready." },
  };
  const eventId = rememberEvent(session, JSON.stringify(notice));
  const replay = pending.map((event) => `id: ${event.id}\ndata: ${event.data}\n\n`).join("");
  const body = `${replay}id: ${eventId}\ndata: ${JSON.stringify(notice)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "mcp-session-id": session.id,
    },
  });
}

function handleDelete(request: Request) {
  const id = request.headers.get("mcp-session-id");
  if (!id) return rpcError(400, null, -32600, "MCP-Session-Id header is required.");
  if (!getSession(id)) return rpcError(404, null, -32001, "Session not found.");
  deleteSession(id);
  return new Response(null, { status: 204 });
}
