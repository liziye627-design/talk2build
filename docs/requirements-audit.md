# Requirements audit (Alexa+ track, AWS Builder, Open Source)

Checked against the official rules, the FAQ and the resources page on 2026-10-20.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Self-hosted MCP server, spec 2025-11-25 | Met | `src/lib/types.ts` `PROTOCOL_VERSION`; `initialize` returns `2025-11-25` |
| Streamable HTTP: single endpoint, POST/GET/DELETE, session id, protocol header, JSON or SSE | Met | `src/mcp/handler.ts`; tests in `tests/mcp*.test.ts` |
| Origin validation (DNS rebinding) | Met | `allowOrigin` in `src/mcp/handler.ts` (403 on foreign origin; `MCP_ALLOWED_ORIGINS`) |
| Auth: bearer token, OAuth 2.1 auth code + PKCE S256, protected-resource and AS metadata | Met (dev-grade AS) | `src/server/oauth.ts`, `/.well-known/*` in `src/server/routes.ts`; the local AS auto-approves |
| 401 without `WWW-Authenticate` (Alexa+ add-on checklist) | Met, deliberate | Matches the Alexa+ checklist; generic MCP clients that expect `resource_metadata` in the header must read `/.well-known/oauth-protected-resource` instead |
| Simulated Alexa+ experience: web page acting as a real MCP client (initialize, tools/list, tools/call) | Met | `src/alexa/client.ts` `AlexaPlusClient`; every meeting utterance goes through it |
| Add-on manifest | Partial (authored, not deployable) | `alexa/addon-package/addon.json`; the add-on tools are partner-only per the FAQ |
| Runtime use, not just named | Met | MCP config and client are loaded and called on every turn |
| Repo: public, license detected, setup and run instructions | Met | MIT; README "For judges" and "Production start" |
| Video under 3 minutes, public, English | Met | https://youtu.be/oLMys1SccUk (2:26) |
| Product feedback per tool | Met | `docs/product-feedback.md` |
| AWS Builder: AWS service with documented integration | Partial | Bedrock Converse in `src/lib/llm/bedrock.ts` and the agent backend; README "Live Amazon Bedrock"; `npm run bedrock:smoke`. No live call has been made (no AWS credentials) |
| Open Source: new public repo with license, URL, username, description | Met | github.com/liziye627-design/talk2build, created 2026-10-15 |
| Friction log (bonus up to 10%) | Met | `docs/friction-log.md` |
