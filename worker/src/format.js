// Превращает ответ модели в HTML для Telegram: **текст** → жирный, остальное экранируется.

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Выравнивает оформление расклада, чтобы оно не зависело от того, как модель расставила звёздочки.
export function normalizeLayout(text) {
  // Абзац сразу после главной мысли — строка про реальную жизнь; если модель забыла 🏠, добавим.
  const blocks = text.split(/\n{2,}/);
  if (blocks.length > 2 && blocks[0].startsWith("✨") && !/^(🏠|📖|🧠|•)/u.test(blocks[1])) {
    blocks[1] = `🏠 ${blocks[1]}`;
    text = blocks.join("\n\n");
  }
  return text
    // Главная мысль — общий итог; подписываем её «Если коротко:», убирая подписи модели.
    .replace(/^✨[ \t*]*(?:Если коротко|Коротко|Главная мысль|Суть сна|Суть)[ \t*]*[:—–-][ \t*]*/imu, "✨ ")
    .replace(/^✨[ \t]*(\S)/mu, "✨ Если коротко: $1")
    .replace(/^📖[ \t*]*Сонники[ \t*:]*$/gmu, "📖 **Сонники**")
    .replace(/^🧠[ \t*]*Психология[ \t*:]*$/gmu, "🧠 **Психология**")
    .replace(/^😴[ \t*]*Совет[ \t]+для[ \t]+сна[ \t*:—–-]*/gimu, "😴 **Совет для сна** — ")
    .replace(/^🏠[ \t*]*Из[ \t]+реальн\S*[ \t]+жизн[^\s*:—–-]*[ \t*:—–-]*/gimu, "🏠 ")
    .replace(/^🏠 (\S)/gmu, (m, ch) => `🏠 ${ch.toUpperCase()}`);
}

export function toTelegramHtml(text) {
  const html = escapeHtml(normalizeLayout(text)).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
  // Сама главная мысль всегда жирная, даже если модель забыла звёздочки.
  return html.replace(/^✨ Если коротко: (.+)$/mu, (line, rest) =>
    rest.startsWith("<b>") ? line : `✨ Если коротко: <b>${rest}</b>`,
  );
}

export function stripMarkup(text) {
  return normalizeLayout(text).replace(/\*\*/g, "");
}
