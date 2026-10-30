// Расшифровка голосовых: сначала Whisper в Cloudflare Workers AI (без «фильтра контента» Gemini,
// который иногда ошибочно отклоняет обычные записи), при сбое — Gemini.

export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

export class SpeechToText {
  // ai — привязка Workers AI (env.AI), fallback — объект с методом transcribe (GeminiInterpreter).
  constructor({ ai, fallback, onWhisper }) {
    this.ai = ai;
    this.fallback = fallback;
    this.onWhisper = onWhisper || (() => {});
  }

  async transcribe(audioBase64, mimeType) {
    if (this.ai) {
      try {
        const result = await this.ai.run(WHISPER_MODEL, { audio: audioBase64, language: "ru", task: "transcribe" });
        const text = String(result?.text || "").trim();
        await this.#report(true);
        // Пустой текст — значит речи не слышно; это не сбой, а «неразборчиво».
        return text;
      } catch (err) {
        await this.#report(false);
        console.warn(`Whisper: ошибка, пробую Gemini: ${err?.message}`);
      }
    }
    return this.fallback.transcribe(audioBase64, mimeType);
  }

  async #report(ok) {
    try {
      await this.onWhisper({ ok });
    } catch {
      // подсчёт не должен мешать расшифровке
    }
  }
}
