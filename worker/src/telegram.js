// Минимальный клиент Telegram Bot API.

export class Telegram {
  constructor(token, fetchFn) {
    this.base = `https://api.telegram.org/bot${token}`;
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

  sendTyping(chatId) {
    return this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  editMessageText(chatId, messageId, text) {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text });
  }

  answerCallbackQuery(id, text, showAlert = false) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }
}
