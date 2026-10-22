// Минимальный клиент Telegram Bot API.

export class Telegram {
  constructor(token, fetchFn) {
    this.base = `https://api.telegram.org/bot${token}`;
    this.fileBase = `https://api.telegram.org/file/bot${token}`;
    this.fetch = fetchFn || ((...args) => fetch(...args));
  }

  async call(method, payload) {
    const response = await this.fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) console.warn(`Telegram ${method}: ошибка ${response.status} ${data.description || ""}`);
    return data;
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call("sendMessage", { chat_id: chatId, text, ...extra });
  }

  // Отправка с HTML-разметкой; если Telegram её не принял — тем же текстом без разметки.
  async sendHtml(chatId, html, plain, extra = {}) {
    const res = await this.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", ...extra });
    if (!res.ok && plain !== undefined) return this.sendMessage(chatId, plain, extra);
    return res;
  }

  // Скачивает файл (например, голосовое) и возвращает его в base64.
  async downloadFile(fileId) {
    const info = await this.call("getFile", { file_id: fileId });
    if (!info.ok || !info.result?.file_path) throw new Error("getFile не удался");
    const response = await this.fetch(`${this.fileBase}/${info.result.file_path}`);
    if (!response.ok) throw new Error(`загрузка файла: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  sendTyping(chatId) {
    return this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  editMessageText(chatId, messageId, text, extra = {}) {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...extra });
  }

  // Превращает сообщение «принял, жду…» в готовый ответ. Если HTML не принят — без разметки,
  // а если сообщение отредактировать нельзя — отправляет новым.
  async editHtml(chatId, messageId, html, plain, extra = {}) {
    const base = { chat_id: chatId, message_id: messageId, ...extra };
    let res = await this.call("editMessageText", { ...base, text: html, parse_mode: "HTML" });
    if (res.ok) return res;
    res = await this.call("editMessageText", { ...base, text: plain });
    if (res.ok) return res;
    return this.sendMessage(chatId, plain, extra);
  }

  editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    return this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  }

  answerCallbackQuery(id, text, showAlert = false) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }
}
