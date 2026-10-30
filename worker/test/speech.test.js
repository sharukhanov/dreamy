import { describe, expect, it } from "vitest";
import { SpeechToText, WHISPER_MODEL } from "../src/speech.js";

const fallback = (text = "из gemini") => ({ calls: 0, async transcribe() { this.calls++; return text; } });

describe("расшифровка голосовых", () => {
  it("сначала Whisper", async () => {
    const calls = [];
    const fb = fallback();
    const stt = new SpeechToText({ ai: { run: async (m, input) => (calls.push([m, input]), { text: " Снилось море. " }) }, fallback: fb });
    expect(await stt.transcribe("QUJD", "audio/ogg")).toBe("Снилось море.");
    expect(calls[0][0]).toBe(WHISPER_MODEL);
    expect(calls[0][1]).toMatchObject({ audio: "QUJD", language: "ru" });
    expect(fb.calls).toBe(0);
  });

  it("если Whisper упал — Gemini", async () => {
    const fb = fallback();
    const stt = new SpeechToText({ ai: { run: async () => { throw new Error("down"); } }, fallback: fb });
    expect(await stt.transcribe("QUJD", "audio/ogg")).toBe("из gemini");
  });

  it("без Workers AI — сразу Gemini", async () => {
    const stt = new SpeechToText({ ai: undefined, fallback: fallback() });
    expect(await stt.transcribe("QUJD", "audio/ogg")).toBe("из gemini");
  });

  it("тишина у Whisper — пустой текст, а не сбой", async () => {
    const fb = fallback();
    const stt = new SpeechToText({ ai: { run: async () => ({ text: "" }) }, fallback: fb });
    expect(await stt.transcribe("QUJD", "audio/ogg")).toBe("");
    expect(fb.calls).toBe(0);
  });
});
