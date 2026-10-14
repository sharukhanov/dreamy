// Точка входа Cloudflare Worker: Telegram присылает сюда апдейты (webhook).
import promptTemplate from "../../prompts/interpreter.md";
import traditionsYaml from "../../config/traditions.yaml";
import { handleUpdate, parseAccess } from "./bot.js";
import { GeminiInterpreter } from "./gemini.js";
import { createPromptBuilder } from "./prompt.js";
import { D1Storage } from "./storage.js";
import { Telegram } from "./telegram.js";

const buildPrompt = createPromptBuilder(promptTemplate, traditionsYaml);

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

    const deps = {
      telegram: new Telegram(env.TELEGRAM_BOT_TOKEN),
      interpreter: new GeminiInterpreter({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        fallbackModel: env.GEMINI_FALLBACK_MODEL,
        systemPrompt: buildPrompt,
      }),
      storage: new D1Storage(env.DB),
      access: parseAccess(env.ALLOWED_USER_IDS),
      dailyLimit: Number(env.DAILY_LIMIT ?? 10),
      timeZone: env.TIME_ZONE || "Europe/Moscow",
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
