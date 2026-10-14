// Дневник снов в Cloudflare D1 (SQLite).

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

  async deleteAll(userId) {
    const res = await this.db.prepare("DELETE FROM dreams WHERE user_id = ?").bind(userId).run();
    return res.meta.changes;
  }
}
