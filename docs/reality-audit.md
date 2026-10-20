# Reality audit: what is real, what is scripted, what is blocked by keys

Checked 2026-10-20 (Asia/Shanghai) against commit-time code. "Real" means it runs on real input and produces output that was not written in advance. Mocks remain only in tests, and in the scripted showcase (the **Play the pizza game jam** button and the incident demo).

| Path | Status | Notes |
| --- | --- | --- |
| Speech-to-text, local Whisper (`TALK2BUILD_STT=whisper`) | **Real** | faster-whisper `base.en`, CPU int8. Verified on Kokoro TTS audio over HTTP and in headless Chrome with a fake mic ([live-local-check.md](live-local-check.md)). Not yet verified on a live human voice |
| Real-time (chunked) mic transcription | **Real** | `src/lib/transcribe/chunker.ts`: the mic is recorded in ~4 s self-contained segments that upload while the next one records. Verified in headless Chrome (first line on screen ~10.8 s after unmute, later lines every ~1.5 s). Words at segment boundaries can be split or misheard |
| Speech-to-text, browser Web Speech API | Real, unverified here | Needs desktop Chrome with a real mic; the test Chromium has no speech backend |
| Speech-to-text, Amazon Transcribe streaming (`TALK2BUILD_STT=transcribe`) | **Blocked by keys** | Implemented with `@aws-sdk/client-transcribe-streaming` (ffmpeg → 16 kHz PCM → 100 ms audio events). Tested only with a mocked client. Never called live |
| Meeting-turn planner, `LLM_PROVIDER=local` | **Real** | Ollama + `qwen2.5:1.5b` (Q4_K_M GGUF), OpenAI-compatible `/v1/chat/completions`, JSON mode, 45 s timeout, 512 max tokens. No key |
| In-room agent extraction (decisions, action items, jobs) with `local` | **Real** | Same local model. Prompt now gives exact JSON shapes; the parser accepts the map/string forms small models emit |
| Design card (`design_draft`) | **Real outside the demo** | Previously always returned the billing-export template. Now: lines outside the scripted billing domain get a sketch of what was said, and with a live model a model-written `docs/architecture.md` replaces it |
| Agent artifacts / seat (Architect, Skeptic) drafts | Real with a model | `draftWithModel` uses the configured backend (local, Bedrock, OpenAI-compatible); templates only when no model is configured or the call fails (card says so) |
| Evidence card (GitHub / npm / PyPI numbers) | **Real** | Live public APIs, with source URL and fetch time; failures shown as failures |
| `run_tests`, scaffold, patch | Real | Spawns `node --test` on the generated scaffold after confirmation |
| MCP server (2025-11-25, Streamable HTTP) and the simulated Alexa+ client | **Real** | Every turn goes through a real MCP session over HTTP. A real Alexa+ device is not connected (add-on tools are partner-only) |
| Planner `LLM_PROVIDER=mock` (default) | Mock (by design) | Deterministic classifier. Still the default so the showcase is reproducible; also the fallback when a live model fails (turn marked `degraded`) |
| Agent `TALK2BUILD_AGENT=mock` / no backend | Mock (by design) | Keyword extraction + recorded fixtures |
| Pizza game-jam playback (button) | Scripted (showcase) | Scripted lines and a pre-written game template, disclosed in the UI, video and spec |
| Incident scenario facts (deploys, Redis metrics, diff) | Scripted data | `src/lib/incident.ts` is fixture data for the incident demo |
| Amazon Bedrock (`LLM_PROVIDER=bedrock`, Nova Lite) | **Blocked by keys** | Converse adapter + `npm run bedrock:smoke`. Unit-tested with an injected client. **No live Bedrock call has ever been made** |
| Nebius / OpenAI | **Blocked by keys** | Same OpenAI-compatible client as `local`, which is proven live against Ollama |

## Known limits of the real paths

- `qwen2.5:1.5b` is small. In the live run it sometimes filed an action item as a decision too, and about 1 in 5 planner calls fell back to the deterministic classifier (`degraded: true`). A larger local model (e.g. `qwen2.5:7b`) or Bedrock should do better; not measured.
- Chunked transcription cuts on a timer, not on silence, so a sentence that spans two chunks becomes two turns, and those fragments rarely produce decisions. Short tails (< 2 s) are padded with silence and runaway repeats are collapsed, which removed the "8 8 8 …" loops seen in testing.
- On this 8-core CPU box, Whisper keeps up (≈0.4–0.9 s per 4 s chunk), but Whisper and the LLM share the CPU; with the LLM in the loop a chunk took 2.7–22 s end to end over HTTP.
