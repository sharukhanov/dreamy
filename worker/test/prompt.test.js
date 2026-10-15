import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, createPromptBuilder, parseTraditions, pickRandom } from "../src/prompt.js";
import { looksLikeCrisis } from "../src/safety.js";

const root = new URL("../../", import.meta.url);
const template = readFileSync(new URL("prompts/interpreter.md", root), "utf8");
const yaml = readFileSync(new URL("config/traditions.yaml", root), "utf8");

describe("промт", () => {
  it("в конфиге есть все сонники и подходы", () => {
    const t = parseTraditions(yaml);
    const names = [...t.dream_books, ...t.psychology].map((x) => x.name);
    for (const name of ["Миллер", "Цветков", "Ванга", "Лофф", "Нострадамус", "Фрейд", "Юнг", "Холл", "Перлз", "Адлер"]) {
      expect(names).toContain(name);
    }
    expect(t.pick).toEqual({ dream_books: 3, psychology: 3 });
  });

  it("в промт попадают 3 сонника и 3 подхода", () => {
    const p = buildSystemPrompt(template, yaml);
    expect(p).not.toContain("{{");
    const section = (title) => p.split(title)[1].split("\n\n")[0];
    expect(section("Сонники:\n").split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
    expect(section("Психологические подходы:\n").split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
    expect(p).toContain("уточняющий вопрос");
    expect(p).toContain("никаких вопросов к человеку в конце");
  });

  it("набор традиций меняется от сна к сну", () => {
    const build = createPromptBuilder(template, yaml);
    const variants = new Set(Array.from({ length: 30 }, () => build()));
    expect(variants.size).toBeGreaterThan(5);
  });

  it("pickRandom не выходит за границы", () => {
    expect(pickRandom([1, 2], 5)).toHaveLength(2);
    expect(new Set(pickRandom([1, 2, 3, 4, 5], 3)).size).toBe(3);
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
