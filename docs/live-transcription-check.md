# Live transcription check (2026-10-20, Asia/Shanghai)

Production build, `TALK2BUILD_STT=whisper`, faster-whisper `base.en` on CPU (int8), mock planner. The input clips were synthesized with Kokoro TTS (three different voices), so this is real audio but not a live human.

| Clip | Upload | Whisper text | Latency | Result in the room |
| --- | --- | --- | --- | --- |
| goal.wav (5.9 s, Maya) | audio/wav | "Goal for this meeting – Build Space Cat Courier, a tiny browser game before the pizza gets here." | 1624 ms (first call) | Maya's turn, `source: whisper-local`, reply "On it: Plan.", Plan card ready |
| arch.webm (5.8 s, Chris, Opus) | audio/webm | "Let's sketch the architecture. A game loop, keyboard, and touch input, and a canvas renderer." | 467 ms | Chris's turn, "On it: Game architecture.", architecture card ready |
| pizza.wav (2.2 s, Priya) | audio/wav | "is the pizza here yet, I'm starving." | 430 ms | Priya's turn, parked as chatter, no card |

The browser path was checked too. Headless Chromium used a fake microphone fed from goal.wav: the mic button opened MediaRecorder, the recorded clip went to `/transcribe`, and the room got a `whisper-local` line with the Plan card. The fake device loops the file, so the tail of the line repeats.

Not verified: the Web Speech API. The constructor exists in the test Chromium, but it has no speech backend, and recognition ended with no result. It needs desktop Chrome with a real microphone.
