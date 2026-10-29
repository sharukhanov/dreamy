import { describe, expect, it } from "vitest";
import { GeminiInterpreter, InterpreterError } from "../src/gemini.js";

const ok = (text) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

function make(responses, fallbackModel) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const it = new GeminiInterpreter({
    apiKey: "KEY",
    model: "main",
    fallbackModel,
    systemPrompt: "SYS",
    fetchFn,
    retryDelayMs: 0,
  });
  return { it, calls };
}

describe("Gemini", () => {
  it("передаёт промт, модель и ключ", async () => {
    const { it: g, calls } = make([ok("  ответ ")]);
    expect(await g.interpret("сон")).toBe("ответ");
    expect(calls[0].url).toContain("/main:generateContent");
    expect(calls[0].headers["x-goog-api-key"]).toBe("KEY");
    expect(calls[0].body.systemInstruction.parts[0].text).toBe("SYS");
    expect(calls[0].body.contents[0].parts[0].text).toBe("сон");
  });

  it("повторяет один раз на запасной модели", async () => {
    const { it: g, calls } = make([fail(503), ok("ок")], "spare");
    expect(await g.interpret("сон")).toBe("ок");
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["main:generateContent", "spare:generateContent"]);
  });

  it("после двух неудач бросает InterpreterError", async () => {
    const { it: g, calls } = make([fail(503), new Error("net"), ok("x")]);
    await expect(g.interpret("сон")).rejects.toBeInstanceOf(InterpreterError);
    expect(calls).toHaveLength(2);
  });

  it("пустой ответ считается ошибкой", async () => {
    const { it: g } = make([ok(""), ok("  ")]);
    await expect(g.interpret("сон")).rejects.toBeInstanceOf(InterpreterError);
  });

  it("принимает промт-функцию и вызывает её на каждый сон", async () => {
    let n = 0;
    const calls = [];
    const g = new GeminiInterpreter({
      apiKey: "K",
      model: "m",
      systemPrompt: () => `SYS${++n}`,
      fetchFn: async (url, init) => {
        calls.push(JSON.parse(init.body).systemInstruction.parts[0].text);
        return ok("x");
      },
      retryDelayMs: 0,
    });
    await g.interpret("a");
    await g.interpret("b");
    expect(calls).toEqual(["SYS1", "SYS2"]);
  });

  it("расшифровка отправляет аудио и свой промт", async () => {
    const { it: g, calls } = make([ok(" Снилось море. ")]);
    expect(await g.transcribe("QUJD", "audio/ogg")).toBe("Снилось море.");
    expect(calls[0].body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "audio/ogg", data: "QUJD" } });
    expect(calls[0].body.systemInstruction.parts[0].text).toContain("дословно");
    expect(calls[0].body.generationConfig.temperature).toBe(0);
  });

  it("сообщает о каждом запросе к Gemini — и удачном, и неудачном", async () => {
    const seen = [];
    const responses = [fail(503), ok("ок")];
    const g = new GeminiInterpreter({
      apiKey: "K",
      model: "main",
      fallbackModel: "spare",
      systemPrompt: "S",
      retryDelayMs: 0,
      fetchFn: async () => responses.shift(),
      onCall: (x) => seen.push(x),
    });
    await g.interpret("сон");
    expect(seen).toEqual([
      { model: "main", ok: false },
      { model: "spare", ok: true },
    ]);
  });

  it("пропускает «мысли» модели", async () => {
    const resp = {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "думаю", thought: true }, { text: "ответ" }] } }] }),
    };
    const { it: g } = make([resp]);
    expect(await g.interpret("сон")).toBe("ответ");
  });
});
