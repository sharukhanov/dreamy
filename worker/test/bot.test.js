import { describe, expect, it } from "vitest";
import { handleUpdate, parseAccess, parseUserIds } from "../src/bot.js";
import * as texts from "../src/texts.js";
import { OWNER_ID, STRANGER_ID, callbackUpdate, makeDeps, messageUpdate } from "./helpers.js";

const DREAM = "Мне снилось, что я падаю с высокой башни, а внизу шумит море.";

describe("сны", () => {
  it("толкует и сохраняет сон, показывает «печатает»", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    expect(d.telegram.texts).toEqual(["Толкование сна."]);
    expect(d.telegram.calls[0].method).toBe("sendTyping");
    expect(d.interpreter.calls).toEqual([DREAM]);
    const rows = await d.storage.latest(OWNER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].dream_text).toBe(DREAM);
  });

  it("выделяет главную мысль жирным и экранирует HTML", async () => {
    const d = makeDeps();
    d.interpreter.reply = "✨ **Главное** <тег>\n\n💭 Вопрос?";
    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    const sent = d.telegram.calls.find((c) => c.html);
    expect(sent.text).toBe("✨ Если коротко: <b>Главное</b> &lt;тег&gt;\n\n💭 Вопрос?");
    expect(sent.plain).toBe("✨ Если коротко: Главное <тег>\n\n💭 Вопрос?");
  });

  it("не толкует слишком длинный сон", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "а".repeat(4001)), d);
    expect(d.telegram.texts[0]).toContain("4001");
    expect(d.interpreter.calls).toHaveLength(0);
  });

  it("принимает сон ровно в 4000 символов", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "а".repeat(4000)), d);
    expect(d.interpreter.calls).toHaveLength(1);
  });

  it("при кризисе отвечает бережно и не толкует", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "Снилась тьма, и я не хочу больше жить"), d);
    expect(d.telegram.texts).toEqual([texts.CRISIS_REPLY]);
    expect(d.interpreter.calls).toHaveLength(0);
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(0);
  });

  it("при недоступной модели пишет понятное сообщение", async () => {
    const d = makeDeps();
    d.interpreter.fail = true;
    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    expect(d.telegram.texts).toEqual([texts.API_ERROR]);
    expect(texts.API_ERROR).toContain("Временно не удаётся подключиться к модели");
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(0);
  });

  it("на голосовое отвечает, что понимает только текст", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, undefined, { voice: { file_id: "x", duration: 2 } }), d);
    expect(d.telegram.texts).toEqual([texts.ONLY_TEXT]);
  });

  it("игнорирует повторную доставку того же апдейта", async () => {
    const d = makeDeps();
    const u = messageUpdate(OWNER_ID, DREAM);
    await handleUpdate(u, d);
    await handleUpdate(u, d);
    expect(d.interpreter.calls).toHaveLength(1);
  });
});

describe("выбор сонников и психологии", () => {
  const lastKeyboard = (d) => {
    const c = [...d.telegram.calls].reverse().find((x) => x.extra?.reply_markup || x.replyMarkup);
    return (c.replyMarkup || c.extra.reply_markup).inline_keyboard.flat();
  };
  const keyboardOf = (d) => lastKeyboard(d).map((b) => b.text);

  it("/start: приветствие, затем выбор сонников, затем выбор психологии", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "/start"), d);
    expect(d.telegram.texts).toEqual([texts.START, texts.chooseBooks(3)]);
    expect(lastKeyboard(d).at(-1).callback_data).toBe("bk:ok:n");

    await handleUpdate(callbackUpdate(OWNER_ID, "bk:t:0:n"), d);
    expect(lastKeyboard(d).at(-1).callback_data).toBe("bk:ok:n");
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:ok:n"), d);
    expect(d.telegram.texts.slice(-2)).toEqual([texts.booksLine(["Миллер"]), texts.chooseSchools(3)]);

    await handleUpdate(callbackUpdate(OWNER_ID, "ps:t:1:n"), d);
    await handleUpdate(callbackUpdate(OWNER_ID, "ps:ok:n"), d);
    expect(d.telegram.texts.at(-1)).toBe(texts.allSet(["Миллер"], ["Юнг"], 3, 3));

    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    expect(d.interpreter.options.at(-1)).toEqual({ dreamBooks: ["Миллер"], psychology: ["Юнг"] });
  });

  it("/sonnik и /psy показывают кнопки, по умолчанию отмечены «Случайные»", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "/sonnik"), d);
    expect(keyboardOf(d)).toContain("Миллер");
    expect(keyboardOf(d)).toContain(`✅ ${texts.RANDOM_BOOKS_BUTTON}`);
    await handleUpdate(messageUpdate(OWNER_ID, "/psy"), d);
    expect(d.telegram.texts.at(-1)).toBe(texts.chooseSchools(3));
    expect(keyboardOf(d)).toContain("Юнг");
  });

  it("отмечает и снимает отметку, готово без онбординга сохраняет выбор", async () => {
    const d = makeDeps();
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:t:0"), d);
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:t:3"), d);
    expect(await d.storage.getChoice(OWNER_ID, "dream_books")).toEqual(["Миллер", "Лофф"]);
    expect(keyboardOf(d)).toContain("✅ Лофф");
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:t:3"), d);
    expect(await d.storage.getChoice(OWNER_ID, "dream_books")).toEqual(["Миллер"]);
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:ok"), d);
    expect(d.telegram.texts.at(-1)).toBe(texts.choiceSaved(texts.booksLine(["Миллер"])));
  });

  it("не больше трёх", async () => {
    const d = makeDeps();
    for (const i of [0, 1, 2, 3]) await handleUpdate(callbackUpdate(OWNER_ID, `ps:t:${i}`), d);
    expect(await d.storage.getChoice(OWNER_ID, "psychology")).toHaveLength(3);
    const alert = d.telegram.calls.filter((c) => c.method === "answerCallbackQuery").at(-1);
    expect(alert.text).toBe(texts.tooManySchools(3));
    expect(alert.showAlert).toBe(true);
  });

  it("«Случайные» сбрасывает выбор", async () => {
    const d = makeDeps();
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:t:0"), d);
    await handleUpdate(callbackUpdate(OWNER_ID, "bk:r"), d);
    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    expect(d.interpreter.options.at(-1)).toEqual({ dreamBooks: [], psychology: [] });
  });

  it("под толкованием кнопки «Сонники» и «Психология»", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    const sent = d.telegram.calls.find((c) => c.html);
    expect(sent.extra.reply_markup.inline_keyboard[0].map((b) => b.callback_data)).toEqual(["bk:open", "ps:open"]);
    await handleUpdate(callbackUpdate(OWNER_ID, "ps:open"), d);
    expect(d.telegram.texts.at(-1)).toBe(texts.chooseSchools(3));
  });
});

describe("доступ", () => {
  it("отказывает чужим", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(STRANGER_ID, DREAM), d);
    expect(d.telegram.texts).toEqual([texts.NOT_ALLOWED]);
    expect(d.interpreter.calls).toHaveLength(0);
  });

  it("в режиме настройки сообщает id", async () => {
    const d = makeDeps([]);
    await handleUpdate(messageUpdate(12345, DREAM), d);
    expect(d.telegram.texts[0]).toContain("Ваш Telegram id: 12345");
  });

  it("чужой не может удалить дневник", async () => {
    const d = makeDeps();
    await d.storage.add(OWNER_ID, "сон", "т");
    await handleUpdate(callbackUpdate(STRANGER_ID, "forget:yes"), d);
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(1);
  });

  it("в открытом режиме отвечает любому", async () => {
    const d = makeDeps([], { isPublic: true });
    await handleUpdate(messageUpdate(STRANGER_ID, DREAM), d);
    expect(d.telegram.texts).toEqual(["Толкование сна."]);
  });

  it("дневной лимит для обычных пользователей", async () => {
    const d = makeDeps([OWNER_ID], { isPublic: true, dailyLimit: 2 });
    for (let i = 0; i < 3; i++) await handleUpdate(messageUpdate(STRANGER_ID, DREAM), d);
    expect(d.interpreter.calls).toHaveLength(2);
    expect(d.telegram.texts.at(-1)).toBe(texts.dailyLimit(2));
  });

  it("у владельца лимита нет", async () => {
    const d = makeDeps([OWNER_ID], { isPublic: true, dailyLimit: 1 });
    for (let i = 0; i < 3; i++) await handleUpdate(messageUpdate(OWNER_ID, DREAM), d);
    expect(d.interpreter.calls).toHaveLength(3);
  });

  it("молчит в группах", async () => {
    const d = makeDeps([], { isPublic: true });
    const u = messageUpdate(STRANGER_ID, DREAM);
    u.message.chat = { id: -100, type: "group" };
    await handleUpdate(u, d);
    expect(d.telegram.calls).toHaveLength(0);
  });

  it("разбирает режим доступа", () => {
    expect(parseAccess("*").isPublic).toBe(true);
    expect([...parseAccess("*, 44").ids]).toEqual([44]);
    expect(parseAccess("44").isPublic).toBe(false);
  });

  it("разбирает список id", () => {
    expect([...parseUserIds(" 1, 22 ;333, abc")]).toEqual([1, 22, 333]);
    expect(parseUserIds("").size).toBe(0);
    expect(parseUserIds(undefined).size).toBe(0);
  });
});

describe("команды", () => {
  it("/start показывает приветствие и выбор сонников, /help — справку", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "/start"), d);
    await handleUpdate(messageUpdate(OWNER_ID, "/help"), d);
    expect(d.telegram.texts).toEqual([texts.START, texts.chooseBooks(3), texts.HELP]);
    expect(texts.HELP).toContain("не медицинский совет");
    expect(texts.HELP).toContain("/sonnik");
    expect(texts.HELP).toContain("/psy");
  });

  it("/history пустой", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "/history"), d);
    expect(d.telegram.texts).toEqual([texts.HISTORY_EMPTY]);
  });

  it("/history показывает последние 5 только своих", async () => {
    const d = makeDeps();
    for (let i = 0; i < 7; i++) await d.storage.add(OWNER_ID, `сон ${i}`, `толкование ${i}`);
    await d.storage.add(STRANGER_ID, "чужой сон", "чужое");
    await handleUpdate(messageUpdate(OWNER_ID, "/history"), d);
    const [header, ...body] = d.telegram.texts;
    expect(header).toBe(texts.historyHeader(5));
    expect(body).toHaveLength(5);
    expect(body[0]).toContain("<i>сон 2</i>");
    expect(body[4]).toContain("сон 6");
    expect(body.some((t) => t.includes("чужой"))).toBe(false);
  });

  it("/forget с подтверждением", async () => {
    const d = makeDeps();
    await d.storage.add(OWNER_ID, "сон", "т");
    await handleUpdate(messageUpdate(OWNER_ID, "/forget"), d);
    expect(d.telegram.texts).toEqual([texts.FORGET_CONFIRM]);
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(1);

    await handleUpdate(callbackUpdate(OWNER_ID, "forget:no"), d);
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(1);

    await handleUpdate(callbackUpdate(OWNER_ID, "forget:yes"), d);
    expect(d.telegram.texts.at(-1)).toBe(texts.forgetDone(1));
    expect(await d.storage.latest(OWNER_ID)).toHaveLength(0);
  });
});
