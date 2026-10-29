// Точка входа Cloudflare Worker: Telegram присылает сюда апдейты (webhook).
import promptTemplate from "../../prompts/interpreter.md";
import traditionsYaml from "../../config/traditions.yaml";
import { handleUpdate, parseAccess } from "./bot.js";
import { GeminiInterpreter } from "./gemini.js";
import { createPromptBuilder, parseTraditions } from "./prompt.js";
import { D1Storage } from "./storage.js";
import { Telegram } from "./telegram.js";

const buildPrompt = createPromptBuilder(promptTemplate, traditionsYaml);
const TRADITIONS = parseTraditions(traditionsYaml);
const CHOICES = {
  bk: { all: TRADITIONS.dream_books, max: TRADITIONS.pick.dream_books },
  ps: { all: TRADITIONS.psychology, max: TRADITIONS.pick.psychology },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Сонник работает.", { status: 200 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await request.json().catch(() => null);
    if (!update) return new Response("bad request", { status: 400 });

    const storage = new D1Storage(env.DB);
    const userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? 0;
    const deps = {
      telegram: new Telegram(env.TELEGRAM_BOT_TOKEN),
      interpreter: new GeminiInterpreter({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        fallbackModel: env.GEMINI_FALLBACK_MODEL,
        systemPrompt: buildPrompt,
        // Каждый запрос к Gemini записываем, чтобы в /stats видеть расход дневного лимита.
        onCall: ({ model, ok }) => storage.logEvent(userId, `${ok ? "ai" : "ai_fail"}:${model}`),
      }),
      storage,
      ai: {
        models: [...new Set([env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean))],
        dailyLimit: Number(env.GEMINI_DAILY_LIMIT || 500),
      },
      access: parseAccess(env.ALLOWED_USER_IDS),
      dailyLimit: Number(env.DAILY_LIMIT ?? 10),
      timeZone: env.TIME_ZONE || "Europe/Moscow",
      choices: CHOICES,
    };

    try {
      await handleUpdate(update, deps);
    } catch (err) {
      // Отвечаем 200, чтобы Telegram не присылал апдейт снова и снова.
      console.error(`Ошибка обработки апдейта: ${err?.name}: ${err?.message}`);
    }
    return new Response("ok");
  },
};
