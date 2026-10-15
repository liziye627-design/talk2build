# Product feedback draft

Paste one block per tool into the Devpost form. These notes are from building Talk2Build against the public docs during the hackathon. We did not have AWS credits (the October 7 notice says the codes are gone) and we did not complete a Login with Amazon deploy, so the Bedrock and device sections say what we could and could not exercise.

## Alexa+ MCP Toolkit and Streamable HTTP

**Used for:** The voice front-end. Talk2Build’s meeting tools are a self-hosted MCP server on protocol 2025-11-25, Streamable HTTP, at `/mcp`. A simulated Alexa+ client in the web app initializes a session and calls the tools. `alexa/addon-package/addon.json` is the add-on manifest, with `integrations[].type` set to `MCP`.

**What worked:** The transport spec is specific enough to implement without an SDK: one endpoint, POST for every message, GET for a server stream, DELETE to end a session, `MCP-Session-Id`, `MCP-Protocol-Version`, and either a JSON body or an SSE stream. Returning JSON when the client accepts both types, and SSE when `text/event-stream` is listed first, matched the spec and was straightforward to test. Tool results with `content` plus `structuredContent` gave Alexa a sentence to speak and the app a payload to render. The quickstart’s `addon.json` schema (manifest 1.0, store listing, MCP endpoint) is concrete.

**What needs work:** The interesting product is trapped behind a public HTTPS URL and a Login with Amazon CLI (`alexa-ai configure`, then deploy). There is no in-repo way to prove the device path without that account, so a hackathon team cannot show “Alexa+ on a device” from the repo alone. The simulated-experience path is allowed and we took it, but the docs still read as if the CLI is the only happy path. The 500 ms round-trip budget is right for a tool call and too tight once the model plan is also in the path. Say so, or split “tool latency” from “model latency.”

**Onboarding:** The resources page links “Build with Agent Skills” and “Streamable HTTP” without the destination visible in the scraped page; the real start is the MCP quickstart. Once there, the requirements are clear. Authentication is a separate cliff: 401 with no `WWW-Authenticate`, no DCR, no CIMD, PKCE S256 required. We implemented that checklist. It is surprising if you know ordinary HTTP auth, because a 401 without `WWW-Authenticate` hides the next step from a generic client.

**Build with it again?** Yes for the MCP server. The protocol is the right seam, and a meeting agent maps onto tools cleanly. The add-on deploy is the part I would not start on the night before a deadline.

## Alexa+ add-on manifest and Alexa AI CLI

**Used for:** The entry point a real Alexa+ client loads. We authored `addon.json` to the published schema: name, descriptions, four example phrases, privacy and terms URLs, six icon sizes, a 600×900 carousel image, and the MCP endpoint.

**What worked:** The schema table in the quickstart is complete. Field limits (name ≤ 30, short description ≤ 123, 3–4 example phrases) are the right kind of constraint. Icons can live in the app and be swapped to HTTPS URIs at deploy time.

**What needs work:** `alexa-ai new mcp` is the documented generator, and it requires an authenticated developer account before you can even see the files it writes. Publishing the JSON schema is good; publishing a `hello` manifest in the sample repos would be better, so a team can diff their file against a known-good one without the CLI. Media assets have to be HTTPS before validation, which means you cannot validate a local demo.

**Onboarding:** We did not run `alexa-ai deploy`. The human step is still: install the CLI, `alexa-ai configure` in a browser, replace the placeholder URLs, deploy, and try the web simulator.

**Build with it again?** Yes, after one successful deploy. Not as a first-day hackathon task.

## Amazon Bedrock

**Used for:** The planner. `LLM_PROVIDER=bedrock` calls the Converse API through `@aws-sdk/client-bedrock-runtime`. The system prompt asks for a JSON plan of MCP tool calls. If the call fails, the turn falls back to the deterministic mock and the client is told the provider degraded. Default model id is `amazon.nova-lite-v1:0`, overridable with `BEDROCK_MODEL_ID`.

**What worked:** Converse is a small surface: system text, one user message, `maxTokens`, `temperature`. Wiring it behind the same interface as the mock and the OpenAI-compatible client took one file. Nova Lite is the right default for a short JSON plan. The AWS Builder mini challenge listing Bedrock explicitly made the choice obvious.

**What needs work:** The hackathon’s credit codes were gone as of the October 7 update, and this environment has no AWS keys, so we could not send a live Converse call. The adapter is tested with an injected client, not against a model. A hackathon that requires an AWS call should keep a credit path open through the submission deadline, or publish a no-cost model id that works on the free tier without a request form. Cold-start latency on Converse will blow the Alexa+ 500 ms budget; the docs for “Bedrock plus Alexa+” should show a pattern where the model plans and the tools stay local and fast.

**Onboarding:** The SDK’s default credential chain is familiar. Nothing Bedrock-specific blocked us except access.

**Build with it again?** Yes. Converse is the API I want. I would not promise a live Bedrock demo at a hackathon unless the credits are in hand on day one.

## Open source note

The Open Source mini challenge asks for a license and a new project. This repo is MIT. No extra feedback block is required for the license itself. If the form asks whether we would publish this way again: yes. Shipping the MCP server as the product, not as a private sidecar, is what makes the Alexa+ path reviewable.
