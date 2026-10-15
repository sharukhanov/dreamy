// Выбор режима, сонников и психологических подходов кнопками.
// callback_data:
//   md:<both|books|psy>[:n]   — режим
//   <bk|ps>:t:<номер>[:n]     — отметить/снять сонник или подход
//   <bk|ps>:r[:n]             — «случайные»
//   <bk|ps>:ok[:n]            — готово
//   <md|bk|ps>:open           — открыть выбор (из меню настроек)
//   st:open                   — меню настроек (кнопка под толкованием)
// «:n» — первый запуск (/start): режим → сонники → психология, по очереди и только нужное.
import * as texts from "./texts.js";
import { MODES } from "./prompt.js";

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

const usesBooks = (mode) => mode !== "psy";
const usesSchools = (mode) => mode !== "books";

// Кнопки под толкованием: что делать дальше.
export function resultMarkup() {
  return {
    inline_keyboard: [
      [{ text: texts.NEXT_DREAM_BUTTON, callback_data: "nx:dream" }],
      [
        { text: texts.SETTINGS_BUTTON, callback_data: "st:open" },
        { text: texts.HISTORY_BUTTON, callback_data: "nx:history" },
      ],
    ],
  };
}

// Меню настроек: текущий выбор и кнопки, чтобы поменять только нужное в этом режиме.
export function settingsMarkup(mode = "both") {
  const rows = [[{ text: texts.CHANGE_MODE_BUTTON, callback_data: "md:open" }]];
  if (usesBooks(mode)) rows.push([{ text: texts.CHANGE_BOOKS_BUTTON, callback_data: "bk:open" }]);
  if (usesSchools(mode)) rows.push([{ text: texts.CHANGE_SCHOOLS_BUTTON, callback_data: "ps:open" }]);
  return { inline_keyboard: rows };
}

export async function sendSettings(chatId, userId, deps) {
  const { telegram, storage, choices } = deps;
  const mode = await storage.getMode(userId);
  const books = labelsOf(choices.bk.all, await storage.getChoice(userId, KINDS.bk.setting));
  const schools = labelsOf(choices.ps.all, await storage.getChoice(userId, KINDS.ps.setting));
  await telegram.sendMessage(chatId, texts.settingsText(mode, books, schools, choices.bk.max, choices.ps.max), {
    reply_markup: settingsMarkup(mode),
  });
}

export function modeKeyboard(current, onboarding = false) {
  const suffix = onboarding ? ":n" : "";
  return {
    inline_keyboard: MODES.map((m) => [
      { text: `${m === current ? "✅ " : ""}${texts.MODE_BUTTONS[m]}`, callback_data: `md:${m}${suffix}` },
    ]),
  };
}

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

export async function sendModePicker(chatId, userId, { telegram, storage }, onboarding = false) {
  const mode = await storage.getMode(userId);
  await telegram.sendMessage(chatId, texts.CHOOSE_MODE, { reply_markup: modeKeyboard(mode, onboarding) });
}

export async function sendPicker(kind, chatId, userId, { telegram, storage, choices }, onboarding = false) {
  const { all, max } = choices[kind];
  const selected = await storage.getChoice(userId, KINDS[kind].setting);
  await telegram.sendMessage(chatId, KINDS[kind].choose(max), {
    reply_markup: pickerKeyboard(kind, all, selected, onboarding),
  });
}

async function summary(userId, { storage, choices }) {
  const mode = await storage.getMode(userId);
  const books = labelsOf(choices.bk.all, await storage.getChoice(userId, KINDS.bk.setting));
  const schools = labelsOf(choices.ps.all, await storage.getChoice(userId, KINDS.ps.setting));
  return texts.allSet(mode, books, schools, choices.bk.max, choices.ps.max);
}

async function handleModeCallback(callback, deps, value, flag) {
  const { telegram, storage } = deps;
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  const userId = callback.from.id;
  await telegram.answerCallbackQuery(callback.id);
  if (value === "open") {
    if (chatId) await sendModePicker(chatId, userId, deps);
    return;
  }
  if (!MODES.includes(value)) return;
  await storage.setMode(userId, value);
  if (!chatId) return;
  await telegram.editMessageText(chatId, messageId, texts.modeLine(value));
  if (flag === "n") {
    // Первый запуск: дальше спрашиваем только то, что нужно в выбранном режиме.
    await sendPicker(usesBooks(value) ? "bk" : "ps", chatId, userId, deps, true);
  } else {
    // Смена режима из меню: показываем настройки, чтобы можно было донастроить нужное.
    await sendSettings(chatId, userId, deps);
  }
}

// Возвращает true, если callback относился к выбору.
export async function handlePickerCallback(callback, deps) {
  const [kind, action, arg, flag] = String(callback.data || "").split(":");
  if (kind === "st") {
    await deps.telegram.answerCallbackQuery(callback.id);
    if (callback.message?.chat?.id) await sendSettings(callback.message.chat.id, callback.from.id, deps);
    return true;
  }
  if (kind === "md") {
    await handleModeCallback(callback, deps, action, arg);
    return true;
  }
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
    const selected = labelsOf(all, await storage.getChoice(userId, setting));
    const line = kind === "bk" ? texts.booksLine(selected, max) : texts.schoolsLine(selected, max);
    const mode = await storage.getMode(userId);
    if (onboarding && kind === "bk" && usesSchools(mode)) {
      await telegram.editMessageText(chatId, messageId, line);
      await sendPicker("ps", chatId, userId, deps, true);
    } else if (onboarding) {
      await telegram.editMessageText(chatId, messageId, await summary(userId, deps));
    } else {
      await telegram.editMessageText(chatId, messageId, texts.choiceSaved(line));
    }
    return true;
  }

  await telegram.answerCallbackQuery(callback.id);
  return true;
}
