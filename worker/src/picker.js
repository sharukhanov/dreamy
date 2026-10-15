// Выбор сонников и психологических подходов кнопками.
// callback_data: <вид>:t:<номер>[:n] — отметить/снять, <вид>:r[:n] — случайные,
// <вид>:ok[:n] — готово, <вид>:open — открыть выбор. «:n» — первый запуск: после сонников
// сразу предлагаем выбрать психологию.
import * as texts from "./texts.js";

export const KINDS = {
  bk: {
    setting: "dream_books",
    choose: texts.chooseBooks,
    tooMany: texts.tooManyBooks,
    random: texts.RANDOM_BOOKS_BUTTON,
  },
  ps: {
    setting: "psychology",
    choose: texts.chooseSchools,
    tooMany: texts.tooManySchools,
    random: texts.RANDOM_SCHOOLS_BUTTON,
  },
};

export const RESULT_MARKUP = {
  inline_keyboard: [
    [
      { text: texts.CHANGE_BOOKS_BUTTON, callback_data: "bk:open" },
      { text: texts.CHANGE_SCHOOLS_BUTTON, callback_data: "ps:open" },
    ],
  ],
};

export function pickerKeyboard(kind, all, selected, onboarding = false) {
  const suffix = onboarding ? ":n" : "";
  const chosen = new Set(selected);
  const rows = [];
  all.forEach((item, i) => {
    const button = {
      text: `${chosen.has(item.name) ? "✅ " : ""}${item.button || item.label || item.name}`,
      callback_data: `${kind}:t:${i}${suffix}`,
    };
    if (i % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([{ text: `${chosen.size ? "" : "✅ "}${KINDS[kind].random}`, callback_data: `${kind}:r${suffix}` }]);
  rows.push([{ text: texts.PICKER_DONE_BUTTON, callback_data: `${kind}:ok${suffix}` }]);
  return { inline_keyboard: rows };
}

export function labelsOf(all, selected) {
  return all.filter((x) => selected.includes(x.name)).map((x) => x.label || x.name);
}

export async function sendPicker(kind, chatId, userId, { telegram, storage, choices }, onboarding = false) {
  const { all, max } = choices[kind];
  const selected = await storage.getChoice(userId, KINDS[kind].setting);
  await telegram.sendMessage(chatId, KINDS[kind].choose(max), {
    reply_markup: pickerKeyboard(kind, all, selected, onboarding),
  });
}

// Возвращает true, если callback относился к выбору.
export async function handlePickerCallback(callback, deps) {
  const [kind, action, arg, flag] = String(callback.data || "").split(":");
  if (!KINDS[kind]) return false;
  const { telegram, storage, choices } = deps;
  const { all, max } = choices[kind];
  const { setting } = KINDS[kind];
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const userId = callback.from.id;
  const onboarding = flag === "n" || (action !== "t" && arg === "n");

  if (action === "open") {
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) await sendPicker(kind, chatId, userId, deps);
    return true;
  }

  if (action === "t" || action === "r") {
    let selected = await storage.getChoice(userId, setting);
    if (action === "r") {
      selected = [];
    } else {
      const item = all[Number(arg)];
      if (!item) {
        await telegram.answerCallbackQuery(callback.id);
        return true;
      }
      if (selected.includes(item.name)) {
        selected = selected.filter((n) => n !== item.name);
      } else if (selected.length >= max) {
        await telegram.answerCallbackQuery(callback.id, KINDS[kind].tooMany(max), true);
        return true;
      } else {
        selected = [...selected, item.name];
      }
    }
    await storage.setChoice(userId, setting, selected);
    await telegram.answerCallbackQuery(callback.id);
    if (chatId) {
      await telegram.editMessageReplyMarkup(chatId, messageId, pickerKeyboard(kind, all, selected, onboarding));
    }
    return true;
  }

  if (action === "ok") {
    await telegram.answerCallbackQuery(callback.id);
    if (!chatId) return true;
    const books = labelsOf(choices.bk.all, await storage.getChoice(userId, KINDS.bk.setting));
    const schools = labelsOf(choices.ps.all, await storage.getChoice(userId, KINDS.ps.setting));
    if (kind === "bk" && onboarding) {
      await telegram.editMessageText(chatId, messageId, texts.booksLine(books, choices.bk.max));
      await sendPicker("ps", chatId, userId, deps, true);
    } else if (kind === "ps" && onboarding) {
      await telegram.editMessageText(chatId, messageId, texts.allSet(books, schools, choices.bk.max, choices.ps.max));
    } else {
      const line = kind === "bk" ? texts.booksLine(books, choices.bk.max) : texts.schoolsLine(schools, choices.ps.max);
      await telegram.editMessageText(chatId, messageId, texts.choiceSaved(line));
    }
    return true;
  }

  await telegram.answerCallbackQuery(callback.id);
  return true;
}
