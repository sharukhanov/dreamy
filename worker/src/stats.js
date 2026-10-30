// Продуктовая статистика для владельца (/stats): новые и вернувшиеся, удержание, отток,
// частота и длительность использования. Считается по событиям без текстов снов.

const DAY = 24 * 60 * 60 * 1000;
const SESSION_GAP = 30 * 60 * 1000; // пауза больше 30 минут — новая сессия
// Что считаем «использованием» (а не служебными событиями вроде метки источника).
const ACTIVE_TYPES = new Set(["start", "dream_ok", "voice_ok", "history", "model_fail", "limit_hit", "crisis", "too_long", "non_text", "voice_fail", "forget"]);

// Смещение часового пояса относительно UTC (мс) на момент now.
export function tzOffset(now = new Date(), timeZone = "Europe/Moscow") {
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return local.getTime() - utc.getTime();
}

// Номер дня в часовом поясе бота (целое число дней с 1970 года).
const dayIndex = (ms, offset) => Math.floor((ms + offset) / DAY);

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

// events: [{ user_id, type, created_at }] за последние ~60 дней (без владельца);
// firstSeen: Map user_id → ISO первого события за всё время.
export function computeMetrics(events, firstSeen, now = new Date(), timeZone = "Europe/Moscow") {
  const offset = tzOffset(now, timeZone);
  const today = dayIndex(now.getTime(), offset);
  const parsed = events
    .map((e) => ({ user: e.user_id, type: e.type, t: Date.parse(e.created_at) }))
    .filter((e) => !Number.isNaN(e.t))
    .sort((a, b) => a.t - b.t);
  const active = parsed.filter((e) => ACTIVE_TYPES.has(e.type));
  const firstDay = new Map([...firstSeen].map(([u, iso]) => [u, dayIndex(Date.parse(iso), offset)]));

  // Активные дни каждого человека.
  const daysByUser = new Map();
  for (const e of active) {
    const d = dayIndex(e.t, offset);
    if (!daysByUser.has(e.user)) daysByUser.set(e.user, new Set());
    daysByUser.get(e.user).add(d);
  }
  const activeIn = (from, to) => {
    const users = new Set();
    for (const [u, days] of daysByUser) for (const d of days) if (d >= from && d <= to) { users.add(u); break; }
    return users;
  };
  const dreamsIn = (from, to) =>
    parsed.filter((e) => e.type === "dream_ok" && dayIndex(e.t, offset) >= from && dayIndex(e.t, offset) <= to).length;

  // Сегодня и вчера.
  const todayUsers = activeIn(today, today);
  const yesterdayUsers = activeIn(today - 1, today - 1);
  const newToday = [...todayUsers].filter((u) => firstDay.get(u) === today).length;

  // Неделя (последние 7 дней, включая сегодня) и предыдущая неделя.
  const weekUsers = activeIn(today - 6, today);
  const prevWeekUsers = activeIn(today - 13, today - 7);
  const newWeek = [...weekUsers].filter((u) => firstDay.get(u) >= today - 6).length;
  const avgDau = [0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + activeIn(today - i, today - i).size, 0) / 7;
  const monthUsers = activeIn(today - 29, today);
  // Core users — регулярные: присылали сны в 2+ разных дня за последние 7 дней.
  const dreamDays = new Map();
  for (const e of parsed) {
    if (e.type !== "dream_ok") continue;
    const d = dayIndex(e.t, offset);
    if (d < today - 6) continue;
    if (!dreamDays.has(e.user)) dreamDays.set(e.user, new Set());
    dreamDays.get(e.user).add(d);
  }
  const coreUsers = [...dreamDays.values()].filter((days) => days.size >= 2).length;
  const daysPerUser = weekUsers.size
    ? [...weekUsers].reduce((s, u) => s + [...daysByUser.get(u)].filter((d) => d >= today - 6).length, 0) / weekUsers.size
    : 0;

  // Удержание: вернулись на следующий день (D1) и в течение недели после первого дня.
  const cohort = (fromAgo, toAgo) =>
    [...firstDay].filter(([, d]) => d >= today - fromAgo && d <= today - toAgo).map(([u]) => u);
  const d1Cohort = cohort(14, 1);
  const d1Back = d1Cohort.filter((u) => daysByUser.get(u)?.has(firstDay.get(u) + 1)).length;
  const w1Cohort = cohort(28, 7);
  const w1Back = w1Cohort.filter((u) =>
    [...(daysByUser.get(u) || [])].some((d) => d > firstDay.get(u) && d <= firstDay.get(u) + 7),
  ).length;
  const churned = [...prevWeekUsers].filter((u) => !weekUsers.has(u)).length;

  // Сессии за неделю: длительность и сколько снов за сессию.
  const sessions = [];
  const lastByUser = new Map();
  for (const e of active.filter((x) => dayIndex(x.t, offset) >= today - 6)) {
    const s = lastByUser.get(e.user);
    if (s && e.t - s.end <= SESSION_GAP) {
      s.end = e.t;
      if (e.type === "dream_ok") s.dreams++;
    } else {
      const fresh = { start: e.t, end: e.t, dreams: e.type === "dream_ok" ? 1 : 0 };
      sessions.push(fresh);
      lastByUser.set(e.user, fresh);
    }
  }
  // Сессия из одного сна длится примерно минуту: столько человек пишет и ждёт ответ.
  const sessionMinutes = sessions.length
    ? sessions.reduce((s, x) => s + Math.max(1, (x.end - x.start) / 60000), 0) / sessions.length
    : 0;
  const dreamsPerSession = sessions.length ? sessions.reduce((s, x) => s + x.dreams, 0) / sessions.length : 0;

  // Самые активные часы (окно в 3 часа) по снам за 30 дней.
  const hours = new Array(24).fill(0);
  for (const e of parsed) {
    if (e.type === "dream_ok" && dayIndex(e.t, offset) >= today - 29) {
      hours[new Date(e.t + offset).getUTCHours()]++;
    }
  }
  let peak = null;
  for (let h = 0; h < 24; h++) {
    const n = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24];
    if (n > 0 && (!peak || n > peak.n)) peak = { from: h, to: (h + 3) % 24, n };
  }

  // Воронка новичков за неделю: нажали «Старт» → прислали хотя бы один сон.
  const newcomers = [...firstDay].filter(([, d]) => d >= today - 6).map(([u]) => u);
  const startedNew = newcomers.filter((u) => active.some((e) => e.user === u && e.type === "start")).length;
  const dreamedNew = newcomers.filter((u) => parsed.some((e) => e.user === u && e.type === "dream_ok")).length;

  // Источники за 30 дней: сколько пришло по метке и сколько из них прислали сон.
  const sources = new Map();
  for (const e of parsed) {
    if (!e.type.startsWith("src:") || dayIndex(e.t, offset) < today - 29) continue;
    const name = e.type.slice(4);
    if (!sources.has(name)) sources.set(name, new Set());
    sources.get(name).add(e.user);
  }
  const dreamers = new Set(parsed.filter((e) => e.type === "dream_ok").map((e) => e.user));

  return {
    today: {
      users: todayUsers.size,
      yesterday: yesterdayUsers.size,
      new: newToday,
      returning: todayUsers.size - newToday,
      dreams: dreamsIn(today, today),
      voices: parsed.filter((e) => e.type === "voice_ok" && dayIndex(e.t, offset) === today).length,
      fails: parsed.filter((e) => e.type === "model_fail" && dayIndex(e.t, offset) === today).length,
    },
    week: {
      users: weekUsers.size,
      new: newWeek,
      dreams: dreamsIn(today - 6, today),
      daysPerUser,
      core: coreUsers,
      avgDau,
    },
    month: { users: monthUsers.size },
    retention: {
      d1: pct(d1Back, d1Cohort.length),
      d1Cohort: d1Cohort.length,
      w1: pct(w1Back, w1Cohort.length),
      w1Cohort: w1Cohort.length,
      churn: pct(churned, prevWeekUsers.size),
      prevWeek: prevWeekUsers.size,
    },
    usage: { sessionMinutes, dreamsPerSession, peak },
    funnel: { newcomers: newcomers.length, started: startedNew, dreamed: dreamedNew },
    sources: [...sources]
      .map(([name, users]) => ({ name, users: users.size, dreamed: [...users].filter((u) => dreamers.has(u)).length }))
      .sort((a, b) => b.users - a.users)
      .slice(0, 5),
    totalUsers: firstDay.size,
  };
}

const trend = (now, before) => {
  if (!before) return "";
  const change = Math.round(((now - before) / before) * 100);
  return change === 0 ? " (как вчера)" : ` (вчера ${before}, ${change > 0 ? "↑" : "↓"}${Math.abs(change)}%)`;
};
const rate = (value, cohort) => (value === null ? "мало данных" : `${value}% (когорта ${cohort} чел.)`);
const fixed = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// Начало «суток» Gemini: лимиты сбрасываются в полночь по тихоокеанскому времени.
export function geminiDayStart(now = new Date()) {
  const offset = tzOffset(now, "America/Los_Angeles");
  const start = Math.floor((now.getTime() + offset) / DAY) * DAY - offset;
  return new Date(start);
}

// ai: { models: ["…"], dailyLimit, used: { model: n }, resetAt: Date }
function aiLines(ai, timeZone) {
  if (!ai?.models?.length) return [];
  const reset = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(ai.resetAt);
  const lines = ["", `🤖 Gemini сегодня (лимит обновится в ${reset} МСК)`];
  let left = 0;
  ai.models.forEach((model, i) => {
    const used = ai.used[model] || 0;
    left += Math.max(0, ai.dailyLimit - used);
    lines.push(`• ${i === 0 ? "Основная" : "Запасная"} ${model}: ${used} / ${ai.dailyLimit}`);
  });
  // Голосовые расшифровывает Whisper, поэтому любой сон — это один запрос к Gemini.
  lines.push(`• Осталось ≈ ${left} запросов — это ~${left} снов (текстом или голосом)`);
  return lines;
}

export function formatDashboard(m, ai = null, timeZone = "Europe/Moscow") {
  const lines = [
    "📊 Dreamy · дашборд (без учёта вас)",
    "",
    "☀️ Сегодня",
    `• DAU: ${m.today.users}${trend(m.today.users, m.today.yesterday)}`,
    `• New: ${m.today.new} · Returning: ${m.today.returning}`,
    `• Снов: ${m.today.dreams}${m.today.voices ? ` (голосом ${m.today.voices})` : ""}`,
    "",
    "👥 Аудитория",
    `• WAU (за 7 дней): ${m.week.users}, из них новых ${m.week.new}`,
    `• MAU (за 30 дней): ${m.month.users}`,
    `• Core users: ${m.week.core} — присылали сны в 2+ разных дня за неделю`,
    "",
    "🔁 Retention",
    `• D1 — вернулись на следующий день: ${rate(m.retention.d1, m.retention.d1Cohort)}`,
    `• D7 — вернулись в течение недели: ${rate(m.retention.w1, m.retention.w1Cohort)}`,
    `• Churn — не вернулись с прошлой недели: ${m.retention.churn === null ? "мало данных" : `${m.retention.churn}% (из ${m.retention.prevWeek} чел.)`}`,
    "",
    "⏱ Engagement (за 7 дней)",
    `• Снов: ${m.week.dreams}, в среднем ${m.week.users ? fixed(m.week.dreams / m.week.users) : 0} на человека`,
    `• Заходят ${fixed(m.week.daysPerUser)} дн. из 7`,
    `• Сессия ~${Math.round(m.usage.sessionMinutes) || 1} мин, ${fixed(m.usage.dreamsPerSession)} сна за раз`,
    `• Пик активности: ${m.usage.peak ? `${m.usage.peak.from}:00–${m.usage.peak.to}:00` : "пока мало данных"}`,
    "",
    "🎯 Activation (новички за 7 дней)",
    `• ${m.funnel.newcomers} пришли → ${m.funnel.dreamed} прислали первый сон` +
      (m.funnel.newcomers ? ` (${pct(m.funnel.dreamed, m.funnel.newcomers)}%)` : ""),
  ];
  if (m.sources.length) {
    lines.push("", "📣 Источники (30 дней)");
    for (const s of m.sources) lines.push(`• ${s.name}: ${s.users} чел. → сон прислали ${s.dreamed}`);
  }
  lines.push(...aiLines(ai, timeZone));
  if (m.today.fails) lines.push(`• ⚠️ Сбои модели сегодня: ${m.today.fails}`);
  lines.push("", `Всего пользователей за всё время: ${m.totalUsers}`);
  return lines.join("\n");
}
