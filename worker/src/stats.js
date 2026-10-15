// Статистика использования для владельца бота (/stats). Только счётчики, без текстов снов.

const DAY_MS = 24 * 60 * 60 * 1000;

// Начало сегодняшнего дня в часовом поясе бота, а также 7 и 30 дней назад — в ISO (UTC).
export function periodStarts(now = new Date(), timeZone = "Europe/Moscow") {
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const offset = local.getTime() - now.getTime();
  const localMidnight = new Date(local);
  localMidnight.setHours(0, 0, 0, 0);
  const today = new Date(localMidnight.getTime() - offset);
  return {
    today: today.toISOString(),
    week: new Date(today.getTime() - 6 * DAY_MS).toISOString(),
    month: new Date(today.getTime() - 29 * DAY_MS).toISOString(),
  };
}

// Сколько людей выбрали каждую традицию, и сколько оставили «случайные».
export function countChoices(rows, column, all) {
  const counts = new Map(all.map((x) => [x.name, 0]));
  let random = 0;
  for (const row of rows) {
    let names = [];
    try {
      names = JSON.parse(row[column] || "[]");
    } catch {
      names = [];
    }
    if (!names.length) random++;
    for (const n of names) if (counts.has(n)) counts.set(n, counts.get(n) + 1);
  }
  const top = all
    .map((x) => ({ label: x.button || x.label || x.name, n: counts.get(x.name) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return { top, random };
}

function choiceLines(title, { top, random }) {
  const lines = top.map((x) => `• ${x.label} — ${x.n}`);
  if (random) lines.push(`• 🎲 случайные — ${random}`);
  return `${title}\n${lines.length ? lines.join("\n") : "• пока никто не выбирал"}`;
}

export function formatStats(s, choices) {
  const perUser = s.activeWeek ? (s.dreamsWeek / s.activeWeek).toFixed(1) : "0";
  return [
    "📊 Статистика бота (без учёта вас)",
    "",
    "👥 Люди",
    `• всего: ${s.usersTotal}`,
    `• новых: сегодня ${s.newToday}, за 7 дней ${s.newWeek}`,
    `• прислали сон: сегодня ${s.activeToday}, за 7 дней ${s.activeWeek}, за 30 дней ${s.activeMonth}`,
    `• возвращались в разные дни: ${s.returning}`,
    "",
    "🌙 Сны",
    `• сегодня ${s.dreamsToday}, за 7 дней ${s.dreamsWeek}, всего ${s.dreamsTotal}`,
    `• в среднем ${perUser} сна на человека за неделю`,
    "",
    "⚠️ Проблемы",
    `• модель недоступна: сегодня ${s.failsToday}, за 7 дней ${s.failsWeek}`,
    `• упёрлись в дневной лимит сегодня: ${s.limitToday}`,
    `• бережных ответов (признаки кризиса) за 7 дней: ${s.crisisWeek}`,
    "",
    choiceLines("📖 Выбор сонников", countChoices(s.choices, "dream_books", choices.bk.all)),
    "",
    choiceLines("🧠 Выбор психологии", countChoices(s.choices, "psychology", choices.ps.all)),
  ].join("\n");
}
