// Толкование через Google Gemini (REST API).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class InterpreterError extends Error {}

export class GeminiInterpreter {
  constructor({ apiKey, model, fallbackModel, systemPrompt, fetchFn, timeoutMs = 25000, retryDelayMs = 1500 }) {
    this.apiKey = apiKey;
    // Первая попытка — основная модель, повтор — запасная (если задана).
    this.models = [model, fallbackModel || model];
    // Строка или функция, которая возвращает промт (свежий набор традиций на каждый сон).
    this.systemPrompt = systemPrompt;
    this.fetch = fetchFn || ((...args) => fetch(...args));
    this.timeoutMs = timeoutMs;
    this.retryDelayMs = retryDelayMs;
  }

  async interpret(dreamText) {
    const systemPrompt =
      typeof this.systemPrompt === "function" ? this.systemPrompt() : this.systemPrompt;
    let lastError;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      try {
        return await this.#call(model, dreamText, systemPrompt);
      } catch (err) {
        lastError = err;
        console.warn(`Gemini (${model}): ошибка на попытке ${i + 1}/${this.models.length}: ${err.message}`);
        if (i < this.models.length - 1 && this.retryDelayMs) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
        }
      }
    }
    throw new InterpreterError(lastError?.message || "unknown");
  }

  async #call(model, dreamText, systemPrompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: dreamText }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
        .trim();
      if (!text) throw new Error("пустой ответ модели");
      return text;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("таймаут");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
