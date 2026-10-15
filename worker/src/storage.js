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

  // since: { today, week, month } — ISO-время начала периодов; excludeIds — кого не считать (владелец).
  async stats(since, excludeIds = []) {
    const ex = excludeIds.length ? `AND user_id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
    const one = async (sql, ...params) => {
      const row = await this.db.prepare(sql).bind(...params, ...excludeIds).first();
      return row?.n ?? 0;
    };
    const count = (type, from) =>
      one(`SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ? ${ex}`, type, from);
    const active = (from) =>
      one(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE type = 'dream_ok' AND created_at >= ? ${ex}`, from);
    // Новые люди — у кого первое событие позже начала периода (здесь исключения идут раньше даты).
    const firstSeen = async (from) => {
      const row = await this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM (SELECT MIN(created_at) AS m FROM events WHERE 1 = 1 ${ex} GROUP BY user_id) ` +
            "WHERE m >= ?",
        )
        .bind(...excludeIds, from)
        .first();
      return row?.n ?? 0;
    };
    const settings = await this.db
      .prepare(`SELECT dream_books, psychology, mode FROM user_settings WHERE 1 = 1 ${ex}`)
      .bind(...excludeIds)
      .all();

    return {
      usersTotal: await one(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE 1 = 1 ${ex}`),
      newToday: await firstSeen(since.today),
      newWeek: await firstSeen(since.week),
      activeToday: await active(since.today),
      activeWeek: await active(since.week),
      activeMonth: await active(since.month),
      returning: await one(
        `SELECT COUNT(*) AS n FROM (SELECT user_id FROM events WHERE type = 'dream_ok' ${ex} ` +
          "GROUP BY user_id HAVING COUNT(DISTINCT substr(created_at, 1, 10)) >= 2)",
      ),
      dreamsToday: await count("dream_ok", since.today),
      dreamsWeek: await count("dream_ok", since.week),
      dreamsTotal: await count("dream_ok", "0"),
      failsToday: await count("model_fail", since.today),
      failsWeek: await count("model_fail", since.week),
      limitToday: await count("limit_hit", since.today),
      crisisWeek: await count("crisis", since.week),
      choices: settings.results || [],
    };
  }

  async deleteAll(userId) {
    const res = await this.db.prepare("DELETE FROM dreams WHERE user_id = ?").bind(userId).run();
    return res.meta.changes;
  }
}
