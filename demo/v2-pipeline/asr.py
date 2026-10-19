import json, sys, subprocess, numpy as np
from faster_whisper import WhisperModel
m = WhisperModel("base.en", device="cpu", compute_type="int8")
n = json.load(open("narration.json"))
out = {}
for key in n:
    raw = subprocess.run(["ffmpeg","-v","error","-i",f"aud/{key}.wav","-f","f32le","-ac","1","-ar","16000","-"],capture_output=True,check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    segs, _ = m.transcribe(audio, word_timestamps=True, beam_size=5)
    words = [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)} for s in segs for w in s.words]
    out[key] = {"text": " ".join(x["w"] for x in words), "words": words}
    print(key, "|", out[key]["text"])
json.dump(out, open("aud/asr.json", "w"), indent=1)
