import { InterpreterError } from "../src/gemini.js";

export const OWNER_ID = 111;
export const STRANGER_ID = 999;
export const SCHOOLS = ["Фрейд", "Юнг", "Холл", "Перлз"].map((name) => ({ name, label: name, button: name }));
export const BOOKS = ["Миллер", "Цветков", "Ванга", "Лофф", "Нострадамус"].map((name) => ({
  name,
  label: name,
  button: name,
}));

export class FakeTelegram {
  constructor() {
    this.calls = [];
  }
  async sendMessage(chatId, text, extra = {}) {
    this.calls.push({ method: "sendMessage", chatId, text, extra });
    return { ok: true, result: { message_id: 1000 + this.calls.length } };
  }
  async editHtml(chatId, messageId, html, plain, extra = {}) {
    this.calls.push({ method: "editMessageText", chatId, messageId, text: html, plain, html: true, extra });
    return { ok: true };
  }
  async sendHtml(chatId, html, plain, extra = {}) {
    this.calls.push({ method: "sendMessage", chatId, text: html, plain, html: true, extra });
  }
  async downloadFile(fileId) {
    this.calls.push({ method: "downloadFile", fileId });
    if (this.downloadFails) throw new Error("download failed");
    return "QUJD";
  }
  async editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    this.calls.push({ method: "editMessageReplyMarkup", chatId, messageId, replyMarkup });
  }
  async sendTyping(chatId) {
    this.calls.push({ method: "sendTyping", chatId });
  }
  async editMessageText(chatId, messageId, text, extra = {}) {
    this.calls.push({ method: "editMessageText", chatId, messageId, text, extra });
  }
  async answerCallbackQuery(id, text, showAlert) {
    this.calls.push({ method: "answerCallbackQuery", id, text, showAlert });
  }
  get texts() {
    return this.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => c.text);
  }
}

export class MemoryStorage {
  constructor() {
    this.rows = [];
    this.books = new Map();
    this.events = [];
    this.seen = new Set();
    this.nextId = 1;
  }
  async markUpdate(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
  async add(userId, dreamText, interpretation) {
    this.rows.push({
      id: this.nextId++,
      user_id: userId,
      created_at: new Date().toISOString(),
      dream_text: dreamText,
      interpretation,
    });
  }
  async latest(userId, limit = 5) {
    return this.rows.filter((r) => r.user_id === userId).sort((a, b) => b.id - a.id).slice(0, limit);
  }
  async logEvent(userId, type) {
    this.events.push({ userId, type });
  }
  async aiUsage(sinceIso) {
    this.aiSince = sinceIso;
    return this.aiUsed || {};
  }
  async statsData(excludeIds) {
    this.statsCall = { excludeIds };
    const events = this.events
      .filter((e) => !excludeIds.includes(e.userId))
      .map((e, i) => ({ user_id: e.userId, type: e.type, created_at: new Date(Date.now() - (100 - i) * 1000).toISOString() }));
    const firstSeen = new Map();
    for (const e of events) if (!firstSeen.has(e.user_id)) firstSeen.set(e.user_id, e.created_at);
    return { events, firstSeen };
  }
  async getMode(userId) {
    return this.books.get(`${userId}:mode`) || "both";
  }
  async setMode(userId, mode) {
    this.books.set(`${userId}:mode`, mode);
  }
  async getChoice(userId, setting) {
    return this.books.get(`${userId}:${setting}`) || [];
  }
  async setChoice(userId, setting, names) {
    this.books.set(`${userId}:${setting}`, names);
  }
  async countSince(userId, sinceIso) {
    return this.rows.filter((r) => r.user_id === userId && r.created_at >= sinceIso).length;
  }
  async deleteAll(userId) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.user_id !== userId);
    return before - this.rows.length;
  }
}

export class FakeInterpreter {
  constructor(reply = "Толкование сна.") {
    this.reply = reply;
    this.fail = false;
    this.calls = [];
    this.options = [];
  }
  async transcribe(audio, mimeType) {
    this.transcribed = { audio, mimeType };
    if (this.fail) throw new InterpreterError("boom");
    return this.transcript ?? "Мне снилось море и большой корабль.";
  }
  async interpret(text, options = {}) {
    this.calls.push(text);
    this.options.push(options);
    if (this.fail) throw new InterpreterError("boom");
    return this.reply;
  }
}

let counter = 1;

export function messageUpdate(userId, text, extra = {}) {
  return {
    update_id: counter++,
    message: {
      message_id: counter++,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "T" },
      ...(text === undefined ? {} : { text }),
      ...extra,
    },
  };
}

export function callbackUpdate(userId, data) {
  return {
    update_id: counter++,
    callback_query: {
      id: String(counter++),
      from: { id: userId, is_bot: false, first_name: "T" },
      data,
      message: { message_id: 5, chat: { id: userId, type: "private" } },
    },
  };
}

export function makeDeps(allowed = [OWNER_ID], { isPublic = false, dailyLimit = 0 } = {}) {
  return {
    access: { isPublic, ids: new Set(allowed) },
    dailyLimit,
    telegram: new FakeTelegram(),
    interpreter: new FakeInterpreter(),
    storage: new MemoryStorage(),
    timeZone: "Europe/Moscow",
    choices: { bk: { all: BOOKS, max: 3 }, ps: { all: SCHOOLS, max: 3 } },
  };
}
