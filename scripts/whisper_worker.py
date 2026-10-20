"""Local speech-to-text worker for Talk2Build (faster-whisper, no API key).

Reads one JSON request per line on stdin: {"id": "...", "path": "/tmp/x.webm", "language": "en"}
Writes one JSON response per line on stdout: {"id", "text", "language", "duration", "segments"} or {"id", "error"}.
Audio is decoded with the ffmpeg binary, so any format ffmpeg reads (wav, webm/opus, ogg, mp3) works.

Environment: TALK2BUILD_WHISPER_MODEL (default base.en), TALK2BUILD_WHISPER_DEVICE (cpu),
TALK2BUILD_WHISPER_COMPUTE (int8).
"""
import json, os, subprocess, sys

import numpy as np
from faster_whisper import WhisperModel

model = WhisperModel(
    os.environ.get("TALK2BUILD_WHISPER_MODEL", "base.en"),
    device=os.environ.get("TALK2BUILD_WHISPER_DEVICE", "cpu"),
    compute_type=os.environ.get("TALK2BUILD_WHISPER_COMPUTE", "int8"),
)
print(json.dumps({"ready": True}), flush=True)


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = {}
    try:
        req = json.loads(line)
        audio = decode(req["path"])
        if len(audio) < 2 * 16000:
            # Very short chunks (e.g. the tail of a live recording) make Whisper loop ("8 8 8 ...").
            # A second of silence on each side stops that without changing the words.
            pad = np.zeros(16000, dtype=np.float32)
            audio = np.concatenate([pad, audio, pad])
        lang = req.get("language") or None
        segs, info = model.transcribe(audio, language=lang, beam_size=5, vad_filter=True)
        segments = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
        text = " ".join(s["text"] for s in segments).strip()
        print(json.dumps({"id": req.get("id"), "text": text, "language": info.language,
                          "duration": round(len(audio) / 16000, 2), "segments": segments}), flush=True)
    except Exception as exc:  # report and keep serving
        print(json.dumps({"id": req.get("id"), "error": f"{type(exc).__name__}: {exc}"}), flush=True)
