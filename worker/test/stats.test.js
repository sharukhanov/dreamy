import { describe, expect, it } from "vitest";
import { countChoices, formatStats, periodStarts } from "../src/stats.js";

describe("статистика", () => {
  it("начало дня считается по Москве", () => {
    const p = periodStarts(new Date("2026-10-15T22:30:00Z"), "Europe/Moscow");
    expect(p.today).toBe("2026-10-15T21:00:00.000Z");
    expect(p.week).toBe("2026-10-09T21:00:00.000Z");
    expect(p.month).toBe("2026-09-16T21:00:00.000Z");
  });

  it("считает выбор сонников и «случайные»", () => {
    const all = [{ name: "Миллер" }, { name: "Лофф" }, { name: "Ванга" }];
    const rows = [
      { dream_books: '["Миллер","Лофф"]' },
      { dream_books: '["Миллер"]' },
      { dream_books: "[]" },
      { dream_books: "битый json" },
    ];
    expect(countChoices(rows, "dream_books", all)).toEqual({
      top: [
        { label: "Миллер", n: 2 },
        { label: "Лофф", n: 1 },
      ],
      random: 2,
    });
  });

  it("формирует отчёт", () => {
    const s = {
      usersTotal: 5, newToday: 1, newWeek: 3, activeToday: 2, activeWeek: 4, activeMonth: 5, returning: 2,
      dreamsToday: 3, dreamsWeek: 10, dreamsTotal: 20, failsToday: 0, failsWeek: 1, limitToday: 0, crisisWeek: 0,
      choices: [{ dream_books: '["Миллер"]', psychology: "[]", mode: "books" }],
    };
    const choices = { bk: { all: [{ name: "Миллер" }] }, ps: { all: [{ name: "Юнг" }] } };
    const r = formatStats(s, choices);
    expect(r).toContain("• всего: 5");
    expect(r).toContain("в среднем 2.5 сна на человека");
    expect(r).toContain("• Миллер — 1");
    expect(r).toContain("• 🎲 случайные — 1");
    expect(r).toContain("• 📖 только сонники — 1");
  });
});
