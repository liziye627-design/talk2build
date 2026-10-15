import { createHash, randomBytes } from "node:crypto";

interface AuthCode {
  challenge: string;
  resource: string;
  expiresAt: number;
}

interface OAuthGlobal {
  __talk2buildCodes?: Map<string, AuthCode>;
  __talk2buildTokens?: Set<string>;
}

function codes() {
  const g = globalThis as typeof globalThis & OAuthGlobal;
  if (!g.__talk2buildCodes) g.__talk2buildCodes = new Map();
  return g.__talk2buildCodes;
}

function tokens() {
  const g = globalThis as typeof globalThis & OAuthGlobal;
  if (!g.__talk2buildTokens) g.__talk2buildTokens = new Set();
  return g.__talk2buildTokens;
}

export function resetOAuth() {
  codes().clear();
  tokens().clear();
}

export function demoToken() {
  return process.env.MCP_DEMO_TOKEN || "talk2build-demo";
}

export function authRequired() {
  return process.env.MCP_REQUIRE_AUTH === "true";
}

export function isAcceptedToken(token: string) {
  return token === demoToken() || tokens().has(token);
}

export function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function issueCode(challenge: string, resource: string) {
  const code = randomBytes(24).toString("base64url");
  codes().set(code, { challenge, resource, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

export function exchangeCode(input: { code: string; verifier: string; resource?: string }) {
  const stored = codes().get(input.code);
  if (!stored || stored.expiresAt < Date.now()) {
    codes().delete(input.code);
    return { ok: false as const, error: "invalid_grant" };
  }
  if (stored.challenge !== s256(input.verifier)) {
    return { ok: false as const, error: "invalid_grant" };
  }
  if (input.resource && stored.resource && input.resource !== stored.resource) {
    return { ok: false as const, error: "invalid_target" };
  }
  codes().delete(input.code);
  const accessToken = randomBytes(32).toString("base64url");
  tokens().add(accessToken);
  return {
    ok: true as const,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "talk2build:meeting",
    },
  };
}

export function issuerFrom(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(issuer: string) {
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ["talk2build:meeting"],
    bearer_methods_supported: ["header"],
    resource_name: "Talk2Build",
  };
}

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["talk2build:meeting"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}
