import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AlexaPlusClient } from "@/alexa/client";
import { resetSessions } from "@/mcp/sessions";
import { assertProductionToken, authRequired, isAcceptedToken, resetOAuth } from "@/server/oauth";
import { startServer } from "@/server/standalone";
import { PROTOCOL_VERSION } from "@/lib/types";

let server: Awaited<ReturnType<typeof startServer>>;

function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = await startServer(0);
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  delete process.env.MCP_REQUIRE_AUTH;
  resetSessions();
  resetOAuth();
});

describe("streamable HTTP MCP", () => {
  it("negotiates protocol 2025-11-25 and lists the meeting tools", async () => {
    const client = new AlexaPlusClient(`${server.url}/mcp`);
    await client.initialize();
    const tools = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "ingest_transcript",
      "classify_utterance",
      "timeline_add",
      "timeline_correlate",
      "chatter_park",
      "deploy_lookup",
      "diff_fetch",
      "decision_record",
      "confirm_ask",
      "todo_add",
      "write_doc",
      "scaffold_code",
      "pr_draft",
      "run_tests",
      "report_progress",
    ]) {
      expect(names).toContain(name);
    }
    const deploy = await client.callTool("deploy_lookup", { query: "reconciliation batch" });
    expect(deploy.ok).toBe(true);
    expect(deploy.summary).toMatch(/v2\.3/);
  });

  it("returns JSON or SSE and manages the session", async () => {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(init.headers.get("content-type")).toContain("application/json");
    const session = init.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    const noted = await post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "mcp-session-id": session || "" },
    );
    expect(noted.status).toBe(202);

    const missing = await post({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(missing.status).toBe(400);

    const badVersion = await post(
      { jsonrpc: "2.0", id: 3, method: "ping" },
      { "mcp-session-id": session || "", "mcp-protocol-version": "2024-11-05" },
    );
    expect(badVersion.status).toBe(400);

    const sse = await post(
      { jsonrpc: "2.0", id: 4, method: "ping", params: {} },
      { "mcp-session-id": session || "", "mcp-protocol-version": PROTOCOL_VERSION, accept: "text/event-stream" },
    );
    expect(sse.status).toBe(400);

    const stream = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
        "mcp-session-id": session || "",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" }),
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain("\"result\"");

    const listen = await fetch(`${server.url}/mcp`, {
      headers: {
        accept: "text/event-stream",
        "mcp-session-id": session || "",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
    });
    expect(listen.status).toBe(200);
    expect(await listen.text()).toContain("Talk2Build MCP session ready");

    const removed = await fetch(`${server.url}/mcp`, { method: "DELETE", headers: { "mcp-session-id": session || "" } });
    expect(removed.status).toBe(204);
    const gone = await fetch(`${server.url}/mcp`, { method: "DELETE", headers: { "mcp-session-id": session || "" } });
    expect(gone.status).toBe(404);
  });

  it("rejects a foreign origin", async () => {
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "x", version: "0" } } },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
  });

  it("requires a bearer token without WWW-Authenticate and accepts a PKCE login", async () => {
    process.env.MCP_REQUIRE_AUTH = "true";
    const metadata = await fetch(`${server.url}/.well-known/oauth-authorization-server`);
    const document = (await metadata.json()) as { code_challenge_methods_supported: string[] };
    expect(document.code_challenge_methods_supported).toContain("S256");
    const resource = await fetch(`${server.url}/.well-known/oauth-protected-resource`);
    expect(resource.status).toBe(200);

    const denied = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "x", version: "0" } },
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBeNull();

    const verifier = randomBytes(32).toString("base64url");
    const challenge = s256(verifier);
    const redirectUri = `${server.url}/health`;
    const authorize = await fetch(
      `${server.url}/oauth/authorize?response_type=code&client_id=talk2build&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256&state=room&resource=${encodeURIComponent(`${server.url}/mcp`)}`,
      { redirect: "manual" },
    );
    expect(authorize.status).toBe(302);
    const code = new URL(authorize.headers.get("location") || "").searchParams.get("code");
    const tokenResponse = await fetch(`${server.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code || "",
        code_verifier: verifier,
        resource: `${server.url}/mcp`,
      }),
    });
    const token = (await tokenResponse.json()) as { access_token: string };
    expect(token.access_token).toBeTruthy();

    const allowed = await post(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "alexa", version: "1" } },
      },
      { authorization: `Bearer ${token.access_token}` },
    );
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("requires a random production token and protects job cancel", async () => {
    const previousToken = process.env.MCP_DEMO_TOKEN;
    const previousAuth = process.env.MCP_REQUIRE_AUTH;
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.MCP_DEMO_TOKEN;
      delete process.env.MCP_REQUIRE_AUTH;
      expect(authRequired()).toBe(true);
      expect(() => assertProductionToken()).toThrow(/random/);
      process.env.MCP_DEMO_TOKEN = "talk2build-demo";
      expect(() => assertProductionToken()).toThrow(/talk2build-demo/);
      expect(isAcceptedToken("talk2build-demo")).toBe(false);

      process.env.MCP_DEMO_TOKEN = "unit-test-token-not-demo";
      expect(() => assertProductionToken()).not.toThrow();
      expect(isAcceptedToken("unit-test-token-not-demo")).toBe(true);
      expect(isAcceptedToken("talk2build-demo")).toBe(false);

      const denied = await fetch(`${server.url}/api/meetings/m1/jobs/job_x/cancel`, { method: "POST" });
      expect(denied.status).toBe(401);
      const demo = await fetch(`${server.url}/api/meetings/m1/jobs/job_x/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer talk2build-demo" },
      });
      expect(demo.status).toBe(401);
      const allowed = await fetch(`${server.url}/api/meetings/m1/jobs/job_x/cancel`, {
        method: "POST",
        headers: { authorization: "Bearer unit-test-token-not-demo" },
      });
      expect(allowed.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      if (previousToken === undefined) delete process.env.MCP_DEMO_TOKEN;
      else process.env.MCP_DEMO_TOKEN = previousToken;
      if (previousAuth === undefined) delete process.env.MCP_REQUIRE_AUTH;
      else process.env.MCP_REQUIRE_AUTH = previousAuth;
    }
  });
});
