# Friction log

Severity is what I would have put on the Devpost form. These are from building Talk2Build, not from a production rollout.

## 1. Public MCP URL before you can see Alexa+

- **Task:** Connect the meeting server to Alexa+ as the voice front-end.
- **Steps:** Read the resources page, then the MCP quickstart. Implemented Streamable HTTP locally. Looked up `alexa-ai new mcp` and `alexa-ai deploy`.
- **Expected:** A local simulator that attaches to `http://127.0.0.1/mcp` the way the MCP Inspector does.
- **Actual:** Alexa+ calls a remote HTTPS URL. The CLI wants a Login with Amazon session before it will scaffold or deploy. Localhost is explicitly not enough.
- **Severity:** High for a one-week hackathon. Low once you own an account and a tunnel.
- **Workaround:** Ship the simulated Alexa+ client in the web app, speaking the same protocol, and check in the add-on manifest with placeholder HTTPS URLs. Document the human deploy step.
- **Suggestion:** Offer a dev-stage mode that accepts a loopback or tunnel URL without a store listing, and let `alexa-ai new mcp --non-interactive` run logged out so the manifest can be generated in CI.

## 2. 401 with no WWW-Authenticate

- **Task:** Meet the Alexa+ authentication checklist.
- **Steps:** Read the quickstart. Implemented 401 for unauthenticated `/mcp`, protected-resource metadata, and an authorization server that advertises PKCE S256.
- **Expected:** A 401 that tells a client where to go, usually via `WWW-Authenticate`.
- **Actual:** The checklist says the 401 must not include `WWW-Authenticate`. Discovery is only by fetching `/.well-known/oauth-protected-resource`. Dynamic client registration and client-id metadata documents are not supported.
- **Severity:** Medium. Easy to “fix” the wrong way.
- **Workaround:** Follow the checklist literally. Keep auth off for the local demo (`MCP_REQUIRE_AUTH=false`) and cover the 401 path in tests.
- **Suggestion:** Publish a ten-line curl script that does metadata → authorize → token → `initialize`, and say in the first paragraph that the missing header is intentional.

## 3. AWS credits closed mid-hackathon

- **Task:** Use Amazon Bedrock for the planner, for the AWS Builder mini challenge.
- **Steps:** Checked the resources page. The October 7 update says credit codes are exhausted. This environment has no AWS keys.
- **Expected:** A free-tier or hackathon credential that can make one Converse call.
- **Actual:** The integration is real code and a unit test with an injected Converse response. There is no live call to show.
- **Severity:** High if a judge requires a live AWS trace. Medium if “documented integration” includes a working client and a fallback.
- **Workaround:** Default `LLM_PROVIDER=mock`, keep the Bedrock adapter, and fall back to mock when the call fails so a demo never dies on a missing key.
- **Suggestion:** Keep a credit path open until the submission deadline, or name one model that works without a promotional code.

## 4. Accept header and protocol header are easy to miss

- **Task:** Pass a Streamable HTTP conformance check.
- **Steps:** Implemented POST, then pointed the Alexa+ client at it.
- **Expected:** A JSON-RPC body to be enough, the way older examples look.
- **Actual:** The client must send `Accept: application/json, text/event-stream`. Later requests need `MCP-Protocol-Version: 2025-11-25` and the session id. Missing any one of them is a 400, and the spec’s fallback version is `2025-03-26`, which this server rejects on purpose.
- **Severity:** Low. The spec is right. It is just sharp.
- **Workaround:** Tests cover the missing session, the bad protocol version, JSON, and SSE.
- **Suggestion:** The quickstart should show one successful `curl` for `initialize` and one for `tools/call`, headers included.

## 5. Web Speech API is not the Alexa+ microphone

- **Task:** Take a real microphone in the browser demo, with a scripted fallback for the video.
- **Steps:** Used `SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis` for the reply.
- **Expected:** One voice stack shared with Alexa+.
- **Actual:** Browser speech is a different system, missing in some embedded webviews, and `speechSynthesis` often has no voices until `voiceschanged`. The scripted path is what the tests and the video can rely on.
- **Severity:** Low. Expected for a simulated front-end.
- **Workaround:** Scripted playback, a typed line, and a short wait that gives up when no TTS voice exists so the demo does not stall.
- **Suggestion:** For teams on the simulated path, a sample page that is explicitly “Alexa+ in a browser” would set the expectation that device audio is a separate step.
