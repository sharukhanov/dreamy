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
  it("/start и /help", async () => {
    const d = makeDeps();
    await handleUpdate(messageUpdate(OWNER_ID, "/start"), d);
    await handleUpdate(messageUpdate(OWNER_ID, "/help"), d);
    expect(d.telegram.texts).toEqual([texts.START, texts.HELP]);
    expect(texts.HELP).toContain("не медицинский совет");
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
