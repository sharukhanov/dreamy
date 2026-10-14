// Превращает ответ модели в HTML для Telegram: **текст** → жирный, остальное экранируется.

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Выравнивает оформление расклада, чтобы оно не зависело от того, как модель расставила звёздочки.
export function normalizeLayout(text) {
  return text
    .replace(/^📖[ \t*]*Сонники[ \t*:]*$/gmu, "📖 **Сонники**")
    .replace(/^🧠[ \t*]*Психология[ \t*:]*$/gmu, "🧠 **Психология**")
    .replace(/^🏠[ \t*]*Из[ \t]+реальн\S*[ \t]+жизн[^\s*:—–-]*[ \t*:—–-]*/gimu, "🏠 ")
    .replace(/^🏠 (\S)/gmu, (m, ch) => `🏠 ${ch.toUpperCase()}`);
}

export function toTelegramHtml(text) {
  const html = escapeHtml(normalizeLayout(text)).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
  // Главная мысль (строка с ✨) всегда жирная, даже если модель забыла звёздочки.
  return html.replace(/^✨[ \t]*(\S.*)$/mu, (line, rest) =>
    rest.startsWith("<b>") ? line : `✨ <b>${rest}</b>`,
  );
}

export function stripMarkup(text) {
  return normalizeLayout(text).replace(/\*\*/g, "");
}
