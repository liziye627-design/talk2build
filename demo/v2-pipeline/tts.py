import json, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("/workspace/tts/m/kokoro-v1.0.onnx", "/workspace/tts/m/voices-v1.0.bin")
n = json.load(open("/workspace/rec2/narration.json"))
dur = {}
for key, text in n.items():
    text = text.replace("Talk2Build", "Talk to Build").replace("Phaser", "Fayzer")
    samples, sr = k.create(text, voice="af_heart", speed=1.05, lang="en-us")
    sf.write(f"/workspace/rec2/aud/{key}.wav", samples, sr)
    dur[key] = round(len(samples) / sr, 2)
json.dump(dur, open("/workspace/rec2/aud/dur.json", "w"), indent=1)
print(dur, sum(dur.values()))
