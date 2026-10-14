// Превращает ответ модели в HTML для Telegram: **текст** → жирный, остальное экранируется.

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(text) {
  return escapeHtml(text).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
}

export function stripMarkup(text) {
  return text.replace(/\*\*/g, "");
}
