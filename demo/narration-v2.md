# Talk2Build demo v2: narration (Pizza Game Jam)

Voice: Kokoro v1.0 (af_heart, speed 1.05), English. TTS gets phonetic spellings ("Talk to Build", "Fayzer"); the captions use the real names.
Final cut: `talk2build-demo-v2.mp4`, 1920x1080 30 fps H.264 + AAC 48 kHz, 2:26 (145.96 s), integrated -16.0 LUFS, true peak -1.5 dBFS, LRA 6.3 LU.

| # | Start | End | Scene | Narration (s) | Text |
|---|---|---|---|---|---|
| 0 | 0:00.00 | 0:03.67 | title | 2.07 | Talk2Build. The meeting that ships. |
| 1 | 0:03.67 | 0:15.74 | s01_hook | 9.9 | Three friends, one deadline. The pizza is twenty-five minutes out, and they want a game before it lands. Talk2Build sits in the meeting, with Alexa plus as its voice. |
| 2 | 0:15.74 | 0:26.77 | s02_goal | 8.02 | Maya says the goal out loud. Nobody types a command. A plan card appears, and the decision and action items are saved under her name. |
| 3 | 0:26.77 | 0:39.80 | s03_design | 6.91 | Chris sketches the architecture. Priya asks for the game screen. Both land on the shared stage while they are still talking. |
| 4 | 0:39.80 | 0:57.84 | s04_evidence | 13.53 | Then the classic argument: Phaser or PixiJS? This card is live. Real GitHub and npm numbers, each with its source. Talk2Build recommends. The humans decide: plain canvas, zero dependencies. |
| 5 | 0:57.84 | 1:04.37 | s05_pizza | 4.27 | Is the pizza here yet? Small talk gets parked. It stays out of the plan. |
| 6 | 1:04.37 | 1:11.90 | s06_phone | 5.1 | A feasibility card for phones: plain canvas works, as long as it gets touch controls. |
| 7 | 1:11.90 | 1:30.94 | s07_yes | 14.85 | Chris asks for the build. Anything that writes code waits for a human yes. Maya says yes. Talk2Build writes a spec from the meeting's decisions, scaffolds the prototype from its game-jam template, and runs the tests. Seven of seven pass. |
| 8 | 1:30.94 | 1:52.97 | s08_play | 9.9 | And here it is, playable right inside the meeting. Space Cat Courier. Dodge the asteroids, grab pizza for fuel. Every ten parcels, the asteroids speed up. |
| 9 | 1:52.97 | 1:59.00 | s09_pizza | 2.69 | Then the real pizza arrived. Parked, naturally. |
| 10 | 1:59.00 | 2:08.04 | s10_end | 5.06 | End the meeting. The minutes, the spec, the designs and the prototype stay in the workspace. |
| 11 | 2:08.04 | 2:20.94 | s11_how | 11.5 | Under the hood, Alexa plus talks to a self-hosted MCP server over Streamable HTTP, and the tools do the work. This demo runs in mock mode, on recorded fixtures. |
| 12 | 2:20.94 | 2:25.91 | end | 2.37 | Talk2Build. Open source on GitHub. |

## Burned-in captions

- 0:03.97 to 0:05.45: Three friends, one deadline.
- 0:05.20 to 0:08.88: The pizza is twenty-five minutes out, and they want a
- 0:08.63 to 0:10.70: game before it lands.
- 0:10.45 to 0:13.74: Talk2Build sits in the meeting, with Alexa plus as its voice.
- 0:16.04 to 0:18.47: Maya says the goal out loud.
- 0:18.22 to 0:19.28: Nobody types a command.
- 0:19.03 to 0:22.89: A plan card appears, and the decision and action items
- 0:22.64 to 0:24.07: are saved under her name.
- 0:27.07 to 0:28.54: Chris sketches the architecture.
- 0:28.29 to 0:30.69: Priya asks for the game screen.
- 0:30.44 to 0:33.94: Both land on the shared stage while they are still talking.
- 0:40.10 to 0:42.98: Then the classic argument: Phaser or PixiJS?
- 0:42.73 to 0:44.59: This card is live.
- 0:44.34 to 0:48.90: Real GitHub and npm numbers, each with its source.
- 0:48.65 to 0:49.58: Talk2Build recommends.
- 0:49.33 to 0:53.23: The humans decide: plain canvas, zero dependencies.
- 0:58.14 to 0:59.95: Is the pizza here yet?
- 0:59.70 to 1:00.84: Small talk gets parked.
- 1:00.59 to 1:02.35: It stays out of the plan.
- 1:04.67 to 1:08.33: A feasibility card for phones: plain canvas works, as
- 1:08.08 to 1:09.50: long as it gets touch controls.
- 1:12.20 to 1:14.18: Chris asks for the build.
- 1:13.93 to 1:17.22: Anything that writes code waits for a human yes.
- 1:16.97 to 1:18.50: Maya says yes.
- 1:18.25 to 1:20.81: Talk2Build writes a spec from the meeting's decisions,
- 1:20.56 to 1:24.46: scaffolds the prototype from its game-jam template, and
- 1:24.21 to 1:26.17: runs the tests.
- 1:25.92 to 1:26.95: Seven of seven pass.
- 1:31.24 to 1:34.49: And here it is, playable right inside the meeting.
- 1:34.24 to 1:35.37: Space Cat Courier.
- 1:35.12 to 1:38.40: Dodge the asteroids, grab pizza for fuel.
- 1:38.15 to 1:41.17: Every ten parcels, the asteroids speed up.
- 1:53.27 to 1:55.09: Then the real pizza arrived.
- 1:54.84 to 1:55.86: Parked, naturally.
- 1:59.30 to 2:00.07: End the meeting.
- 1:59.82 to 2:03.15: The minutes, the spec, the designs and the prototype
- 2:02.90 to 2:04.03: stay in the workspace.
- 2:08.44 to 2:12.03: Under the hood, Alexa plus talks to a self-hosted MCP
- 2:11.78 to 2:16.02: server over Streamable HTTP, and the tools do the work.
- 2:15.77 to 2:19.73: This demo runs in mock mode, on recorded fixtures.

## Honesty notes

- Mock mode (LLM_PROVIDER=mock, TALK2BUILD_AGENT=mock): the meeting turns are scripted, and the agent output comes from recorded fixtures. No model call is made.
- The game is scaffolded from a game-jam template that was written ahead of time. The meeting chose the template; it did not generate it live. The title card, the end card, docs/spec.md and the in-game footer all say so.
- `node --test` really runs (7/7) inside the app.
- The GitHub and npm numbers on the evidence card are fetched live at recording time (Phaser ~40.5k stars, PixiJS ~48.4k), so they will drift.
- The gameplay is driven by a scripted keyboard bot (rec pipeline `bot.mjs`), not a person.
- The zoom and pan are a CSS transform applied while recording, so the text renders sharp. Captions, cards, the audio mix and loudness normalisation are added in post (`render.py`).

## Audio QA

- Each clip was transcribed back with faster-whisper (base.en and small.en), and so was the whole final mix (small.en). Every line matches the script. The only mismatches were Whisper misreads that went away when the passage was re-checked on its own: "a game" in s01 under base.en, and "command" in s02 in the full-mix pass.
- Silences: the longest is about 12 s, while the game is played (deliberate: the screen carries it, and there is no music or SFX).
