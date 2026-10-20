// Test double for scripts/whisper_worker.py: speaks the same line protocol, and "transcribes" a file
// by reading it as UTF-8 text. Only used by tests/transcribe.test.ts; real runs use faster-whisper.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  const req = JSON.parse(line);
  const text = readFileSync(req.path, "utf8").trim();
  if (text === "BROKEN") console.log(JSON.stringify({ id: req.id, error: "RuntimeError: could not decode" }));
  else console.log(JSON.stringify({ id: req.id, text, language: req.language || "en", duration: 1, segments: [] }));
}
