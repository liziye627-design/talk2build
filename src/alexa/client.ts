import { PROTOCOL_VERSION } from "@/lib/types";

export interface AlexaToolResult {
  ok: boolean;
  summary: string;
  data: unknown;
}

interface RpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: {
    protocolVersion?: string;
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: { ok?: boolean; summary?: string; data?: unknown };
    tools?: Array<{ name: string }>;
  };
  error?: { code?: number; message?: string };
}

export type McpTransport = (request: Request) => Promise<Response>;

export function parseMcpPayload(contentType: string | null, text: string): RpcEnvelope | null {
  if (!text.trim()) return null;
  if ((contentType || "").includes("text/event-stream")) {
    const chunks = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = chunks.at(-1);
    return last ? (JSON.parse(last) as RpcEnvelope) : null;
  }
  return JSON.parse(text) as RpcEnvelope;
}

/**
 * Simulated Alexa+ MCP client.
 * Alexa+ is the voice front-end: it speaks Streamable HTTP (protocol 2025-11-25)
 * against the Talk2Build server, discovers tools, and calls them for the room.
 */
export class AlexaPlusClient {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    private readonly baseUrl: string,
    private readonly transport: McpTransport = (request) => fetch(request),
    private readonly token?: string,
  ) {}

  async initialize() {
    const opened = await this.rpc(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "talk2build-alexa-plus",
          title: "Talk2Build on Alexa+",
          version: "1.0.0",
        },
      },
      this.nextId++,
      false,
    );
    if (!opened.sessionId) throw new Error("Alexa+ MCP initialize did not return MCP-Session-Id.");
    if (opened.payload?.result?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Alexa+ expected protocol ${PROTOCOL_VERSION}.`);
    }
    this.sessionId = opened.sessionId;
    const noted = await this.rpc("notifications/initialized", {}, null, true);
    if (noted.status !== 202) throw new Error(`notifications/initialized returned ${noted.status}.`);
    return opened.payload;
  }

  async listTools() {
    const response = await this.rpc("tools/list", {}, this.nextId++, true);
    return response.payload?.result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<AlexaToolResult> {
    if (!this.sessionId) await this.initialize();
    let response = await this.rpc("tools/call", { name, arguments: args }, this.nextId++, true);
    if (response.status === 404) {
      this.sessionId = null;
      await this.initialize();
      response = await this.rpc("tools/call", { name, arguments: args }, this.nextId++, true);
    }
    if (response.status >= 400) {
      throw new Error(response.payload?.error?.message || `MCP call failed (${response.status}).`);
    }
    if (response.payload?.error) {
      throw new Error(response.payload.error.message || "MCP error");
    }
    const result = response.payload?.result;
    const structured = result?.structuredContent;
    const summary = structured?.summary || result?.content?.find((item) => item.text)?.text || "Tool finished.";
    return {
      ok: structured?.ok ?? !result?.isError,
      summary,
      data: structured?.data ?? null,
    };
  }

  private async rpc(method: string, params: unknown, id: number | null, session: boolean) {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (session && this.sessionId) {
      headers.set("mcp-session-id", this.sessionId);
      headers.set("mcp-protocol-version", PROTOCOL_VERSION);
    }
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
    if (id !== null) body.id = id;
    const response = await this.transport(new Request(this.baseUrl, { method: "POST", headers, body: JSON.stringify(body) }));
    const text = await response.text();
    const payload = text ? parseMcpPayload(response.headers.get("content-type"), text) : null;
    return {
      status: response.status,
      payload,
      sessionId: response.headers.get("mcp-session-id"),
    };
  }
}

interface ClientGlobal {
  __talk2buildAlexa?: Map<string, AlexaPlusClient>;
}

export function getAlexaClient(baseUrl: string, token?: string) {
  const g = globalThis as typeof globalThis & ClientGlobal;
  if (!g.__talk2buildAlexa) g.__talk2buildAlexa = new Map();
  const key = `${baseUrl}|${token ?? ""}`;
  const existing = g.__talk2buildAlexa.get(key);
  if (existing) return existing;
  const client = new AlexaPlusClient(baseUrl, (request) => fetch(request), token);
  g.__talk2buildAlexa.set(key, client);
  return client;
}
