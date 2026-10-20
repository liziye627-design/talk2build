# Live local check: real speech → Whisper → local LLM → cards (no API keys)

Run 2026-10-20, 11:30–11:47 Asia/Shanghai, on the shared Linux box (8 vCPU, no GPU, ~2 GB free RAM).

Stack: Ollama 0.40.6 serving `qwen2.5:1.5b` (Qwen2.5-1.5B-Instruct Q4_K_M GGUF from Hugging Face, imported with `ollama create`), faster-whisper `base.en` int8, Talk2Build at this commit with `LLM_PROVIDER=local TALK2BUILD_STT=whisper`. Input audio is Kokoro TTS (several voices), so it is real audio but not a live human voice.

Setup note: `ollama pull` failed on this network (the registry's blob redirect resolved to a private address), so the GGUF was downloaded from Hugging Face and imported:

```bash
curl -L -o qwen2.5-1.5b-instruct-q4_k_m.gguf https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
ollama create qwen2.5:1.5b -f Modelfile   # FROM ./qwen2.5-1.5b-instruct-q4_k_m.gguf + ChatML template
```

## 1. Clip by clip over HTTP (`POST /api/meetings/:id/transcribe`)

Meeting "Bakery newsletter" (Maya host, Chris, Priya). Wall = whole request (Whisper + planner LLM + agent LLM + tools).

| Clip (speaker) | Whisper | Whisper text | Wall | Planner result |
| --- | --- | --- | --- | --- |
| maya_goal 5.4 s (Maya) | 1334 ms (cold) | "Our goal today is to launch a weekly newsletter sign-up page for the Bakery by Friday." | 3.9 s | requirement, local qwen2.5:1.5b |
| chris_decide 6.2 s (Chris) | 567 ms | "Let's decide to use a simple static page with a form that posts to our existing mailing list." | 7.5 s | degraded (model plan rejected, deterministic fallback); agent recorded the decision |
| priya_action 2.8 s (Priya) | 509 ms | "I will write the copy and send it to Chris by Wednesday." | 8.2 s | local; reply "Decision noted: Write copy for bakery newsletter" |
| chris_chatter 3.5 s (Chris) | 443 ms | "By the way, did anyone watch the football game last night?" | 4.4 s | chatter, parked, silent |
| maya_plan 4.6 s (Maya) | 480 ms | "Please draft a plan for the sign-up page with the steps we need before Friday." | 9.7 s | decision, local |

Room state afterwards (written by the local model, nothing scripted):

- Decisions: Chris — "Use a simple static page with a form that posts to our existing mailing list"; Priya — "Write copy for bakery newsletter" (the model filed Priya's commitment as a decision too).
- Action items: Priya — "Send copy to Chris by Wednesday".
- Parked chatter: Chris — the football question.

An earlier run, before the fixes in this commit, exposed three real problems that are now handled: a runaway JSON generation that hung for 5 minutes (now 45 s timeout + 512 max tokens), a model-planned `timeline_add` without required arguments that failed the turn (now rolled back and re-run on the deterministic plan, marked degraded), and the design card returning the canned billing-export architecture for an unrelated meeting (now a sketch of what was said, then a model draft).

## 2. Near-real-time: chunked upload, real-time pacing (HTTP)

`long.wav` (12.5 s, one speaker) cut into 4 s segments, each posted as soon as it would exist in real time:

| Segment | Posted at | End to end | Whisper | Text (before the padding/repeat fix) |
| --- | --- | --- | --- | --- |
| 0 | +4.0 s | 2.7 s | 480 ms | "Okay, quick recap before we go, we agreed the sign up page." |
| 1 | +8.0 s | 17.2 s | 831 ms | "ships on Friday. Priya owns the copy, Chris builds the" |
| 2 | +25.3 s | 22.2 s | 3736 ms | "… how many people sign uhh alright okay so so so so …" |
| 3 | +47.5 s | 12.9 s | 901 ms | "signed up. 8 8 8 8 8 …" (0.47 s tail) |

Fixes from this: chunks < 2 s are padded with 1 s of silence (re-tested: the 0.47 s tail no longer loops), and words repeated 4+ times in a row are collapsed. The slow totals come from the LLM sharing the CPU with Whisper.

## 3. Browser: the mic button in headless Chrome (production build)

`next start` with `LLM_PROVIDER=local TALK2BUILD_STT=whisper`; Chrome with `--use-file-for-fake-audio-capture=long48.wav%noloop`; Playwright clicked 解除静音 (unmute), waited 13.5 s, clicked 静音 (mute).

```
+10780ms transcribe 200 "Okay, quick recap before we go. We agreed the sign-up paid" (1419 ms whisper)
+12355ms transcribe 200 "ships on Friday. Priya owns the copy, Chris builds the" (438 ms whisper)
mic off at +13595ms
+14142ms transcribe 200 "the form and I will check the analytics on Monday to see how many people" (414 ms whisper)
+15633ms transcribe 200 "signed up." (384 ms whisper)
```

All four lines landed in the transcript as Maya, `source: whisper-local`, in order, while recording was still going for the first two. Because the recap sentence was split across chunks, the model did not extract decisions from the fragments (known limit; see reality-audit.md).

## Not verified

Live human voice; Web Speech API in desktop Chrome; Amazon Transcribe and Bedrock (no AWS credentials); larger local models.
