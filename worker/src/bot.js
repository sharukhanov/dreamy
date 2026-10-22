// Логика бота: обработка одного апдейта Telegram. Тексты снов в логи не пишем.
import * as texts from "./texts.js";
import { applyMode, escapeHtml, stripMarkup, toTelegramHtml } from "./format.js";
import { InterpreterError, UNINTELLIGIBLE } from "./gemini.js";
import { handlePickerCallback, resultMarkup, sendModePicker, sendPicker, sendSettings } from "./picker.js";
import { looksLikeCrisis } from "./safety.js";
import { formatStats, periodStarts } from "./stats.js";

const TELEGRAM_LIMIT = 4096;
const FORGET_YES_DATA = "forget:yes";
const FORGET_NO_DATA = "forget:no";
const TYPING_INTERVAL_MS = 4500;
const MAX_VOICE_SECONDS = 180;
const MAX_VOICE_BYTES = 20 * 1024 * 1024; // больше Telegram не отдаёт ботам
const NEXT_DREAM_DATA = "nx:dream";
const HISTORY_DATA = "nx:history";
export function parseUserIds(raw) {
  const ids = new Set();
  for (const part of String(raw || "").split(/[,;]/)) {
    const p = part.trim();
    if (/^-?\d+$/.test(p)) ids.add(Number(p));
  }
  return ids;
}

// ALLOWED_USER_IDS: "" — режим настройки; "1,2" — только эти люди;
// "*" — все желающие; "*,1" — все, а у человека с id 1 нет дневного лимита.
export function parseAccess(raw) {
  const isPublic = String(raw || "")
    .split(/[,;]/)
    .some((p) => p.trim() === "*");
  return { isPublic, ids: parseUserIds(raw) };
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

// deps: { telegram, interpreter, storage, access: {isPublic, ids}, dailyLimit, timeZone,
//         choices: { bk: {all, max}, ps: {all, max} } }
export async function handleUpdate(update, deps) {
  const { telegram, storage, access } = deps;
  if (typeof update.update_id === "number" && !(await storage.markUpdate(update.update_id))) {
    console.log(`Повторный апдейт ${update.update_id}, пропускаю`);
    return;
  }

  const message = update.message;
  const callback = update.callback_query;
  const user = message?.from || callback?.from;
  if (!user) return;
  // Бот работает только в личных сообщениях, в группах молчит.
  const chatType = message?.chat?.type || callback?.message?.chat?.type;
  if (chatType && chatType !== "private") return;

  if (!access.isPublic && access.ids.size === 0) {
    console.log(`Режим настройки: сообщение от Telegram id ${user.id}`);
    const reply = texts.setupMode(user.id);
    if (message) await telegram.sendMessage(message.chat.id, reply);
    else await telegram.answerCallbackQuery(callback.id, reply, true);
    return;
  }
  if (!access.isPublic && !access.ids.has(user.id)) {
    console.log(`Отказ в доступе: Telegram id ${user.id}`);
    if (message) await telegram.sendMessage(message.chat.id, texts.NOT_ALLOWED);
    else await telegram.answerCallbackQuery(callback.id, texts.NOT_ALLOWED, true);
    return;
  }

  if (callback) return handleCallback(callback, deps);
  if (message) return handleMessage(message, deps);
}

async function handleCallback(callback, deps) {
  const { telegram, storage } = deps;
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;

  if (await handlePickerCallback(callback, deps)) return;
  if (callback.data === NEXT_DREAM_DATA) {
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await telegram.sendMessage(chatId, texts.NEXT_DREAM);
    return;
  }
  if (callback.data === HISTORY_DATA) {
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await sendHistory(chatId, callback.from.id, deps);
    return;
  }

  if (callback.data === FORGET_YES_DATA) {
    const count = await storage.deleteAll(callback.from.id);
    await storage.logEvent(callback.from.id, "forget");
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

  const voice = message.voice || message.audio;
  if (voice) return handleVoice(voice, message, deps);
  if (typeof message.text !== "string") {
    await deps.storage.logEvent(message.from.id, "non_text");
    await telegram.sendMessage(chatId, texts.ONLY_TEXT);
    return;
  }
  const text = message.text.trim();
  if (text.startsWith("/")) return handleCommand(text, message, deps);
  return handleDream(text, message, deps);
}

async function handleCommand(text, message, deps) {
  const { telegram, storage, timeZone } = deps;
  const chatId = message.chat.id;
  const command = text.split(/\s/)[0].split("@")[0].toLowerCase();
  switch (command) {
    case "/start":
      await storage.logEvent(message.from.id, "start");
      await telegram.sendMessage(chatId, texts.START);
      await sendModePicker(chatId, message.from.id, deps, true);
      break;
    case "/mode":
      await sendModePicker(chatId, message.from.id, deps);
      break;
    case "/settings":
      await sendSettings(chatId, message.from.id, deps);
      break;
    case "/sonnik":
      await sendPicker("bk", chatId, message.from.id, deps);
      break;
    case "/psy":
      await sendPicker("ps", chatId, message.from.id, deps);
      break;
    case "/stats":
      // Статистика — только для владельцев (id из ALLOWED_USER_IDS), остальным обычная справка.
      if (!deps.access.ids.has(message.from.id)) {
        await telegram.sendMessage(chatId, texts.HELP);
        break;
      }
      await telegram.sendMessage(
        chatId,
        formatStats(await storage.stats(periodStarts(new Date(), timeZone), [...deps.access.ids]), deps.choices),
      );
      break;
    case "/history":
      await sendHistory(chatId, message.from.id, deps);
      break;
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

async function sendHistory(chatId, userId, { telegram, storage, timeZone }) {
  await storage.logEvent(userId, "history");
  const records = await storage.latest(userId, 5);
  if (!records.length) {
    await telegram.sendMessage(chatId, texts.HISTORY_EMPTY);
    return;
  }
  await telegram.sendMessage(chatId, texts.historyHeader(records.length));
  for (const r of [...records].reverse()) {
    const date = formatDate(r.created_at, timeZone);
    const dream = cut(r.dream_text, 1000);
    const html = texts.historyItemHtml(date, escapeHtml(dream), toTelegramHtml(r.interpretation));
    const plain = texts.historyItem(date, dream, stripMarkup(r.interpretation));
    await telegram.sendHtml(chatId, html, cut(plain, TELEGRAM_LIMIT));
  }
}

// true — человек упёрся в дневной лимит (сообщение уже отправлено).
async function hitDailyLimit(userId, chatId, { telegram, storage, access, dailyLimit }) {
  if (!(dailyLimit > 0) || access.ids.has(userId)) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if ((await storage.countSince(userId, since)) < dailyLimit) return false;
  console.log(`Пользователь ${userId}: достигнут дневной лимит`);
  await storage.logEvent(userId, "limit_hit");
  await telegram.sendMessage(chatId, texts.dailyLimit(dailyLimit));
  return true;
}

// Голосовое: скачиваем, расшифровываем через Gemini, показываем расшифровку и толкуем как текст.
async function handleVoice(voice, message, deps) {
  const { telegram, interpreter, storage } = deps;
  const chatId = message.chat.id;
  const userId = message.from.id;

  if ((voice.duration || 0) > MAX_VOICE_SECONDS || (voice.file_size || 0) > MAX_VOICE_BYTES) {
    await storage.logEvent(userId, "too_long");
    await telegram.sendMessage(chatId, texts.voiceTooLong(Math.round(MAX_VOICE_SECONDS / 60)));
    return;
  }
  if (await hitDailyLimit(userId, chatId, deps)) return;

  console.log(`Пользователь ${userId}: голосовое (${voice.duration || "?"} с)`);
  await telegram.sendTyping(chatId);
  const typing = setInterval(() => telegram.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);
  let transcript;
  try {
    const audio = await telegram.downloadFile(voice.file_id);
    transcript = (await interpreter.transcribe(audio, voice.mime_type || "audio/ogg")).trim();
  } catch (err) {
    console.error(`Пользователь ${userId}: не удалось расшифровать голосовое: ${err?.message}`);
    await storage.logEvent(userId, "voice_fail");
    await telegram.sendMessage(chatId, err instanceof InterpreterError ? texts.API_ERROR : texts.VOICE_FAILED);
    return;
  } finally {
    clearInterval(typing);
  }

  if (!transcript || transcript.toUpperCase().includes(UNINTELLIGIBLE)) {
    await storage.logEvent(userId, "voice_fail");
    await telegram.sendMessage(chatId, texts.VOICE_UNCLEAR);
    return;
  }
  await storage.logEvent(userId, "voice_ok");
  await telegram.sendHtml(chatId, texts.voiceHeard(escapeHtml(cut(transcript, 1500))), texts.voiceHeardPlain(cut(transcript, 1500)));
  return handleDream(transcript, message, deps);
}

async function handleDream(text, message, { telegram, interpreter, storage, access, dailyLimit }) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (text.length > texts.MAX_DREAM_LENGTH) {
    await storage.logEvent(userId, "too_long");
    await telegram.sendMessage(chatId, texts.tooLong(text.length));
    return;
  }
  if (!text) {
    await telegram.sendMessage(chatId, texts.ONLY_TEXT);
    return;
  }
  if (looksLikeCrisis(text)) {
    console.log(`Пользователь ${userId}: сработала кризисная проверка`);
    await storage.logEvent(userId, "crisis");
    await telegram.sendMessage(chatId, texts.CRISIS_REPLY);
    return;
  }

  if (await hitDailyLimit(userId, chatId, { telegram, storage, access, dailyLimit })) return;

  console.log(`Пользователь ${userId}: толкование сна (${text.length} символов)`);
  await telegram.sendTyping(chatId);
  const typing = setInterval(() => telegram.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);
  const dreamBooks = await storage.getChoice(userId, "dream_books");
  const psychology = await storage.getChoice(userId, "psychology");
  const mode = await storage.getMode(userId);
  let interpretation;
  try {
    interpretation = applyMode(await interpreter.interpret(text, { dreamBooks, psychology, mode }), mode);
  } catch (err) {
    if (!(err instanceof InterpreterError)) throw err;
    console.error(`Пользователь ${userId}: модель недоступна`);
    await storage.logEvent(userId, "model_fail");
    await telegram.sendMessage(chatId, texts.API_ERROR);
    return;
  } finally {
    clearInterval(typing);
  }

  await storage.add(userId, text, interpretation);
  await storage.logEvent(userId, "dream_ok");
  await telegram.sendHtml(chatId, toTelegramHtml(interpretation), cut(stripMarkup(interpretation), TELEGRAM_LIMIT), {
    reply_markup: resultMarkup(),
  });
}
