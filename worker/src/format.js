// Превращает ответ модели в HTML для Telegram: **текст** → жирный, остальное экранируется.

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(text) {
  const html = escapeHtml(text).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
  // Главная мысль (строка с ✨) всегда жирная, даже если модель забыла звёздочки.
  return html.replace(/^✨[ \t]*(\S.*)$/mu, (line, rest) =>
    rest.startsWith("<b>") ? line : `✨ <b>${rest}</b>`,
  );
}

export function stripMarkup(text) {
  return text.replace(/\*\*/g, "");
}
