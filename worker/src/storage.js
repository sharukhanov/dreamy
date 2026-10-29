// Дневник снов в Cloudflare D1 (SQLite).

// Разрешённые настройки и их колонки (имя колонки подставляется в SQL, поэтому только из этого списка).
const SETTINGS = { dream_books: "dream_books", psychology: "psychology" };

export class D1Storage {
  constructor(db) {
    this.db = db;
  }

  async markUpdate(updateId) {
    // true — апдейт новый; false — Telegram прислал его повторно.
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?, ?)")
      .bind(updateId, new Date().toISOString())
      .run();
    await this.db.prepare("DELETE FROM processed_updates WHERE update_id < ?").bind(updateId - 1000).run();
    return res.meta.changes > 0;
  }

  async add(userId, dreamText, interpretation) {
    await this.db
      .prepare("INSERT INTO dreams (created_at, user_id, dream_text, interpretation) VALUES (?, ?, ?, ?)")
      .bind(new Date().toISOString(), userId, dreamText, interpretation)
      .run();
  }

  async latest(userId, limit = 5) {
    const { results } = await this.db
      .prepare(
        "SELECT id, created_at, dream_text, interpretation FROM dreams WHERE user_id = ? ORDER BY id DESC LIMIT ?",
      )
      .bind(userId, limit)
      .all();
    return results;
  }

  async countSince(userId, sinceIso) {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM dreams WHERE user_id = ? AND created_at >= ?")
      .bind(userId, sinceIso)
      .first();
    return row?.n ?? 0;
  }

  // setting: "dream_books" или "psychology" — список выбранных имён (пусто — случайные).
  async getChoice(userId, setting) {
    const column = SETTINGS[setting];
    const row = await this.db.prepare(`SELECT ${column} AS v FROM user_settings WHERE user_id = ?`).bind(userId).first();
    try {
      return row?.v ? JSON.parse(row.v) : [];
    } catch {
      return [];
    }
  }

  async setChoice(userId, setting, names) {
    const column = SETTINGS[setting];
    await this.db
      .prepare(
        `INSERT INTO user_settings (user_id, ${column}, updated_at) VALUES (?, ?, ?) ` +
          `ON CONFLICT(user_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
      )
      .bind(userId, JSON.stringify(names), new Date().toISOString())
      .run();
  }

  async getMode(userId) {
    const row = await this.db.prepare("SELECT mode FROM user_settings WHERE user_id = ?").bind(userId).first();
    return row?.mode || "both";
  }

  async setMode(userId, mode) {
    await this.db
      .prepare(
        "INSERT INTO user_settings (user_id, mode, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at",
      )
      .bind(userId, mode, new Date().toISOString())
      .run();
  }

  // Событие для статистики: только тип (start, dream_ok, model_fail, limit_hit, crisis, …), без текста.
  async logEvent(userId, type) {
    try {
      await this.db
        .prepare("INSERT INTO events (created_at, user_id, type) VALUES (?, ?, ?)")
        .bind(new Date().toISOString(), userId, type)
        .run();
    } catch (err) {
      console.warn(`Не удалось записать событие ${type}: ${err?.message}`);
    }
  }

  // Данные для /stats: события за последние 60 дней и дата первого появления каждого человека.
  // excludeIds — кого не считать (владелец).
  async statsData(excludeIds = []) {
    const ex = excludeIds.length ? `AND user_id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const events = await this.db
      .prepare(`SELECT user_id, type, created_at FROM events WHERE created_at >= ? ${ex} ORDER BY id LIMIT 50000`)
      .bind(since, ...excludeIds)
      .all();
    const first = await this.db
      .prepare(`SELECT user_id, MIN(created_at) AS first FROM events WHERE 1 = 1 ${ex} GROUP BY user_id`)
      .bind(...excludeIds)
      .all();
    return {
      events: events.results || [],
      firstSeen: new Map((first.results || []).map((r) => [r.user_id, r.first])),
    };
  }

  // Сколько запросов к Gemini сделал бот (по моделям) с момента sinceIso — всех людей, включая владельца.
  async aiUsage(sinceIso) {
    const { results } = await this.db
      .prepare(
        "SELECT type, COUNT(*) AS n FROM events WHERE (type LIKE 'ai:%' OR type LIKE 'ai_fail:%') AND created_at >= ? GROUP BY type",
      )
      .bind(sinceIso)
      .all();
    const usage = {};
    for (const r of results || []) {
      const model = r.type.slice(r.type.indexOf(":") + 1);
      usage[model] = (usage[model] || 0) + r.n;
    }
    return usage;
  }

  async deleteAll(userId) {
    const res = await this.db.prepare("DELETE FROM dreams WHERE user_id = ?").bind(userId).run();
    return res.meta.changes;
  }
}
