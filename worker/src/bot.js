// Логика бота: обработка одного апдейта Telegram. Тексты снов в логи не пишем.
import * as texts from "./texts.js";
import { escapeHtml, stripMarkup, toTelegramHtml } from "./format.js";
import { InterpreterError } from "./gemini.js";
import { looksLikeCrisis } from "./safety.js";

const TELEGRAM_LIMIT = 4096;
const FORGET_YES_DATA = "forget:yes";
const FORGET_NO_DATA = "forget:no";
const TYPING_INTERVAL_MS = 4500;
// Кнопки выбора сонников: bk:t:<номер> — отметить/снять, bk:r — случайные, bk:ok — готово, bk:open — открыть выбор.
const BOOK_TOGGLE = "bk:t:";
const BOOK_RANDOM = "bk:r";
const BOOK_DONE = "bk:ok";
const BOOK_OPEN = "bk:open";
const CHANGE_BOOKS_MARKUP = {
  inline_keyboard: [[{ text: texts.CHANGE_BOOKS_BUTTON, callback_data: BOOK_OPEN }]],
};

export function bookKeyboard(allBooks, selected) {
  const chosen = new Set(selected);
  const rows = [];
  allBooks.forEach((book, i) => {
    const text = `${chosen.has(book.name) ? "✅ " : ""}${book.button || book.label || book.name}`;
    const button = { text, callback_data: `${BOOK_TOGGLE}${i}` };
    if (i % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([{ text: `${chosen.size ? "" : "✅ "}${texts.RANDOM_BOOKS_BUTTON}`, callback_data: BOOK_RANDOM }]);
  rows.push([{ text: texts.BOOKS_DONE_BUTTON, callback_data: BOOK_DONE }]);
  return { inline_keyboard: rows };
}

function chosenLabels(allBooks, selected) {
  return allBooks.filter((b) => selected.includes(b.name)).map((b) => b.label || b.name);
}

async function sendBookPicker(chatId, userId, { telegram, storage, books }) {
  const selected = await storage.getBooks(userId);
  await telegram.sendMessage(chatId, texts.chooseBooks(books.max), {
    reply_markup: bookKeyboard(books.all, selected),
  });
}

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
//         books: { all: [{name, label, button}], max } }
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
  const { telegram, storage, books } = deps;
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const userId = callback.from.id;
  const data = callback.data || "";

  if (data.startsWith(BOOK_TOGGLE)) {
    const book = books.all[Number(data.slice(BOOK_TOGGLE.length))];
    if (!book) return telegram.answerCallbackQuery(callback.id);
    let selected = await storage.getBooks(userId);
    if (selected.includes(book.name)) {
      selected = selected.filter((n) => n !== book.name);
    } else if (selected.length >= books.max) {
      return telegram.answerCallbackQuery(callback.id, texts.tooManyBooks(books.max), true);
    } else {
      selected = [...selected, book.name];
    }
    await storage.setBooks(userId, selected);
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await telegram.editMessageReplyMarkup(chatId, messageId, bookKeyboard(books.all, selected));
    return;
  }
  if (data === BOOK_RANDOM) {
    await storage.setBooks(userId, []);
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await telegram.editMessageReplyMarkup(chatId, messageId, bookKeyboard(books.all, []));
    return;
  }
  if (data === BOOK_DONE) {
    const selected = await storage.getBooks(userId);
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) {
      await telegram.editMessageText(chatId, messageId, texts.booksChosen(chosenLabels(books.all, selected), books.max));
    }
    return;
  }
  if (data === BOOK_OPEN) {
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await sendBookPicker(chatId, userId, deps);
    return;
  }

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

async function handleCommand(text, message, deps) {
  const { telegram, storage, timeZone } = deps;
  const chatId = message.chat.id;
  const command = text.split(/\s/)[0].split("@")[0].toLowerCase();
  switch (command) {
    case "/start":
      await telegram.sendMessage(chatId, texts.START);
      await sendBookPicker(chatId, message.from.id, deps);
      break;
    case "/sonnik":
      await sendBookPicker(chatId, message.from.id, deps);
      break;
    case "/history": {
      const records = await storage.latest(message.from.id, 5);
      if (!records.length) {
        await telegram.sendMessage(chatId, texts.HISTORY_EMPTY);
        break;
      }
      await telegram.sendMessage(chatId, texts.historyHeader(records.length));
      for (const r of [...records].reverse()) {
        const date = formatDate(r.created_at, timeZone);
        const dream = cut(r.dream_text, 1000);
        const html = texts.historyItemHtml(date, escapeHtml(dream), toTelegramHtml(r.interpretation));
        const plain = texts.historyItem(date, dream, stripMarkup(r.interpretation));
        await telegram.sendHtml(chatId, html, cut(plain, TELEGRAM_LIMIT));
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

async function handleDream(text, message, { telegram, interpreter, storage, access, dailyLimit }) {
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

  if (dailyLimit > 0 && !access.ids.has(userId)) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if ((await storage.countSince(userId, since)) >= dailyLimit) {
      console.log(`Пользователь ${userId}: достигнут дневной лимит`);
      await telegram.sendMessage(chatId, texts.dailyLimit(dailyLimit));
      return;
    }
  }

  console.log(`Пользователь ${userId}: толкование сна (${text.length} символов)`);
  await telegram.sendTyping(chatId);
  const typing = setInterval(() => telegram.sendTyping(chatId).catch(() => {}), TYPING_INTERVAL_MS);
  const dreamBooks = await storage.getBooks(userId);
  let interpretation;
  try {
    interpretation = await interpreter.interpret(text, { dreamBooks });
  } catch (err) {
    if (!(err instanceof InterpreterError)) throw err;
    console.error(`Пользователь ${userId}: модель недоступна`);
    await telegram.sendMessage(chatId, texts.API_ERROR);
    return;
  } finally {
    clearInterval(typing);
  }

  await storage.add(userId, text, interpretation);
  await telegram.sendHtml(chatId, toTelegramHtml(interpretation), cut(stripMarkup(interpretation), TELEGRAM_LIMIT), {
    reply_markup: CHANGE_BOOKS_MARKUP,
  });
}
