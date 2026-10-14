import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, parseTraditions } from "../src/prompt.js";
import { looksLikeCrisis } from "../src/safety.js";

const root = new URL("../../", import.meta.url);
const template = readFileSync(new URL("prompts/interpreter.md", root), "utf8");
const yaml = readFileSync(new URL("config/traditions.yaml", root), "utf8");

describe("промт", () => {
  it("содержит все традиции и правила", () => {
    const p = buildSystemPrompt(template, yaml);
    expect(p).not.toContain("{{");
    for (const name of ["Миллер", "Цветков", "в традиции Ванги", "Фрейд", "Юнг", "Холл"]) {
      expect(p).toContain(name);
    }
    expect(p).toContain("уточняющий вопрос");
  });

  it("отклоняет пустой раздел", () => {
    expect(() => parseTraditions("dream_books: []\npsychology:\n  - name: Юнг\n")).toThrow();
  });
});

describe("кризис", () => {
  it.each(["Я больше не хочу жить", "думаю о самоубийстве", "иногда режу себя", "I want to kill myself"])(
    "распознаёт: %s",
    (t) => expect(looksLikeCrisis(t)).toBe(true),
  );
  it.each(["Мне снилось, что я умер", "Снилось, что выпали зубы", "Во сне я падала с крыши"])(
    "не трогает обычный сон: %s",
    (t) => expect(looksLikeCrisis(t)).toBe(false),
  );
});
