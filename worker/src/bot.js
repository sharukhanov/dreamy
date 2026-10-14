// Логика бота: обработка одного апдейта Telegram. Тексты снов в логи не пишем.
import * as texts from "./texts.js";
import { InterpreterError } from "./gemini.js";
import { looksLikeCrisis } from "./safety.js";

const TELEGRAM_LIMIT = 4096;
const FORGET_YES_DATA = "forget:yes";
const FORGET_NO_DATA = "forget:no";
const TYPING_INTERVAL_MS = 4500;

export function parseUserIds(raw) {
  const ids = new Set();
  for (const part of String(raw || "").split(/[,;]/)) {
    const p = part.trim();
    if (/^-?\d+$/.test(p)) ids.add(Number(p));
  }
  return ids;
}

const cut = (text, limit) => (text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…");

function formatDate(iso, timeZone) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");
}

// deps: { telegram, interpreter, storage, allowedIds: Set<number>, timeZone }
export async function handleUpdate(update, deps) {
  const { telegram, storage, allowedIds } = deps;
  if (typeof update.update_id === "number" && !(await storage.markUpdate(update.update_id))) {
    console.log(`Повторный апдейт ${update.update_id}, пропускаю`);
    return;
  }

  const message = update.message;
  const callback = update.callback_query;
  const user = message?.from || callback?.from;
  if (!user) return;

  if (allowedIds.size === 0) {
    console.log(`Режим настройки: сообщение от Telegram id ${user.id}`);
    const reply = texts.setupMode(user.id);
    if (message) await telegram.sendMessage(message.chat.id, reply);
    else await telegram.answerCallbackQuery(callback.id, reply, true);
    return;
  }
  if (!allowedIds.has(user.id)) {
    console.log(`Отказ в доступе: Telegram id ${user.id}`);
    if (message) await telegram.sendMessage(message.chat.id, texts.NOT_ALLOWED);
    else await telegram.answerCallbackQuery(callback.id, texts.NOT_ALLOWED, true);
    return;
  }

  if (callback) return handleCallback(callback, deps);
  if (message) return handleMessage(message, deps);
}

async function handleCallback(callback, { telegram, storage }) {
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (callback.data === FORGET_YES_DATA) {
    const count = await storage.deleteAll(callback.from.id);
    console.log(`Пользователь ${callback.from.id} удалил дневник (${count} записей)`);
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await telegram.editMessageText(chatId, messageId, texts.forgetDone(count));
  } else if (callback.data === FORGET_NO_DATA) {
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await telegram.editMessageText(chatId, messageId, texts.FORGET_CANCELLED);
  } else {
    await telegram.answerCallbackQuery(callback.id);
  }
}

async function handleMessage(message, deps) {
  const { telegram } = deps;
  const chatId = message.chat.id;

  if (typeof message.text !== "string") {
    await telegram.sendMessage(chatId, texts.ONLY_TEXT);
    return;
  }
  const text = message.text.trim();
  if (text.startsWith("/")) return handleCommand(text, message, deps);
  return handleDream(text, message, deps);
}

async function handleCommand(text, message, { telegram, storage, timeZone }) {
  const chatId = message.chat.id;
  const command = text.split(/\s/)[0].split("@")[0].toLowerCase();
  switch (command) {
    case "/start":
      await telegram.sendMessage(chatId, texts.START);
      break;
    case "/history": {
      const records = await storage.latest(message.from.id, 5);
      if (!records.length) {
        await telegram.sendMessage(chatId, texts.HISTORY_EMPTY);
        break;
      }
      await telegram.sendMessage(chatId, texts.historyHeader(records.length));
      for (const r of [...records].reverse()) {
        const item = texts.historyItem(
          formatDate(r.created_at, timeZone),
          cut(r.dream_text, 1000),
          r.interpretation,
        );
        await telegram.sendMessage(chatId, cut(item, TELEGRAM_LIMIT));
      }
      break;
    }
    case "/forget":
      await telegram.sendMessage(chatId, texts.FORGET_CONFIRM, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: texts.FORGET_YES, callback_data: FORGET_YES_DATA },
              { text: texts.FORGET_NO, callback_data: FORGET_NO_DATA },
            ],
          ],
        },
      });
      break;
    default:
      await telegram.sendMessage(chatId, texts.HELP);
  }
}

async function handleDream(text, message, { telegram, interpreter, storage }) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (text.length > texts.MAX_DREAM_LENGTH) {
    await telegram.sendMessage(chatId, texts.tooLong(text.length));
    return;
  }
  if (!text) {
    await telegram.sendMessage(chatId, texts.ONLY_TEXT);
    return;
  }
  if (looksLikeCrisis(text)) {
    console.log(`Пользователь ${userId}: сработала кризисная проверка`);
    await telegram.sendMessage(chatId, texts.CRISIS_REPLY);
    return;
  }

  console.log(`Пользователь ${userId}: толкование сна (${text.length} символов)`);
  await telegram.sendTyping(chatId);
  const typing = setInterval(() => telegram.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);
  let interpretation;
  try {
    interpretation = await interpreter.interpret(text);
  } catch (err) {
    if (!(err instanceof InterpreterError)) throw err;
    console.error(`Пользователь ${userId}: модель недоступна`);
    await telegram.sendMessage(chatId, texts.API_ERROR);
    return;
  } finally {
    clearInterval(typing);
  }

  await storage.add(userId, text, interpretation);
  await telegram.sendMessage(chatId, cut(interpretation, TELEGRAM_LIMIT));
}
