import { describe, expect, it } from "vitest";
import { computeMetrics, formatDashboard, geminiDayStart, tzOffset } from "../src/stats.js";

// «Сейчас» — 29 октября 2026, 15:00 по Москве.
const NOW = new Date("2026-10-29T12:00:00Z");
const at = (daysAgo, hourMsk = 15) => {
  const d = new Date(Date.UTC(2026, 9, 29 - daysAgo, hourMsk - 3, 0, 0));
  return d.toISOString();
};
const ev = (user, type, daysAgo, hour) => ({ user_id: user, type, created_at: at(daysAgo, hour) });

function build(events) {
  const firstSeen = new Map();
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!firstSeen.has(e.user_id)) firstSeen.set(e.user_id, e.created_at);
  }
  return computeMetrics(events, firstSeen, NOW, "Europe/Moscow");
}

describe("продуктовая статистика", () => {
  it("Москва — UTC+3", () => {
    expect(tzOffset(NOW, "Europe/Moscow")).toBe(3 * 60 * 60 * 1000);
  });

  it("сегодня: новые и вернувшиеся, сравнение со вчера", () => {
    const m = build([
      ev(1, "start", 3), ev(1, "dream_ok", 3), ev(1, "dream_ok", 0), // старый, вернулся сегодня
      ev(2, "start", 0), ev(2, "dream_ok", 0), ev(2, "dream_ok", 0), // новый сегодня
      ev(3, "start", 1), // был только вчера
    ]);
    expect(m.today).toMatchObject({ users: 2, yesterday: 1, new: 1, returning: 1, dreams: 3 });
    expect(m.totalUsers).toBe(3);
  });

  it("сутки считаются по Москве: 01:00 МСК — уже сегодня", () => {
    const m = build([{ user_id: 1, type: "dream_ok", created_at: "2026-10-28T22:00:00Z" }]);
    expect(m.today.users).toBe(1);
  });

  it("удержание D1, в течение недели и отток", () => {
    const m = build([
      ev(1, "start", 10), ev(1, "dream_ok", 9), // вернулся на следующий день
      ev(2, "start", 10), // не вернулся
      ev(3, "start", 9), ev(3, "dream_ok", 5), // вернулся в течение недели, но не на следующий день
      ev(4, "start", 8), ev(4, "dream_ok", 2), // активен и на прошлой, и на этой неделе
    ]);
    expect(m.retention.d1).toBe(25); // 1 из 4
    expect(m.retention.w1).toBe(75); // 1, 3 и 4 (вернулся на 6-й день) из 4
    // На прошлой неделе (7–13 дней назад) были 1, 2, 3, 4; на этой — 3 и 4. Не вернулись 1 и 2.
    expect(m.retention.churn).toBe(50);
  });

  it("сессии, пиковые часы и воронка новичков", () => {
    const m = build([
      { user_id: 1, type: "start", created_at: at(1, 22) },
      { user_id: 1, type: "dream_ok", created_at: "2026-10-28T19:04:00Z" }, // 22:04 МСК, та же сессия
      { user_id: 1, type: "dream_ok", created_at: "2026-10-28T19:10:00Z" }, // 22:10
      ev(2, "start", 0, 9), // пришёл и ничего не прислал
    ]);
    expect(m.usage.sessionMinutes).toBeCloseTo((10 + 1) / 2, 1);
    expect(m.usage.peak.from).toBe(20);
    expect(m.funnel).toEqual({ newcomers: 2, started: 2, dreamed: 1 });
  });

  it("источники по меткам", () => {
    const m = build([ev(1, "start", 0), ev(1, "src:mamchat", 0), ev(1, "dream_ok", 0), ev(2, "start", 0), ev(2, "src:mamchat", 0)]);
    expect(m.sources).toEqual([{ name: "mamchat", users: 2, dreamed: 1 }]);
  });

  it("отчёт читается и не ломается без данных", () => {
    const empty = formatDashboard(build([]));
    expect(empty).toContain("DAU: 0");
    expect(empty).toContain("мало данных");
    expect(empty).not.toContain("Gemini");
    const r = formatDashboard(build([ev(1, "start", 1), ev(1, "dream_ok", 0), ev(2, "start", 0), ev(2, "dream_ok", 0), ev(2, "voice_ok", 0)]));
    expect(r).toContain("DAU: 2 (вчера 1, ↑100%)");
    expect(r).toContain("New: 1 · Returning: 1");
    expect(r).toContain("(голосом 1)");
    expect(r).toContain("Retention");
    expect(r).not.toContain("Липкость");
  });

  it("Core users — сны в 2+ разных дня за неделю; MAU", () => {
    const m = build([
      ev(1, "dream_ok", 0), ev(1, "dream_ok", 3), // core
      ev(2, "dream_ok", 0), ev(2, "dream_ok", 0), // два сна, но в один день — не core
      ev(3, "dream_ok", 20), // только в MAU
    ]);
    expect(m.week.core).toBe(1);
    expect(m.month.users).toBe(3);
  });

  it("сутки Gemini начинаются в полночь по Калифорнии, остаток считается по обеим моделям", () => {
    expect(geminiDayStart(NOW).toISOString()).toBe("2026-10-29T07:00:00.000Z");
    const r = formatDashboard(build([]), {
      models: ["lite-a", "lite-b"],
      dailyLimit: 500,
      used: { "lite-a": 120, "lite-b": 3 },
      resetAt: new Date("2026-10-30T07:00:00Z"),
    });
    expect(r).toContain("лимит обновится в 10:00 МСК");
    expect(r).toContain("Основная lite-a: 120 / 500");
    expect(r).toContain("Запасная lite-b: 3 / 500");
    expect(r).toContain("Осталось ≈ 877 запросов");
  });
});
