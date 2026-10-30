// Толкование через Google Gemini (REST API).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class InterpreterError extends Error {
  // blocked — Gemini отказался обрабатывать содержимое (фильтр безопасности Google), а не был недоступен.
  constructor(message, { blocked = false } = {}) {
    super(message);
    this.blocked = blocked;
  }
}

// Причины, по которым Google отказывается отвечать на само содержимое запроса.
const BLOCK_REASONS = ["PROHIBITED_CONTENT", "SAFETY", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "OTHER"];

const TRANSCRIBE_PROMPT =
  "Ты расшифровываешь голосовые сообщения, в которых человек рассказывает свой сон. " +
  "Запиши сказанное дословно, на языке оригинала, с нормальной пунктуацией. " +
  "Убери только слова-паразиты («ээ», «ну», «короче»). Ничего не толкуй, не комментируй и не добавляй. " +
  "Если речи не слышно или разобрать её нельзя — ответь ровно словом НЕРАЗБОРЧИВО.";
export const UNINTELLIGIBLE = "НЕРАЗБОРЧИВО";

export class GeminiInterpreter {
  // onCall({ model, ok }) — вызывается на каждый запрос к Gemini (для подсчёта дневного лимита).
  constructor({ apiKey, model, fallbackModel, systemPrompt, fetchFn, timeoutMs = 25000, retryDelayMs = 1500, onCall }) {
    this.onCall = onCall || (() => {});
    this.apiKey = apiKey;
    // Первая попытка — основная модель, повтор — запасная (если задана).
    this.models = [model, fallbackModel || model];
    // Строка или функция, которая возвращает промт (свежий набор традиций на каждый сон).
    this.systemPrompt = systemPrompt;
    this.fetch = fetchFn || ((...args) => fetch(...args));
    this.timeoutMs = timeoutMs;
    this.retryDelayMs = retryDelayMs;
  }

  // options: { dreamBooks, psychology } — выбранные имена; пусто — значит случайные.
  async interpret(dreamText, options = {}) {
    const systemPrompt =
      typeof this.systemPrompt === "function" ? this.systemPrompt(options) : this.systemPrompt;
    return this.#withRetry((model) => this.#call(model, [{ text: dreamText }], systemPrompt, 0.8));
  }

  // Голосовое → текст. audioBase64 — содержимое файла, mimeType — например "audio/ogg".
  async transcribe(audioBase64, mimeType) {
    return this.#withRetry((model) =>
      this.#call(model, [{ inlineData: { mimeType, data: audioBase64 } }], TRANSCRIBE_PROMPT, 0),
    );
  }

  async #withRetry(attempt) {
    let lastError;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      try {
        const result = await attempt(model);
        await this.#report(model, true);
        return result;
      } catch (err) {
        await this.#report(model, false);
        lastError = err;
        console.warn(`Gemini (${model}): ошибка на попытке ${i + 1}/${this.models.length}: ${err.message}`);
        if (i < this.models.length - 1 && this.retryDelayMs) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
        }
      }
    }
    throw new InterpreterError(lastError?.message || "unknown", { blocked: Boolean(lastError?.blocked) });
  }

  async #report(model, ok) {
    try {
      await this.onCall({ model, ok });
    } catch {
      // подсчёт не должен ломать толкование
    }
  }

  async #call(model, parts, systemPrompt, temperature) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const answer = data?.candidates?.[0]?.content?.parts || [];
      const text = answer
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
        .trim();
      if (!text) {
        const c = data?.candidates?.[0];
        const why = [c?.finishReason, data?.promptFeedback?.blockReason].filter(Boolean).join(", ");
        const err = new Error(`пустой ответ модели${why ? ` (${why})` : ""}`);
        err.blocked = BLOCK_REASONS.includes(c?.finishReason) || Boolean(data?.promptFeedback?.blockReason);
        throw err;
      }
      return text;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("таймаут");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
