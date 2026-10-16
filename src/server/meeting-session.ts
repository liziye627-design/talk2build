import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authRequired, isAcceptedToken } from "@/server/oauth";

/** C1 (design-rev3-c1): meeting-scoped signed session cookie for the browser. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionGlobal {
  __talk2buildSessionSecret?: string;
}

export const SESSION_SECRET_ERROR =
  "Production requires TALK2BUILD_SESSION_SECRET set to a random secret of at least 32 characters.";

/** Same pattern as assertProductionToken: production refuses to start without a real secret. */
export function assertProductionSessionSecret() {
  if (process.env.NODE_ENV !== "production") return;
  const configured = process.env.TALK2BUILD_SESSION_SECRET?.trim() || "";
  if (configured.length < 32) throw new Error(SESSION_SECRET_ERROR);
}

function secret() {
  assertProductionSessionSecret();
  const configured = process.env.TALK2BUILD_SESSION_SECRET?.trim();
  if (configured) return configured;
  // No fixed constant: a random per-process secret. Restarting invalidates old sessions.
  const g = globalThis as typeof globalThis & SessionGlobal;
  if (!g.__talk2buildSessionSecret) g.__talk2buildSessionSecret = randomBytes(32).toString("base64url");
  return g.__talk2buildSessionSecret;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function sessionCookieName(meetingId: string) {
  return `t2b_ms_${meetingId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function issueMeetingSession(meetingId: string, now = Date.now()): string {
  const payload = `${Buffer.from(meetingId).toString("base64url")}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyMeetingSession(value: string | null | undefined, meetingId: string, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [encodedId, expires, mac] = parts as [string, string, string];
  let signed: string;
  try {
    signed = sign(`${encodedId}.${expires}`);
  } catch {
    // Fail closed: production without TALK2BUILD_SESSION_SECRET never accepts a cookie.
    return false;
  }
  const expected = Buffer.from(signed);
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  if (Buffer.from(encodedId, "base64url").toString() !== meetingId) return false;
  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/** Secure follows the request protocol (architect decision), not NODE_ENV. */
export function requestIsHttps(request?: Request | null) {
  if (!request) return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionSetCookie(meetingId: string, secure: boolean, now = Date.now()) {
  const attrs = [
    `${sessionCookieName(meetingId)}=${issueMeetingSession(meetingId, now)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function withSessionCookie(response: Response, meetingId: string, request?: Request | null) {
  if (response.ok) response.headers.append("set-cookie", sessionSetCookie(meetingId, requestIsHttps(request)));
  return response;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function bearerOf(headers: Headers) {
  const header = headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function originMatchesHost(headers: Headers) {
  const origin = headers.get("origin");
  if (!origin) return true;
  const host = headers.get("x-forwarded-host") || headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The single cancel gate for the server action and every HTTP cancel endpoint.
 * Allowed when auth is off, with a valid Bearer (MCP/Alexa clients), or with a valid
 * session cookie for this meeting (browser). Cookie path also requires Origin == Host when Origin is sent.
 */
export function authorizeCancel(input: { headers: Headers; cookieValue?: string | null; meetingId: string; checkOrigin?: boolean }) {
  if (!authRequired()) return true;
  const token = bearerOf(input.headers);
  if (token && isAcceptedToken(token)) return true;
  const cookie = input.cookieValue ?? readCookie(input.headers.get("cookie"), sessionCookieName(input.meetingId));
  if (!verifyMeetingSession(cookie, input.meetingId)) return false;
  return input.checkOrigin === false ? true : originMatchesHost(input.headers);
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
  });
}
